// AC-5.6 (UC-6, prd.md §3.4 v1.25): опция обработчика dedupe переопределяет dedupe модуля — при модуле 'inbox'
// обработчик с {dedupe: 'none'} получает tx = null, строка inbox не пишется, повтор того же id вызывает его снова;
// обработчик без опции — inbox; {dedupe: 'inbox'} без таблицы inbox у модуля — отказ запуска с текстом.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbTx } from '../../../src/database/db.js';
import { KitSubscriber } from '../../../src/messaging/subscriber.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, truncateFixtures } from '../../support/database.js';
import {
    TestAccountTouched,
    TestNoteCreated,
    consumed,
    createMessagingApp,
    initReady,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

/** Обработчики: заметки — {dedupe: 'none'}, аккаунты — без опции (inbox модуля). */
@Injectable()
class MixedConsumer implements OnModuleInit {
    readonly notes: (DbTx | null)[] = [];
    readonly accounts: (DbTx | null)[] = [];

    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(
            TestNoteCreated,
            (_event, tx) => {
                this.notes.push(tx);

                return Promise.resolve();
            },
            { dedupe: 'none' },
        );
        this.subscriber.on(TestAccountTouched, (_event, tx) => {
            this.accounts.push(tx);

            return Promise.resolve();
        });
    }
}

/** Обработчик с {dedupe: 'inbox'} при модуле без таблицы inbox. */
@Injectable()
class InboxWithoutTableConsumer implements OnModuleInit {
    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(TestNoteCreated, () => Promise.resolve(), { dedupe: 'inbox' });
    }
}

describe('UC-6: dedupe на обработчик', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createMessagingApp({
            options: { subscriber: { inbox: fixtureSchema.inbox } },
            providers: [MixedConsumer],
        });
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
        await resetQueues();
        await truncateFixtures();
    });

    it("AC-5.6: модуль 'inbox', обработчик {dedupe: 'none'} — tx = null, строки inbox нет, повтор id вызывает обработчик снова", async () => {
        const envelope = testEnvelope({ id: 'evt_none_1' });
        publishEnvelope(broker, envelope);
        await waitUntil(async () => (await consumed(app, 'handled')) === 1, 'handled 1');
        publishEnvelope(broker, envelope);
        await waitUntil(async () => (await consumed(app, 'handled')) === 2, 'handled 2');

        expect(app.get(MixedConsumer).notes).toEqual([null, null]);
        expect(await consumed(app, 'duplicate')).toBe(0);
        expect(await adminQuery("select id from kit.inbox where id = 'evt_none_1'")).toEqual([]);
    });

    it('AC-5.6: обработчик без опции — inbox модуля: tx задан, строка inbox записана, повтор — duplicate', async () => {
        const envelope = testEnvelope({
            id: 'evt_inbox_1',
            type: TestAccountTouched.type,
            tenant: null,
            subject: { kind: 'account', id: 'a1' },
            data: { accountId: 'a1' },
        });
        publishEnvelope(broker, envelope);
        await waitUntil(
            async () => (await consumed(app, 'handled', TestAccountTouched.type)) === 1,
            'handled account',
        );
        publishEnvelope(broker, envelope);
        await waitUntil(
            async () => (await consumed(app, 'duplicate', TestAccountTouched.type)) === 1,
            'duplicate account',
        );

        const { accounts } = app.get(MixedConsumer);
        expect(accounts).toHaveLength(1);
        expect(accounts[0]).not.toBeNull();
        expect(await adminQuery("select id from kit.inbox where id = 'evt_inbox_1'")).toHaveLength(
            1,
        );
    });

    it("AC-5.6: {dedupe: 'inbox'} без таблицы inbox у модуля — отказ запуска с текстом", async () => {
        await expect(
            createMessagingApp({
                options: { subscriber: { dedupe: 'none' } },
                providers: [InboxWithoutTableConsumer],
            }).then((failed) => failed.init()),
        ).rejects.toThrow(/dedupe: 'inbox' — у KitMessagingModule нет таблицы inbox/);
    });
});
