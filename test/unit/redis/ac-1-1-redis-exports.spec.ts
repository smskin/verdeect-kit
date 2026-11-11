// AC-1.1 (UC-1; PRD v1.18 «Экспорт /redis»): точка входа /redis экспортирует ровно KitRedisModule, KIT_REDIS,
// KitRedisChannels, RateLimiter, throwRateLimited; типы KitRedisModuleOptions, RateLimitOptions, RateLimitResult —
// в redis-exports.test-d.ts (prd.md §3.7).
import { describe, expect, it } from 'vitest';

describe('UC-1: экспорт /redis', () => {
    it('AC-1.1: значения /redis — ровно KitRedisModule, KIT_REDIS, KitRedisChannels, RateLimiter, throwRateLimited', async () => {
        const module = await import('../../../src/redis/index.js');

        expect(Object.keys(module).sort()).toEqual(
            [
                'KIT_REDIS',
                'KitRedisChannels',
                'KitRedisModule',
                'RateLimiter',
                'throwRateLimited',
            ].sort(),
        );
    });
});
