// Db (prd.md §3.3, AC-4.1–AC-4.5, AC-4.16, UC-5). Эталон — O db.ts + pool-client.ts (withPoolClient, новый Drizzle на
// клиент, afterCommit через WeakMap). Из I — отслеживание пачек для остановки (batchRuns). По PRD: read без тенанта —
// TenantRequiredError, readGlobal — пул чтения без транзакции, afterCommit в read-only — AfterCommitInReadOnlyError,
// setLocal. Срок пула учитывает сам пул (kit-database.module.ts, KT-19 п. 3).
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { isConnectionError } from '../internal/pg-errors.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import type { DrizzleDriver, NodePgDatabase, Pool, PoolClient } from './pg.js';
import { TENANT_SETTING, type DbContext } from './tenant.js';

/** Чтение через пул чтения (`readGlobal`): Drizzle node-postgres без транзакции. */
export type DbReader = NodePgDatabase;

/** Транзакция Drizzle node-postgres (`Db.transaction`, `Db.read`). */
export type DbTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/** Задача после `COMMIT` (`Db.afterCommit`). */
export type AfterCommitTask = () => void | Promise<void>;

/** `Db.read` без тенанта: чтение без компании — только `Db.readGlobal` (строгий RLS, P0). */
export class TenantRequiredError extends Error {
    override readonly name = 'TenantRequiredError';

    constructor() {
        super(
            'Db.read: нет тенанта в DbContext — для чтения без компании используйте Db.readGlobal',
        );
    }
}

/** `Db.afterCommit` в read-only транзакции или на `readGlobal`: задачи после `COMMIT` там невозможны. */
export class AfterCommitInReadOnlyError extends Error {
    override readonly name = 'AfterCommitInReadOnlyError';

    constructor() {
        super(
            'Db.afterCommit: read-only транзакция или readGlobal — задача после COMMIT невозможна',
        );
    }
}

/**
 * `Db.afterCommit` с дескриптором, который не является транзакцией этого `Db` (другой `Db`, `DRIZZLE`, вложенная
 * `tx.transaction()`): задача никогда бы не выполнилась — ошибка вместо молчаливой потери.
 */
export class AfterCommitOutsideTransactionError extends Error {
    override readonly name = 'AfterCommitOutsideTransactionError';

    constructor() {
        super(
            'Db.afterCommit: нужна транзакция этого Db (Db.transaction) — не вложенная и не другого Db',
        );
    }
}

/** Пулы и драйвер `Db`. */
export interface DbOptions {
    /** Основной пул (`transaction`, `runExclusive`). */
    readonly main: Pool;
    /** Пул чтения: `default_transaction_read_only`, `statement_timeout` 5 с (`read`, `readGlobal`). */
    readonly read: Pool;
    /** `drizzle()` из `loadDrizzle()`. */
    readonly drizzle: DrizzleDriver['drizzle'];
}

/** Имя переменной `Db.setLocal`. */
const LOCAL_NAME = /^app\.[a-z_]{1,48}$/;

/** Служебные переменные пакета: задаются только `DbContext` в `transaction`/`read`, не `setLocal` (KT-22 п. 1). */
const RESERVED_LOCALS: ReadonlySet<string> = new Set([TENANT_SETTING]);

interface DbInternals {
    readonly main: Pool;
    readonly runOn: <T>(
        client: PoolClient,
        ctx: DbContext,
        fn: (tx: DbTx) => Promise<T>,
    ) => Promise<T>;
    readonly batchRuns: Set<Promise<unknown>>;
    stopping: boolean;
}

const internals = new WeakMap<Db, DbInternals>();

function internalsOf(db: Db): DbInternals {
    const value = internals.get(db);
    if (value === undefined) {
        throw new TypeError('Db: объект не создан конструктором Db');
    }

    return value;
}

/** Основной пул `Db` (для `runExclusive`). */
export function mainPoolOf(db: Db): Pool {
    return internalsOf(db).main;
}

/**
 * Транзакция `Db` (тенант, `afterCommit`) на уже выданном клиенте — например, на соединении блокировки `runExclusive`,
 * без второго соединения пула (KT-22 п. 4). Клиент не возвращается в пул: им владеет вызывающий.
 */
