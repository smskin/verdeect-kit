// AC-1.1, AC-1.6: типы пакета (.d.ts архива) проверяются tsc потребителя; /observability — §3.2; /http — §3.5;
// /database — §3.3, /idempotency — §3.3а, /testing — §3.8 (E4).
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { defineEnv, envBase, parseEnv } from '@verdeect/kit/config';
import { DomainError, type KitBootstrapOptions, type Page } from '@verdeect/kit/http';
import {
    createLoggerOptions,
    HealthRegistry,
    KitLifecycle,
    type KitRedaction,
} from '@verdeect/kit/observability';
import type { DbContext } from '@verdeect/kit/database';
import type { KitIdempotentOptions } from '@verdeect/kit/idempotency';
import type { KitWorkerScope } from '@verdeect/kit/testing';
import { pino } from 'pino';
import { z } from 'zod';

const schema = defineEnv({ ...envBase });
export const port: number = parseEnv(schema, {}).PORT;

// @ts-expect-error PORT пакета — число, строка несовместима (AC-1.6)
defineEnv({ ...envBase, PORT: z.string() });

const env = { REPLICA_ID: 'r', LOG_LEVEL: 'info' } as const;

// Кортеж KitLoggerParams: логгер вне Nest.
export const logger = pino(
    ...createLoggerOptions({ service: 'consumer', entry: 'cli', env }).pinoHttp,
);

export const redaction: KitRedaction = { sensitiveKeys: ['inn'] };

const lifecycle = new KitLifecycle({
    logger,
    health: new HealthRegistry({ logger }),
    env: { SHUTDOWN_TIMEOUT_MS: 1000, SHUTDOWN_DRAIN_MS: 0 },
});
lifecycle.register({ name: 'x', stop() {} }, { step: 3 });
// @ts-expect-error шаг 1 выполняет сам KitLifecycle — участники только шагов 2–5 (§3.2)
lifecycle.register({ name: 'y', stop() {} }, { step: 1 });

// Генератор trace-id передаётся адаптеру Fastify (задача 4).
export const adapter = new FastifyAdapter({
    genReqId: createLoggerOptions({ service: 'consumer', entry: 'http', env }).pinoHttp[0].genReqId,
});

// /http (§3.5): типы опций, страницы и ошибки домена.
export const bootstrapOptions: KitBootstrapOptions<typeof schema> = {
    module: class AppModule {},
    service: 'consumer',
    env: schema,
    logger: { trustTraceparent: false, quietRoutes: ['/internal'] },
    http: { bodyLimit: 1024 },
    redaction,
};
export const page: Page<{ id: string }> = { items: [{ id: 'a' }], nextCursor: null };
export const status: number = new DomainError('FORBIDDEN').status;

// /database, /idempotency, /testing (E4): типы контекста, опций @Idempotent и области воркера.
export const dbContext: DbContext = { tenant: null, traceId: 't', actor: { channel: 'system' } };
export const idempotentOptions: KitIdempotentOptions = { required: true, tenantFromBody: 'tenant' };
export const scope: KitWorkerScope = { tenant: 'w0-00000000' };
