// AC-4.5 (UC-4): срок пула учитывает пул /database — verdeect_db_pool_wait_timeouts_total{pool: main|read}, метка
// poolTimeoutOf, одно событие GlitchTip (captureThrottled); фильтр /http отвечает 503 + Retry-After: 1 без своей метрики
// (prd.md §3.3, KT-19 п. 3). Перенос O or-119-db-pool. Проект isolated: initFakeSentry — процесс-глобальный Sentry.
// Срок пула pg-pool покрывает и установку нового соединения: holding() открывает первое соединение холодного пула под
// тем же сроком, поэтому срок — с запасом × TEST_TIMEOUT_SCALE, а не 100 мс (под нагрузкой TCP + SCRAM дольше; KT-30).
import { Controller, Get, Inject, Module } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEnv } from '../../../src/config/define-env.js';
import { envBase, envDatabase } from '../../../src/config/fragments.js';
import { KitConfigModule } from '../../../src/config/kit-config.module.js';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { DRIZZLE, KitDatabaseModule } from '../../../src/database/kit-database.module.js';
import { loadDrizzle, type NodePgDatabase, type Pool } from '../../../src/database/pg.js';
import { isPoolTimeout, poolTimeoutOf } from '../../../src/internal/pg-errors.js';
import { KIT_METRICS } from '../../../src/internal/tokens.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { appUrl, createDbApp, createTestDb, ctx, type TestDb } from '../../support/database.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';

const envSchema = defineEnv({ ...envBase, ...envDatabase });

/** Срок ожидания клиента пула: и для запроса к занятому пулу, и для первого соединения холодного пула в holding(). */
const ACQUIRE_TIMEOUT_MS = 1000 * TEST_TIMEOUT_SCALE;

@Controller('pool')
class PoolController {
    constructor(
        private readonly db: Db,
        @Inject(DRIZZLE) private readonly drizzle: NodePgDatabase,
    ) {}

    @Get('tx')
    async tx(): Promise<unknown> {
        return this.db.transaction(ctx('acme'), (tx) => tx.execute(sql`select 1`));
    }

    @Get('direct')
    async direct(): Promise<unknown> {
        return this.drizzle.execute(sql`select 1`);
    }
}

@Module({
    imports: [
        KitConfigModule.forRoot({ schema: envSchema }),
        KitDatabaseModule.forRoot({ schema: fixtureSchema }),
    ],
    controllers: [PoolController],
})
class PoolModule {}

async function timeouts(metrics: KitMetrics, pool: 'main' | 'read'): Promise<number> {
    const { values } = await metrics.dbPoolWaitTimeouts.get();

    return values.find((value) => value.labels.pool === pool)?.value ?? 0;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => {
            throw new Error('ожидалась ошибка срока пула');
        },
        (error: unknown) => error,
    );
}

/** Занимает единственный клиент пула на время work. */
async function holding<T>(pool: Pool, work: () => Promise<T>): Promise<T> {
    const held = await pool.connect();
    try {
        return await work();
    } finally {
        held.release();
    }
}

let delivered: DeliveredEvent[];

beforeAll(() => {
    delivered = initFakeSentry().delivered;
});

describe('UC-4: срок пула через HTTP', () => {
    let app: Awaited<ReturnType<typeof createDbApp>>;
    let main: Pool;
    let metrics: KitMetrics;

    beforeAll(async () => {
        app = await createDbApp({
            module: PoolModule,
            schema: envSchema,
            env: {
                DATABASE_URL: appUrl(),
                DB_POOL_MAX: '1',
                DB_POOL_ACQUIRE_TIMEOUT_MS: String(ACQUIRE_TIMEOUT_MS),
                LOG_LEVEL: 'silent',
            },
        });
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
        main = mainPoolOf(app.get(Db));
        metrics = app.get<KitMetrics>(KIT_METRICS);
    });

    afterAll(async () => {
        await app.close();
    });

    it('AC-4.5: HTTP — маршрут с Db.transaction при занятом пуле → 503 SERVICE_UNAVAILABLE + Retry-After: 1, метрика +1 ровно один раз, событие GlitchTip ровно одно', async () => {
        const response = await holding(main, () => app.inject({ method: 'GET', url: '/pool/tx' }));
        await Sentry.flush(2000);

        expect(response.statusCode).toBe(503);
        expect(response.headers['retry-after']).toBe('1');
        expect(response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
        expect(await timeouts(metrics, 'main')).toBe(1);
        expect(delivered).toHaveLength(1);
    });

    it('AC-4.5: HTTP — маршрут с прямым запросом DRIZZLE при занятом пуле → 503 + Retry-After: 1, метрика +1, событий фильтр не добавляет', async () => {
        const response = await holding(main, () =>
            app.inject({ method: 'GET', url: '/pool/direct' }),
        );
        await Sentry.flush(2000);

        expect(response.statusCode).toBe(503);
        expect(response.headers['retry-after']).toBe('1');
        expect(await timeouts(metrics, 'main')).toBe(2);
        expect(delivered).toHaveLength(1);
    });

    it('AC-4.5: проба /health database — up при свободном пуле', async () => {
        const report = await app.get(HealthRegistry).evaluate();

        expect(report.checks).toMatchObject({ database: 'up', 'database-read': 'up' });
    });
});

describe('UC-4: срок пула Db и DRIZZLE', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb({ poolMax: 1, acquireTimeoutMs: ACQUIRE_TIMEOUT_MS });
    });

    afterAll(async () => {
        await test.close();
    });

    it('AC-4.5: исчерпание основного пула через Db.transaction → isPoolTimeout, poolTimeoutOf = main, verdeect_db_pool_wait_timeouts_total{pool="main"} +1', async () => {
        const error = await holding(test.main, () =>
            caught(test.db.transaction(ctx('acme'), (tx) => tx.execute(sql`select 1`))),
        );

        expect(isPoolTimeout(error)).toBe(true);
        expect(poolTimeoutOf(error)).toBe('main');
        expect(await timeouts(test.metrics, 'main')).toBe(1);
    });

    it('AC-4.5: исчерпание пула чтения через Db.readGlobal → pool="read" +1', async () => {
        const error = await holding(test.read, () =>
            caught(test.db.readGlobal((reader) => reader.execute(sql`select 1`))),
        );

        expect(poolTimeoutOf(error)).toBe('read');
        expect(await timeouts(test.metrics, 'read')).toBe(1);
    });

    it('AC-4.5: исчерпание основного пула прямым запросом через DRIZZLE (drizzle(main).execute) → pool="main" +1, ошибка помечена main', async () => {
        const { drizzle } = await loadDrizzle();
        const error = await holding(test.main, () =>
            caught(drizzle(test.main).execute(sql`select 1`)),
        );

        expect(poolTimeoutOf(error)).toBe('main');
        expect(await timeouts(test.metrics, 'main')).toBe(2);
    });

    it('AC-4.5: исчерпание пула чтения прямым запросом через DRIZZLE_READ → pool="read" +1', async () => {
        const { drizzle } = await loadDrizzle();
        const error = await holding(test.read, () =>
            caught(drizzle(test.read).execute(sql`select 1`)),
        );

        expect(poolTimeoutOf(error)).toBe('read');
        expect(await timeouts(test.metrics, 'read')).toBe(2);
    });
});
