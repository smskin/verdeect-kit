// FR-72 (I), UC-5: порядок outbox по seq — монотонен внутри и между транзакциями, публикация по seq после разрыва
// соединения; метрики verdeect_outbox_lag_seconds, verdeect_outbox_pending (prd.md §3.2, §3.4). Эквивалентность — I
// fr-72-outbox-seq.int-spec, O outbox.int-spec «порядок по seq», outbox-metrics.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_METRICS } from '../../../src/internal/tokens.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

async function add(app: NestFastifyApplication, n: number): Promise<string> {
    return app.get(Db).transaction(ctx('acme'), (tx) =>
        app.get(OutboxStore).add(tx, TestNoteCreated, {
            subjectId: `n${n}`,
            data: { noteId: `n${n}`, title: 'T' },
        }),
    );
}

async function gauge(
    app: NestFastifyApplication,
    name: 'outboxLagSeconds' | 'outboxPending',
): Promise<number> {
    const metric = await app.get<KitMetrics>(KIT_METRICS)[name].get();

    return metric.values[0]?.value ?? 0;
}

describe('UC-5: порядок outbox', () => {
    let app: NestFastifyApplication | undefined;
    let proxy: TcpProxy | undefined;
    let broker: BrokerClient;

    beforeEach(async () => {
        await truncateFixtures();
        broker = await BrokerClient.connect();
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await proxy?.close();
        proxy = undefined;
        await broker.close();
    });

    it('FR-72 (I): seq монотонен внутри и между транзакциями', async () => {
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             select 'evt_' || g, 'acme', 'kit.note.created', 1, 's', '{}', 't', '{}' from generate_series(1, 3) g`,
        );
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             values ('evt_4', 'acme', 'kit.note.created', 1, 's', '{}', 't', '{}')`,
        );

        const seqs = (await outboxRows()).map((row) => row.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(seqs).size).toBe(4);
        expect((await outboxRows()).map((row) => row.id)).toEqual([
            'evt_1',
            'evt_2',
            'evt_3',
            'evt_4',
        ]);
    });

    it('O outbox: порядок публикации — по seq после разрыва соединения', async () => {
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createOutboxApp({ env: { RABBITMQ_URL: proxy.url } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
        const captured = await broker.capture('kit.#');

        await proxy.break();
        await waitUntil(() => !connection.isConnected(), 'разрыв соединения');
        const ids = [await add(app, 1), await add(app, 2), await add(app, 3)];
        await proxy.restore();
        await waitUntil(() => captured.length === 3, 'три сообщения', 15_000);

        expect(captured.map((message) => message.properties.messageId)).toEqual(ids);
    });

    it('O outbox: verdeect_outbox_lag_seconds > 0 при неопубликованной строке и 0 после публикации; verdeect_outbox_pending', async () => {
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createOutboxApp({ env: { RABBITMQ_URL: proxy.url } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
        await proxy.break();
        await waitUntil(() => !connection.isConnected(), 'разрыв соединения');
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data, occurred_at)
             values ('evt_old', 'acme', 'kit.note.created', 1, 's', '{}', 't', '{"noteId":"n","title":"T"}',
                     now() - interval '30 seconds')`,
        );
        const local = app;
        await waitUntil(async () => (await gauge(local, 'outboxPending')) === 1, 'pending 1');
        expect(await gauge(local, 'outboxLagSeconds')).toBeGreaterThan(0);

        await proxy.restore();
        await waitUntil(
            async () => (await gauge(local, 'outboxPending')) === 0,
            'pending 0',
            15_000,
        );
        expect(await gauge(local, 'outboxLagSeconds')).toBe(0);
    });
});
