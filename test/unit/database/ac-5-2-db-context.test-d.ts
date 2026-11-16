// AC-5.2 (U; prd.md §3.3 v1.33 стр. 95): поля actor DbContext — string | null (clientId, accountId, memberId,
// onBehalfOf); channel — только string. null пишется в строку outbox и конверт как null.
import { describe, expectTypeOf, it } from 'vitest';
import type { DbContext } from '../../../src/database/tenant.js';

describe('UC-5: DbContext.actor', () => {
    it("AC-5.2: DbContext принимает actor {clientId: null, channel: 'system'} и все четыре поля null", () => {
        const one: DbContext = {
            tenant: null,
            traceId: 't',
            actor: { clientId: null, channel: 'system' },
        };
        const all: DbContext = {
            tenant: 'acme',
            traceId: 't',
            actor: {
                clientId: null,
                accountId: null,
                memberId: null,
                onBehalfOf: null,
                channel: 'http',
            },
        };

        expectTypeOf(one).toExtend<DbContext>();
        expectTypeOf(all).toExtend<DbContext>();
        expectTypeOf<DbContext['actor']['clientId']>().toEqualTypeOf<string | null | undefined>();
    });

    it('AC-5.2: channel: null — ошибка типа', () => {
        const context: DbContext = {
            tenant: null,
            traceId: 't',
            // @ts-expect-error channel — только string
            actor: { channel: null },
        };

        expectTypeOf(context).toExtend<DbContext>();
    });
});
