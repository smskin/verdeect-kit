// Помощники уровня I для /database (prd.md §3.3, §3.8): Db на пулах роли приложения, приложение с окружением без
// vi.stubEnv (setPreparsedEnv — механизм bootstrapService), очистка таблиц фикстуры. Эталон приёмов — O test/support/
// database.ts (withRole, truncateAll); в пакет не идут.
import type { DynamicModule, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { inject } from 'vitest';
import type { z } from 'zod';
import { parseEnv } from '../../src/config/parse-env.js';
import { Db } from '../../src/database/db.js';
import { createPools, type KitPools } from '../../src/database/kit-database.module.js';
import { loadDrizzle } from '../../src/database/pg.js';
import type { DbContext } from '../../src/database/tenant.js';
import { setPreparsedEnv } from '../../src/internal/preparsed-env.js';
import { kitMetrics, type KitMetrics } from '../../src/observability/metrics.js';
import { createTestApp, type KitTestOverride } from '../../src/testing/create-test-app.js';
import { adminQuery as query } from './postgres.js';

/** `Db` теста и его пулы. */
export interface TestDb extends KitPools {
    readonly db: Db;
    readonly metrics: KitMetrics;
    readonly close: () => Promise<void>;
}

function provided(key: 'kitDatabaseUrl' | 'kitDatabaseAdminUrl' | 'kitDatabaseOwnerUrl'): string {
    const value = inject(key);
    if (value === undefined) {
        throw new Error(`${key} не передан: globalSetup без postgres`);
    }

    return value;
}

/** `Db` на пулах роли `kit_app` (или `url`), метрики — свой реестр `kitMetrics`. */
export async function createTestDb(
    options: { poolMax?: number; acquireTimeoutMs?: number; url?: string } = {},
): Promise<TestDb> {
    const metrics = kitMetrics({ service: 'kit' });
    const pools = await createPools(
        {
            DATABASE_URL: options.url ?? provided('kitDatabaseUrl'),
            DB_POOL_MAX: options.poolMax ?? 4,
            DB_POOL_ACQUIRE_TIMEOUT_MS: options.acquireTimeoutMs ?? 5000,
        },
        { metrics },
    );
    const { drizzle } = await loadDrizzle();
    const db = new Db({ ...pools, drizzle });

    return {
        ...pools,
        db,
        metrics,
        close: async () => {
            await Promise.all([pools.main.end(), pools.read.end()]);
        },
    };
}

/** Запрос суперпользователя к БД `kit`. */
export function adminQuery<T extends object = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
): Promise<T[]> {
    return query<T>(provided('kitDatabaseAdminUrl'), sql, params);
}

/** Очищает таблицы фикстуры. */
export async function truncateFixtures(): Promise<void> {
    await adminQuery('TRUNCATE kit.note, kit.setting');
}

/** Адрес роли приложения `kit_app` к БД `kit`. */
export function appUrl(): string {
    return provided('kitDatabaseUrl');
}

/**
 * Приложение теста: окружение `env` разбирается схемой `schema` (тот же объект, что в `KitConfigModule.forRoot`)
 * и передаётся одной сборке контекста — без `vi.stubEnv` (проект shared).
 */
export async function createDbApp(options: {
    readonly module: Type | DynamicModule;
    readonly schema: z.ZodType<Record<string, unknown>>;
    readonly env: Record<string, string>;
    readonly overrides?: readonly KitTestOverride[];
}): Promise<NestFastifyApplication> {
    setPreparsedEnv(options.schema, parseEnv(options.schema, options.env));

    return createTestApp({ module: options.module, service: 'kit', overrides: options.overrides });
}

/** Контекст `Db` теста. */
export function ctx(tenant: string | null, channel = 'http'): DbContext {
    return { tenant, traceId: 'trace-test', actor: { channel } };
}

/** SQLSTATE первого узла цепочки `cause` с кодом из 5 знаков. */
export function sqlStateOf(error: unknown): string | undefined {
    for (let current = error; typeof current === 'object' && current !== null;) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === 'string' && code.length === 5) {
            return code;
        }
        current = (current as { cause?: unknown }).cause;
    }

    return undefined;
}
