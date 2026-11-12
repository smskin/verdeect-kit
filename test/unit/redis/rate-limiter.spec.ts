// AC-8.3, AC-9.5 (UC-11): RateLimiter на подделке ioredis — команды MULTI, fail-open с метрикой
// verdeect_rate_limit_unavailable_total, warn не чаще раза в 60 с (prd.md §3.7, NFR-8; D7, D8 плана E8). Эталон — I
// rate-limiter.ts (scope в логе), B (PTTL, fail-open без GlitchTip).
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitMetrics } from '../../../src/observability/metrics.js';
import type { RedisLog } from '../../../src/redis/client.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';

type Call = [command: string, ...args: unknown[]];

function fakeRedis(exec: () => Promise<unknown>) {
    const calls: Call[] = [];
    const chain = {
        incr: (...args: unknown[]) => (calls.push(['incr', ...args]), chain),
        pexpire: (...args: unknown[]) => (calls.push(['pexpire', ...args]), chain),
        pttl: (...args: unknown[]) => (calls.push(['pttl', ...args]), chain),
        get: (...args: unknown[]) => (calls.push(['get', ...args]), chain),
        exec: () => (calls.push(['exec']), exec()),
    };
    const redis = { multi: () => (calls.push(['multi']), chain) } as unknown as Redis;

    return { redis, calls };
}

function spyLog() {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } satisfies RedisLog;
}

async function unavailableCount(metrics: ReturnType<typeof kitMetrics>): Promise<number> {
    const value = (await metrics.rateLimitUnavailable.get()).values[0]?.value;

    return value ?? 0;
}

const OPTIONS = { limit: 3, windowMs: 60_000 };

afterEach(() => {
    vi.useRealTimers();
});

