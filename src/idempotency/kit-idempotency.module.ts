// KitIdempotencyModule.forRoot({table}) (prd.md §3.3а v1.14, AC-4.14, AC-9.5, UC-9). Эталон — O idempotency.module.ts +
// idempotency-cleanup.job.ts (раз в час, пачка 1000, до 100 пачек, остановка); по PRD: очистка через runExclusive
// функцией idempotency_purge пачками; нет функции — отказ запуска; расписание — таймер (без @nestjs/schedule); пулы и
// шаги остановки — хуки Nest (KitLifecycle не используется). v1.31 (AC-5.12): расписание — цепочка таймеров
// cleanupClock: замок занят — через 5–6 мин, иначе — через час. v1.34 (§3.3а стр. 117, AC-5.24): ошибка прохода — серия
// backgroundFailed('idempotency-cleanup'), выполненный проход — backgroundSucceeded, занятый замок и остановка — ничего.
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
import { resultOf } from '../internal/cleanup-result.js';
import {
    cleanupClock,
    nextCleanupDelay,
    type CleanupOutcome,
} from '../internal/cleanup-schedule.js';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import { KIT_BACKGROUND_LOOPS, KIT_LOGGER, KIT_PACKAGE_METRICS } from '../internal/tokens.js';
import { requireKitCore } from '../internal/kit-core-required.js';
import { backgroundFailed, backgroundSucceeded } from '../observability/background-failures.js';
import type { KitMetrics } from '../observability/metrics.js';
import { IdempotencyInterceptor, KIT_IDEMPOTENCY_TABLE } from './idempotency.interceptor.js';
import { IDEMPOTENCY_TABLE, PURGE_FUNCTION, type KitIdempotencyTable } from './table.js';

/** Пределы прохода по умолчанию (эталон O). */
const CLEANUP_LIMITS = { batchSize: 1000, maxBatches: 100 } as const;

/** Схема таблицы (внутренний токен). */
const KIT_IDEMPOTENCY_SCHEMA = Symbol('KIT_IDEMPOTENCY_SCHEMA');

/** Опции `KitIdempotencyModule.forRoot`. */
export interface KitIdempotencyModuleOptions {
    /** Таблица `createIdempotencyTable(pgSchema(…))` схемы сервиса. */
    readonly table: KitIdempotencyTable;
}

/** task серии сбоев прохода очистки идемпотентности (§3.3а v1.34). */
const CLEANUP_TASK = 'idempotency-cleanup';

