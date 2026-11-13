// AC-5.22 (UC-6 А8; prd.md §3.4 v1.26–v1.27): обработчик выбирается по паре (type, version) для on и onReplica;
// неподписанная версия подписанного type — ack без обработки, без inbox и DLQ, verdeect_events_skipped_total{type, version}
// и debug-строка; повтор пары — ошибка регистрации; v1 и v2 одного type — без ошибки. v1.28: unknownVersion — одно
// значение на type, 'dlq' не влияет на подписанные версии (случай DLQ — ac-5-22-unknown-version-dlq.spec.ts).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { KitSubscriber } from '../../../src/messaging/subscriber.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, truncateFixtures } from '../../support/database.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import {
    ReplicaConsumer,
    TestConsumer,
    TestConsumerDlq,
    TestConsumerDlqV2,
    TestConsumerV2,
    TestNoteCreated,
    TestNoteCreatedV2,
    consumed,
    createMessagingApp,
    initReady,
    memoryLogger,
    publishEnvelope,
    resetQueues,
    skipped,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

const V2_DATA = { noteId: 'n2', title: 'ok', priority: 1 };

function detachedSubscriber(): KitSubscriber {
    return new KitSubscriber({
        service: 'kit',
        replica: 'kit-1',
        dedupe: 'none',
        connection: null,
        retrySeconds: 1,
        reconnectSeconds: 1,
    });
}

async function inboxIds(): Promise<string[]> {
    const rows = await adminQuery<{ id: string }>('select id from kit.inbox order by id');

    return rows.map(({ id }) => id);
}

