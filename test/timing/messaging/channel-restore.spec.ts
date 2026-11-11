// UC-5, AC-5.11: восстановление канала relay без разрыва соединения — брокер закрыл канал (404 публикации в удалённый
// exchange) → /health down ≤ 2 с; после объявления exchange канал заменён, строки опубликованы (prd.md §3.4). Эквивалентность
// — P channel-restore.timing-spec.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { BrokerClient } from '../../support/broker.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: восстановление канала relay', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    let disconnects = 0;

    beforeEach(async () => {
        await truncateFixtures();
        broker = await BrokerClient.connect();
        app = await createOutboxApp();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
        disconnects = 0;
        const manager = (
            connection as unknown as { manager: { on: (e: string, l: () => void) => void } }
        ).manager;
        manager.on('disconnect', () => {
            disconnects += 1;
        });
    });

    afterEach(async () => {
        await broker.declareEventsExchange();
        await app.close();
        await broker.close();
        await truncateFixtures();
    });

    async function add(n: number): Promise<void> {
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: `n${n}`,
                data: { noteId: `n${n}`, title: 'T' },
            }),
        );
    }

    it('P channel-restore: брокер закрыл канал relay (404 при публикации в удалённый exchange) → /health down ≤ 2 с; после объявления exchange канал заменён, строка опубликована без разрыва соединения', async () => {
        await broker.deleteExchange('verdeect.events');
        const t0 = performance.now();
        await add(1);
        await waitUntil(
            async () => (await app.get(HealthRegistry).evaluate()).checks['rabbitmq'] === 'down',
            'rabbitmq down',
        );
        expect(performance.now() - t0).toBeLessThan(2_000 * TEST_TIMEOUT_SCALE);

        await broker.declareEventsExchange();
        await waitUntil(
            async () => (await outboxRows())[0]?.published_at !== null,
            'строка опубликована',
            10_000,
        );
        expect(disconnects).toBe(0);
    });

    it('P channel-restore: канал relay не готов (нет exchange) → outbox не опрашивается, attempts не растут, lag растёт; после объявления exchange все строки опубликованы за ≤ 2 × RABBITMQ_RETRY_SECONDS', async () => {
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await broker.deleteExchange('verdeect.events');
        await add(1);
        await waitUntil(() => !connection.isChannelReady('outbox-relay'), 'канал relay не готов');
        const store = app.get(OutboxStore);
        const claim = vi.spyOn(store, 'claimBatch');
        // Окно наблюдения закрывает сигнал системы, а не пауза: цикл метрик relay (statsLoop) тикает раз в
        // RELAY_POLL_MS и без канала — два его запроса значат, что период опроса прошёл, а захвата не было.
        let statsTicks = 0;
        const { queries } = await countQueries(
            mainPoolOf(app.get(Db)),
            async () => {
                await add(2);
                await add(3);
                await waitUntil(() => statsTicks >= 2, 'два тика метрик relay', 5_000);
            },
            {
                onQuery: (text) => {
                    if (text.includes('as pending')) {
                        statsTicks += 1;
                    }
                },
            },
        );

        expect(claim).not.toHaveBeenCalled();
        expect(
            queries.filter(
                (text) => text.includes('for update skip locked') && !text.includes('delete'),
            ),
        ).toEqual([]);
        expect((await outboxRows()).every((row) => row.attempts <= 1)).toBe(true);
        claim.mockRestore();

        const t0 = performance.now();
        await broker.declareEventsExchange();
        await waitUntil(
            async () => (await outboxRows()).every((row) => row.published_at !== null),
            'все опубликованы',
            10_000,
        );
        expect(performance.now() - t0).toBeLessThan(2 * 1_000 * TEST_TIMEOUT_SCALE + 1_000);
    });
});
