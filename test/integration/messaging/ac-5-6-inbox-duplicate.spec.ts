// AC-5.6 (UC-6): inbox занимается в транзакции обработчика — повтор id → duplicate без вызова обработчика (prd.md §3.4,
// §6). Обработчик под RLS видит только строки тенанта события; on после onApplicationBootstrap — ошибка (PRD v1.15).
// Эквивалентность — O inbox-guard.int-spec (claim, откат, параллельный claim).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimInbox } from '../../../src/messaging/inbox.js';
import { KitSubscriber } from '../../../src/messaging/subscriber.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { BrokerClient } from '../../support/broker.js';
import {
    adminQuery,
    createTestDb,
    ctx,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    barrier,
    consumed,
    createSubscriberApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: inbox', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;
    let test: TestDb;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        test = await createTestDb();
        app = await createSubscriberApp();
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
        await test.close();
        await truncateFixtures();
    });

    it('AC-5.6: повтор сообщения с тем же id → duplicate, обработчик не вызван, verdeect_events_consumed_total{result="duplicate"} +1', async () => {
        const envelope = testEnvelope({ id: 'evt_dup_1' });
        publishEnvelope(broker, envelope);
        await waitUntil(async () => (await consumed(app, 'handled')) === 1, 'handled 1');
        publishEnvelope(broker, envelope);
        await waitUntil(async () => (await consumed(app, 'duplicate')) === 1, 'duplicate 1');

        expect(app.get(TestConsumer).count()).toBe(1);
        expect(await adminQuery("select id from kit.inbox where id = 'evt_dup_1'")).toHaveLength(1);
        expect(app.get(TestConsumer).lastTx).not.toBeNull();
    });

    it("AC-5.6: обработчик при dedupe 'inbox' получает tx с DbContext из конверта и под RLS видит только строки тенанта события", async () => {
        await adminQuery(
            "insert into kit.note (id, tenant, body) values ('a1', 'acme', 'x'), ('a2', 'acme', 'y'), ('g1', 'globex', 'z')",
        );
        const consumer = app.get(TestConsumer);
        const before = consumer.count();
        publishEnvelope(
            broker,
            testEnvelope({ tenant: 'acme', data: { noteId: 'n1', title: 'rls' } }),
        );
        await waitUntil(() => consumer.count() === before + 1, 'обработчик rls');

        expect(consumer.visibleNotes).toBe(2);
        expect(consumer.received.at(-1)?.tenant).toBe('acme');
    });

    it('AC-5.6: on после onApplicationBootstrap — ошибка', () => {
        expect(() => app.get(KitSubscriber).on(TestNoteCreated, () => Promise.resolve())).toThrow(
            'KitSubscriber.on: регистрация — до запуска приложения (onModuleInit)',
        );
    });

    it('O inbox-guard: первый claim → true, повтор → false; откат первого claim — повтор → true; параллельный claim того же id ждёт первую транзакцию', async () => {
        const inbox = fixtureSchema.inbox;
        expect(
            await test.db.transaction(ctx(null), (tx) => claimInbox(tx, inbox, 'evt_g1', 't')),
        ).toBe(true);
        expect(
            await test.db.transaction(ctx(null), (tx) => claimInbox(tx, inbox, 'evt_g1', 't')),
        ).toBe(false);

        await test.db
            .transaction(ctx(null), async (tx) => {
                await claimInbox(tx, inbox, 'evt_g2', 't');
                throw new Error('откат');
            })
            .catch(() => undefined);
        expect(
            await test.db.transaction(ctx(null), (tx) => claimInbox(tx, inbox, 'evt_g2', 't')),
        ).toBe(true);

        const gate = barrier();
        const claimed = barrier();
        const first = test.db.transaction(ctx(null), async (tx) => {
            const result = await claimInbox(tx, inbox, 'evt_g3', 't');
            claimed.release();
            await gate.wait;

            return result;
        });
        await claimed.wait;
        let secondDone = false;
        const second = test.db
            .transaction(ctx(null), (tx) => claimInbox(tx, inbox, 'evt_g3', 't'))
            .finally(() => {
                secondDone = true;
            });
        // Второй INSERT ждёт блокировку первого: сигнал — ожидание в pg_locks, без паузы.
        await waitUntil(
            async () =>
                (
                    await adminQuery(
                        "select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%kit%inbox%'",
                    )
                ).length > 0,
            'второй claim ждёт блокировку',
        );
        expect(secondDone).toBe(false);
        gate.release();

        expect(await first).toBe(true);
        expect(await second).toBe(false);
    });
});
