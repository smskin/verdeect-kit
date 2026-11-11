// AC-8.5 (UC-14): префикс воркера <svc>:w<N>: — ключи, счётчики лимитера и каналы двух воркеров не пересекаются; команды
// воркера проходят под ACL сервиса из генератора CLI (prd.md §3.7, §3.8; D2, D5 плана E8). Два воркера в одном процессе —
// явные значения KIT_REDIS_PREFIX (так redisWorkerOverride работает в разных воркерах). Не переносится: номер БД на
// воркер у B (заменён префиксом воркера).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_REDIS_PREFIX } from '../../../src/internal/tokens.js';
import { KitRedisChannels } from '../../../src/redis/channels.js';
import { KIT_REDIS } from '../../../src/redis/client.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';
import { redisWorkerOverride } from '../../../src/testing/redis-worker.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { adminRedis, createRedisApp, deleteByPrefix, moduleAclLog } from '../../support/redis.js';

const POOL = process.env.VITEST_POOL_ID ?? '1';

let admin: Redis;
let w1: NestFastifyApplication;
let w2: NestFastifyApplication;

function workerApp(prefix: string): Promise<NestFastifyApplication> {
    return createRedisApp({
        options: { subscriber: true },
        overrides: [{ provide: KIT_REDIS_PREFIX, useValue: prefix }],
    });
}

beforeAll(async () => {
    admin = adminRedis();
    // Журнал общий для сервера: записи NOPERM других файлов фильтрует moduleAclLog (клиент kit-probe).
    await admin.call('ACL', 'LOG', 'RESET');
    w1 = await workerApp('kit:w1:');
    w2 = await workerApp('kit:w2:');
    await w1.init();
    await w2.init();
});

afterAll(async () => {
    await Promise.all([w1.close(), w2.close()]);
    for (const prefix of ['kit:w1:', 'kit:w2:', workerScope().redisPrefix]) {
        await deleteByPrefix(admin, prefix);
    }
    await admin.quit();
});

describe('UC-14: изоляция воркеров в Redis', () => {
    it('AC-8.5: префикс воркера — <svc>:w<N>: из workerScope()', () => {
        expect(workerScope().redisPrefix).toBe(`kit:w${POOL}:`);
    });

    it('AC-8.5: два воркера не видят ключей друг друга; счётчики лимитера независимы', async () => {
        await w1.get<Redis>(KIT_REDIS).set('k', 'one');
        await w2.get<Redis>(KIT_REDIS).set('k', 'two');

        expect(await w1.get<Redis>(KIT_REDIS).get('k')).toBe('one');
        expect(await w2.get<Redis>(KIT_REDIS).get('k')).toBe('two');
        expect(await admin.mget('kit:w1:k', 'kit:w2:k')).toEqual(['one', 'two']);

        const options = { limit: 1, windowMs: 60_000 };
        expect((await w1.get(RateLimiter).hit('login:x', options)).allowed).toBe(true);
        expect((await w1.get(RateLimiter).hit('login:x', options)).allowed).toBe(false);
        expect((await w2.get(RateLimiter).hit('login:x', options)).allowed).toBe(true);
        expect(await admin.exists('kit:w1:rl:login:x', 'kit:w2:rl:login:x')).toBe(2);
    });

    it('AC-8.5: каналы воркеров изолированы', async () => {
        const got2: string[] = [];
        const unsubscribe2 = await w2.get(KitRedisChannels).subscribe('x', (message) => {
            got2.push(message);
        });
        let deliver: (message: string) => void = () => undefined;
        const received = new Promise<string>((resolve) => {
            deliver = resolve;
        });
        // subscribe завершается ответом Redis на SUBSCRIBE: после него публикация доходит.
        const unsubscribe1 = await w1.get(KitRedisChannels).subscribe('x', (message) => {
            deliver(message);
        });

        expect(await w1.get(KitRedisChannels).publish('x', 'from-w1')).toBe(1);
        expect(await withDeadline(received, 'w1 не получил сообщение')).toBe('from-w1');
        expect(got2).toEqual([]);

        await unsubscribe1();
        await unsubscribe2();
    });

    it('AC-8.5: redisWorkerOverride() — {provide: KIT_REDIS_PREFIX, useValue: workerScope().redisPrefix}', async () => {
        const override = redisWorkerOverride();
        expect(override).toEqual({ provide: KIT_REDIS_PREFIX, useValue: `kit:w${POOL}:` });

        const app = await createRedisApp({ overrides: [override] });
        await app.init();
        try {
            await app.get<Redis>(KIT_REDIS).set('k', 'mine');
            expect(await admin.get(`kit:w${POOL}:k`)).toBe('mine');
        } finally {
            await app.close();
        }
    });

    it('AC-8.5: под ACL сервиса из CLI команды воркера проходят — в ACL LOG нет записей пользователя kit', async () => {
        expect(await moduleAclLog(admin)).toEqual([]);
    });
});

function withDeadline<T>(promise: Promise<T>, what: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(what)), 1000 * TEST_TIMEOUT_SCALE),
        ),
    ]);
}
