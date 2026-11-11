// AC-5.17 (UC-6): prefetch 10 — при 20 сообщениях и блокирующем обработчике одновременно не больше 10 неподтверждённых
// (prd.md §3.4). Сигнал — счётчик вызовов и management API, без пауз.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient, brokerAdmin } from '../../support/broker.js';
import { truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    createSubscriberApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: prefetch', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createSubscriberApp();
        await initReady(app);
    });

    afterAll(async () => {
        app.get(TestConsumer).gate.release();
        await app.close();
        await broker.close();
        await truncateFixtures();
    });

    it('AC-5.17: prefetch 10 — при 20 сообщениях и блокирующем обработчике одновременно не больше 10 неподтверждённых', async () => {
        const consumer = app.get(TestConsumer);
        const admin = brokerAdmin();
        const vhost = workerScope().rabbitmq.vhost;
        for (let n = 0; n < 20; n += 1) {
            publishEnvelope(broker, testEnvelope({ data: { noteId: `n${n}`, title: 'block' } }));
        }
        await waitUntil(() => consumer.count() === 10, '10 вызовов');
        // Статистика management API обновляется с задержкой: ждём согласованного снимка.
        await waitUntil(
            async () => {
                const info = await admin.queue(vhost, 'kit');

                return info?.messagesUnacknowledged === 10 && info.messagesReady === 10;
            },
            'unacked 10, ready 10',
            15_000,
        );
        expect(consumer.count()).toBe(10);

        consumer.gate.release();
        await waitUntil(() => consumer.count() === 20, 'все 20');
    });
});
