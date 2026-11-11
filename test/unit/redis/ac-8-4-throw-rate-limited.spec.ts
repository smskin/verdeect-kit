// AC-8.4 (UC-11): throwRateLimited → DomainError RATE_LIMITED, 429 и Retry-After в секундах вверх через KitExceptionFilter
// (prd.md §3.5, §3.7; D6 плана E8). Перенос I RateLimitedError и B BffError.rateLimited — обобщены до DomainError.
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import { DomainError } from '../../../src/http/errors.js';
import { throwRateLimited } from '../../../src/redis/rate-limiter.js';
import { createTestApp, expectProblem } from '../../../src/testing/index.js';

@Controller()
class LimitedController {
    @Get('limited')
    limited(): never {
        throwRateLimited({ allowed: false, remaining: 0, retryAfterMs: 1500 });
    }

    @Get('bare')
    bare(): never {
        throw new DomainError('RATE_LIMITED');
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: defineEnv({ ...envBase }) })],
    controllers: [LimitedController],
})
class LimitedModule {}

let app: NestFastifyApplication | undefined;

beforeEach(() => {
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('SHUTDOWN_DRAIN_MS', '0');
});

afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.unstubAllEnvs();
});

function thrown(retryAfterMs: number): unknown {
    try {
        throwRateLimited({ allowed: false, remaining: 0, retryAfterMs });
    } catch (error) {
        return error;
    }

    return undefined;
}

describe('UC-11: 429 RATE_LIMITED', () => {
    it.each([
        [1500, 2],
        [1000, 1],
        [1, 1],
        [0, 1],
        [59_001, 60],
    ])(
        'AC-8.4: throwRateLimited(retryAfterMs: %i) → DomainError RATE_LIMITED, 429, details.retryAfterSec %i',
        (retryAfterMs, retryAfterSec) => {
            const error = thrown(retryAfterMs);

            expect(error).toBeInstanceOf(DomainError);
            expect(error).toMatchObject({
                code: 'RATE_LIMITED',
                status: 429,
                details: { retryAfterSec },
            });
        },
    );

    it("AC-8.4: через KitExceptionFilter — 429, Retry-After: '2', тело {error: {code: 'RATE_LIMITED'}}", async () => {
        app = await createTestApp({ module: LimitedModule, service: 'probe' });
        const res = await app.inject({ method: 'GET', url: '/limited' });

        expectProblem(res, { status: 429, code: 'RATE_LIMITED' });
        expect(res.headers['retry-after']).toBe('2');
    });

    it('AC-8.4: DomainError RATE_LIMITED без retryAfterSec — 429 без Retry-After', async () => {
        app = await createTestApp({ module: LimitedModule, service: 'probe' });
        const res = await app.inject({ method: 'GET', url: '/bare' });

        expectProblem(res, { status: 429, code: 'RATE_LIMITED' });
        expect(res.headers['retry-after']).toBeUndefined();
    });

    it('§3.7: throwRateLimited с allowed: true — TypeError', () => {
        expect(() => throwRateLimited({ allowed: true, remaining: 1, retryAfterMs: 0 })).toThrow(
            TypeError,
        );
    });
});
