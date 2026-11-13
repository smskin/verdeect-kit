// workerScope (prd.md §3.8 v1.14, AC-8.5): в типе tenant (E4), rabbitmq (E5) и redisPrefix (E8).
import { describe, expectTypeOf, it } from 'vitest';
import type { KitWorkerScope } from '../../../src/testing/worker-scope.js';

describe('UC-14: workerScope', () => {
    it('AC-8.5, AC-1.15: в типе tenant, rabbitmq (с adminUrl) и redisPrefix: string', () => {
        expectTypeOf<KitWorkerScope>().toEqualTypeOf<{
            readonly tenant: string;
            readonly rabbitmq: {
                readonly vhost: string;
                readonly url: string;
                readonly adminUrl: string;
            };
            readonly redisPrefix: string;
        }>();
        expectTypeOf<KitWorkerScope['redisPrefix']>().toEqualTypeOf<string>();
    });
});
