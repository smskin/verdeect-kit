// AC-5.4 (UC-5, prd.md §3.1, §3.4 v1.25): пауза переподключения — RABBITMQ_RECONNECT_SECONDS, не RABBITMQ_RETRY_SECONDS:
// при RETRY=30 и RECONNECT=1 канал relay после обрыва соединения восстанавливается не позже ~1 с × TEST_TIMEOUT_SCALE
// после возврата брокера. Обрыв — TcpProxy.break, время — от restore() до готовности канала.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { truncateFixtures } from '../../support/database.js';
import { createOutboxApp, waitUntil } from '../../support/messaging.js';

describe('UC-5: переподключение к брокеру', () => {
    let app: NestFastifyApplication;
    let proxy: TcpProxy;

    beforeAll(async () => {
        await truncateFixtures();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createOutboxApp({
            env: {
                RABBITMQ_URL: proxy.url,
                RABBITMQ_RETRY_SECONDS: '30',
                RABBITMQ_RECONNECT_SECONDS: '1',
            },
        });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
    });

    afterAll(async () => {
        await app.close();
        await proxy.close();
        await truncateFixtures();
    });

    it('AC-5.4: RABBITMQ_RETRY_SECONDS=30, RABBITMQ_RECONNECT_SECONDS=1 — канал после обрыва восстановлен ≤ ~1 с × TEST_TIMEOUT_SCALE', async () => {
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await proxy.break();
        await waitUntil(() => !connection.isConnected(), 'разрыв');

        await proxy.restore();
        const restored = performance.now();
        await waitUntil(
            () => connection.isChannelReady('outbox-relay'),
            'канал после обрыва',
            10_000,
        );

        // Пауза переподключения 1 с + подключение и настройка канала.
        expect(performance.now() - restored).toBeLessThan(1_000 * TEST_TIMEOUT_SCALE + 1_000);
    });
});
