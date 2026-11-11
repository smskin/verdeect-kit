// workerScope (prd.md §3.8 v1.14): в типе E4 только tenant; rabbitmq (E5), redisPrefix (E8) — позже.
import { describe, expectTypeOf, it } from 'vitest';
import type { KitWorkerScope } from '../../../src/testing/worker-scope.js';

describe('UC-14: workerScope', () => {
    it('§3.8: в типе нет rabbitmq и redisPrefix (E5, E8)', () => {
        expectTypeOf<KitWorkerScope>().toEqualTypeOf<{ readonly tenant: string }>();
        expectTypeOf<KitWorkerScope>().not.toHaveProperty('rabbitmq');
        expectTypeOf<KitWorkerScope>().not.toHaveProperty('redisPrefix');
    });
});
