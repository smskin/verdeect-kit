// AC-5.4 (UC-5): брокер недоступен 10 с — события копятся, verdeect_outbox_lag_seconds растёт; после восстановления
// опубликованы по seq без потерь и повторов (prd.md §3.4). Эквивалентность — I ac-6-2-broker-outage, O outbox-confirm.
// Реальная пауза 10 с — длительность из PRD.
import { setTimeout as sleep } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_PACKAGE_METRICS } from '../../../src/internal/tokens.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient } from '../../support/broker.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import { TestNoteCreated, createOutboxApp, waitUntil } from '../../support/messaging.js';

describe('UC-5: недоступный брокер', () => {
    let app: NestFastifyApplication;
    let proxy: TcpProxy;
    let broker: BrokerClient;

    async function gauge(name: 'outboxLagSeconds' | 'outboxPending'): Promise<number> {
        return (await app.get<KitMetrics>(KIT_PACKAGE_METRICS)[name].get()).values[0]?.value ?? 0;
    }

    beforeAll(async () => {
        await truncateFixtures();
        broker = await BrokerClient.connect();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createOutboxApp({ env: { RABBITMQ_URL: proxy.url } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
    });

    afterAll(async () => {
        await app.close();
        await proxy.close();
        await broker.close();
        await truncateFixtures();
    });

    it('AC-5.4: брокер недоступен 10 с — события копятся, verdeect_outbox_lag_seconds и verdeect_outbox_pending растут, после восстановления опубликованы по seq без потерь и повторов', async () => {
        const captured = await broker.capture('kit.#');
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await proxy.break();
        await waitUntil(() => !connection.isConnected(), 'разрыв');
        // Метрики обновляются без канала (П10): до записи pending 0, после — растёт вместе с lag.
        await waitUntil(async () => (await gauge('outboxPending')) === 0, 'pending 0 до записи');
        const ids: string[] = [];
        for (let n = 0; n < 3; n += 1) {
            ids.push(
                await app.get(Db).transaction(ctx('acme'), (tx) =>
                    app.get(OutboxStore).add(tx, TestNoteCreated, {
                        subjectId: `n${n}`,
                        data: { noteId: `n${n}`, title: 'T' },
                    }),
                ),
            );
        }
        await sleep(3_000);
        const lagEarly = await gauge('outboxLagSeconds');
        const pendingEarly = await gauge('outboxPending');
        await sleep(7_000);
        const lagLate = await gauge('outboxLagSeconds');

        expect(lagLate).toBeGreaterThan(lagEarly);
        expect(pendingEarly).toBe(3);
        expect(await gauge('outboxPending')).toBe(3);
        expect(captured).toHaveLength(0);

        await proxy.restore();
        await waitUntil(() => captured.length === 3, 'три сообщения', 30_000);
        expect(captured.map((message) => message.properties.messageId)).toEqual(ids);
        await waitUntil(async () => (await gauge('outboxPending')) === 0, 'pending 0');
        expect(await gauge('outboxLagSeconds')).toBe(0);
        expect(captured).toHaveLength(3);
    });
});
