// AC-5.18 (UC-14, prd.md §3.8 v1.25): после рестарта брокера (обрыв соединения приложения — TcpProxy.break/restore)
// waitForBrokerReady дожидается восстановления канала, publishTestEvent после него доставляет событие подписчику;
// брокер недоступен — по сроку ошибка; без KitMessagingModule — ошибка «нет пробы rabbitmq».
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import {
    publishTestEvent,
    waitForBrokerReady,
    waitForInbox,
} from '../../../src/testing/test-events.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { createDbApp, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    createMessagingApp,
    initReady,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';
import { ProbeModule, probeEnv } from '../../unit/http/support.js';

describe('UC-14: waitForBrokerReady', () => {
    let app: NestFastifyApplication;
    let proxy: TcpProxy;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createMessagingApp({
            options: { subscriber: { inbox: fixtureSchema.inbox } },
            providers: [TestConsumer],
            env: { RABBITMQ_URL: proxy.url },
        });
        await initReady(app);
    });

    afterAll(async () => {
        await proxy.restore();
        await app.close();
        await proxy.close();
        await resetQueues();
        await truncateFixtures();
    });

    it('AC-5.18: брокер недоступен — waitForBrokerReady по сроку отклоняется', async () => {
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await proxy.break();
        await waitUntil(() => !connection.isConnected(), 'разрыв');

        await expect(waitForBrokerReady(app, { timeoutMs: 200 })).rejects.toThrow(
            'waitForBrokerReady: брокер не готов за 200 мс',
        );
    });

    it('AC-5.18: после возврата брокера waitForBrokerReady дожидается канала, publishTestEvent доставляет событие', async () => {
        await proxy.restore();
        await waitForBrokerReady(app);

        const envelope = await publishTestEvent(TestNoteCreated, { noteId: 'r1', title: 'ok' });
        await waitForInbox(envelope.id, { timeoutMs: 5_000 });
        expect(app.get(TestConsumer).count()).toBeGreaterThanOrEqual(1);
    });

    it('AC-5.18: приложение без KitMessagingModule — ошибка «нет пробы rabbitmq»', async () => {
        const plain = await createDbApp({
            module: ProbeModule,
            schema: probeEnv,
            env: { LOG_LEVEL: 'silent' },
        });
        try {
            await plain.init();
            await expect(waitForBrokerReady(plain, { timeoutMs: 200 })).rejects.toThrow(
                'waitForBrokerReady: у приложения нет пробы rabbitmq (KitMessagingModule с listen: true)',
            );
        } finally {
            await plain.close();
        }
    });
});