describe('UC-6: версии событий', () => {
    let broker: BrokerClient;
    let app: NestFastifyApplication | undefined;

    beforeAll(async () => {
        broker = await BrokerClient.connect();
    });

    afterAll(async () => {
        await broker.close();
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        await truncateFixtures();
    });

    describe('очередь сервиса', () => {
        it('AC-5.22: обработчик v1, конверты v1 и v2 — вызван только для v1, v2 подтверждено, inbox без v2, DLQ пуст, skipped{type, version="2"} = 1', async () => {
            await resetQueues();
            const { logger, lines } = memoryLogger();
            app = await createMessagingApp({
                options: { subscriber: { inbox: fixtureSchema.inbox } },
                providers: [TestConsumer],
                overrides: [{ provide: KIT_LOGGER, useValue: logger }],
            });
            await initReady(app);
            const current = app;
            const consumer = app.get(TestConsumer);
            publishEnvelope(broker, testEnvelope({ id: 'evt_v1' }));
            publishEnvelope(broker, testEnvelope({ id: 'evt_v2', version: 2, data: V2_DATA }));

            await waitUntil(async () => (await skipped(current, 2)) === 1, 'skipped v2');
            await waitUntil(() => consumer.count() === 1, 'обработчик v1');
            await waitUntil(
                async () => (await broker.queueInfo('kit'))?.messageCount === 0,
                'очередь kit пуста',
            );

            expect(consumer.received.map((event) => event.id)).toEqual(['evt_v1']);
            expect(await inboxIds()).toEqual(['evt_v1']);
            expect((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0).toBe(0);
            expect(await consumed(current, 'handled')).toBe(1);
            expect(await consumed(current, 'dlq')).toBe(0);
            // AC-5.22: в debug-логе пропуска есть type, version, id.
            expect(
                lines.find(
                    (line) =>
                        line['msg'] ===
                        'messaging: версия события не подписана — подтверждено без обработки',
                ),
            ).toMatchObject({ id: 'evt_v2', type: TestNoteCreated.type, version: 2 });
        });

        it('AC-5.22: конверт v2 с data, проходящими схему v1, обработчику v1 не попадает', async () => {
            await resetQueues();
            app = await createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [TestConsumer],
            });
            await initReady(app);
            const current = app;
            publishEnvelope(broker, testEnvelope({ id: 'evt_v2_like_v1', version: 2 }));

            await waitUntil(async () => (await skipped(current, 2)) === 1, 'skipped v2');
            expect(app.get(TestConsumer).count()).toBe(0);
        });

        it('AC-5.22: обработчики v1 и v2 — каждый получает свою версию', async () => {
            await resetQueues();
            app = await createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [TestConsumer, TestConsumerV2],
            });
            await initReady(app);
            const v1 = app.get(TestConsumer);
            const v2 = app.get(TestConsumerV2);
            publishEnvelope(broker, testEnvelope({ id: 'evt_a1' }));
            publishEnvelope(broker, testEnvelope({ id: 'evt_a2', version: 2, data: V2_DATA }));

            await waitUntil(() => v1.count() === 1 && v2.received.length === 1, 'оба обработчика');
            expect(v1.received.map((event) => [event.id, event.version])).toEqual([['evt_a1', 1]]);
            expect(v2.received.map((event) => [event.id, event.version])).toEqual([['evt_a2', 2]]);
            expect(await skipped(app, 2)).toBe(0);
        });
    });

    describe('регистрация', () => {
        it('AC-5.22: повторный on той же пары — ошибка регистрации', () => {
            const subscriber = detachedSubscriber();
            subscriber.on(TestNoteCreated, () => Promise.resolve());

            expect(() => subscriber.on(TestNoteCreated, () => Promise.resolve())).toThrow(
                new TypeError(
                    'KitSubscriber.on: обработчик kit.note.created v1 уже зарегистрирован',
                ),
            );
        });

        it('AC-5.22: on v1 и on v2 одного type — без ошибки', () => {
            const subscriber = detachedSubscriber();
            subscriber.on(TestNoteCreated, () => Promise.resolve());

            expect(() => subscriber.on(TestNoteCreatedV2, () => Promise.resolve())).not.toThrow();
        });

        it('AC-5.22: повторный onReplica той же пары — ошибка', () => {
            const subscriber = detachedSubscriber();
            subscriber.onReplica(TestNoteCreated, () => Promise.resolve());

            expect(() => subscriber.onReplica(TestNoteCreated, () => Promise.resolve())).toThrow(
                new TypeError(
                    'KitSubscriber.onReplica: обработчик kit.note.created v1 уже зарегистрирован',
                ),
            );
            expect(() =>
                subscriber.onReplica(TestNoteCreatedV2, () => Promise.resolve()),
            ).not.toThrow();
        });
    });

    describe('unknownVersion', () => {
        it("AC-5.22: unknownVersion: 'dlq' — конверт v1 обработан как обычно", async () => {
            await resetQueues();
            app = await createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [TestConsumerDlq],
            });
            await initReady(app);
            const consumer = app.get(TestConsumerDlq);
            publishEnvelope(broker, testEnvelope({ id: 'evt_d1' }));

            await waitUntil(() => consumer.received.length === 1, 'обработчик v1');
            expect(consumer.received.map((event) => event.id)).toEqual(['evt_d1']);
            expect(await consumed(app, 'handled')).toBe(1);
            expect((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0).toBe(0);
        });

        it("AC-5.22: unknownVersion: 'dlq' у on v1 и on v2 — каждый получает свою версию", async () => {
            await resetQueues();
            app = await createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [TestConsumerDlq, TestConsumerDlqV2],
            });
            await initReady(app);
            const v1 = app.get(TestConsumerDlq);
            const v2 = app.get(TestConsumerDlqV2);
            publishEnvelope(broker, testEnvelope({ id: 'evt_d1' }));
            publishEnvelope(broker, testEnvelope({ id: 'evt_d2', version: 2, data: V2_DATA }));

            await waitUntil(
                () => v1.received.length === 1 && v2.received.length === 1,
                'оба обработчика',
            );
            expect(v1.received.map((event) => [event.id, event.version])).toEqual([['evt_d1', 1]]);
            expect(v2.received.map((event) => [event.id, event.version])).toEqual([['evt_d2', 2]]);
            expect((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0).toBe(0);
        });

        it('AC-5.22: разные unknownVersion у on одного type — ошибка регистрации', () => {
            const error = new TypeError(
                'KitSubscriber.on: у обработчиков kit.note.created разные unknownVersion — значение одно на type',
            );
            const dlqFirst = detachedSubscriber();
            dlqFirst.on(TestNoteCreated, () => Promise.resolve(), { unknownVersion: 'dlq' });
            expect(() => dlqFirst.on(TestNoteCreatedV2, () => Promise.resolve())).toThrow(error);

            const skipFirst = detachedSubscriber();
            skipFirst.on(TestNoteCreated, () => Promise.resolve());
            expect(() =>
                skipFirst.on(TestNoteCreatedV2, () => Promise.resolve(), {
                    unknownVersion: 'dlq',
                }),
            ).toThrow(error);

            const both = detachedSubscriber();
            both.on(TestNoteCreated, () => Promise.resolve(), { unknownVersion: 'dlq' });
            expect(() =>
                both.on(TestNoteCreatedV2, () => Promise.resolve(), { unknownVersion: 'dlq' }),
            ).not.toThrow();
        });

        it("AC-5.22: unknownVersion вне 'skip' | 'dlq' — TypeError", () => {
            const subscriber = detachedSubscriber();
            const options = { unknownVersion: 'drop' } as unknown as {
                readonly unknownVersion: 'skip';
            };

            expect(() => subscriber.on(TestNoteCreated, () => Promise.resolve(), options)).toThrow(
                new TypeError("KitSubscriber.on: unknownVersion drop — 'skip' или 'dlq'"),
            );
        });
    });

    describe('очередь реплики', () => {
        it('AC-5.22: onReplica v1, конверт v2 — обработчик не вызван, skipped +1', async () => {
            await resetQueues();
            app = await createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [ReplicaConsumer],
            });
            await initReady(app, 'subscriber-replica');
            const current = app;
            const consumer = app.get(ReplicaConsumer);
            publishEnvelope(broker, testEnvelope({ id: 'evt_r2', version: 2, data: V2_DATA }));
            publishEnvelope(broker, testEnvelope({ id: 'evt_r1' }));

            await waitUntil(() => consumer.calls === 1, 'обработчик реплики v1');
            await waitUntil(async () => (await skipped(current, 2)) === 1, 'skipped v2');
            expect(consumer.calls).toBe(1);
        });
    });
});
