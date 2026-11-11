// redisWorkerOverride (prd.md §3.8, AC-8.5, UC-14; D2 плана E8): подмена префикса Redis приложения префиксом воркера
// <svc>:w<N>: для createTestApp({overrides}). Токен префикса — внутренний, из /redis не экспортируется.
import { KIT_REDIS_PREFIX } from '../internal/tokens.js';
import type { KitTestOverride } from './create-test-app.js';
import { workerScope } from './worker-scope.js';

/**
 * Подмена префикса ключей и каналов `KitRedisModule` префиксом воркера `workerScope().redisPrefix` (AC-8.5).
 *
 * @example
 * vi.stubEnv('REDIS_URL', inject('kitRedisUrl') ?? '');
 * const app = await createTestApp({ module: AppModule, service: 'svc', overrides: [redisWorkerOverride()] });
 * @throws {TypeError} стек без `redis: true`.
 */
export function redisWorkerOverride(): KitTestOverride {
    return { provide: KIT_REDIS_PREFIX, useValue: workerScope().redisPrefix };
}
