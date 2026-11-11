// AC-5.2 (UC-5): строка outbox — tenant, actor, traceId из DbContext, id evt_ + ULID; конверт relay — 01 §7.1, routing
// key = type; строка с типом вне outbox.events — subject.kind 'unknown', warn один раз на тип (prd.md §3.4 v1.15; П23).
// Эквивалентность O outbox.int-spec «relay публикует с routing key = type…», «чужой tenant».
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { EnvelopeSchema } from '../../../src/messaging/envelope.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, sqlStateOf, truncateFixtures } from '../../support/database.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import {
    TestNoteCreated,
    createOutboxApp,
    memoryLogger,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: строка и конверт outbox', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    const { logger, lines } = memoryLogger();

    beforeAll(async () => {
        broker = await BrokerClient.connect();
        app = await createOutboxApp({ overrides: [{ provide: KIT_LOGGER, useValue: logger }] });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    beforeEach(truncateFixtures);

    it('AC-5.2: строка содержит tenant, actor, traceId из DbContext и id evt_ + ULID', async () => {
        const context = {
            tenant: 'acme',
            traceId: 'trace-1',
            actor: { accountId: 'acc', channel: 'http' },
        };
        const id = await app.get(Db).transaction(context, (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            }),
        );

        expect(id).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
        const [row] = await outboxRows();
        expect(row).toMatchObject({
            id,
            tenant: 'acme',
            type: 'kit.note.created',
            subject_id: 'n1',
            actor: { accountId: 'acc', channel: 'http' },
            trace_id: 'trace-1',
            data: { noteId: 'n1', title: 'T' },
        });
    });

    it('AC-5.2: конверт relay совпадает с 01 §7.1 — EnvelopeSchema.parse(body), routing key = type, messageId = id, type, persistent, contentType, timestamp', async () => {
        const captured = await broker.capture('kit.#');
        const id = await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            }),
        );
        await waitUntil(() => captured.length === 1, 'одно сообщение');

        const [message] = captured;
        const [row] = await outboxRows();
        expect(message?.routingKey).toBe('kit.note.created');
        expect(EnvelopeSchema.parse(message?.body)).toEqual(message?.body);
        expect(message?.body).toEqual({
            id,
            type: 'kit.note.created',
            version: 1,
            occurredAt: expect.stringMatching(/Z$/) as unknown,
            tenant: 'acme',
            actor: { channel: 'http' },
            subject: { kind: 'note', id: 'n1' },
            data: { noteId: 'n1', title: 'T' },
            traceId: 'trace-test',
        });
        expect(message?.properties).toMatchObject({
            messageId: id,
            type: 'kit.note.created',
            contentType: 'application/json',
            deliveryMode: 2,
        });
        expect(typeof message?.properties.timestamp).toBe('number');
        await waitUntil(async () => (await outboxRows())[0]?.published_at !== null, 'published_at');
        expect(row?.id).toBe(id);
    });

    it('O outbox: строка чужого tenant под app.tenant=acme → ошибка политики', async () => {
        const error: unknown = await app
            .get(Db)
            .transaction(ctx('acme'), (tx) =>
                tx.execute(sql`insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
                    values ('evt_x', 'other', 't.a.b', 1, 's', '{}', 't', '{}')`),
            )
            .catch((reason: unknown) => reason);

        expect(sqlStateOf(error)).toBe('42501');
    });

    it("AC-5.2: строка с типом вне outbox.events опубликована с subject.kind = 'unknown', warn записан один раз на тип", async () => {
        const captured = await broker.capture('kit.legacy.#');
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             values ('evt_legacy_1', 'acme', 'kit.legacy.touched', 1, 'l1', '{}', 't', '{}'),
                    ('evt_legacy_2', 'acme', 'kit.legacy.touched', 1, 'l2', '{}', 't', '{}')`,
        );
        await waitUntil(() => captured.length === 2, 'два сообщения старого типа');

        expect(captured.map((message) => message.body['subject'])).toEqual([
            { kind: 'unknown', id: 'l1' },
            { kind: 'unknown', id: 'l2' },
        ]);
        expect(
            lines.filter(
                (line) =>
                    line['level'] === 40 &&
                    line['type'] === 'kit.legacy.touched' &&
                    String(line['msg']).includes('unknown'),
            ),
        ).toHaveLength(1);
    });
});
