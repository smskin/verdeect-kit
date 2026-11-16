// AC-5.13 (UC-14, prd.md §3.8 стр. 190 v1.31): deliverTestEvent(app, Event, data, opts?) — доставка конверта подписчику
// этого приложения тем же путём, что handle() (разбор, выбор по паре, проверка data, inbox, классификация ошибки), без
// брокера, ack/nack и DLQ; итог — handled | duplicate | skipped | retry | dlq с причиной. Основная проверка — уровень C
// (test/consumer/minimal/src/delivery.spec.ts); здесь — строки таблицы итогов R14 плана rc.10. waitForDelivery(app, id)
// — первый итог доставки брокера в этом экземпляре (журнал пишется только при загруженном /testing).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import { waitForDelivery } from '../../../src/testing/delivery.js';
import { deliverTestEvent, publishTestEvent } from '../../../src/testing/test-events.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestConsumerDlq,
    TestNoteCreated,
    TestNoteCreatedV2,
    createMessagingApp,
    createSubscriberApp,
    resetQueues,
} from '../../support/messaging.js';

/** Событие без подписки. */
const TestOtherDone = defineEvent({
    type: 'kit.other.done',
    version: 1,
    subject: 'other',
    data: z.object({ otherId: z.string() }),
});

async function inboxHas(id: string): Promise<boolean> {
    return (await adminQuery('select 1 from kit.inbox where id = $1', [id])).length > 0;
}

describe('UC-14: deliverTestEvent', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await resetQueues();
        app = await createSubscriberApp();
        broker = await BrokerClient.connect();
    });

    afterAll(async () => {
        await broker.close();
        await app.close();
    });

    beforeEach(truncateFixtures);

    it("AC-5.13: подписанная пара, dedupe: 'inbox', первый id — handled и строка inbox; тот же id — duplicate", async () => {
        const before = app.get(TestConsumer).count();
        const first = await deliverTestEvent(
            app,
            TestNoteCreated,
            { noteId: 'n1', title: 'ok' },
            { id: 'evt_d1' },
        );
        const again = await deliverTestEvent(
            app,
            TestNoteCreated,
            { noteId: 'n1', title: 'ok' },
            { id: 'evt_d1' },
        );

        expect(first).toEqual({ result: 'handled' });
        expect(await inboxHas('evt_d1')).toBe(true);
        expect(again).toEqual({ result: 'duplicate' });
        expect(app.get(TestConsumer).count()).toBe(before + 1);
    });

    it('AC-5.13: data вне схемы — dlq с причиной data; обработчик не вызван', async () => {
        const before = app.get(TestConsumer).count();
        const outcome = await deliverTestEvent(app, TestNoteCreated, {
            noteId: 'n2',
            title: '',
        });

        expect(outcome).toEqual({ result: 'dlq', reason: 'data' });
        expect(app.get(TestConsumer).count()).toBe(before);
    });

    it("AC-5.13: неподписанная версия, unknownVersion: 'skip' — skipped; type не подписан — dlq unsubscribed", async () => {
        expect(
            await deliverTestEvent(app, TestNoteCreatedV2, {
                noteId: 'n3',
                title: 'ok',
                priority: 1,
            }),
        ).toEqual({ result: 'skipped' });
        expect(await deliverTestEvent(app, TestOtherDone, { otherId: 'o1' })).toEqual({
            result: 'dlq',
            reason: 'unsubscribed',
        });
    });

    it('AC-5.13: InvalidMessageError — dlq с error.reason; прочая ошибка и ExpectedMessageError — retry', async () => {
        const deliver = (title: string) =>
            deliverTestEvent(app, TestNoteCreated, { noteId: `n-${title}`, title });

        expect(await deliver('invalid')).toEqual({ result: 'dlq', reason: 'test-invalid' });
        expect(await deliver('fail')).toEqual({ result: 'retry' });
        expect(await deliver('expected')).toEqual({ result: 'retry' });
    });

    it('AC-5.13: deliverTestEvent не публикует в брокер — в очереди kit и kit.dlq 0 сообщений', async () => {
        await deliverTestEvent(app, TestNoteCreated, { noteId: 'n5', title: 'invalid' });

        expect((await broker.queueInfo('kit'))?.messageCount ?? 0).toBe(0);
        expect((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0).toBe(0);
    });

    it("AC-5.13: неподписанная версия, unknownVersion: 'dlq' — dlq с причиной version", async () => {
        const dlqApp = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [TestConsumerDlq],
        });
        try {
            expect(
                await deliverTestEvent(dlqApp, TestNoteCreatedV2, {
                    noteId: 'n6',
                    title: 'ok',
                    priority: 1,
                }),
            ).toEqual({ result: 'dlq', reason: 'version' });
        } finally {
            await dlqApp.close();
        }
    });
});

describe('UC-14: waitForDelivery', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
        await resetQueues();
        app = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [TestConsumer],
        });
    });

    afterAll(async () => {
        await app.close();
    });

    it("AC-5.13: подписчик dedupe: 'none' — publishTestEvent → waitForDelivery → handled; вызов после доставки — тоже handled", async () => {
        const consumer = app.get(TestConsumer);
        const before = consumer.count();
        const envelope = await publishTestEvent(TestNoteCreated, { noteId: 'w1', title: 'ok' });

        expect(await waitForDelivery(app, envelope.id, { timeoutMs: 5_000 })).toEqual({
            result: 'handled',
        });
        expect(consumer.count()).toBe(before + 1);
        expect(await waitForDelivery(app, envelope.id, { timeoutMs: 5_000 })).toEqual({
            result: 'handled',
        });
    });

    it('AC-5.13: InvalidMessageError — dlq с причиной', async () => {
        const envelope = await publishTestEvent(TestNoteCreated, {
            noteId: 'w2',
            title: 'invalid',
        });

        expect(await waitForDelivery(app, envelope.id, { timeoutMs: 5_000 })).toEqual({
            result: 'dlq',
            reason: 'test-invalid',
        });
    });

    it('AC-5.13: неизвестный id с timeoutMs: 200 — Error с id в тексте', async () => {
        await expect(waitForDelivery(app, 'evt_nope', { timeoutMs: 200 })).rejects.toThrow(
            /evt_nope/,
        );
    });
});
