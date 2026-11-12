// AC-5.10 (UC-12): с правами definitions.json (buildDefinitions — тот же путь, что CLI) relay публикует, подписчик
// получает, повтор и DLQ через exchange по умолчанию; объявление и чтение чужих очередей — ACCESS_REFUSED; exchange
// только пассивно; публикация с ключом вне префикса publishes — ACCESS_REFUSED (prd.md §3.4 M3, v1.20; П13). Обобщение O or-119-rabbit-permissions.int-spec на vhost воркера.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { asWorker, BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    consumed,
    createOutboxApp,
    initReady,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-12: права definitions.json', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
        });
        await initReady(app);
        await initReady(app, 'outbox-relay');
    });

    afterAll(async () => {
        await app.close();
        await broker.deleteQueue('platform').catch(() => undefined);
        await broker.close();
        await truncateFixtures();
    });

    async function add(title: string, noteId: string): Promise<void> {
        await app
            .get(Db)
            .transaction(ctx('acme'), (tx) =>
                app
                    .get(OutboxStore)
                    .add(tx, TestNoteCreated, { subjectId: noteId, data: { noteId, title } }),
            );
    }

    it('AC-5.10: relay публикует в verdeect.events с ключом своего префикса (publishes kit.), подписчик получает и подтверждает', async () => {
        await add('ok', 'p1');
        await waitUntil(async () => (await consumed(app, 'handled')) === 1, 'handled');

        expect(await adminQuery('select id from kit.inbox')).toHaveLength(1);
    });

    it('AC-5.10: сбой обработчика → kit.retry (dead-letter через exchange по умолчанию), InvalidMessageError → копия в kit.dlq', async () => {
        await add('fail', 'p2');
        await waitUntil(async () => (await consumed(app, 'retry')) >= 1, 'retry');
        await add('invalid', 'p3');
        await waitUntil(async () => (await consumed(app, 'dlq')) >= 1, 'dlq');

        expect((await broker.take('kit.dlq'))?.properties.headers?.['x-dlq-reason']).toBe(
            'test-invalid',
        );
        await broker.purge('kit', 'kit.retry');
    });

    it.each(['platform', 'platform.retry', 'identity'])(
        'AC-5.10: объявление чужой очереди %s → ACCESS_REFUSED',
        async (queue) => {
            expect(
                await asWorker((channel) => channel.assertQueue(queue, { durable: true })),
            ).toMatch(/ACCESS_REFUSED|403/);
        },
    );

    it('AC-5.10: чтение чужой очереди → ACCESS_REFUSED', async () => {
        await broker.channel.assertQueue('platform', { durable: true });

        expect(await asWorker((channel) => channel.consume('platform', () => undefined))).toMatch(
            /ACCESS_REFUSED|403/,
        );
    });

    it.each(['platform.note.created', 'kitx.note.created'])(
        'AC-5.10: публикация в verdeect.events с ключом %s вне префикса kit. → ACCESS_REFUSED',
        async (key) => {
            expect(
                await asWorker(async (channel) => {
                    channel.publish('verdeect.events', key, Buffer.from('{}'));
                    await channel.waitForConfirms();
                }),
            ).toMatch(/ACCESS_REFUSED|403/);
        },
    );

    it('AC-5.10: exchange виден пассивной проверкой', async () => {
        expect(await asWorker((channel) => channel.checkExchange('verdeect.events'))).toBe('ok');
    });

    it('AC-5.10: своя очередь kit.dlq читается пользователем', async () => {
        expect(await asWorker((channel) => channel.checkQueue('kit.dlq'))).toBe('ok');
        expect(await asWorker((channel) => channel.get('kit.dlq', { noAck: false }))).toBe('ok');
    });
});