export function transactionOn<T>(
    db: Db,
    client: PoolClient,
    ctx: DbContext,
    fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
    return internalsOf(db).runOn(client, ctx, fn);
}

/** Идёт остановка `Db` (шаг 3): новые пачки не начинаются. */
export function isStopping(db: Db): boolean {
    return internalsOf(db).stopping;
}

/** Регистрирует проход пачек: `beforeApplicationShutdown` дожидается его. */
export function trackBatchRun<T>(db: Db, run: Promise<T>): Promise<T> {
    const { batchRuns } = internalsOf(db);
    batchRuns.add(run);
    const forget = (): void => void batchRuns.delete(run);
    run.then(forget, forget);

    return run;
}

/**
 * Выделенный клиент пула на одну единицу работы; возвращается в пул всегда. Обрыв (событие `error` клиента или
 * ошибка соединения из `work`) — `release(err)`: pg-pool уничтожает клиента, пул не исчерпывается (AC-4.4). drizzle-orm
 * 0.45.4 выполняет BEGIN вне try/finally своей transaction() — поэтому клиент берётся здесь, а не Drizzle над пулом.
 */
export async function withPoolClient<T>(
    pool: Pool,
    work: (client: PoolClient) => Promise<T>,
    onBroken?: (error: Error) => void,
): Promise<T> {
    const client = await pool.connect();
    let broken: Error | undefined;
    const onError = (error: Error): void => {
        broken ??= error;
    };
    client.on('error', onError);
    try {
        return await work(client);
    } catch (error) {
        if (broken === undefined && isConnectionError(error)) {
            broken = error instanceof Error ? error : new Error('соединение БД разорвано');
        }
        throw error;
    } finally {
        client.removeListener('error', onError);
        client.release(broken);
        if (broken !== undefined) {
            onBroken?.(broken);
        }
    }
}

/**
 * Работа сервиса с БД под строгим RLS (§3.3): один `set_config('app.tenant', …, true)` на транзакцию, чтение без
 * тенанта — только `readGlobal`, задачи после `COMMIT`, своя переменная `app.*`. Собирается `KitDatabaseModule`.
 */
export class Db {
    private readonly logger = new Logger('Db');
    private readonly afterCommitTasks = new WeakMap<object, AfterCommitTask[]>();
    private readonly transactions = new WeakSet<object>();
    private readonly readOnly = new WeakSet<object>();
    private readonly drizzle: DbOptions['drizzle'];
    private readonly readPool: Pool;
    private readonly reader: DbReader;

    /** @param options пулы (с учётом срока — KitDatabaseModule) и драйвер Drizzle. */
    constructor(options: DbOptions) {
        this.drizzle = options.drizzle;
        this.readPool = options.read;
        this.reader = options.drizzle(options.read);
        this.readOnly.add(this.reader);
        internals.set(this, {
            main: options.main,
            runOn: (client, ctx, fn) => this.run(ctx, fn, false, client),
            batchRuns: new Set(),
            stopping: false,
        });
    }

    /** Транзакция чтения и записи на основном пуле с тенантом `ctx.tenant` (`null` — строки компаний не видны). */
    transaction<T>(ctx: DbContext, fn: (tx: DbTx) => Promise<T>): Promise<T> {
        return this.run(ctx, fn, false);
    }

    /**
     * Read-only транзакция на пуле чтения (`statement_timeout` 5 с) с тенантом.
     * @throws {TenantRequiredError} в `ctx` нет тенанта (до подключения).
     */
    read<T>(ctx: DbContext, fn: (tx: DbTx) => Promise<T>): Promise<T> {
        if (ctx.tenant === null || ctx.tenant === '') {
            return Promise.reject(new TenantRequiredError());
        }

        return this.run(ctx, fn, true);
    }

    /** Чтение без компании (глобальные таблицы): пул чтения без транзакции и без `set_config`. */
    async readGlobal<T>(fn: (db: DbReader) => Promise<T>): Promise<T> {
        return fn(this.reader);
    }

