// KitIdempotencyModule.forRoot({table}) (prd.md §3.3а v1.14, AC-4.14, AC-9.5, UC-9). Эталон — O idempotency.module.ts +
// idempotency-cleanup.job.ts (раз в час, пачка 1000, до 100 пачек, остановка); по PRD: очистка через runExclusive
// функцией idempotency_purge пачками; нет функции — отказ запуска; расписание — таймер (без @nestjs/schedule); пулы и
// шаги остановки — хуки Nest (KitLifecycle не используется).
import {
    Inject,
    Injectable,
    Logger,
    Module,
    Optional,
    type BeforeApplicationShutdown,
    type DynamicModule,
    type OnApplicationBootstrap,
    type OnModuleInit,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Logger as PinoLogger } from 'pino';
import { deleteInBatches } from '../database/batches.js';
import { Db } from '../database/db.js';
import { runExclusive } from '../database/run-exclusive.js';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import { KIT_LOGGER, KIT_METRICS } from '../internal/tokens.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { IdempotencyInterceptor, KIT_IDEMPOTENCY_TABLE } from './idempotency.interceptor.js';
import { IDEMPOTENCY_TABLE, PURGE_FUNCTION, type KitIdempotencyTable } from './table.js';

/** Интервал очистки (эталон O — раз в час). */
const CLEANUP_INTERVAL_MS = 3_600_000;

/** Пределы прохода по умолчанию (эталон O). */
const CLEANUP_LIMITS = { batchSize: 1000, maxBatches: 100 } as const;

/** Схема таблицы (внутренний токен). */
const KIT_IDEMPOTENCY_SCHEMA = Symbol('KIT_IDEMPOTENCY_SCHEMA');

/** Опции `KitIdempotencyModule.forRoot`. */
export interface KitIdempotencyModuleOptions {
    /** Таблица `createIdempotencyTable(pgSchema(…))` схемы сервиса. */
    readonly table: KitIdempotencyTable;
}

/** Логгер прохода: pino экземпляра (`service`, `replica` в `base`) или логгер Nest. */
interface CleanupLog {
    debug(fields: object, message: string): void;
    info(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

function nestLog(): CleanupLog {
    const logger = new Logger('IdempotencyCleanup');

    return {
        debug: (fields, message) => logger.debug(fields, message),
        info: (fields, message) => logger.log(fields, message),
        error: (fields, message) => logger.error(fields, message),
    };
}

/** Очистка записей старше 24 ч одной репликой (UC-9); внутренний класс модуля. */
@Injectable()
export class IdempotencyCleanup
    implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown
{
    private readonly log: CleanupLog;
    private stopped = false;
    private interval: NodeJS.Timeout | undefined;
    private current: Promise<void> | undefined;
    private running = false;

    constructor(
        private readonly db: Db,
        @Inject(KIT_IDEMPOTENCY_SCHEMA) private readonly schema: string,
        @Optional() @Inject(KIT_METRICS) private readonly metrics?: KitMetrics,
        @Optional() @Inject(KIT_LOGGER) logger?: PinoLogger,
    ) {
        this.log = logger ?? nestLog();
    }

    /** До прослушивания порта: функция очистки есть, иначе отказ запуска. */
    async onModuleInit(): Promise<void> {
        const signature = `${quoteIdentifier(this.schema)}.${quoteIdentifier(PURGE_FUNCTION)}(integer)`;
        const { rows } = await this.db.readGlobal((reader) =>
            reader.execute<{ ok: boolean }>(
                sql`select to_regprocedure(${signature}) is not null as ok`,
            ),
        );
        if (rows[0]?.ok !== true) {
            throw new Error(
                `KitIdempotencyModule: нет функции ${this.schema}.${PURGE_FUNCTION} — добавьте idempotencyPurgeSql(${this.schema}) в SQL-миграцию сервиса`,
            );
        }
    }

    /** Первый проход сразу после старта, затем раз в час. */
    onApplicationBootstrap(): void {
        this.current = new Promise<void>((resolve) => {
            setTimeout(resolve, 0).unref();
        }).then(() => this.run());
        this.interval = setInterval(() => void this.run(), CLEANUP_INTERVAL_MS);
        this.interval.unref();
    }

    /** Текущий проход (включая ещё не начатый первый); нет — разрешённый промис. */
    idle(): Promise<void> {
        return this.current ?? Promise.resolve();
    }

    /** Проход очистки; идущий проход не накладывается (пропуск). Ошибка не пробрасывается. */
    run(
        limits: { readonly batchSize: number; readonly maxBatches: number } = CLEANUP_LIMITS,
    ): Promise<void> {
        if (this.stopped) {
            return Promise.resolve();
        }
        if (this.running && this.current !== undefined) {
            return this.current;
        }
        this.running = true;
        const pass = this.pass(limits).finally(() => {
            this.running = false;
        });
        this.current = pass;

        return pass;
    }

    /** Шаг 3 остановки: пачка дорабатывает, новая не начинается. */
    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        clearInterval(this.interval);
        await this.current;
    }

    private async pass(limits: {
        readonly batchSize: number;
        readonly maxBatches: number;
    }): Promise<void> {
        const table = IDEMPOTENCY_TABLE;
        const fn = sql.raw(`${quoteIdentifier(this.schema)}.${quoteIdentifier(PURGE_FUNCTION)}`);
        try {
            const outcome = await runExclusive(
                this.db,
                `verdeect-kit:idempotency-cleanup:${this.schema}`,
                () =>
                    deleteInBatches({
                        db: this.db,
                        sql: (batch) => sql`select ${fn}(${batch}::int) as deleted`,
                        ...limits,
                        shouldContinue: () => !this.stopped,
                    }),
            );
            if (!outcome.ran) {
                this.log.debug({ table }, 'очистка идемпотентности: другая реплика');

                return;
            }
            const { deleted, batches, complete } = outcome.result;
            const result = !complete && batches === limits.maxBatches ? 'partial' : 'ok';
            this.metrics?.cleanupRuns.inc({ table, result });
            this.log.info({ table, deleted, batches, result }, 'очистка идемпотентности: проход');
        } catch (error) {
            this.metrics?.cleanupRuns.inc({ table, result: 'error' });
            this.log.error({ table, err: sanitizeError(error) }, 'очистка идемпотентности: ошибка');
            captureError(error);
        }
    }
}

/**
 * Идемпотентность маршрутов `@Idempotent` (§3.3а): интерсептор на `Db` сервиса, проверка функции
 * `idempotency_purge` при старте, очистка записей старше 24 ч раз в час одной репликой. Требует `KitDatabaseModule`.
 */
@Module({})
export class KitIdempotencyModule {
    /**
     * Модуль с таблицей сервиса.
     * @throws {TypeError} таблица без схемы или имя схемы вне формата имени сервиса.
     */
    static forRoot(options: KitIdempotencyModuleOptions): DynamicModule {
        const schema = getTableConfig(options.table).schema;
        if (schema === undefined) {
            throw new TypeError(
                'KitIdempotencyModule: таблица без схемы — createIdempotencyTable(pgSchema(…))',
            );
        }
        assertServiceName(schema, 'KitIdempotencyModule');

        return {
            module: KitIdempotencyModule,
            global: true,
            providers: [
                { provide: KIT_IDEMPOTENCY_TABLE, useValue: options.table },
                { provide: KIT_IDEMPOTENCY_SCHEMA, useValue: schema },
                { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
                IdempotencyCleanup,
            ],
        };
    }
}
