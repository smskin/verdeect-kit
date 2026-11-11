// AC-5.8 (UC-6): dedupe 'none' — подписчик работает без БД, обработчик получает tx = null; модуль собран без
// KitDatabaseModule (prd.md §3.4; роль BFF). Без pg — U-тест ac-1-2-messaging-forroot-pg.spec.ts.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { BrokerClient } from '../../support/broker.js';
import {
    TestConsumer,
    createMessagingApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: dedupe none', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [TestConsumer],
        });
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    it("AC-5.8: dedupe 'none' — подписчик работает без БД, tx = null; модуль собран без KitDatabaseModule", async () => {
        publishEnvelope(broker, testEnvelope());
        const consumer = app.get(TestConsumer);
        await waitUntil(() => consumer.count() === 1, 'обработчик вызван');

        expect(consumer.lastTx).toBeNull();
        expect(() => app.get(Db)).toThrow();
        await waitUntil(
            async () => (await broker.queueInfo('kit'))?.messageCount === 0,
            'kit пуста',
        );
    });
});
