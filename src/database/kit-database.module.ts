// KitDatabaseModule.forRoot({schema}) (prd.md §3.3, AC-4.4, AC-4.5, UC-8). Эталон — O drizzle.provider.ts +
// database.module.ts: пулы main/read, READ_POOL_OPTIONS, обработчики error/connect, проба database, onApplicationShutdown
// — шаг 4. По PRD и KT-19 п. 3: срок пула учитывается на уровне пула (обёртка connect экземпляра) — метрика с меткой
// pool, captureThrottled и метка ошибки tagPoolTimeout; пробы database и database-read; KitLifecycle не используется.
import {
    Inject,
    Logger,
    Module,
    Optional,
    type DynamicModule,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KitDatabaseEnv } from '../config/fragments.js';
import { isPoolTimeout, tagPoolTimeout, type KitPoolName } from '../internal/pg-errors.js';
import { KIT_METRICS } from '../internal/tokens.js';
import { HealthRegistry } from '../observability/health-registry.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureThrottled } from '../observability/sentry.js';
import { Db } from './db.js';
import { loadDrizzle, loadPg, type NodePgDatabase, type Pool } from './pg.js';

/** Drizzle основного пула со схемой сервиса — запросы вне `Db` (`drizzle(pool, {schema})`). */
export const DRIZZLE = Symbol('DRIZZLE');

/** Drizzle пула чтения со схемой сервиса (read-only, `statement_timeout` 5 с). */
export const DRIZZLE_READ = Symbol('DRIZZLE_READ');

/** Пулы основной и чтения (внутренний токен). */
const KIT_PG_POOLS = Symbol('KIT_PG_POOLS');

/** Окружение модуля (внутренний токен). */
const KIT_DATABASE_ENV = Symbol('KIT_DATABASE_ENV');

/** Предел запроса пула чтения, мс. */
const READ_STATEMENT_TIMEOUT_MS = 5000;

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

/** Опции `KitDatabaseModule.forRoot`. */
export interface KitDatabaseModuleOptions {
    /** Объект схемы Drizzle сервиса (`import * as schema`) — для `DRIZZLE` и `DRIZZLE_READ`. */
    readonly schema: Record<string, unknown>;
}

const logger = new Logger('KitDatabase');

type ConnectCallback = (error: Error | undefined, ...rest: unknown[]) => void;

/**
 * Учёт срока пула (AC-4.5, KT-19 п. 3): обёртка `connect` экземпляра — через неё идут и транзакции `Db`, и
 * `pool.query` (`DRIZZLE`, `readGlobal`). Срок помечается именем пула один раз: метрика, `captureThrottled`, `warn`.
 */
