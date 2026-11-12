// AC-8.2 (UC-11 шаги 1, 3): Redis не отвечает — команда основного соединения завершается ошибкой не позже ~0,5 с
// (commandTimeout), проба /health redis — down и статус degraded (некритичная; critical: true — unavailable, 503), лимитер —
// fail-open в тот же срок
// (prd.md §3.7; D9, D11 плана E8). Недоступность — tcpProxy.blackhole() (поведение реального драйвера), сторож времени —
// timingGuard в globalSetup.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { KIT_REDIS } from '../../../src/redis/client.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { waitUntil } from '../../support/messaging.js';
import { createRedisApp, redisUrl } from '../../support/redis.js';

let proxy: TcpProxy;
let app: NestFastifyApplication;

beforeEach(async () => {
    proxy = await tcpProxy(redisUrl());
    app = await createRedisApp({ env: { REDIS_URL: proxy.url } });
    await app.init();
    expect(await app.get<Redis>(KIT_REDIS).ping()).toBe('PONG');
});

afterEach(async () => {
    await app.close();
    await proxy.close();
});

async function elapsed(work: () => Promise<unknown>): Promise<number> {
    const started = performance.now();
    await work();

    return performance.now() - started;
}

describe('UC-11: Redis недоступен', () => {
    it('AC-8.2: Redis не отвечает (blackhole) — команда завершается ошибкой не позже ~0,5 с', async () => {
        proxy.blackhole();
        let failure: unknown;

        const duration = await elapsed(async () => {
            failure = await app
                .get<Redis>(KIT_REDIS)
                .get('k')
                .then(
                    () => undefined,
                    (error: unknown) => error,
                );
        });

        expect(failure).toBeInstanceOf(Error);
        expect(duration).toBeGreaterThanOrEqual(450);
        expect(duration).toBeLessThanOrEqual(800 * TEST_TIMEOUT_SCALE);
    });

    it('AC-8.2: проба /health — degraded (200), redis: down; после восстановления — ok', async () => {
        const health = app.get(HealthRegistry);
        proxy.blackhole();

        expect(await health.evaluate()).toEqual({ status: 'degraded', checks: { redis: 'down' } });

        // Соединение в «чёрной дыре» не рвётся само: обрыв и восстановление — ioredis переподключается.
        await proxy.break();
        await proxy.restore();
        await waitUntil(
            async () => (await health.evaluate()).status === 'ok',
            'проба redis снова up',
            5_000,
        );
    });

    it('UC-11: лимитер при blackhole — allowed: true не позже ~0,5 с', async () => {
        proxy.blackhole();
        let result: unknown;

        const duration = await elapsed(async () => {
            result = await app.get(RateLimiter).hit('t:k', { limit: 1, windowMs: 1000 });
        });

        expect(result).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
        expect(duration).toBeLessThanOrEqual(800 * TEST_TIMEOUT_SCALE);
    });
});

describe('UC-11: Redis недоступен, critical: true', () => {
    it('AC-8.2: с critical: true проба redis критичная — Redis недоступен → unavailable (/health 503), redis: down', async () => {
        const criticalProxy = await tcpProxy(redisUrl());
        const criticalApp = await createRedisApp({
            options: { critical: true },
            env: { REDIS_URL: criticalProxy.url },
        });
        try {
            await criticalApp.init();
            criticalProxy.blackhole();

            expect(await criticalApp.get(HealthRegistry).evaluate()).toEqual({
                status: 'unavailable',
                checks: { redis: 'down' },
            });
        } finally {
            await criticalApp.close();
            await criticalProxy.close();
        }
    });
});
