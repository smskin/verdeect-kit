// AC-5.3 (UC-5): публикация < 100 мс после COMMIT без ожидания опроса (afterCommit → relay.wake); строка другого
// процесса — не позже опроса 1000 мс + пачка (prd.md §3.4). Уровень T.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import { TestNoteCreated, createOutboxApp, waitUntil } from '../../support/messaging.js';

describe('UC-5: задержка публикации', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        broker = await BrokerClient.connect();
        app = await createOutboxApp();
        await app.init();
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    beforeEach(truncateFixtures);

    it('AC-5.3: публикация < 100 мс после COMMIT без ожидания опроса', async () => {
        const captured = await broker.capture('kit.#');
        const latencies: number[] = [];
        for (let n = 0; n < 5; n += 1) {
            await app.get(Db).transaction(ctx('acme'), (tx) =>
                app.get(OutboxStore).add(tx, TestNoteCreated, {
                    subjectId: `n${n}`,
                    data: { noteId: `n${n}`, title: 'T' },
                }),
            );
            const t0 = performance.now();
            await waitUntil(() => captured.length === n + 1, `сообщение ${n + 1}`);
            latencies.push(performance.now() - t0);
        }
        const median = [...latencies].sort((a, b) => a - b)[2] ?? Infinity;

        expect(median).toBeLessThan(100 * TEST_TIMEOUT_SCALE);
    });

    it('AC-5.3: строка, вставленная другим процессом, — не позже 1000 мс + пачка', async () => {
        const captured = await broker.capture('kit.#');
        const t0 = performance.now();
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             values ('evt_foreign', 'acme', 'kit.note.created', 1, 's', '{}', 't', '{"noteId":"n","title":"T"}')`,
        );
        await waitUntil(() => captured.length === 1, 'сообщение');

        expect(performance.now() - t0).toBeLessThan(1000 + 500 * TEST_TIMEOUT_SCALE);
    });
});
