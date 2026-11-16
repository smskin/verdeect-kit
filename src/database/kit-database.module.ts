// KitDatabaseModule.forRoot({schema}) (prd.md §3.3, AC-4.4, AC-4.5, UC-8). Эталон — O drizzle.provider.ts +
// database.module.ts: пулы main/read, READ_POOL_OPTIONS, обработчики error/connect, проба database, onApplicationShutdown
// — шаг 4. По PRD и KT-19 п. 3: срок пула учитывается на уровне пула (обёртка connect экземпляра) — метрика с меткой
// pool, captureThrottled и метка ошибки tagPoolTimeout; пробы database и database-read; KitLifecycle не используется.
// Сборка пулов — pools.ts (общая с createTestDb, AC-4.19). v1.31 (AC-4.20): select 1 основного пула при сборке модуля
// в сроке DB_POOL_ACQUIRE_TIMEOUT_MS — в любом контексте, до прослушивания порта и до зависимых от Db провайдеров.
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
import { requireKitCore } from '../internal/kit-core-required.js';
import { connectionCodeOf, isConnectionError, isPoolTimeout } from '../internal/pg-errors.js';
import { KIT_PACKAGE_METRICS, KIT_PG_POOLS } from '../internal/tokens.js';
import { HealthRegistry } from '../observability/health-registry.js';
import type { StartupFailure } from '../observability/fail-startup.js';
import type { KitMetrics } from '../observability/metrics.js';
import { Db } from './db.js';
import { loadDrizzle, type NodePgDatabase, type Pool } from './pg.js';
import { buildPools, checkConnection, type KitPools } from './pools.js';

/** Drizzle основного пула со схемой сервиса — запросы вне `Db` (`drizzle(pool, {schema})`). */
export const DRIZZLE = Symbol('DRIZZLE');

/** Drizzle пула чтения со схемой сервиса (read-only, `statement_timeout` 5 с). */
export const DRIZZLE_READ = Symbol('DRIZZLE_READ');

/** Окружение модуля (внутренний токен). */
const KIT_DATABASE_ENV = Symbol('KIT_DATABASE_ENV');

/** Пулы `/database` (сборка — `pools.ts`). */
export type { KitPools } from './pools.js';

/** Опции `KitDatabaseModule.forRoot`. */
export interface KitDatabaseModuleOptions {
    /** Объект схемы Drizzle сервиса (`import * as schema`) — для `DRIZZLE` и `DRIZZLE_READ`. */
    readonly schema: Record<string, unknown>;
}

const logger = new Logger('KitDatabase');

/** Основной пул и пул чтения на `DATABASE_URL` с учётом срока; адрес не логируется. */
export function createPools(
    env: KitDatabaseEnv,
    options: { readonly metrics?: KitMetrics } = {},
): Promise<KitPools> {
    return buildPools({
        url: env.DATABASE_URL,
        max: env.DB_POOL_MAX,
        connectionTimeoutMs: env.DB_POOL_ACQUIRE_TIMEOUT_MS,
        ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
        log: {
            warn: (fields, message) => logger.warn(fields, message),
            debug: (fields, message) => logger.debug(fields, message),
        },
    });
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
 * Отказ проверки соединения при запуске (§3.3 v1.31, AC-4.20): `StartupFailure` с кодом `DATABASE_UNAVAILABLE` —
 * `failStartup` пишет `fatal` `{code, cause}` и одно событие с тегом `code`. Исходная ошибка не вкладывается (`cause`
 * нет): её текст несёт SQL и адрес БД. Не экспортируется.
 */
class DatabaseUnavailableError extends Error implements StartupFailure {
    readonly startupCode = 'DATABASE_UNAVAILABLE';

    /** @param nodeCode Код узла ошибки: `ECONNREFUSED`, SQLSTATE или `timeout`. */
    constructor(private readonly nodeCode: string) {
        super('База данных недоступна при запуске');
        this.name = 'DatabaseUnavailableError';
    }

    startupDetails(): Readonly<Record<string, unknown>> {
        return { cause: this.nodeCode };
    }
}

/**
 * Пулы с проверкой соединения основного пула; при отказе пулы закрываются (сокеты не держат процесс). Ошибка
 * соединения или срок — `DatabaseUnavailableError`, прочая ошибка проверки — как есть.
 */
async function checkedPools(env: KitDatabaseEnv, metrics: KitMetrics): Promise<KitPools> {
    const pools = await createPools(env, { metrics });
    const startedAt = performance.now();
    try {
        await checkConnection(pools.main, env.DB_POOL_ACQUIRE_TIMEOUT_MS);
    } catch (error) {
        await Promise.allSettled([pools.main.end(), pools.read.end()]);
        if (isConnectionError(error) || isPoolTimeout(error)) {
            throw new DatabaseUnavailableError(connectionCodeOf(error) ?? 'timeout');
        }
        throw error;
    }
    logger.debug(
        { pool: 'main', ms: Math.round(performance.now() - startedAt) },
        'БД: соединение проверено',
    );

    return pools;
}

/**
 * Глобальный модуль БД сервиса (§3.3): `Db`, `DRIZZLE`, `DRIZZLE_READ`; пробы `database` и `database-read` (критичные,
 * при `createHttpApp`), метрика срока пула; пулы закрываются на шаге 4 (`onApplicationShutdown`). Окружение —
 * `envDatabase` из `KitConfigModule`. Соединений на реплику — `2 × DB_POOL_MAX`. При запуске соединение основного пула
 * проверяется (`select 1`); недоступная БД — отказ сборки.
 */
@Module({})
export class KitDatabaseModule implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(KitDatabaseModule.name);
    private readonly health: HealthRegistry;

    constructor(
        @Inject(KIT_PG_POOLS) private readonly pools: KitPools,
        @Optional() health?: HealthRegistry,
    ) {
        this.health = requireKitCore(health, 'KitDatabaseModule');
    }

    /**
     * Модуль БД со схемой Drizzle сервиса. При сборке (в любом контексте: `bootstrapService` до прослушивания порта,
     * `createApplicationContext` CLI, `createTestApp`) — `select 1` основного пула в сроке `DB_POOL_ACQUIRE_TIMEOUT_MS`
     * на подключение и запрос; ошибка соединения или срок — сборка отклоняется `StartupFailure` с кодом
     * `DATABASE_UNAVAILABLE` (`failStartup`: `fatal` и одно событие с тегом `code`, без SQL и адреса).
     */
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
                    useFactory: async (env: KitDatabaseEnv, metrics?: KitMetrics) =>
                        checkedPools(env, requireKitCore(metrics, 'KitDatabaseModule')),
                    inject: [KIT_DATABASE_ENV, { token: KIT_PACKAGE_METRICS, optional: true }],
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
