// §3.4 (U, типы): Envelope<E> — tenant по признаку события, data — z.output схемы (prd.md §3.4); src/messaging/envelope.ts.
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import type { Envelope } from '../../../src/messaging/envelope.js';

const data = z.object({ name: z.string(), count: z.coerce.number() });
export const RequiredEvent = defineEvent({ type: 'kit.a.b', version: 1, subject: 'a', data });
export const NoneEvent = defineEvent({
    type: 'kit.a.c',
    version: 1,
    subject: 'a',
    tenant: 'none',
    data,
});

describe('UC-6: Envelope', () => {
    it("§3.4: Envelope — tenant: string для 'required', null для 'none'; data — z.output схемы события", () => {
        expectTypeOf<Envelope<typeof RequiredEvent>['tenant']>().toEqualTypeOf<string>();
        expectTypeOf<Envelope<typeof NoneEvent>['tenant']>().toEqualTypeOf<null>();
        expectTypeOf<Envelope<typeof RequiredEvent>['data']>().toEqualTypeOf<
            z.output<typeof data>
        >();
        expectTypeOf<Envelope<typeof RequiredEvent>['type']>().toEqualTypeOf<'kit.a.b'>();
        expectTypeOf<Envelope['tenant']>().toEqualTypeOf<string | null>();
    });
});
