// Сборка пулов /database (prd.md §3.3, §3.8 v1.26, AC-4.5, AC-4.19; KT-77): основной пул и пул чтения с обработчиками
// error/connect и учётом срока пула. Без @nestjs/*: общая для KitDatabaseModule и createTestDb (/testing не грузит
// kit-database.module.ts). Перенесено из kit-database.module.ts (эталон O drizzle.provider.ts: READ_POOL_OPTIONS).
import { isPoolTimeout, tagPoolTimeout, type KitPoolName } from '../internal/pg-errors.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureThrottled } from '../observability/sentry.js';
import { loadPg, type Pool } from './pg.js';

/** Предел запроса пула чтения, мс. */
export const READ_STATEMENT_TIMEOUT_MS = 5000;

/**
 * Параметры старта соединений пула чтения (эталон O): одиночный запрос — read-only транзакция, срок 5 с, `app.tenant`
 * пуст с подключения.
 */
export const READ_POOL_OPTIONS = `-c default_transaction_read_only=on -c statement_timeout=${READ_STATEMENT_TIMEOUT_MS} -c app.tenant=`;

/** Пулы `/database`. */
export interface KitPools {
    /** Основной пул. */
    readonly main: Pool;
    /** Пул чтения. */
    readonly read: Pool;
}

/** Логгер сборки пулов: поля и сообщение (Nest `Logger` модуля или логгер `createTestDb`). */
export interface KitPoolsLog {
    /** Предупреждение. */
    warn(fields: Record<string, unknown>, message: string): void;
    /** Отладка. */
    debug(fields: Record<string, unknown>, message: string): void;
}

/** Опции сборки пулов. */
export interface BuildPoolsOptions {
    /** Адрес БД; не логируется. */
    readonly url: string;
    /** Соединений в каждом пуле. */
    readonly max: number;
    /** Срок установки соединения и ожидания клиента, мс. */
    readonly connectionTimeoutMs: number;
    /** Метрики пакета (`dbPoolWaitTimeouts`). */
    readonly metrics?: KitMetrics;
    /** Логгер. */
    readonly log: KitPoolsLog;
}

type ConnectCallback = (error: Error | undefined, ...rest: unknown[]) => void;

/**
 * Учёт срока пула (AC-4.5, KT-19 п. 3): обёртка `connect` экземпляра — через неё идут и транзакции `Db`, и
 * `pool.query` (`DRIZZLE`, `readGlobal`). Срок помечается именем пула один раз: метрика, `captureThrottled`, `warn`.
 */
function instrumentPoolTimeouts(
    pool: Pool,
    name: KitPoolName,
    log: KitPoolsLog,
    metrics?: KitMetrics,
): void {
    const report = (error: unknown): void => {
        if (!isPoolTimeout(error) || !tagPoolTimeout(error, name)) {
            return;
        }
        metrics?.dbPoolWaitTimeouts.inc({ pool: name });
        captureThrottled(`db-pool-timeout:${name}`, error);
        log.warn({ pool: name }, 'пул БД: истёк срок ожидания клиента');
    };
    const original = pool.connect.bind(pool) as (callback?: ConnectCallback) => unknown;
    const connect = (callback?: ConnectCallback): unknown => {
        if (typeof callback === 'function') {
            return original((error, ...rest) => {
                if (error) {
                    report(error);
                }
                callback(error, ...rest);
            });
        }

        return (original() as Promise<unknown>).catch((error: unknown) => {
            report(error);
            throw error;
        });
    };
    // boundary: pg-pool connect перегружен (промис и обратный вызов) — обёртка сохраняет оба вида.
    pool.connect = connect as Pool['connect'];
}

/** Основной пул и пул чтения с учётом срока; адрес не логируется. */
export async function buildPools(options: BuildPoolsOptions): Promise<KitPools> {
    const pg = await loadPg();
    const { log } = options;
    const create = (name: KitPoolName): Pool => {
        const pool = new pg.Pool({
            connectionString: options.url,
            max: options.max,
            connectionTimeoutMillis: options.connectionTimeoutMs,
            ...(name === 'read' ? { options: READ_POOL_OPTIONS } : {}),
        });
        const onError = (error: Error): void =>
            log.warn(
                { pool: name, err: sanitizeError(error) },
                'пул БД: ошибка простаивающего клиента',
            );
        pool.on('error', onError);
        // pg-pool снимает свой обработчик 'error' с выданного клиента: без своего обрыв уронил бы процесс.
        pool.on('connect', (client) => void client.on('error', onError));
        instrumentPoolTimeouts(pool, name, log, options.metrics);
        log.debug({ pool: name, max: options.max }, 'пул БД: создан');

        return pool;
    };

    return { main: create('main'), read: create('read') };
}
