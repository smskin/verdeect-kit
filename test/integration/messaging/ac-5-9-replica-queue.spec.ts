// AC-5.9 (UC-6): onReplica — очередь kit.replica.<REPLICA_ID> exclusive, auto-delete, не durable; удаляется при
// остановке реплики; без inbox и DLQ (prd.md §3.4; П24). Эталон — P policy-changed.consumer.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient, brokerAdmin } from '../../support/broker.js';
import {
    ReplicaConsumer,
    createMessagingApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

const QUEUE = 'kit.replica.kit-1';

describe('UC-6: очередь реплики', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    const admin = brokerAdmin();
    const vhost = workerScope().rabbitmq.vhost;

    beforeAll(async () => {
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [ReplicaConsumer],
        });
        await initReady(app, 'subscriber-replica');
    });

    afterAll(async () => {
        await broker.close();
    });

    it('AC-5.9: onReplica — очередь kit.replica.<REPLICA_ID> exclusive, auto-delete, не durable; событие доходит до обработчика', async () => {
        const info = await admin.queue(vhost, QUEUE);

        expect(info).toMatchObject({ exclusive: true, autoDelete: true, durable: false });
        publishEnvelope(broker, testEnvelope());
        await waitUntil(() => app.get(ReplicaConsumer).calls === 1, 'обработчик реплики');
    });

    it('AC-5.9: без inbox и DLQ — ошибка обработчика не создаёт сообщений в kit.dlq', async () => {
        const consumer = app.get(ReplicaConsumer);
        const before = consumer.calls;
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'fail' } }));
        await waitUntil(() => consumer.calls === before + 1, 'обработчик реплики');

        expect((await admin.queue(vhost, 'kit.dlq'))?.messages ?? 0).toBe(0);
        expect((await admin.queue(vhost, 'kit'))?.messages ?? 0).toBe(0);
    });

    it('AC-5.9: очередь удаляется при остановке реплики', async () => {
        await app.close();

        // Во время удаления exclusive-очереди management API может ответить ошибкой — это ещё «не удалена».
        await waitUntil(
            async () => (await admin.queue(vhost, QUEUE).catch(() => undefined)) === null,
            'очередь удалена',
        );
    });
});
