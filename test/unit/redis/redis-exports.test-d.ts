// AC-1.1 (PRD v1.18 «Экспорт /redis»): типы /redis — KitRedisModuleOptions, RateLimitOptions, RateLimitResult (prd.md §3.7).
import { describe, expectTypeOf, it } from 'vitest';
import type {
    KitRedisModuleOptions,
    RateLimitOptions,
    RateLimitResult,
} from '../../../src/redis/index.js';

describe('UC-1: типы /redis', () => {
    it('AC-1.1: KitRedisModuleOptions, RateLimitOptions, RateLimitResult', () => {
        expectTypeOf<KitRedisModuleOptions>().toEqualTypeOf<{
            readonly service: string;
            readonly subscriber?: true;
        }>();
        expectTypeOf<RateLimitOptions>().toEqualTypeOf<{
            readonly limit: number;
            readonly windowMs: number;
        }>();
        expectTypeOf<RateLimitResult>().toEqualTypeOf<{
            readonly allowed: boolean;
            readonly remaining: number;
            readonly retryAfterMs: number;
        }>();
    });
});
