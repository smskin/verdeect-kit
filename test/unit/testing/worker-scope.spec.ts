// workerScope (prd.md §3.8 v1.14, UC-14): tenant — слаг компании воркера; src/testing/worker-scope.ts.
import { describe, expect, it } from 'vitest';
import { workerScope } from '../../../src/testing/worker-scope.js';

describe('UC-14: workerScope', () => {
    it('§3.8: tenant — слаг ^[a-z0-9][a-z0-9-]{0,48}$, начинается с w<VITEST_POOL_ID>-', () => {
        const { tenant } = workerScope();

        expect(tenant).toMatch(/^[a-z0-9][a-z0-9-]{0,48}$/);
        expect(tenant).toMatch(new RegExp(`^w${process.env.VITEST_POOL_ID ?? '0'}-[0-9a-f]{8}$`));
    });

    it('§3.8: повторный вызов в воркере — то же значение', () => {
        expect(workerScope()).toBe(workerScope());
    });
});
