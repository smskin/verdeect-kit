// Очистка outbox и inbox (prd.md §3.4, UC-9, AC-5.11, AC-5.12, AC-9.5). Эталон — O messaging-cleanup.job.ts (ошибка одной
// таблицы не мешает другой); по PRD — runExclusive, пачки на соединении блокировки (E4 KT-22 п. 4), раз в час. Метрика —
// verdeect_cleanup_runs_total{table: outbox|inbox} (общая, E4 П8), число строк — info-лог. Расписание и итог прохода —
// по образцу IdempotencyCleanup. Прямой DELETE под ролью приложения с пустым тенантом: outbox — исключение политики,
// inbox без RLS (П15). Значения /database (runExclusive, deleteInBatches) передаёт forRoot: messaging их не импортирует.
// v1.31 (AC-5.12): расписание — цепочка таймеров cleanupClock: замок занят — через 5–6 мин, иначе — через час.
// v1.34 (§3.4 стр. 134, AC-5.24): серия backgroundFailed('messaging-cleanup') — один сбой за проход по первой ошибке
// (замок или любая таблица), backgroundSucceeded — только если все таблицы без ошибки; занятый замок и остановка — ничего.
import { sql, type SQL } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type * as Database from '../database/index.js';
import type { PoolClient } from '../database/pg.js';
import { resultOf } from '../internal/cleanup-result.js';
import {
    cleanupClock,
    nextCleanupDelay,
    type CleanupOutcome,
} from '../internal/cleanup-schedule.js';
import { messagingCleanupLockKey } from '../internal/outbox-policy.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import { backgroundFailed, backgroundSucceeded } from '../observability/background-failures.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { nestLog, type MessagingLog } from './rabbit-connection.js';
import type { KitInboxTable, KitOutboxTable } from './tables.js';
import { CLEANUP_BATCH_SIZE, CLEANUP_MAX_BATCHES, RETENTION_DAYS } from './topology.js';

/** Пределы прохода. */
interface CleanupLimits {
    readonly batchSize: number;
    readonly maxBatches: number;
}

type CleanupTable = 'outbox' | 'inbox';

/** task серии сбоев прохода очистки сообщений (§3.4 v1.34). */
const CLEANUP_TASK = 'messaging-cleanup';

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
    /** Фоновые циклы (`createTestApp({backgroundLoops})`); `false` — очистка не планируется. Умолчание `true`. */
    readonly backgroundLoops?: boolean;
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
    /** `stopLoops()`: расписание остановлено, `run()` по вызову работает. */
    private loopsStopped = false;
    private timer: NodeJS.Timeout | undefined;
    private current: Promise<unknown> | undefined;
    private pending: Promise<CleanupOutcome> | undefined;
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

    /** Первый проход сразу после старта, дальше — по расписанию `runScheduled`. */
    onApplicationBootstrap(): void {
        if (this.deps.backgroundLoops === false) {
            this.log.debug(
                {},
                'очистка сообщений: фоновые циклы отключены (backgroundLoops: false)',
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
            { table: this.tables.map(([name]) => name), delayMs, outcome },
            'очистка: следующий проход запланирован',
        );
    }

    /** Текущий проход (включая ещё не начатый первый); нет — разрешённый промис. */
    idle(): Promise<void> {
        return (this.current ?? Promise.resolve()).then(() => undefined);
    }

    /**
     * Проход очистки; идущий проход не накладывается (параллельный вызов получает его промис). Ошибка не пробрасывается.
     * Итог — `{ran}`: `false` — замок у другой реплики, остановка или ошибка прохода (серия `messaging-cleanup`).
     */
    async run(
        limits: CleanupLimits = { batchSize: CLEANUP_BATCH_SIZE, maxBatches: CLEANUP_MAX_BATCHES },
    ): Promise<{ readonly ran: boolean }> {
        return { ran: (await this.passOnce(limits)) === 'done' };
    }

    /** Один проход; параллельный вызов получает идущий. Остановлено — `busy` без прохода (расписание не строится). */
    private passOnce(
        limits: CleanupLimits = { batchSize: CLEANUP_BATCH_SIZE, maxBatches: CLEANUP_MAX_BATCHES },
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

    /** Шаг 3 остановки: пачка дорабатывает, новая (и новая таблица) не начинается. */
    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        cleanupClock.clearTimeout(this.timer);
        await this.current;
    }

    private async pass(limits: CleanupLimits): Promise<CleanupOutcome> {
        const { db, database, schema } = this.deps;
        const tables = this.tables.map(([name]) => name);
        let failure: { readonly error: unknown } | undefined;
        try {
            const outcome = await database.runExclusive(
                db,
                messagingCleanupLockKey(schema),
                async (connection) => {
                    for (const [name, sqlOf] of this.tables) {
                        if (this.stopped) {
                            break;
                        }
                        const error = await this.cleanTable(name, sqlOf, limits, connection);
                        if (error !== undefined) {
                            failure ??= { error };
                        }
                    }
                },
            );
            if (!outcome.ran) {
                this.log.debug({ tables }, 'очистка сообщений: другая реплика');

                return 'busy';
            }
        } catch (error) {
            // Блокировку взять не удалось (БД недоступна): ошибка обеих таблиц.
            for (const table of tables) {
                this.deps.metrics?.cleanupRuns.inc({ table, result: 'error' });
            }
            failure ??= { error };
        }
        if (this.stopped) {
            // Остановка: серия не меняется (§3.4 v1.34).
            return failure === undefined ? 'done' : 'error';
        }
        if (failure !== undefined) {
            backgroundFailed(CLEANUP_TASK, failure.error, this.log);

            return 'error';
        }
        backgroundSucceeded(CLEANUP_TASK, this.log);

        return 'done';
    }

    /** Ошибка таблицы возвращается в итог прохода (без своего error-лога и события); иначе `undefined`. */
    private async cleanTable(
        table: CleanupTable,
        sqlOf: (batch: number) => SQL,
        limits: CleanupLimits,
        connection: PoolClient,
    ): Promise<unknown> {
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

            return undefined;
        } catch (error) {
            this.deps.metrics?.cleanupRuns.inc({ table, result: 'error' });
            this.log.debug(
                { table, err: sanitizeError(error) },
                'очистка сообщений: ошибка таблицы',
            );

            return error;
        }
    }
}
