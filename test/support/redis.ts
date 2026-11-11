// Стенд /redis уровня I/T (prd.md §3.7, §3.8; D4 плана E8): приложение сервиса kit с KitConfigModule (envBase + envRedis)
// и KitRedisModule под пользователем сервиса из aclfile стека (kitRedisUrl); администратор теста (kitRedisAdminUrl) —
// CLIENT LIST, ACL LOG, PTTL и очистка ключей. Образец — createMessagingApp (test/support/messaging.ts).
import type { Provider, Type } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { inject } from 'vitest';
import { defineEnv } from '../../src/config/define-env.js';
import { envBase, envRedis } from '../../src/config/fragments.js';
import { KitConfigModule } from '../../src/config/kit-config.module.js';
import { KitRedisModule, type KitRedisModuleOptions } from '../../src/redis/kit-redis.module.js';
import type { KitTestOverride } from '../../src/testing/create-test-app.js';
import { createDbApp } from './database.js';

/** Схема окружения стенда. */
export const redisEnvSchema = defineEnv({ ...envBase, ...envRedis });

function provided(key: 'kitRedisUrl' | 'kitRedisAdminUrl'): string {
    const value = inject(key);
    if (value === undefined) {
        throw new Error(`${key} не передан: globalSetup без redis: true`);
    }

    return value;
}

/** Адрес пользователя сервиса `kit` из aclfile стека. */
export function redisUrl(): string {
    return provided('kitRedisUrl');
}

/** Окружение стенда: пользователь сервиса kit, реплика kit-1. */
export function redisEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        LOG_LEVEL: 'silent',
        REDIS_URL: redisUrl(),
        REPLICA_ID: 'kit-1',
        ...overrides,
    };
}

/** Приложение сервиса kit с KitRedisModule; `init()` вызывает тест. */
export async function createRedisApp(
    options: {
        readonly options?: Omit<KitRedisModuleOptions, 'service'>;
        readonly env?: Record<string, string>;
        readonly providers?: readonly Provider[];
        readonly controllers?: readonly Type[];
        readonly overrides?: readonly KitTestOverride[];
    } = {},
): Promise<NestFastifyApplication> {
    @Module({
        imports: [
            KitConfigModule.forRoot({ schema: redisEnvSchema }),
            KitRedisModule.forRoot({ service: 'kit', ...options.options }),
        ],
        providers: [...(options.providers ?? [])],
        controllers: [...(options.controllers ?? [])],
    })
    class RedisAppModule {}

    return createDbApp({
        module: RedisAppModule,
        schema: redisEnvSchema,
        env: redisEnv(options.env),
        overrides: options.overrides,
    });
}

/** Соединение администратора теста (`~* &* +@all`); закрывает вызывающий (`quit()`). */
export function adminRedis(): Redis {
    return new Redis(provided('kitRedisAdminUrl'), { lazyConnect: true, maxRetriesPerRequest: 1 });
}

/** Соединение пользователя сервиса без `keyPrefix` (проверки ACL); закрывает вызывающий. */
export function serviceRedis(url = redisUrl()): Redis {
    return new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
    });
}

/** Удаляет ключи с префиксом администратором (`SCAN MATCH <prefix>*` + `DEL`). */
export async function deleteByPrefix(admin: Redis, prefix: string): Promise<void> {
    let cursor = '0';
    do {
        const [next, keys] = await admin.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) {
            await admin.del(...keys);
        }
    } while (cursor !== '0');
}

/** Имена клиентов `CLIENT LIST` (`name=…`). */
export async function clientNames(admin: Redis): Promise<string[]> {
    const list = String(await admin.client('LIST'));

    return [...list.matchAll(/\bname=(\S*)/g)].map((match) => match[1] ?? '');
}

/** Записи ACL LOG пользователя kit, кроме клиента kit-probe (проверки NOPERM в ac-8-1): журнал общий для сервера. */
export async function moduleAclLog(admin: Redis): Promise<string[]> {
    const entries = (await admin.call('ACL', 'LOG')) as unknown[][];
    const field = (entry: unknown[], name: string): string => {
        const index = entry.indexOf(name);

        return index === -1 ? '' : String(entry[index + 1]);
    };

    return entries
        .filter((entry) => field(entry, 'username') === 'kit')
        .map((entry) => `${field(entry, 'object')} ${field(entry, 'client-info')}`)
        .filter((info) => !/\bname=kit-probe\b/.test(info));
}
