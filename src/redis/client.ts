// Соединение ioredis /redis (prd.md §3.7, AC-8.2, AC-8.6, NFR-3). Эталон — O shared/redis/redis.provider.ts: lazyConnect,
// maxRetriesPerRequest 1, commandTimeout 500 / 5000 для подписки, закрытие quit() → disconnect(), ошибки соединения без
// URL. По PRD: keyPrefix <svc>: у основного соединения, enableReadyCheck: false (INFO запрещён ACL -@dangerous),
// ioredis — динамический import() при создании (без top-level await, П15), логгер — pino экземпляра или адаптер Nest.
import { Logger } from '@nestjs/common';
import type { Redis, RedisOptions } from 'ioredis';
import { sanitizeError } from '../observability/sanitize-error.js';

/** Токен основного соединения Redis: `Redis` ioredis с `keyPrefix <svc>:` (§3.7). */
export const KIT_REDIS = Symbol('KIT_REDIS');

/** Срок команды основного соединения, мс (§3.7, AC-8.2). */
export const MAIN_COMMAND_TIMEOUT_MS = 500;

/** Срок команды подписочного соединения, мс (§3.7, AC-8.6). */
export const SUBSCRIBER_COMMAND_TIMEOUT_MS = 5000;

/** Роль соединения в логах. */
export type RedisConnectionRole = 'main' | 'subscriber';

/** Логгер фоновых операций /redis: pino экземпляра (`service`, `replica` в `base`) или адаптер логгера Nest. */
export interface RedisLog {
    /** Уровень debug. */
    debug(fields: object, message: string): void;
    /** Уровень info. */
    info(fields: object, message: string): void;
    /** Уровень warn. */
    warn(fields: object, message: string): void;
    /** Уровень error. */
    error(fields: object, message: string): void;
}

/** Адаптер логгера Nest (приложение без KIT_LOGGER); копия nestLog /messaging — импорт оттуда запрещён. */
export function redisNestLog(context: string): RedisLog {
    const logger = new Logger(context);

    return {
        debug: (fields, message) => logger.debug(fields, message),
        info: (fields, message) => logger.log(fields, message),
        warn: (fields, message) => logger.warn(fields, message),
        error: (fields, message) => logger.error(fields, message),
    };
}

type RedisClass = new (url: string, options: RedisOptions) => Redis;

let ioredisPromise: Promise<RedisClass> | undefined;

/**
 * Класс `Redis` ioredis, загружается один раз. Именованный `Redis`, а не `default`: ioredis — CommonJS, и при NodeNext
 * ESM-`default` типизируется как весь `module.exports`.
 */
function loadIoredis(): Promise<RedisClass> {
    ioredisPromise ??= import('ioredis').then((module) => module.Redis);

    return ioredisPromise;
}

/** Параметры соединения. */
export interface RedisConnectionParams {
    /** REDIS_URL (содержит пароль — в лог не пишется). */
    readonly url: string;
    /** Роль соединения. */
    readonly connection: RedisConnectionRole;
    /** Имя сервиса — имя клиента в `CLIENT LIST`. */
    readonly service: string;
    /** Префикс ключей; только у основного соединения. */
    readonly keyPrefix?: string;
    /** Логгер. */
    readonly log: RedisLog;
}

/** Опции ioredis соединения (D9). */
function optionsOf(params: RedisConnectionParams): RedisOptions {
    const main = params.connection === 'main';

    return {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        // Проверка готовности шлёт INFO (@dangerous, запрещён ACL §3.7); при отказе ioredis пишет console.warn.
        enableReadyCheck: false,
        commandTimeout: main ? MAIN_COMMAND_TIMEOUT_MS : SUBSCRIBER_COMMAND_TIMEOUT_MS,
        connectionName: main ? params.service : `${params.service}-subscriber`,
        ...(main && params.keyPrefix !== undefined ? { keyPrefix: params.keyPrefix } : {}),
    };
}

/**
 * Создаёт ленивое соединение (подключается при первой команде). Первая ошибка соединения после `ready` — `warn`, повторы
 * до следующего `ready` — `debug` (переподключения не заливают лог). URL, ключи и аргументы команд в лог не попадают.
 */
export async function createRedisConnection(params: RedisConnectionParams): Promise<Redis> {
    const RedisClient = await loadIoredis();
    const redis = new RedisClient(params.url, optionsOf(params));
    const { connection, log } = params;
    let failing = false;
    redis.on('ready', () => {
        failing = false;
        log.debug({ connection }, 'redis: соединение готово');
    });
    redis.on('error', (error: unknown) => {
        const fields = { connection, err: sanitizeError(error) };
        if (failing) {
            log.debug(fields, 'redis: ошибка соединения (повтор)');

            return;
        }
        failing = true;
        log.warn(fields, 'redis: ошибка соединения');
    });
    log.debug({ connection }, 'redis: соединение создано');

    return redis;
}

/** Закрывает соединение (D11): не подключено — `disconnect()`, иначе `quit()`; ошибка `quit` — `disconnect()`. */
export async function closeRedisConnection(
    redis: Redis,
    connection: RedisConnectionRole,
    log: RedisLog,
): Promise<void> {
    if (redis.status === 'wait' || redis.status === 'end') {
        redis.disconnect();
        log.debug({ connection }, 'redis: соединение закрыто');

        return;
    }
    try {
        await redis.quit();
    } catch (error) {
        log.debug(
            { connection, err: error instanceof Error ? error.name : 'unknown' },
            'redis: quit не удался, disconnect',
        );
        redis.disconnect();
    }
    log.debug({ connection }, 'redis: соединение закрыто');
}
