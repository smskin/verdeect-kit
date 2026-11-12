// AC-1.1 (UC-1; PRD v1.18 «Экспорт /redis»): точка входа /redis экспортирует ровно KitRedisModule, KIT_REDIS,
// KitRedisChannels, RateLimiter, throwRateLimited; типы KitRedisModuleOptions, RateLimitOptions, RateLimitResult —
// в redis-exports.test-d.ts (prd.md §3.7).
// Статический импорт, как в тестах других подпутей: загрузка графа (NestJS, ioredis) идёт при сборе файла, а не в
// сроке теста (под нагрузкой test-full динамический import() внутри it() выходил за 5 с).
import * as redis from '../../../src/redis/index.js';
import { describe, expect, it } from 'vitest';

describe('UC-1: экспорт /redis', () => {
    it('AC-1.1: значения /redis — ровно KitRedisModule, KIT_REDIS, KitRedisChannels, RateLimiter, throwRateLimited', () => {
        expect(Object.keys(redis).sort()).toEqual(
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
