// UC-6: топология подписчика — kit (DLX → kit.retry), kit.retry (TTL RABBITMQ_RETRY_SECONDS × 1000 → kit), kit.dlq;
// привязки только для зарегистрированных типов (prd.md §3.4; П12). Эквивалентность — O topology.int-spec.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient, brokerAdmin } from '../../support/broker.js';
import { truncateFixtures } from '../../support/database.js';
import {
    createSubscriberApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
} from '../../support/messaging.js';

describe('UC-6: топология подписчика', () => {
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
        await app.close();
        await broker.close();
    });

    it('O topology: старт объявляет kit (DLX → kit.retry), kit.retry (TTL RABBITMQ_RETRY_SECONDS × 1000 → kit), kit.dlq', async () => {
        const admin = brokerAdmin();
        const vhost = workerScope().rabbitmq.vhost;

        expect((await admin.queue(vhost, 'kit'))?.arguments).toMatchObject({
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': 'kit.retry',
        });
        expect((await admin.queue(vhost, 'kit.retry'))?.arguments).toMatchObject({
            'x-message-ttl': 1000,
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': 'kit',
        });
        expect((await admin.queue(vhost, 'kit.dlq'))?.durable).toBe(true);
        await expect(
            broker.channel.assertQueue('kit.retry', {
                durable: true,
                messageTtl: 1000,
                deadLetterExchange: '',
                deadLetterRoutingKey: 'kit',
            }),
        ).resolves.toBeDefined();
    });

    it('O topology: привязки — только для зарегистрированных типов', async () => {
        const captured = await broker.capture('kit.other.#');
        publishEnvelope(broker, testEnvelope({ type: 'kit.other.created' }));
        // Сигнал маршрутизации: копию получила временная очередь теста — exchange обработал сообщение.
        while (captured.length === 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }

        expect((await broker.queueInfo('kit'))?.messageCount).toBe(0);
        expect((await broker.queueInfo('kit.dlq'))?.messageCount).toBe(0);
    });
});
