// AC-5.13 (UC-2, UC-14; prd.md §3.8 стр. 190 v1.31): потребитель на упакованном архиве — deliverTestEvent(app, Event,
// data) доставляет событие только этому приложению (два контекста на общей очереди consumer), inbox и итоги duplicate,
// dlq; waitForDelivery(app, id) — итог доставки брокера подписчику dedupe: 'none'. Контексты — createApplicationContext,
// окружение — vi.stubEnv (как messaging.spec.ts). Два describe: несколько слушателей одной очереди получают сообщения
// брокера по кругу — waitForDelivery проверяется на одном контексте.
import 'reflect-metadata';
import {
    Injectable,
    Module,
    type INestApplicationContext,
    type OnModuleInit,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KitConfigModule } from '@verdeect/kit/config';
import { KitDatabaseModule } from '@verdeect/kit/database';
import { InvalidMessageError, KitMessagingModule, KitSubscriber } from '@verdeect/kit/messaging';
import { KitCoreModule } from '@verdeect/kit/observability';
import {
    deliverTestEvent,
    publishTestEvent,
    waitForDelivery,
    waitForInbox,
    workerScope,
} from '@verdeect/kit/testing';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { serviceEnvSchema } from './service/env.js';
import { CompanyArchived, CompanyCreated } from './service/events.js';
import { messagingOptions } from './service/messaging-options.js';
import * as schema from './service/schema.js';

function stubEnv(): void {
    vi.stubEnv('DATABASE_URL', inject('kitDatabaseUrl') ?? '');
    vi.stubEnv('RABBITMQ_URL', workerScope().rabbitmq.url);
    vi.stubEnv('REDIS_URL', inject('kitRedisUrl') ?? '');
    vi.stubEnv('RABBITMQ_RETRY_SECONDS', '1');
    vi.stubEnv('RABBITMQ_RECONNECT_SECONDS', '1');
    vi.stubEnv('AUTH_ISSUER', 'https://id.verdeect.ru');
    vi.stubEnv('AUTH_JWKS_URI', 'http://127.0.0.1:9/jwks');
    vi.stubEnv('AUTH_RESOURCE', 'https://api.verdeect.ru');
    vi.stubEnv('LOG_LEVEL', 'silent');
}

/** Контекст сервиса с обработчиками `consumer`. */
async function context(
    consumer: abstract new (...args: never[]) => unknown,
): Promise<INestApplicationContext> {
    @Module({
        imports: [
            KitConfigModule.forRoot({ schema: serviceEnvSchema }),
            KitCoreModule.forRoot({ service: 'consumer', entry: 'cli' }),
            KitDatabaseModule.forRoot({ schema }),
            KitMessagingModule.forRoot(messagingOptions),
        ],
        providers: [consumer as never],
    })
    class DeliveryTestModule {}

    const ctx = await NestFactory.createApplicationContext(DeliveryTestModule, { logger: false });
    await ctx.init();

    return ctx;
}

/** Счётчик вызовов CompanyCreated (dedupe 'inbox' модуля). */
@Injectable()
class CountingConsumer implements OnModuleInit {
    calls = 0;

    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(CompanyCreated, async () => {
            this.calls += 1;
            await Promise.resolve();
        });
    }
}

/** Второй класс-счётчик: у каждого контекста свой провайдер. */
@Injectable()
class OtherCountingConsumer extends CountingConsumer {}

/** CompanyArchived без inbox; companyId 'invalid' — InvalidMessageError. */
@Injectable()
class ArchivedConsumer implements OnModuleInit {
    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(CompanyCreated, async () => {
            await Promise.resolve();
        });
        this.subscriber.on(
            CompanyArchived,
            async (event) => {
                if (event.data.companyId === 'invalid') {
                    throw new InvalidMessageError('companyId');
                }
                await Promise.resolve();
            },
            { dedupe: 'none' },
        );
    }
}

describe('UC-14: deliverTestEvent в проекте-потребителе', () => {
    let appA: INestApplicationContext;
    let appB: INestApplicationContext;

    beforeAll(async () => {
        stubEnv();
        appA = await context(CountingConsumer);
        appB = await context(OtherCountingConsumer);
    });

    afterAll(async () => {
        await appA.close();
        await appB.close();
        vi.unstubAllEnvs();
    });

    it("AC-5.13: два приложения на общей очереди: deliverTestEvent(appA, E, data) вызывает обработчик только appA, при dedupe: 'inbox' строка inbox записана, повтор того же id — 'duplicate', data вне схемы — 'dlq' с причиной data", async () => {
        const id = 'evt_consumer_d1';
        const first = await deliverTestEvent(
            appA,
            CompanyCreated,
            { companyId: 'cmp_d1', name: 'Acme' },
            { id },
        );
        await waitForInbox(id, { timeoutMs: 10_000 });
        const again = await deliverTestEvent(
            appA,
            CompanyCreated,
            { companyId: 'cmp_d1', name: 'Acme' },
            { id },
        );
        const invalid = await deliverTestEvent(appA, CompanyCreated, {
            companyId: 'cmp_d2',
            name: '',
        });

        expect(first).toEqual({ result: 'handled' });
        expect(again).toEqual({ result: 'duplicate' });
        expect(invalid).toEqual({ result: 'dlq', reason: 'data' });
        expect(appA.get(CountingConsumer).calls).toBe(1);
        expect(appB.get(OtherCountingConsumer).calls).toBe(0);
    });
});

describe('UC-14: waitForDelivery в проекте-потребителе', () => {
    let app: INestApplicationContext;

    beforeAll(async () => {
        stubEnv();
        app = await context(ArchivedConsumer);
    });

    afterAll(async () => {
        await app.close();
        vi.unstubAllEnvs();
    });

    it("AC-5.13: подписчик dedupe: 'none': publishTestEvent + waitForDelivery(app, id) → 'handled', при InvalidMessageError → 'dlq'", async () => {
        const ok = await publishTestEvent(CompanyArchived, { companyId: 'cmp_w1' });
        const bad = await publishTestEvent(CompanyArchived, { companyId: 'invalid' });

        expect(await waitForDelivery(app, ok.id, { timeoutMs: 10_000 })).toEqual({
            result: 'handled',
        });
        expect(await waitForDelivery(app, bad.id, { timeoutMs: 10_000 })).toEqual({
            result: 'dlq',
            reason: 'companyId',
        });
    });
});
