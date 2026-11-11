// AC-9.1 (UC-1, UC-5, UC-6), AC-5.13 (UC-14): потребитель на упакованном архиве публикует событие OutboxStore.add в
// транзакции Db и сам его потребляет подписчиком с inbox; expectOutbox и publishTestEvent + waitForInbox (prd.md §3.4,
// §3.8). Контекст — NestFactory.createApplicationContext (у потребителя нет @nestjs/testing); окружение — vi.stubEnv
// (файлы vitest потребителя изолированы по умолчанию).
import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KitConfigModule } from '@verdeect/kit/config';
import { Db, KitDatabaseModule, type DbContext } from '@verdeect/kit/database';
import { KitMessagingModule, OutboxStore } from '@verdeect/kit/messaging';
import { expectOutbox, publishTestEvent, waitForInbox, workerScope } from '@verdeect/kit/testing';
import { afterAll, beforeAll, describe, inject, it, vi } from 'vitest';
import { CompanyEventsConsumer } from './service/company-events.consumer.js';
import { serviceEnvSchema } from './service/env.js';
import { CompanyArchived, CompanyCreated } from './service/events.js';
import { messagingOptions } from './service/messaging-options.js';
import * as schema from './service/schema.js';

function context(): DbContext {
    return {
        tenant: workerScope().tenant,
        traceId: 'trace-consumer',
        actor: { channel: 'system' },
    };
}

describe('UC-5: сообщения потребителя', () => {
    let ctx: INestApplicationContext;

    beforeAll(async () => {
        vi.stubEnv('DATABASE_URL', inject('kitDatabaseUrl') ?? '');
        vi.stubEnv('RABBITMQ_URL', workerScope().rabbitmq.url);
        vi.stubEnv('REDIS_URL', inject('kitRedisUrl') ?? '');
        vi.stubEnv('RABBITMQ_RETRY_SECONDS', '1');
        vi.stubEnv('AUTH_ISSUER', 'https://id.verdeect.ru');
        vi.stubEnv('AUTH_JWKS_URI', 'http://127.0.0.1:9/jwks');
        vi.stubEnv('AUTH_RESOURCE', 'https://api.verdeect.ru');
        vi.stubEnv('LOG_LEVEL', 'silent');

        @Module({
            imports: [
                KitConfigModule.forRoot({ schema: serviceEnvSchema }),
                KitDatabaseModule.forRoot({ schema }),
                KitMessagingModule.forRoot(messagingOptions),
            ],
            providers: [CompanyEventsConsumer],
        })
        class MessagingTestModule {}

        ctx = await NestFactory.createApplicationContext(MessagingTestModule, { logger: false });
        await ctx.init();
    });

    afterAll(async () => {
        await ctx.close();
        vi.unstubAllEnvs();
    });

    it('AC-9.1: OutboxStore.add в транзакции — expectOutbox(tx, CompanyCreated) проходит', async () => {
        await ctx.get(Db).transaction(context(), async (tx) => {
            await ctx.get(OutboxStore).add(tx, CompanyCreated, {
                subjectId: 'cmp_1',
                data: { companyId: 'cmp_1', name: 'Acme' },
            });
            await expectOutbox(tx, CompanyCreated, { subjectId: 'cmp_1', data: { name: 'Acme' } });
        });
    });

    it('AC-9.1: CompanyArchived — expectOutbox проходит', async () => {
        await ctx.get(Db).transaction(context(), async (tx) => {
            await ctx.get(OutboxStore).add(tx, CompanyArchived, {
                subjectId: 'cmp_1',
                data: { companyId: 'cmp_1' },
            });
            await expectOutbox(tx, CompanyArchived);
        });
    });

    it('AC-9.1: relay публикует, подписчик потребляет — строка inbox по id события (waitForInbox)', async () => {
        const id = await ctx.get(Db).transaction(context(), (tx) =>
            ctx.get(OutboxStore).add(tx, CompanyCreated, {
                subjectId: 'cmp_2',
                data: { companyId: 'cmp_2', name: 'Globex' },
            }),
        );

        await waitForInbox(id, { timeoutMs: 10_000 });
    });

    it('AC-5.13: publishTestEvent(CompanyCreated) + waitForInbox проверяют обработчик без sleep', async () => {
        const envelope = await publishTestEvent(CompanyCreated, {
            companyId: 'cmp_3',
            name: 'Initech',
        });

        await waitForInbox(envelope.id, { timeoutMs: 10_000 });
    });
});
