// AC-5.23 (UC-5; prd.md §3.4 v1.27 стр. 128): outbox.events уникальны по паре (type, version) — публикующий пишет обе
// версии на время перехода; OutboxStore.add пишет version определения; relay ищет определение по паре; строка с парой
// вне outbox.events — subject.kind 'unknown', warn один раз на пару.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestAccountTouched,
    TestConsumer,
    TestConsumerV2,
    TestNoteCreated,
    TestNoteCreatedV2,
    createOutboxApp,
    initReady,
    memoryLogger,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: outbox — версии событий', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    const { logger, lines } = memoryLogger();

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createOutboxApp({
            events: [TestNoteCreated, TestNoteCreatedV2, TestAccountTouched],
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer, TestConsumerV2],
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    beforeEach(truncateFixtures);

    it('AC-5.23: outbox.events с E v1 и v2 — обе пары записываются OutboxStore.add и публикуются со своей version; подписчик с обработчиками v1 и v2 получает каждую своим обработчиком', async () => {
        const captured = await broker.capture('kit.note.created');
        await app.get(Db).transaction(ctx('acme'), async (tx) => {
            const store = app.get(OutboxStore);
            await store.add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'ok' },
            });
            await store.add(tx, TestNoteCreatedV2, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'ok', priority: 2 },
            });
        });
        const v1 = app.get(TestConsumer);
        const v2 = app.get(TestConsumerV2);

        await waitUntil(() => captured.length === 2, 'две публикации');
        await waitUntil(() => v1.count() === 1 && v2.received.length === 1, 'оба обработчика');
        const rows = await adminQuery<{ version: number }>(
            'select version from kit.outbox order by seq',
        );
        expect(rows.map(({ version }) => version)).toEqual([1, 2]);
        expect(captured.map((message) => message.body['version'])).toEqual([1, 2]);
        expect(captured.map((message) => message.body['subject'])).toEqual([
            { kind: 'note', id: 'n1' },
            { kind: 'note', id: 'n1' },
        ]);
        expect(v1.received.at(-1)?.version).toBe(1);
        expect(v2.received.at(-1)?.version).toBe(2);
    });

    it('AC-5.23: повтор пары в outbox.events — TypeError при сборке модуля', async () => {
        await expect(
            createOutboxApp({ events: [TestNoteCreated, TestNoteCreatedV2, TestNoteCreated] }),
        ).rejects.toThrow(
            new TypeError('KitMessagingModule: событие kit.note.created v1 указано дважды'),
        );
    });

    it("AC-5.23: строка с version вне outbox.events публикуется с subject.kind = 'unknown', warn один раз на пару", async () => {
        const captured = await broker.capture('kit.note.created');
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             values ('evt_v3_1', 'acme', 'kit.note.created', 3, 'n3', '{}', 't', '{}'),
                    ('evt_v3_2', 'acme', 'kit.note.created', 3, 'n4', '{}', 't', '{}')`,
        );

        await waitUntil(() => captured.length === 2, 'две публикации v3');
        expect(
            captured.map((message) => [message.body['version'], message.body['subject']]),
        ).toEqual([
            [3, { kind: 'unknown', id: 'n3' }],
            [3, { kind: 'unknown', id: 'n4' }],
        ]);
        expect(
            lines.filter(
                (line) =>
                    line['level'] === 40 &&
                    line['msg'] === 'outbox: пара события вне outbox.events — subject.kind unknown',
            ),
        ).toEqual([expect.objectContaining({ type: 'kit.note.created', version: 3 })]);
    });
});
