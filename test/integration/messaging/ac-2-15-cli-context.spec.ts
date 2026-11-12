// AC-2.15 (UC-13, prd.md §3.2, §3.4 v1.25): контекст CLI сервиса — KitCoreModule({entry: 'cli'}) и
// KitMessagingModule({listen: false}) — не открывает соединений с брокером (адрес брокера — счётчик соединений),
// OutboxStore.add пишет строку, subscriber.on принимается; после публикации репликой API awaitPublished → pending: 0, по
// сроку — pending > 0 без исключения.
import 'reflect-metadata';
import { createServer, type Server } from 'node:net';
import { Injectable, Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KitConfigModule } from '../../../src/config/index.js';
import { Db } from '../../../src/database/db.js';
import { KitDatabaseModule } from '../../../src/database/kit-database.module.js';
import { setPreparsedEnv } from '../../../src/internal/preparsed-env.js';
import { parseEnv } from '../../../src/config/parse-env.js';
import { KitMessagingModule } from '../../../src/messaging/kit-messaging.module.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { KitSubscriber } from '../../../src/messaging/subscriber.js';
import { KitCoreModule } from '../../../src/observability/kit-core.module.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestNoteCreated,
    createOutboxApp,
    initReady,
    messagingEnv,
    messagingEnvSchema,
    outboxRows,
} from '../../support/messaging.js';

/** Обработчик сервиса: регистрируется в конструкторе, как в общем модуле API и CLI. */
@Injectable()
class NotesConsumer {
    constructor(subscriber: KitSubscriber) {
        subscriber.on(TestNoteCreated, () => Promise.resolve());
    }
}

describe('UC-13: контекст CLI сервиса', () => {
    let broker: Server;
    let connections = 0;
    let cli: INestApplicationContext;

    beforeAll(async () => {
        await truncateFixtures();
        broker = createServer((socket) => {
            connections += 1;
            socket.destroy();
        });
        await new Promise<void>((resolve) => broker.listen(0, '127.0.0.1', resolve));
        const address = broker.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const messaging = await KitMessagingModule.forRoot({
            service: 'kit',
            listen: false,
            outbox: { table: fixtureSchema.outbox, events: [TestNoteCreated] },
            subscriber: { inbox: fixtureSchema.inbox },
        });

        @Module({
            imports: [
                KitConfigModule.forRoot({ schema: messagingEnvSchema }),
                KitCoreModule.forRoot({ service: 'kit', entry: 'cli' }),
                KitDatabaseModule.forRoot({ schema: fixtureSchema }),
                messaging,
            ],
            providers: [NotesConsumer],
        })
        class CliModule {}

        setPreparsedEnv(
            messagingEnvSchema,
            parseEnv(
                messagingEnvSchema,
                messagingEnv({ RABBITMQ_URL: `amqp://kit:x@127.0.0.1:${String(port)}/kit` }),
            ),
        );
        cli = await NestFactory.createApplicationContext(CliModule, {
            logger: false,
            abortOnError: false,
        });
        await cli.init();
    });

    afterAll(async () => {
        await cli.close();
        await new Promise<void>((resolve) => broker.close(() => resolve()));
        await truncateFixtures();
    });

    async function add(noteId: string): Promise<string> {
        return cli.get(Db).transaction(ctx('acme'), (tx) =>
            cli.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: noteId,
                data: { noteId, title: 'cli' },
            }),
        );
    }

    it('AC-2.15: listen: false — соединений с брокером нет, OutboxStore.add пишет строку, subscriber.on принят', async () => {
        const id = await add('n1');

        expect(connections).toBe(0);
        expect(await outboxRows()).toEqual([
            expect.objectContaining({ id, type: TestNoteCreated.type, published_at: null }),
        ]);
    });

    it('AC-2.15: awaitPublished по сроку без relay — pending > 0 без исключения', async () => {
        const [row] = await outboxRows();

        expect(
            await cli.get(OutboxStore).awaitPublished([row?.id ?? ''], { timeoutMs: 200 }),
        ).toEqual({
            published: 0,
            pending: 1,
        });
    });

    it('AC-2.15: реплика API публикует строку CLI — awaitPublished по id и по traceId → pending: 0', async () => {
        const [row] = await outboxRows();
        let api: NestFastifyApplication | undefined;
        try {
            api = await createOutboxApp({ events: [TestNoteCreated] });
            await initReady(api, 'outbox-relay');
            const store = cli.get(OutboxStore);

            expect(await store.awaitPublished([row?.id ?? ''], { timeoutMs: 5000 })).toEqual({
                published: 1,
                pending: 0,
            });
            expect(await store.awaitPublished({ traceId: 'trace-test' }, { timeoutMs: 0 })).toEqual(
                {
                    published: 1,
                    pending: 0,
                },
            );
        } finally {
            await api?.close();
        }
        expect(connections).toBe(0);
    });
});