/** Логгер прохода: pino экземпляра (`service`, `replica` в `base`) или логгер Nest. */
interface CleanupLog {
    debug(fields: object, message: string): void;
    info(fields: object, message: string): void;
    warn(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

function nestLog(): CleanupLog {
    const logger = new Logger('IdempotencyCleanup');

    return {
        debug: (fields, message) => logger.debug(fields, message),
        info: (fields, message) => logger.log(fields, message),
        warn: (fields, message) => logger.warn(fields, message),
        error: (fields, message) => logger.error(fields, message),
    };
}

/** Очистка записей старше 24 ч одной репликой (UC-9); внутренний класс модуля. */
@Injectable()
export class IdempotencyCleanup
    implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown
{
    private readonly log: CleanupLog;
    private readonly metrics: KitMetrics;
    private stopped = false;
    /** `stopLoops()`: расписание остановлено, `run()` по вызову работает. */
    private loopsStopped = false;
    private timer: NodeJS.Timeout | undefined;
    private current: Promise<unknown> | undefined;
    private pending: Promise<CleanupOutcome> | undefined;
    private running = false;

    constructor(
        private readonly db: Db,
        @Inject(KIT_IDEMPOTENCY_SCHEMA) private readonly schema: string,
        @Optional() @Inject(KIT_PACKAGE_METRICS) metrics?: KitMetrics,
        @Optional() @Inject(KIT_LOGGER) logger?: PinoLogger,
        @Optional() @Inject(KIT_BACKGROUND_LOOPS) private readonly backgroundLoops?: boolean,
    ) {
        this.metrics = requireKitCore(metrics, 'KitIdempotencyModule');
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

    /** Первый проход сразу после старта, дальше — по расписанию `runScheduled`. */
    onApplicationBootstrap(): void {
        if (this.backgroundLoops === false) {
            this.log.debug(
                {},
                'очистка идемпотентности: фоновые циклы отключены (backgroundLoops: false)',
            );

            return;
        }
        this.current = new Promise<void>((resolve) => {
            setTimeout(resolve, 0).unref();
        }).then(() => this.runScheduled());
    }

    /**
     * @internal Проход и планирование следующего (§3.4 v1.31): выполнен или ошибка — через час, замок занят — через
     * 5 мин + до 1 мин. После остановки следующий не планируется.
     */
    async runScheduled(): Promise<void> {
        if (this.loopsStopped) {
            return;
        }
        const outcome = await this.passOnce();
        if (this.stopped || this.loopsStopped) {
            return;
        }
        const delayMs = nextCleanupDelay(outcome);
        cleanupClock.clearTimeout(this.timer);
        this.timer = cleanupClock.setTimeout(() => void this.runScheduled(), delayMs);
        this.log.debug(
            { scope: 'idempotency', delayMs, outcome },
            'очистка: следующий проход запланирован',
        );
    }

    /** Текущий проход (включая ещё не начатый первый); нет — разрешённый промис. */
    async idle(): Promise<void> {
        await this.current;
    }

    /** Проход очистки; идущий проход не накладывается (пропуск). Ошибка не пробрасывается. */
    async run(
        limits: { readonly batchSize: number; readonly maxBatches: number } = CLEANUP_LIMITS,
    ): Promise<void> {
        await this.passOnce(limits);
    }

    /** Один проход; параллельный вызов получает идущий. Остановлено — `busy` без прохода. */
    private passOnce(
        limits: { readonly batchSize: number; readonly maxBatches: number } = CLEANUP_LIMITS,
    ): Promise<CleanupOutcome> {
        if (this.stopped) {
            return Promise.resolve('busy');
        }
        if (this.running && this.pending !== undefined) {
            return this.pending;
        }
        this.running = true;
        const pass = this.pass(limits).finally(() => {
            this.running = false;
        });
        this.pending = pass;
        this.current = pass;

        return pass;
    }

    /**
     * @internal Остановка расписания для тестов (`stopBackgroundLoops`): следующий проход не планируется, текущий
     * дорабатывает (ожидание без срока). Повтор — без действия, возобновления нет.
     */
    async stopLoops(): Promise<void> {
        this.loopsStopped = true;
        cleanupClock.clearTimeout(this.timer);
        await this.current;
    }

    /** Шаг 3 остановки: пачка дорабатывает, новая не начинается. */
    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        cleanupClock.clearTimeout(this.timer);
        await this.current;
    }

    private async pass(limits: {
        readonly batchSize: number;
        readonly maxBatches: number;
    }): Promise<CleanupOutcome> {
        const table = IDEMPOTENCY_TABLE;
        const fn = sql.raw(`${quoteIdentifier(this.schema)}.${quoteIdentifier(PURGE_FUNCTION)}`);
        try {
            const outcome = await runExclusive(
                this.db,
                `verdeect-kit:idempotency-cleanup:${this.schema}`,
                // Пачки — на соединении блокировки: очистка не берёт второе соединение пула (KT-22 п. 4).
                (connection) =>
                    deleteInBatches({
                        db: this.db,
                        sql: (batch) => sql`select ${fn}(${batch}::int) as deleted`,
                        ...limits,
                        shouldContinue: () => !this.stopped,
                        connection,
                    }),
            );
            if (!outcome.ran) {
                this.log.debug({ table }, 'очистка идемпотентности: другая реплика');

                return 'busy';
            }
            const { deleted, batches, complete } = outcome.result;
            const result = resultOf(complete, batches, limits.maxBatches);
            this.metrics.cleanupRuns.inc({ table, result });
            this.log.info({ table, deleted, batches, result }, 'очистка идемпотентности: проход');
            // Остановка серию не меняет (R9), как у очистки сообщений.
            if (!this.stopped) {
                backgroundSucceeded(CLEANUP_TASK, this.log);
            }

            return 'done';
        } catch (error) {
            this.metrics.cleanupRuns.inc({ table, result: 'error' });
            // Остановка серию не меняет (R9), как у очистки сообщений.
            if (!this.stopped) {
                backgroundFailed(CLEANUP_TASK, error, this.log);
            }

            return 'error';
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
