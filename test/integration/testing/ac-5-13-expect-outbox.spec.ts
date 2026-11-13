// AC-5.13 (UC-14): expectOutbox видит строку события только текущей транзакции и пишет покрытие после успешной
// проверки; publishTestEvent + waitForInbox проверяют обработчик без sleep (prd.md §3.8 E5; П16–П18). Каталог покрытия у
// пакета не задан (globalSetup без outboxEvents) — setWorkerCoverageDir, сброс в afterAll (проект shared). v1.26: форма
// expectOutbox({app, traceId}) — use-case со своей транзакцией, строка ищется после COMMIT по trace_id.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { newId } from '../../../src/internal/ids.js';
import { EnvelopeSchema } from '../../../src/messaging/envelope.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { expectOutbox, setWorkerCoverageDir } from '../../../src/testing/outbox-coverage.js';
import {
    publishTestEvent,
    setTestEventsUrl,
    testEventsClosed,
    waitForInbox,
} from '../../../src/testing/test-events.js';
import { tcpProxy } from '../../../src/testing/tcp-proxy.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { BrokerClient, workerBroker } from '../../support/broker.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestAccountTouched,
    TestConsumer,
    TestNoteCreated,
    createOutboxApp,
    initReady,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';

describe('UC-14: помощники outbox', () => {
    let app: NestFastifyApplication;
    let dir: string;
    const file = (): string => join(dir, `w${process.env.VITEST_POOL_ID ?? '0'}.txt`);
    const keys = (): string[] =>
        existsSync(file()) ? readFileSync(file(), 'utf8').split('\n').filter(Boolean) : [];

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        dir = mkdtempSync(join(tmpdir(), 'kit-expect-outbox-'));
        setWorkerCoverageDir(dir);
        app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
        });
        await initReady(app);
    });

    afterAll(async () => {
        setWorkerCoverageDir(undefined);
        rmSync(dir, { recursive: true, force: true });
        await app.close();
        await truncateFixtures();
    });

    beforeEach(() => {
        rmSync(file(), { force: true });
    });

    it('AC-5.13: expectOutbox находит строку события в транзакции и пишет ключ kit.note.created.v1 в файл воркера', async () => {
        await app.get(Db).transaction(ctx('acme'), async (tx) => {
            await app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            });
            await expectOutbox(tx, TestNoteCreated, { subjectId: 'n1', data: { title: 'T' } });
        });

        expect(keys()).toEqual(['kit.note.created.v1']);
    });

    it('AC-5.13: упавший expectOutbox (нет строки / data не совпала) — ключ не записан', async () => {
        await app.get(Db).transaction(ctx('acme'), async (tx) => {
            await expect(expectOutbox(tx, TestNoteCreated)).rejects.toThrow(
                /нет строки kit\.note\.created\.v1/,
            );
            await app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            });
            await expect(
                expectOutbox(tx, TestNoteCreated, { data: { title: 'другое' } }),
            ).rejects.toThrow();
        });

        expect(keys()).toEqual([]);
    });

    it('AC-5.13: строка другой (закоммиченной) транзакции не засчитывается', async () => {
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n2',
                data: { noteId: 'n2', title: 'T' },
            }),
        );

        await app.get(Db).transaction(ctx('acme'), async (tx) => {
            await expect(expectOutbox(tx, TestNoteCreated, { subjectId: 'n2' })).rejects.toThrow();
        });
        expect(keys()).toEqual([]);
    });

    it('AC-5.13: use-case со своей транзакцией — после COMMIT expectOutbox({app, traceId}) находит строку и засчитывает покрытие', async () => {
        const traceId = newId('trc');
        await app
            .get(Db)
            .transaction({ tenant: 'acme', traceId, actor: { channel: 'http' } }, (tx) =>
                app.get(OutboxStore).add(tx, TestNoteCreated, {
                    subjectId: 'n3',
                    data: { noteId: 'n3', title: 'Свой' },
                }),
            );

        await expectOutbox({ app, traceId }, TestNoteCreated, {
            subjectId: 'n3',
            data: { title: 'Свой' },
        });
        expect(keys()).toEqual(['kit.note.created.v1']);
    });

    it('AC-5.13: строка того же типа с другим traceId не засчитывается — без своей строки expectOutbox падает', async () => {
        await app
            .get(Db)
            .transaction(
                { tenant: 'acme', traceId: newId('trc'), actor: { channel: 'http' } },
                (tx) =>
                    app.get(OutboxStore).add(tx, TestNoteCreated, {
                        subjectId: 'n4',
                        data: { noteId: 'n4', title: 'Чужой' },
                    }),
            );

        await expect(expectOutbox({ app, traceId: newId('trc') }, TestNoteCreated)).rejects.toThrow(
            /нет строки kit\.note\.created\.v1/,
        );
        expect(keys()).toEqual([]);
    });

    it('AC-5.13: {app, traceId} — data не по ожиданию — падает, покрытие не записано', async () => {
        const traceId = newId('trc');
        await app
            .get(Db)
            .transaction({ tenant: 'acme', traceId, actor: { channel: 'http' } }, (tx) =>
                app.get(OutboxStore).add(tx, TestNoteCreated, {
                    subjectId: 'n5',
                    data: { noteId: 'n5', title: 'T' },
                }),
            );

        const error: unknown = await expectOutbox({ app, traceId }, TestNoteCreated, {
            data: { title: 'другое' },
        }).catch((reason: unknown) => reason);

        // Падение — из-за расхождения data (строка найдена), а не из-за её отсутствия.
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('expectOutbox: data kit.note.created.v1 не совпала');
        expect(message).toContain('title');
        expect(message).not.toContain('нет строки');
        expect(keys()).toEqual([]);
    });

    it('UC-14: publishTestEvent + waitForInbox — обработчик подписчика вызван, без sleep', async () => {
        const envelope = await publishTestEvent(TestNoteCreated, { noteId: 'n9', title: 'ok' });
        await waitForInbox(envelope.id, { timeoutMs: 5_000 });

        expect(app.get(TestConsumer).received.some((item) => item.id === envelope.id)).toBe(true);
    });

    it("UC-14: publishTestEvent — тенант воркера для 'required', null для 'none'; EnvelopeSchema", async () => {
        const broker = await BrokerClient.connect();
        try {
            const captured = await broker.capture('kit.#');
            const required = await publishTestEvent(TestNoteCreated, { noteId: 'n1', title: 'ok' });
            const none = await publishTestEvent(TestAccountTouched, { accountId: 'a1' });

            expect(required.tenant).toBe(workerScope().tenant);
            expect(none.tenant).toBeNull();
            expect(EnvelopeSchema.parse(required)).toEqual(required);
            await waitUntil(
                () => captured.length >= 2,
                'два опубликованных конверта во временной очереди теста',
            );
            expect(captured.map((message) => message.body['id'])).toEqual([required.id, none.id]);
        } finally {
            await broker.close();
        }
    });

    it('UC-14: waitForInbox — срок вышел → ошибка с id', async () => {
        await expect(waitForInbox('evt_never', { timeoutMs: 50 })).rejects.toThrow(
            'waitForInbox: событие evt_never не обработано за 50 мс',
        );
    });

    it('UC-14: publishTestEvent после обрыва соединения (tcpProxy) пересоздаёт канал — событие доходит до waitForInbox', async () => {
        const proxy = await tcpProxy(workerBroker().adminUrl);
        setTestEventsUrl(proxy.url);
        try {
            const first = await publishTestEvent(TestNoteCreated, { noteId: 'p1', title: 'ok' });
            await waitForInbox(first.id, { timeoutMs: 5_000 });
            const closed = testEventsClosed();

            await proxy.break();
            await closed;
            await proxy.restore();

            const second = await publishTestEvent(TestNoteCreated, { noteId: 'p2', title: 'ok' });
            await waitForInbox(second.id, { timeoutMs: 5_000 });
        } finally {
            setTestEventsUrl(undefined);
            await proxy.close();
        }
    });
});