    /**
     * Задача после `COMMIT` транзакции `tx` — по порядку, до возврата результата `transaction`; при откате не
     * выполняется; ошибка задачи — `error`-лог и GlitchTip, не пробрасывается. Только для того, что можно потерять.
     * @throws {AfterCommitInReadOnlyError} `tx` — транзакция `read` или дескриптор `readGlobal`.
     * @throws {AfterCommitOutsideTransactionError} `tx` — не транзакция этого `Db` (другой `Db`, вложенная).
     */
    afterCommit(tx: DbTx | DbReader, task: AfterCommitTask): void {
        if (this.readOnly.has(tx)) {
            throw new AfterCommitInReadOnlyError();
        }
        if (!this.transactions.has(tx)) {
            throw new AfterCommitOutsideTransactionError();
        }
        const tasks = this.afterCommitTasks.get(tx) ?? [];
        tasks.push(task);
        this.afterCommitTasks.set(tx, tasks);
    }

    /**
     * Переменная транзакции `app.*` (`set_config(name, value, true)`), имя и значение — параметрами (AC-4.16).
     * Служебная `app.tenant` запрещена: тенант задаётся только `DbContext` в `transaction`/`read`.
     * @throws {TypeError} имя вне `^app\.[a-z_]{1,48}$`, служебное имя пакета или `tx` — не транзакция `Db`.
     */
    async setLocal(tx: DbTx | DbReader, name: string, value: string): Promise<void> {
        if (!LOCAL_NAME.test(name)) {
            throw new TypeError('Db.setLocal: имя вне ^app\\.[a-z_]{1,48}$');
        }
        if (RESERVED_LOCALS.has(name)) {
            throw new TypeError(
                `Db.setLocal: ${name} — служебная переменная пакета; тенант задаётся только DbContext в Db.transaction или Db.read`,
            );
        }
        if (!this.transactions.has(tx)) {
            throw new TypeError('Db.setLocal: нужна транзакция Db.transaction или Db.read');
        }
        await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    }

    /** Шаг 3 остановки: новые пачки `deleteInBatches` не начинаются, идущие дорабатывают. */
    async beforeApplicationShutdown(): Promise<void> {
        const state = internalsOf(this);
        state.stopping = true;
        this.logger.debug({ batches: state.batchRuns.size }, 'Db: остановка, ожидание пачек');
        await Promise.allSettled([...state.batchRuns]);
    }

    private async run<T>(
        ctx: DbContext,
        fn: (tx: DbTx) => Promise<T>,
        readOnly: boolean,
        held?: PoolClient,
    ): Promise<T> {
        const pool = readOnly ? this.readPool : mainPoolOf(this);
        let current: DbTx | undefined;
        // ponytail: экземпляр Drizzle на транзакцию (без схемы — микросекунды); кэш — если покажет профиль.
        const onClient = (client: PoolClient): Promise<T> =>
            this.drizzle(client).transaction(
                async (tx) => {
                    current = tx;
                    this.transactions.add(tx);
                    if (readOnly) {
                        this.readOnly.add(tx);
                    }
                    await tx.execute(
                        sql`select set_config('app.tenant', ${ctx.tenant ?? ''}, true)`,
                    );

                    return fn(tx);
                },
                { accessMode: readOnly ? 'read only' : 'read write' },
            );
        try {
            const result =
                held === undefined
                    ? await withPoolClient(pool, onClient, (error) =>
                          this.logger.debug(
                              { traceId: ctx.traceId, err: sanitizeError(error) },
                              'Db: соединение сломано, клиент уничтожен',
                          ),
                      )
                    : await onClient(held);
            await this.runAfterCommit(current, ctx.traceId);

            return result;
        } catch (error) {
            if (current !== undefined) {
                this.afterCommitTasks.delete(current);
            }
            this.logger.debug(
                {
                    tenant: ctx.tenant,
                    traceId: ctx.traceId,
                    readOnly,
                    err: sanitizeError(error),
                },
                'Db: транзакция откатилась',
            );
            throw error;
        }
    }

    private async runAfterCommit(tx: DbTx | undefined, traceId: string): Promise<void> {
        const tasks = tx === undefined ? undefined : this.afterCommitTasks.get(tx);
        if (tx === undefined || tasks === undefined) {
            return;
        }
        this.afterCommitTasks.delete(tx);
        for (const task of tasks) {
            try {
                await task();
            } catch (error) {
                this.logger.error(
                    { traceId, err: sanitizeError(error) },
                    'Db.afterCommit: задача упала',
                );
                captureError(error);
            }
        }
    }
}
