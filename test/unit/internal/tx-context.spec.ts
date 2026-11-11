// §3.4 (U): связь транзакции Db с DbContext для OutboxStore.add (prd.md §3.4; П4 плана E5); src/internal/tx-context.ts.
import { describe, expect, it } from 'vitest';
import type { DbContext } from '../../../src/database/tenant.js';
import { bindTxContext, txContextOf } from '../../../src/internal/tx-context.js';

const ctx: DbContext = { tenant: 'acme', traceId: 't-1', actor: { channel: 'system' } };

describe('UC-5: контекст транзакции', () => {
    it('§3.4: txContextOf возвращает тот же объект ctx, что связан с tx', () => {
        const tx = {};
        bindTxContext(tx, ctx);

        expect(txContextOf(tx)).toBe(ctx);
    });

    it('§3.4: чужой объект — undefined', () => {
        expect(txContextOf({})).toBeUndefined();
    });
});
