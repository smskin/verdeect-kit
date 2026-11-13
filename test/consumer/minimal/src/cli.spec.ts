// AC-2.15 (UC-13, prd.md §3.2, §3.4 v1.25) на архиве пакета: контекст CLI потребителя — KitCoreModule({entry: 'cli'})
// и общий модуль сообщений с listen: false — собирается без HTTP, не подключается к брокеру (адрес брокера — счётчик
// соединений), OutboxStore.add пишет строку, awaitPublished по сроку возвращает итог без исключения. Окружение —
// vi.stubEnv (файлы vitest потребителя изолированы по умолчанию).
import 'reflect-metadata';
import { createServer, type Server } from 'node:net';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KitConfigModule } from '@verdeect/kit/config';
import { KitCoreModule } from '@verdeect/kit/observability';
import { Db, KitDatabaseModule } from '@verdeect/kit/database';
import { KitMessagingModule, OutboxStore } from '@verdeect/kit/messaging';
import { workerScope } from '@verdeect/kit/testing';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { CompanyEventsConsumer } from './service/company-events.consumer.js';
import { serviceEnvSchema } from './service/env.js';
import { CompanyCreated } from './service/events.js';
import { messagingOptions } from './service/messaging-options.js';
import * as schema from './service/schema.js';

describe('UC-13: CLI потребителя', () => {
    let broker: Server;
    let connections = 0;
    let ctx: INestApplicationContext;

    beforeAll(async () => {
        broker = createServer((socket) => {
            connections += 1;
            socket.destroy();
        });
        await new Promise<void>((resolve) => broker.listen(0, '127.0.0.1', resolve));
        const address = broker.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        vi.stubEnv('DATABASE_URL', inject('kitDatabaseUrl') ?? '');
        vi.stubEnv('RABBITMQ_URL', `amqp://consumer:x@127.0.0.1:${String(port)}/consumer`);
        vi.stubEnv('REDIS_URL', inject('kitRedisUrl') ?? '');
        vi.stubEnv('AUTH_ISSUER', 'https://id.verdeect.ru');
        vi.stubEnv('AUTH_JWKS_URI', 'http://127.0.0.1:9/jwks');
        vi.stubEnv('AUTH_RESOURCE', 'https://api.verdeect.ru');
        vi.stubEnv('LOG_LEVEL', 'silent');

        @Module({
            imports: [
                KitConfigModule.forRoot({ schema: serviceEnvSchema }),
                KitCoreModule.forRoot({ service: 'consumer', entry: 'cli' }),
                KitDatabaseModule.forRoot({ schema }),
                KitMessagingModule.forRoot({ ...messagingOptions, listen: false }),
            ],
            providers: [CompanyEventsConsumer],
        })
        class CliModule {}

        ctx = await NestFactory.createApplicationContext(CliModule, {
            logger: false,
            abortOnError: false,
        });
        await ctx.init();
    });

    afterAll(async () => {
        await ctx.close();
        await new Promise<void>((resolve) => broker.close(() => resolve()));
        vi.unstubAllEnvs();
    });

    it('AC-2.15: listen: false — соединений с брокером нет, OutboxStore.add пишет строку, awaitPublished по сроку без исключения', async () => {
        const id = await ctx.get(Db).transaction(
            {
                tenant: workerScope().tenant,
                traceId: 'trace-cli',
                actor: { channel: 'system' },
            },
            (tx) =>
                ctx.get(OutboxStore).add(tx, CompanyCreated, {
                    subjectId: 'cmp_cli',
                    data: { companyId: 'cmp_cli', name: 'CLI' },
                }),
        );
        const result = await ctx.get(OutboxStore).awaitPublished([id], { timeoutMs: 100 });

        expect(result.published + result.pending).toBe(1);
        expect(connections).toBe(0);
    });
});
