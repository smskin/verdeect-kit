// Фрагменты схемы окружения пакета (prd.md §3.1, C0–C6); эталон — O env.schema.ts, SERVICE_URLS — B.
// Решения PRD поверх эталонов: PORT вместо BFF_PORT/IDENTITY_PORT, RABBITMQ_RETRY_SECONDS = 30, ENCRYPTION_KEYS —
// JSON [{version, secret}] (§3.6, CE-2). Псевдонимов старых ключей нет (P0, N9).
// Фрагмент — объект zod-схем (raw shape), а не z.object: он распаковывается в defineEnv.
import { hostname } from 'node:os';
import { z } from 'zod';
import {
    httpUrl,
    jsonValue,
    nonNegativeInt,
    optionalText,
    port,
    positiveInt,
    uniqueBy,
} from './helpers.js';

/** Режим процесса; одна схема для envBase и envSentry, чтобы распаковка обоих не конфликтовала. */
const nodeEnv = z.enum(['development', 'test', 'production']).default('production');

/** Уровень pino (§3.1); внутренний экспорт для схем CLI, из /config не реэкспортируется. */
export const logLevel = z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info');

/** Имя реплики: пусто → hostname() (§3.1). */
const replicaId = optionalText()
    .transform((value) => value ?? hostname())
    .pipe(z.string().regex(/^[A-Za-z0-9._-]{1,128}$/));

/**
 * Базовые ключи каждого сервиса (§3.1): NODE_ENV (production), LOG_LEVEL (info), PORT (3000),
 * METRICS_PORT (9100), REPLICA_ID (hostname()), SHUTDOWN_TIMEOUT_MS (10000), SHUTDOWN_DRAIN_MS (0).
 */
export const envBase = {
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    PORT: port(3000),
    METRICS_PORT: port(9100),
    REPLICA_ID: replicaId,
    SHUTDOWN_TIMEOUT_MS: positiveInt(10_000),
    SHUTDOWN_DRAIN_MS: nonNegativeInt(0),
};

/** БД (§3.1): DATABASE_URL (обязателен), DB_POOL_MAX (10), DB_POOL_ACQUIRE_TIMEOUT_MS (5000, мин. 1). */
export const envDatabase = {
    DATABASE_URL: z.string().min(1),
    DB_POOL_MAX: positiveInt(10),
    DB_POOL_ACQUIRE_TIMEOUT_MS: positiveInt(5000),
};

/** RabbitMQ (§3.1): RABBITMQ_URL (обязателен), RABBITMQ_RETRY_SECONDS (30, целое ≥ 1). */
export const envMessaging = {
    RABBITMQ_URL: z.url(),
    RABBITMQ_RETRY_SECONDS: positiveInt(30),
};

/** Redis (§3.1): REDIS_URL (обязателен). */
export const envRedis = {
    REDIS_URL: z.url(),
};

/** GlitchTip (§3.1): SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE — пусто → null; NODE_ENV. */
export const envSentry = {
    SENTRY_DSN: optionalText(),
    SENTRY_ENVIRONMENT: optionalText(),
    SENTRY_RELEASE: optionalText(),
    NODE_ENV: nodeEnv,
};

/** Секрет ключа шифра: base64url без `=`, не короче 32 байт (§3.6). Issue — без значения. */
const encryptionSecret = z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .superRefine((value, ctx) => {
        if (Buffer.from(value, 'base64url').length < 32) {
            ctx.addIssue({ code: 'custom', message: 'секрет короче 32 байт', input: '' });
        }
    });

/**
 * @internal Массив ключей шифра `[{version, secret}]`: одна проверка для envCrypto и createCipher (§3.6);
 * из /config не реэкспортируется.
 */
export const encryptionKeysSchema = z
    .array(z.object({ version: z.number().int().positive(), secret: encryptionSecret }))
    .min(1)
    .superRefine(uniqueBy('version'));

/** Ключи шифра (§3.1, §3.6): ENCRYPTION_KEYS — JSON `[{version, secret}]`, версии без повторов. */
export const envCrypto = {
    ENCRYPTION_KEYS: jsonValue(encryptionKeysSchema),
};

/**
 * Адреса других сервисов (§3.1, AC-1.11): SERVICE_URLS — JSON `{имя: http(s)-URL}`; имена `required`
 * обязательны, лишние имена допустимы, но тоже должны быть URL.
 */
export function envServiceUrls(required: readonly string[]) {
    const known = Object.fromEntries(required.map((name) => [name, httpUrl()]));

    return {
        SERVICE_URLS: jsonValue(
            z
                .object(known)
                .catchall(httpUrl())
                .transform((map): Readonly<Record<string, string>> => map),
        ),
    };
}

/** Разобранные базовые ключи (§3.1). */
export type KitBaseEnv = z.output<z.ZodObject<typeof envBase>>;

/** Разобранные ключи БД (§3.1). */
export type KitDatabaseEnv = z.output<z.ZodObject<typeof envDatabase>>;

/** Разобранные ключи RabbitMQ (§3.1). */
export type KitMessagingEnv = z.output<z.ZodObject<typeof envMessaging>>;

/** Разобранные ключи Redis (§3.1). */
export type KitRedisEnv = z.output<z.ZodObject<typeof envRedis>>;

/** Разобранные ключи шифра (§3.1). */
export type KitCryptoEnv = z.output<z.ZodObject<typeof envCrypto>>;
