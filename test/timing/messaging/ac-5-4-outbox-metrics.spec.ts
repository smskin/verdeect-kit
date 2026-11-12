// AC-5.4 (UC-5, prd.md §3.4 v1.25, П10): метрики verdeect_outbox_* считаются при запросе /metrics (collect): без
// запроса запросов метрик к БД нет (countQueries), запрос даёт актуальные значения, при недоступной БД ответ — не позже
// ~1 с × TEST_TIMEOUT_SCALE с последним значением. Брокер недоступен — строки ждут. Реальная пауза — окно наблюдения
// «запросов нет», длительность здесь — предмет проверки.
import { setTimeout as sleep } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Registry } from '@prometheus-io/client';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { DRIZZLE } from '../../../src/database/index.js';
import { KIT_METRICS } from '../../../src/internal/tokens.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { appUrl, ctx, truncateFixtures } from '../../support/database.js';
import { TestNoteCreated, createOutboxApp } from '../../support/messaging.js';

/** Запрос метрик outbox (OutboxStore.stats). */
const STATS_SQL = /as pending/;

function valueOf(text: string, name: string): number {
    const line = text.split('\n').find((item) => item.startsWith(`${name}{`));

    return Number(line?.split(' ').at(-1));
}

describe('UC-5: метрики outbox при запросе /metrics', () => {
    let app: NestFastifyApplication;
    let proxy: TcpProxy;
    let registry: Registry;

    beforeAll(async () => {
        await truncateFixtures();
        proxy = await tcpProxy(appUrl());
        // Брокер недоступен (порт 1): relay не публикует, строки ждут.
        app = await createOutboxApp({
            env: { DATABASE_URL: proxy.url, RABBITMQ_URL: 'amqp://kit:x@127.0.0.1:1/kit' },
        });
        await app.init();
        registry = app.get<Registry>(KIT_METRICS);
        for (const noteId of ['m1', 'm2']) {
            await app
                .get(Db)
                .transaction(ctx('acme'), (tx) =>
                    app
                        .get(OutboxStore)
                        .add(tx, TestNoteCreated, {
                            subjectId: noteId,
                            data: { noteId, title: 'm' },
                        }),
                );
        }
    });

    afterAll(async () => {
        await proxy.restore();
        await app.close();
        await proxy.close();
        await truncateFixtures();
    });

    it('AC-5.4: без запроса /metrics запросов метрик к БД нет', async () => {
        const pool = (app.get(DRIZZLE) as { $client: Pool }).$client;
        const { queries } = await countQueries(pool, () => sleep(2500));

        expect(queries.filter((text) => STATS_SQL.test(text))).toEqual([]);
    });

    it('AC-5.4: запрос /metrics даёт актуальные значения — pending 2, lag > 0', async () => {
        const text = await registry.metrics();

        expect(valueOf(text, 'verdeect_outbox_pending')).toBe(2);
        expect(valueOf(text, 'verdeect_outbox_lag_seconds')).toBeGreaterThan(0);
    });

    it('AC-5.4: БД недоступна — /metrics отвечает не позже ~1 с × TEST_TIMEOUT_SCALE с последним значением', async () => {
        proxy.blackhole();
        for (let scrape = 0; scrape < 2; scrape += 1) {
            const started = performance.now();
            const text = await registry.metrics();
            const elapsed = performance.now() - started;

            expect(elapsed).toBeLessThan(1500 * TEST_TIMEOUT_SCALE);
            expect(valueOf(text, 'verdeect_outbox_pending')).toBe(2);
        }
    });
});
