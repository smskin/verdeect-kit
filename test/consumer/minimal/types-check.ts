// AC-1.1, AC-1.6: типы пакета (.d.ts архива) проверяются tsc потребителя; /observability — §3.2.
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { defineEnv, envBase, parseEnv } from '@verdeect/kit/config';
import {
    createLoggerOptions,
    HealthRegistry,
    KitLifecycle,
    type KitRedaction,
} from '@verdeect/kit/observability';
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
