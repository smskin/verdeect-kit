// Подпуть @verdeect/kit/redis (prd.md §3.7, D1): KitRedisModule, KIT_REDIS, KitRedisChannels, RateLimiter,
// throwRateLimited. Первый импорт — проверка peer ioredis (AC-1.2).
import './peer.js';

export { KIT_REDIS } from './client.js';
export { KitRedisChannels } from './channels.js';
export { KitRedisModule } from './kit-redis.module.js';
export type { KitRedisModuleOptions } from './kit-redis.module.js';
export { RateLimiter, throwRateLimited } from './rate-limiter.js';
export type { RateLimitOptions, RateLimitResult } from './rate-limiter.js';
