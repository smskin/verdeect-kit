// AC-8.3 (UC-11): RateLimiter на реальном Redis под ACL сервиса — limit попыток в окне, retryAfterMs = PTTL, PEXPIRE NX,
// peek без изменения счётчика, окно истекает, fail-open с метрикой verdeect_rate_limit_unavailable_total (prd.md §3.7;
// D7, D8 плана E8). Перенос I test/integration/security/rate-limiter.int-spec.ts и B
// test/integration/shared/rate-limiter.int-spec.ts: окно в мс и результат {allowed, remaining, retryAfterMs} по PRD.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { KIT_PACKAGE_METRICS } from '../../../src/internal/tokens.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';
import { tcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { waitUntil } from '../../support/messaging.js';
import { adminRedis, createRedisApp, deleteByPrefix, redisUrl } from '../../support/redis.js';

let admin: Redis;
let app: NestFastifyApplication;
let limiter: RateLimiter;

beforeAll(async () => {
    admin = adminRedis();
    app = await createRedisApp();
    await app.init();
    limiter = app.get(RateLimiter);
});

afterEach(async () => {
    await deleteByPrefix(admin, 'kit:rl:ac83-');
});

afterAll(async () => {
    await app.close();
    await admin.quit();
});

async function unavailable(metrics: KitMetrics): Promise<number> {
    return (await metrics.rateLimitUnavailable.get()).values[0]?.value ?? 0;
}

describe('UC-11: RateLimiter на Redis', () => {
    it('AC-8.3: limit попыток в окне — allowed, следующая — allowed: false, retryAfterMs = PTTL', async () => {
        const options = { limit: 30, windowMs: 60_000 };
        for (let attempt = 1; attempt <= 30; attempt += 1) {
            const result = await limiter.hit('ac83-login:a', options);
            expect(result).toEqual({ allowed: true, remaining: 30 - attempt, retryAfterMs: 0 });
        }

        const started = performance.now();
        const denied = await limiter.hit('ac83-login:a', options);
        const pttl = await admin.pttl('kit:rl:ac83-login:a');
        const between = performance.now() - started;

        expect(denied.allowed).toBe(false);
        expect(denied.remaining).toBe(0);
        expect(denied.retryAfterMs).toBeGreaterThan(0);
        expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
        // PTTL читается вторым вызовом: окно за это время только убывает; +1 — округление мс (KT-30).
        expect(denied.retryAfterMs - pttl).toBeGreaterThanOrEqual(0);
        expect(denied.retryAfterMs - pttl).toBeLessThanOrEqual(Math.ceil(between) + 1);
    });

    it('AC-8.3: ключ в Redis — kit:rl:<key>, TTL ≤ windowMs; окно не продлевается попаданиями (PEXPIRE NX)', async () => {
        const options = { limit: 5, windowMs: 60_000 };
        await limiter.hit('ac83-scope:k', options);
        const first = await admin.pttl('kit:rl:ac83-scope:k');
        await limiter.hit('ac83-scope:k', options);
        const second = await admin.pttl('kit:rl:ac83-scope:k');

        expect(await admin.get('kit:rl:ac83-scope:k')).toBe('2');
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThanOrEqual(60_000);
        expect(second).toBeLessThanOrEqual(first);
    });

    it('AC-8.3: разные ключи независимы', async () => {
        const options = { limit: 1, windowMs: 60_000 };

        expect((await limiter.hit('ac83-login:a', options)).allowed).toBe(true);
        expect((await limiter.hit('ac83-login:b', options)).allowed).toBe(true);
        expect((await limiter.hit('ac83-login:a', options)).allowed).toBe(false);
    });

    it('AC-8.3: peek не увеличивает счётчик', async () => {
        const options = { limit: 3, windowMs: 60_000 };
        await limiter.hit('ac83-peek:k', options);
        const before = await admin.get('kit:rl:ac83-peek:k');

        expect(await limiter.peek('ac83-peek:k', options)).toEqual({
            allowed: true,
            remaining: 2,
            retryAfterMs: 0,
        });
        expect(await admin.get('kit:rl:ac83-peek:k')).toBe(before);
    });

    it('AC-8.3: peek после limit — allowed: false, retryAfterMs > 0; без попаданий — allowed, remaining = limit', async () => {
        const options = { limit: 2, windowMs: 60_000 };
        await limiter.hit('ac83-peek:full', options);
        await limiter.hit('ac83-peek:full', options);

        const full = await limiter.peek('ac83-peek:full', options);
        expect(full.allowed).toBe(false);
        expect(full.retryAfterMs).toBeGreaterThan(0);
        expect(await limiter.peek('ac83-peek:none', options)).toEqual({
            allowed: true,
            remaining: 2,
            retryAfterMs: 0,
        });
    });

    it('AC-8.3: после окна — снова allowed', async () => {
        const options = { limit: 1, windowMs: 60_000 };
        await limiter.hit('ac83-window:k', options);
        expect((await limiter.hit('ac83-window:k', options)).allowed).toBe(false);

        // Без паузы на окно: администратор укорачивает окно до 1 мс и ждёт истечения ключа.
        await admin.pexpire('kit:rl:ac83-window:k', 1);
        await waitUntil(
            async () => (await admin.pttl('kit:rl:ac83-window:k')) === -2,
            'ключ лимитера истёк',
            1000,
        );

        expect(await limiter.hit('ac83-window:k', options)).toEqual({
            allowed: true,
            remaining: 0,
            retryAfterMs: 0,
        });
    });

    it('AC-8.3: Redis недоступен — allowed: true, remaining = limit и verdeect_rate_limit_unavailable_total +1', async () => {
        const proxy = await tcpProxy(redisUrl());
        const down = await createRedisApp({ env: { REDIS_URL: proxy.url } });
        await down.init();
        try {
            await proxy.break();
            const metrics = down.get<KitMetrics>(KIT_PACKAGE_METRICS);
            const before = await unavailable(metrics);
            const started = Date.now();

            expect(
                await down.get(RateLimiter).hit('ac83-down:k', { limit: 3, windowMs: 1000 }),
            ).toEqual({ allowed: true, remaining: 3, retryAfterMs: 0 });
            expect(Date.now() - started).toBeLessThan(1000 * TEST_TIMEOUT_SCALE);
            expect(await unavailable(metrics)).toBe(before + 1);
            expect(await metrics.registry.metrics()).toMatch(
                /verdeect_rate_limit_unavailable_total\{service="kit"\} \d+/,
            );
        } finally {
            await down.close();
            await proxy.close();
        }
    });
});