describe('UC-11: RateLimiter', () => {
    it('AC-8.3: hit шлёт MULTI INCR rl:<key>, PEXPIRE rl:<key> windowMs NX, PTTL одним exec', async () => {
        const { redis, calls } = fakeRedis(() =>
            Promise.resolve([
                [null, 1],
                [null, 1],
                [null, 60_000],
            ]),
        );
        const limiter = new RateLimiter(redis, spyLog());

        const result = await limiter.hit('login:1.2.3.4', OPTIONS);

        expect(calls).toEqual([
            ['multi'],
            ['incr', 'rl:login:1.2.3.4'],
            ['pexpire', 'rl:login:1.2.3.4', 60_000, 'NX'],
            ['pttl', 'rl:login:1.2.3.4'],
            ['exec'],
        ]);
        expect(result).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    });

    it('AC-8.3: hit сверх limit — allowed: false, remaining 0, retryAfterMs = PTTL; debug только со scope', async () => {
        const { redis } = fakeRedis(() =>
            Promise.resolve([
                [null, 4],
                [null, 0],
                [null, 1234],
            ]),
        );
        const log = spyLog();
        const limiter = new RateLimiter(redis, log);

        expect(await limiter.hit('login:1.2.3.4', OPTIONS)).toEqual({
            allowed: false,
            remaining: 0,
            retryAfterMs: 1234,
        });
        expect(log.debug).toHaveBeenCalledWith({ scope: 'login' }, expect.any(String));
        expect(JSON.stringify(log.debug.mock.calls)).not.toContain('1.2.3.4');
    });

    it('AC-8.3: peek шлёт GET и PTTL, без INCR; allowed = count < limit', async () => {
        const { redis, calls } = fakeRedis(() =>
            Promise.resolve([
                [null, '3'],
                [null, 500],
            ]),
        );
        const limiter = new RateLimiter(redis, spyLog());

        const result = await limiter.peek('login:x', OPTIONS);

        expect(calls).toEqual([['multi'], ['get', 'rl:login:x'], ['pttl', 'rl:login:x'], ['exec']]);
        expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 500 });
    });

    it('AC-8.3: peek без попаданий — allowed: true, remaining = limit', async () => {
        const { redis } = fakeRedis(() =>
            Promise.resolve([
                [null, null],
                [null, -2],
            ]),
        );

        expect(await new RateLimiter(redis, spyLog()).peek('k', OPTIONS)).toEqual({
            allowed: true,
            remaining: 3,
            retryAfterMs: 0,
        });
    });

    it('AC-8.3: exec отклонён — allowed: true, remaining = limit, retryAfterMs 0, метрика +1 на каждый вызов', async () => {
        const { redis } = fakeRedis(() => Promise.reject(new Error('Connection is closed.')));
        const metrics = kitMetrics({ service: 'kit' });
        const limiter = new RateLimiter(redis, spyLog(), metrics);

        expect(await limiter.hit('k', OPTIONS)).toEqual({
            allowed: true,
            remaining: 3,
            retryAfterMs: 0,
        });
        await limiter.peek('k', OPTIONS);

        expect(await unavailableCount(metrics)).toBe(2);
        expect(await metrics.registry.metrics()).toContain(
            'verdeect_rate_limit_unavailable_total{service="kit"} 2',
        );
    });

    it('AC-8.3: ошибка команды внутри результата exec или EXEC прерван (null) — fail-open', async () => {
        const metrics = kitMetrics({ service: 'kit' });
        const failed = fakeRedis(() =>
            Promise.resolve([
                [new Error('NOPERM'), null],
                [null, 0],
                [null, 1],
            ]),
        );
        const aborted = fakeRedis(() => Promise.resolve(null));

        expect(
            await new RateLimiter(failed.redis, spyLog(), metrics).hit('k', OPTIONS),
        ).toMatchObject({ allowed: true, remaining: 3 });
        expect(
            await new RateLimiter(aborted.redis, spyLog(), metrics).hit('k', OPTIONS),
        ).toMatchObject({ allowed: true, remaining: 3 });
        expect(await unavailableCount(metrics)).toBe(2);
    });

    it('AC-9.5: warn fail-open не чаще раза в 60 с, метрика — на каждый вызов, ключа в логе нет', async () => {
        vi.useFakeTimers();
        const { redis } = fakeRedis(() => Promise.reject(new Error('Connection is closed.')));
        const metrics = kitMetrics({ service: 'kit' });
        const log = spyLog();
        const limiter = new RateLimiter(redis, log, metrics);

        await limiter.hit('login:secret-ip', OPTIONS);
        await limiter.hit('login:secret-ip', OPTIONS);
        await limiter.peek('login:secret-ip', OPTIONS);
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            { err: expect.anything() as unknown },
            'лимитер: Redis недоступен, запрос пропущен',
        );

        // Граница окна: на 59 999 мс warn подавлен, на 60 000 мс — второй.
        vi.advanceTimersByTime(59_999);
        await limiter.hit('login:secret-ip', OPTIONS);
        expect(log.warn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        await limiter.hit('login:secret-ip', OPTIONS);

        expect(log.warn).toHaveBeenCalledTimes(2);
        expect(await unavailableCount(metrics)).toBe(5);
        const logged = JSON.stringify(log.warn.mock.calls);
        expect(logged).not.toContain('secret-ip');
        expect(logged).not.toContain('rl:');
    });

    it.each([
        ['', OPTIONS],
        ['k', { limit: 0, windowMs: 1000 }],
        ['k', { limit: 1.5, windowMs: 1000 }],
        ['k', { limit: 1, windowMs: 0 }],
        ['k', { limit: 1, windowMs: Number.NaN }],
    ])('§3.7: key %j, опции %j — TypeError', async (key, options) => {
        const { redis } = fakeRedis(() => Promise.resolve([]));
        const limiter = new RateLimiter(redis, spyLog());

        await expect(limiter.hit(key, options)).rejects.toThrow(TypeError);
        await expect(limiter.peek(key, options)).rejects.toThrow(TypeError);
    });
});