function instrumentPoolTimeouts(pool: Pool, name: KitPoolName, metrics?: KitMetrics): void {
    const report = (error: unknown): void => {
        if (!isPoolTimeout(error) || !tagPoolTimeout(error, name)) {
            return;
        }
        metrics?.dbPoolWaitTimeouts.inc({ pool: name });
        captureThrottled(`db-pool-timeout:${name}`, error);
        logger.warn({ pool: name }, 'пул БД: истёк срок ожидания клиента');
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

/** Основной пул и пул чтения на `DATABASE_URL` с учётом срока; адрес не логируется. */
export async function createPools(
    env: KitDatabaseEnv,
    options: { readonly metrics?: KitMetrics } = {},
): Promise<KitPools> {
    const pg = await loadPg();
    const create = (name: KitPoolName): Pool => {
        const pool = new pg.Pool({
            connectionString: env.DATABASE_URL,
            max: env.DB_POOL_MAX,
            connectionTimeoutMillis: env.DB_POOL_ACQUIRE_TIMEOUT_MS,
            ...(name === 'read' ? { options: READ_POOL_OPTIONS } : {}),
        });
        const onError = (error: Error): void =>
            logger.warn(
                { pool: name, err: sanitizeError(error) },
                'пул БД: ошибка простаивающего клиента',
            );
        pool.on('error', onError);
        // pg-pool снимает свой обработчик 'error' с выданного клиента: без своего обрыв уронил бы процесс.
        pool.on('connect', (client) => void client.on('error', onError));
        instrumentPoolTimeouts(pool, name, options.metrics);
        logger.debug({ pool: name, max: env.DB_POOL_MAX }, 'пул БД: создан');

        return pool;
    };

    return { main: create('main'), read: create('read') };
}

function databaseEnv(config: ConfigService | undefined): KitDatabaseEnv {
    if (config === undefined) {
        throw new Error(
            'KitDatabaseModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envDatabase',
        );
    }

    return {
        DATABASE_URL: config.getOrThrow<string>('DATABASE_URL'),
        DB_POOL_MAX: config.getOrThrow<number>('DB_POOL_MAX'),
        DB_POOL_ACQUIRE_TIMEOUT_MS: config.getOrThrow<number>('DB_POOL_ACQUIRE_TIMEOUT_MS'),
    };
}

/**
 * Глобальный модуль БД сервиса (§3.3): `Db`, `DRIZZLE`, `DRIZZLE_READ`; пробы `database` и `database-read` (критичные,
 * при `createHttpApp`), метрика срока пула; пулы закрываются на шаге 4 (`onApplicationShutdown`). Окружение —
 * `envDatabase` из `KitConfigModule`. Соединений на реплику — `2 × DB_POOL_MAX`.
 */
@Module({})
export class KitDatabaseModule implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(KitDatabaseModule.name);

    constructor(
        @Inject(KIT_PG_POOLS) private readonly pools: KitPools,
        @Optional() private readonly health?: HealthRegistry,
    ) {}

    /** Модуль БД со схемой Drizzle сервиса. */
    static forRoot(options: KitDatabaseModuleOptions): DynamicModule {
        const withSchema = async (pool: Pool): Promise<NodePgDatabase<Record<string, unknown>>> =>
            (await loadDrizzle()).drizzle(pool, { schema: options.schema });

        return {
            module: KitDatabaseModule,
            global: true,
            providers: [
                {
                    provide: KIT_DATABASE_ENV,
                    useFactory: databaseEnv,
                    inject: [{ token: ConfigService, optional: true }],
                },
                {
                    provide: KIT_PG_POOLS,
                    useFactory: (env: KitDatabaseEnv, metrics?: KitMetrics) =>
                        createPools(env, { metrics }),
                    inject: [KIT_DATABASE_ENV, { token: KIT_METRICS, optional: true }],
                },
                {
                    provide: DRIZZLE,
                    useFactory: (pools: KitPools) => withSchema(pools.main),
                    inject: [KIT_PG_POOLS],
                },
                {
                    provide: DRIZZLE_READ,
                    useFactory: (pools: KitPools) => withSchema(pools.read),
                    inject: [KIT_PG_POOLS],
                },
                {
                    provide: Db,
                    useFactory: async (pools: KitPools) =>
                        new Db({ ...pools, drizzle: (await loadDrizzle()).drizzle }),
                    inject: [KIT_PG_POOLS],
                },
            ],
            exports: [Db, DRIZZLE, DRIZZLE_READ],
        };
    }

    /** Пробы `/health` обоих пулов — `select 1` (без `Db.read`: ему нужен тенант). */
    onModuleInit(): void {
        if (this.health === undefined) {
            return;
        }
        const probe = (pool: Pool) => async (): Promise<boolean> => {
            await pool.query('select 1');

            return true;
        };
        this.health.register('database', probe(this.pools.main), { critical: true });
        this.health.register('database-read', probe(this.pools.read), { critical: true });
    }

    /** Шаг 4 остановки: закрытие пулов после HTTP и фоновых задач. */
    async onApplicationShutdown(): Promise<void> {
        const { main, read } = this.pools;
        this.logger.log(
            {
                main: { total: main.totalCount, idle: main.idleCount },
                read: { total: read.totalCount, idle: read.idleCount },
            },
            'пулы БД: закрытие',
        );
        await Promise.all([main.end(), read.end()]);
    }
}
