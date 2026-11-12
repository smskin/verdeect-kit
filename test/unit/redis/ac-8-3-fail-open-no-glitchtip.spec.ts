// AC-8.3 (UC-11; PRD v1.18): fail-open лимитера — ожидаемая ошибка недоступной зависимости, событий GlitchTip нет;
// метрика и warn — есть (prd.md §3.7; skill-context «Expected Errors Are Not Reported»). Ошибки соединения ioredis — тоже
// без GlitchTip, только warn (KT-62). Поддельный транспорт GlitchTip инициализирует процесс-глобальный Sentry — отдельный
// файл.
import * as Sentry from '@sentry/nestjs';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { kitMetrics } from '../../../src/observability/metrics.js';
import { createRedisConnection } from '../../../src/redis/client.js';
import { RateLimiter } from '../../../src/redis/rate-limiter.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';

let delivered: DeliveredEvent[];

beforeAll(() => {
    delivered = initFakeSentry().delivered;
});

afterAll(async () => {
    await Sentry.close(1000);
});

describe('UC-11: fail-open без GlitchTip', () => {
    it('AC-8.3: Redis недоступен — allowed: true, метрика и warn есть, событий GlitchTip нет', async () => {
        const failing = {
            incr: () => failing,
            pexpire: () => failing,
            pttl: () => failing,
            get: () => failing,
            exec: () => Promise.reject(new Error('Connection is closed.')),
        };
        const redis = { multi: () => failing } as unknown as Redis;
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const metrics = kitMetrics({ service: 'kit' });
        const limiter = new RateLimiter(redis, log, metrics);

        expect(await limiter.hit('login:x', { limit: 3, windowMs: 1000 })).toMatchObject({
            allowed: true,
        });
        await limiter.peek('login:x', { limit: 3, windowMs: 1000 });
        await Sentry.flush(1000);

        expect((await metrics.rateLimitUnavailable.get()).values[0]?.value).toBe(2);
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.error).not.toHaveBeenCalled();
        expect(delivered).toHaveLength(0);
    });

    it('AC-8.3: ошибка соединения Redis (событие error ioredis) — warn, затем debug; событий GlitchTip нет', async () => {
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const redis = await createRedisConnection({
            url: 'redis://127.0.0.1:1',
            connection: 'main',
            service: 'kit',
            log,
        });
        try {
            // Соединение ленивое и не открывается: событие error — как от сокета, без сети и пауз.
            redis.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1'));
            redis.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1'));
            await Sentry.flush(1000);

            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ connection: 'main' }),
                'redis: ошибка соединения',
            );
            expect(log.debug).toHaveBeenCalledWith(
                expect.objectContaining({ connection: 'main' }),
                'redis: ошибка соединения (повтор)',
            );
            expect(log.error).not.toHaveBeenCalled();
            expect(delivered).toHaveLength(0);
        } finally {
            redis.disconnect();
        }
    });
});
