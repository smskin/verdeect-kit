// AC-5.15 (UC-6): признак tenant события у подписчика — 'required' с tenant: null и 'none' с тенантом уходят в DLQ с
// x-dlq-reason: tenant, обработчик не вызван (prd.md §3.4).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrokerClient } from '../../support/broker.js';
import { truncateFixtures } from '../../support/database.js';
import {
    TestAccountTouched,
    TestConsumer,
    createSubscriberApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: признак tenant у подписчика', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    async function dlqReason(): Promise<unknown> {
        await waitUntil(
            async () => ((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0) > 0,
            'копия в kit.dlq',
        );

        return (await broker.take('kit.dlq'))?.properties.headers?.['x-dlq-reason'];
    }

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

    beforeEach(async () => {
        await broker.purge('kit.dlq');
    });

    it("AC-5.15: подписчик получает 'required' с tenant: null — DLQ, x-dlq-reason: tenant, обработчик не вызван", async () => {
        publishEnvelope(broker, testEnvelope({ tenant: null }));

        expect(await dlqReason()).toBe('tenant');
        expect(app.get(TestConsumer).count()).toBe(0);
    });

    it("AC-5.15: 'none' с тенантом — DLQ tenant", async () => {
        publishEnvelope(
            broker,
            testEnvelope({
                type: TestAccountTouched.type,
                tenant: 'acme',
                subject: { kind: 'account', id: 'a1' },
                data: { accountId: 'a1' },
            }),
        );

        expect(await dlqReason()).toBe('tenant');
        expect(app.get(TestConsumer).count(TestAccountTouched.type)).toBe(0);
    });
});
