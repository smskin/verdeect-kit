// AC-8.1 (UC-11, UC-12): префикс <svc>: ключей и каналов, NOPERM на чужие ключи и каналы под ACL из генератора CLI
// redis acl, команды модуля под ACL проходят — в ACL LOG нет записей пользователя kit (prd.md §3.7; D3, D9, D14 плана E8).
// Перенос B test/http/shared/redis-acl.http-spec.ts (NOPERM, ACL LOG, команды модуля под ACL); пользователь ACL —
// из aclfile стека (как CLI), а не ACL SETUSER в тесте. ACL LOG общий для сервера и для параллельных файлов: проверяются
// записи пользователя kit, кроме клиента kit-probe (NOPERM этого файла); так учтены и отказы до CLIENT SETNAME.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { KitRedisChannels } from '../../../src/redis/channels.js';
import { KIT_REDIS } from '../../../src/redis/client.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import {
    adminRedis,
    clientNames,
    createRedisApp,
    deleteByPrefix,
    moduleAclLog,
    redisUrl,
    serviceRedis,
} from '../../support/redis.js';

function nextMessage(admin: Redis, channel: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`нет сообщения в ${channel}`)),
            1000 * TEST_TIMEOUT_SCALE,
        );
        admin.on('message', (got: string, message: string) => {
            if (got === channel) {
                clearTimeout(timer);
                resolve(message);
            }
        });
    });
}

describe('UC-11: команды модуля под ACL', () => {
    let admin: Redis;
    let app: NestFastifyApplication;

    beforeAll(async () => {
        admin = adminRedis();
        // До создания приложения: журнал покрывает и CLIENT SETNAME / SETINFO при подключении (D9).
        await admin.call('ACL', 'LOG', 'RESET');
        app = await createRedisApp({ options: { subscriber: true } });
        await app.init();
    });

    afterAll(async () => {
        await deleteByPrefix(admin, 'kit:rl:ac81-');
        await app.close();
        await admin.quit();
    });

    it('AC-8.1: команды модуля под ACL проходят — в ACL LOG нет записей пользователя kit', async () => {
        const limiter = app.get(RateLimiter);
        const channels = app.get(KitRedisChannels);
        const options = { limit: 1, windowMs: 60_000 };
        const unsubscribe = await channels.subscribe('acl', () => undefined);

        await limiter.hit('ac81-acl:probe', options);
        // fail-open скрыл бы отказ ACL (B): поэтому лимитер проверяется отказом на limit + 1.
        expect((await limiter.hit('ac81-acl:probe', options)).allowed).toBe(false);
        expect((await limiter.peek('ac81-acl:probe', options)).allowed).toBe(false);
        await channels.publish('acl', 'm');
        expect((await app.get(HealthRegistry).evaluate()).checks['redis']).toBe('up');
        await unsubscribe();

        expect(await moduleAclLog(admin)).toEqual([]);
    });
});

describe('UC-12: префикс и ACL сервиса', () => {
    let admin: Redis;
    let app: NestFastifyApplication;

    beforeAll(async () => {
        admin = adminRedis();
        app = await createRedisApp({ options: { subscriber: true } });
        await app.init();
    });

    afterEach(async () => {
        await deleteByPrefix(admin, 'kit:ac81-');
    });

    afterAll(async () => {
        await app.close();
        await admin.quit();
    });

    it('AC-8.1: SET через KIT_REDIS — в Redis ключ kit:<key>', async () => {
        await app.get<Redis>(KIT_REDIS).set('ac81-k', 'v');

        expect(await admin.get('kit:ac81-k')).toBe('v');
        expect(await admin.exists('ac81-k')).toBe(0);
    });

    it('AC-8.1: publish в канал x — сообщение в канале kit:x', async () => {
        const listener = adminRedis();
        try {
            await listener.subscribe('kit:x');
            const message = nextMessage(listener, 'kit:x');
            await app.get(KitRedisChannels).publish('x', 'hello');

            expect(await message).toBe('hello');
        } finally {
            listener.disconnect();
        }
    });

    it('AC-8.1: под ACL из CLI чужой ключ и канал → NOPERM, свой — OK', async () => {
        const probe = serviceRedis();
        try {
            await probe.client('SETNAME', 'kit-probe');

            await expect(probe.get('other:x')).rejects.toThrow(/NOPERM/);
            await expect(probe.set('other:x', '1')).rejects.toThrow(/NOPERM/);
            await expect(probe.publish('other:x', 'm')).rejects.toThrow(/NOPERM/);
            expect(await probe.set('kit:ac81-probe', '1')).toBe('OK');
        } finally {
            probe.disconnect();
        }
    });

    it('AC-8.1: под пользователем из aclfile CLI (user default off) оба соединения подключаются, проба redis — up, INFO — NOPERM', async () => {
        await app.get<Redis>(KIT_REDIS).ping();
        const unsubscribe = await app.get(KitRedisChannels).subscribe('x', () => undefined);

        try {
            const names = await clientNames(admin);
            expect(names).toContain('kit');
            expect(names).toContain('kit-subscriber');
            expect(await app.get(HealthRegistry).evaluate()).toEqual({
                status: 'ok',
                checks: { redis: 'up' },
            });
        } finally {
            await unsubscribe();
        }

        const probe = serviceRedis();
        const anonymous = serviceRedis(redisUrl().replace(/\/\/[^@]+@/, '//'));
        try {
            await expect(probe.info()).rejects.toThrow(/NOPERM/);
            await expect(anonymous.get('kit:x')).rejects.toThrow(/NOAUTH|WRONGPASS|NOPERM/);
        } finally {
            probe.disconnect();
            anonymous.disconnect();
        }
    });
});
