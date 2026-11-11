// O outbox-confirm (UC-5, AC-5.11): брокер не подтверждает публикацию — транзакция пачки закрыта за ≤ 5 с (срок пачки),
// строка повторится: attempts + 1, last_error confirm deadline (prd.md §3.4). Эквивалентность — O
// outbox-confirm.timing-spec. Реальный срок пачки 5 с.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: подтверждение брокера', () => {
    let app: NestFastifyApplication;
    let proxy: TcpProxy;

    beforeAll(async () => {
        await truncateFixtures();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        app = await createOutboxApp({ env: { RABBITMQ_URL: proxy.url } });
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
    });

    afterAll(async () => {
        await proxy.restore();
        await app.close();
        await proxy.close();
        await truncateFixtures();
    });

    it('O outbox-confirm: брокер не подтверждает — транзакция пачки закрыта за ≤ 5 с, строки повторятся', async () => {
        proxy.freeze();
        const t0 = performance.now();
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            }),
        );
        await waitUntil(
            async () => ((await outboxRows())[0]?.attempts ?? 0) > 0,
            'attempts > 0',
            10_000,
        );

        expect(performance.now() - t0).toBeLessThan(5_000 + 1_000 * TEST_TIMEOUT_SCALE);
        const [row] = await outboxRows();
        expect(row?.published_at).toBeNull();
        expect(row?.last_error).toContain('confirm deadline');
    });
});
