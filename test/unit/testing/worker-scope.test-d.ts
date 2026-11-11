// workerScope (prd.md §3.8 v1.14): в типе tenant (E4) и rabbitmq (E5); redisPrefix (E8) — позже.
import { describe, expectTypeOf, it } from 'vitest';
import type { KitWorkerScope } from '../../../src/testing/worker-scope.js';

describe('UC-14: workerScope', () => {
    it('§3.8: в типе tenant и rabbitmq, нет redisPrefix (E8)', () => {
        expectTypeOf<KitWorkerScope>().toEqualTypeOf<{
            readonly tenant: string;
            readonly rabbitmq: { readonly vhost: string; readonly url: string };
        }>();
        expectTypeOf<KitWorkerScope>().toHaveProperty('rabbitmq');
        expectTypeOf<KitWorkerScope>().not.toHaveProperty('redisPrefix');
    });
});
