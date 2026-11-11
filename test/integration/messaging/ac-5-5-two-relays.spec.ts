// AC-5.5 (UC-5): две реплики relay на одной БД и одном vhost — каждая строка публикуется один раз (FOR UPDATE SKIP
// LOCKED) (prd.md §3.4). Эквивалентность O outbox.int-spec «две реплики».
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { BrokerClient } from '../../support/broker.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: две реплики relay', () => {
    let first: NestFastifyApplication;
    let second: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await truncateFixtures();
        broker = await BrokerClient.connect();
        first = await createOutboxApp({ env: { REPLICA_ID: 'kit-1' } });
        await first.init();
        second = await createOutboxApp({ env: { REPLICA_ID: 'kit-2' } });
        await second.init();
    });

    afterAll(async () => {
        await Promise.all([first.close(), second.close()]);
        await broker.close();
        await truncateFixtures();
    });

    it('AC-5.5: две реплики relay — каждая строка публикуется один раз (SKIP LOCKED)', async () => {
        const captured = await broker.capture('kit.#');
        await first.get(Db).transaction(ctx('acme'), async (tx) => {
            for (let n = 0; n < 200; n += 1) {
                await first.get(OutboxStore).add(tx, TestNoteCreated, {
                    subjectId: `n${n}`,
                    data: { noteId: `n${n}`, title: 'T' },
                });
            }
        });
        // Пробуждение — у первой реплики; вторая опрашивает раз в секунду и берёт свою часть.
        await waitUntil(() => captured.length >= 200, '200 сообщений', 15_000);
        await waitUntil(
            async () => (await outboxRows()).every((row) => row.published_at !== null),
            'все published_at',
        );

        const ids = captured.map((message) => message.properties.messageId as string);
        expect(ids).toHaveLength(200);
        expect(new Set(ids).size).toBe(200);
    });
});
