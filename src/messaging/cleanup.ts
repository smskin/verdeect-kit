// Очистка outbox и inbox (prd.md §3.4, UC-9, AC-5.11, AC-5.12, AC-9.5). Эталон — O messaging-cleanup.job.ts (ошибка одной
// таблицы не мешает другой); по PRD — runExclusive, пачки на соединении блокировки (E4 KT-22 п. 4), раз в час. Метрика —
// verdeect_cleanup_runs_total{table: outbox|inbox} (общая, E4 П8), число строк — info-лог. Расписание и итог прохода —
// по образцу IdempotencyCleanup. Прямой DELETE под ролью приложения с пустым тенантом: outbox — исключение политики,
// inbox без RLS (П15). Значения /database (runExclusive, deleteInBatches) передаёт forRoot: messaging их не импортирует.
import { sql, type SQL } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type * as Database from '../database/index.js';
import type { PoolClient } from '../database/pg.js';
import { resultOf } from '../internal/cleanup-result.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { nestLog, type MessagingLog } from './rabbit-connection.js';
import type { KitInboxTable, KitOutboxTable } from './tables.js';
import {
    CLEANUP_BATCH_SIZE,
    CLEANUP_INTERVAL_MS,
    CLEANUP_MAX_BATCHES,
    RETENTION_DAYS,
} from './topology.js';

/** Пределы прохода. */
interface CleanupLimits {
    readonly batchSize: number;
    readonly maxBatches: number;
}

type CleanupTable = 'outbox' | 'inbox';

/** Зависимости очистки (внутренние). */
export interface MessagingCleanupDeps {
    /** `Db` сервиса. */
    readonly db: Database.Db;
    /** Значения /database из динамического импорта `forRoot`. */
    readonly database: Pick<typeof Database, 'runExclusive' | 'deleteInBatches'>;
    /** Схема сервиса. */
    readonly schema: string;
    /** Заданные таблицы. */
    readonly tables: { readonly outbox?: KitOutboxTable; readonly inbox?: KitInboxTable };
    /** Метрики. */
    readonly metrics?: KitMetrics;
    /** Логгер. */
    readonly log?: MessagingLog;
}

/**
 * Пачка удаления строк старше RETENTION_DAYS по колонке времени. `lock` — `FOR UPDATE SKIP LOCKED` (outbox: строки
 * держит relay); inbox — без него: проход один (runExclusive), а `FOR UPDATE` потребовал бы права UPDATE у роли
 * приложения (сервис выдаёт на inbox только SELECT, INSERT, DELETE).
 */
function batchSql(
    table: KitOutboxTable | KitInboxTable,
    column: string,
    lock: boolean,
): (batch: number) => SQL {
    const config = getTableConfig(table);
    const name = sql.raw(`${quoteIdentifier(config.schema ?? '')}.${quoteIdentifier(config.name)}`);
    const at = sql.raw(quoteIdentifier(column));
    const locking = sql.raw(lock ? ' for update skip locked' : '');

    return (batch) =>
        sql`with d as (delete from ${name} where id in (
            select id from ${name} where ${at} < now() - make_interval(days => ${RETENTION_DAYS})
            order by ${at} limit ${batch}${locking}) returning 1)
            select count(*)::int as deleted from d`;
}

/** Очистка опубликованного outbox и inbox старше 7 дней одной репликой (внутренний класс модуля). */
export class MessagingCleanup {
    private readonly log: MessagingLog;
    private readonly tables: readonly (readonly [CleanupTable, (batch: number) => SQL])[];
    private stopped = false;
    private interval: NodeJS.Timeout | undefined;
    private current: Promise<void> | undefined;
    private running = false;

    constructor(private readonly deps: MessagingCleanupDeps) {
        this.log = deps.log ?? nestLog('MessagingCleanup');
        const { outbox, inbox } = deps.tables;
        this.tables = [
            ...(outbox === undefined
                ? []
                : [['outbox', batchSql(outbox, 'published_at', true)] as const]),
            ...(inbox === undefined
                ? []
                : [['inbox', batchSql(inbox, 'received_at', false)] as const]),
        ];
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

    /** Проход очистки; идущий проход не накладывается. Ошибка не пробрасывается. */
    run(
        limits: CleanupLimits = { batchSize: CLEANUP_BATCH_SIZE, maxBatches: CLEANUP_MAX_BATCHES },
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

    /** Шаг 3 остановки: пачка дорабатывает, новая (и новая таблица) не начинается. */
    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        clearInterval(this.interval);
        await this.current;
    }

    private async pass(limits: CleanupLimits): Promise<void> {
        const { db, database, schema } = this.deps;
        const tables = this.tables.map(([name]) => name);
        try {
            const outcome = await database.runExclusive(
                db,
                `verdeect-kit:messaging-cleanup:${schema}`,
                async (connection) => {
                    for (const [name, sqlOf] of this.tables) {
                        if (this.stopped) {
                            break;
                        }
                        await this.cleanTable(name, sqlOf, limits, connection);
                    }
                },
            );
            if (!outcome.ran) {
                this.log.debug({ tables }, 'очистка сообщений: другая реплика');
            }
        } catch (error) {
            // Блокировку взять не удалось (БД недоступна): ошибка обеих таблиц.
            for (const table of tables) {
                this.deps.metrics?.cleanupRuns.inc({ table, result: 'error' });
            }
            this.log.error({ tables, err: sanitizeError(error) }, 'очистка сообщений: ошибка');
            captureError(error);
        }
    }

    private async cleanTable(
        table: CleanupTable,
        sqlOf: (batch: number) => SQL,
        limits: CleanupLimits,
        connection: PoolClient,
    ): Promise<void> {
        try {
            // Пачки — на соединении блокировки: второе соединение пула не берётся (KT-22 п. 4).
            const { deleted, batches, complete } = await this.deps.database.deleteInBatches({
                db: this.deps.db,
                sql: sqlOf,
                ...limits,
                shouldContinue: () => !this.stopped,
                connection,
            });
            const result = resultOf(complete, batches, limits.maxBatches);
            this.deps.metrics?.cleanupRuns.inc({ table, result });
            this.log.info({ table, deleted, batches, result }, 'очистка сообщений: проход');
        } catch (error) {
            this.deps.metrics?.cleanupRuns.inc({ table, result: 'error' });
            this.log.error({ table, err: sanitizeError(error) }, 'очистка сообщений: ошибка');
            captureError(error);
        }
    }
}
