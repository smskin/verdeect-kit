// AC-5.10 (UC-12, prd.md §3.4 v1.20): отказ брокера на публикацию с ключом вне префикса publishes (ACCESS_REFUSED) идёт
// по существующему пути relay AC-5.4/5.7 — строка остаётся в outbox неопубликованной с attempts и last_error с
// причиной брокера (не «channel closed»), warn прохода с той же причиной; порядок seq сохраняется — следующая строка ждёт
// за отказанной (первая неудача прерывает пачку, §3.4), после удаления отказанной публикуется: канал восстановлен (KT-62).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { defineEvent } from '../../../src/messaging/define-event.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { BrokerClient, type CapturedMessage } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    initReady,
    memoryLogger,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

/** Тип вне префикса `kit.` пользователя воркера. */
const ForeignNoteCreated = defineEvent({
    type: 'platform.note.created',
    version: 1,
    subject: 'note',
    data: z.object({ noteId: z.string() }),
});

describe('UC-12: отказ публикации вне префикса в relay', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    let captured: CapturedMessage[];
    const { logger, lines } = memoryLogger();

    beforeAll(async () => {
        await truncateFixtures();
        broker = await BrokerClient.connect();
        captured = await broker.capture('kit.#');
        app = await createOutboxApp({
            events: [TestNoteCreated, ForeignNoteCreated],
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app, 'outbox-relay');
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
        await truncateFixtures();
    });

    it('AC-5.10: ACCESS_REFUSED на ключ вне префикса — строка не опубликована, attempts ≥ 1, last_error и warn с причиной брокера', async () => {
        await app
            .get(Db)
            .transaction(ctx('acme'), (tx) =>
                app
                    .get(OutboxStore)
                    .add(tx, ForeignNoteCreated, { subjectId: 'f1', data: { noteId: 'f1' } }),
            );
        await waitUntil(async () => ((await outboxRows())[0]?.attempts ?? 0) >= 1, 'attempts');

        const [row] = await outboxRows();
        expect(row).toMatchObject({ type: 'platform.note.created', published_at: null });
        expect(row?.last_error).toMatch(
            /ACCESS_REFUSED - write access to topic 'platform\.note\.created'/,
        );
        expect(row?.last_error).not.toContain('"noteId"');
        const warn = lines.find((line) => line['msg'] === 'outbox: публикация не удалась');
        expect(warn?.['error']).toBe(row?.last_error);
        expect(await outboxRows()).toHaveLength(1);
    });

    it('AC-5.10: после ACCESS_REFUSED порядок seq сохраняется — строка kit. ждёт за отказанной; отказанная удалена — строка kit. публикуется и доходит до очереди (канал восстановлен)', async () => {
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'k1',
                data: { noteId: 'k1', title: 'ok' },
            }),
        );
        const foreign = async () =>
            (await outboxRows()).find((row) => row.type === ForeignNoteCreated.type);
        const own = async () =>
            (await outboxRows()).find((row) => row.type === TestNoteCreated.type);
        // Ещё одна неудача отказанной строки после вставки — relay прошёл пачку, строка kit. за ней не ушла (§3.4).
        const attempts = (await foreign())?.attempts ?? 0;
        await waitUntil(
            async () => ((await foreign())?.attempts ?? 0) > attempts,
            'повтор отказанной',
        );
        expect(await own()).toMatchObject({ published_at: null, attempts: 0 });
        expect(captured).toEqual([]);

        // Оператор убирает отказанную строку: следующий проход публикует строку kit. тем же relay.
        await adminQuery('DELETE FROM kit.outbox WHERE type = $1', [ForeignNoteCreated.type]);
        await waitUntil(async () => (await own())?.published_at != null, 'published');
        await waitUntil(() => captured.length === 1, 'captured');

        expect(captured.map((message) => message.routingKey)).toEqual([TestNoteCreated.type]);
    });
});
