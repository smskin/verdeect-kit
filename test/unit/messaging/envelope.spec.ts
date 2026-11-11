// AC-5.2, AC-5.7, AC-5.15 (U): конверт 01 §7.1 — buildEnvelope, EnvelopeSchema, parseEnvelope, tenantViolation
// (prd.md §3.4); src/messaging/envelope.ts. Эталон — O/P/I event-envelope.ts.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import {
    EnvelopeSchema,
    buildEnvelope,
    parseEnvelope,
    tenantViolation,
} from '../../../src/messaging/envelope.js';

const row = {
    id: 'evt_01J0000000000000000000000A',
    type: 'kit.company.created',
    version: 1,
    occurredAt: new Date('2026-11-11T10:00:00.000Z'),
    tenant: 'acme',
    actor: { channel: 'system' },
    subjectKind: 'company',
    subjectId: 'cmp_1',
    data: { name: 'Acme' },
    traceId: 'trace-1',
};

describe('UC-5: конверт события', () => {
    it('AC-5.2: buildEnvelope — поля 01 §7.1, occurredAt ISO, subject {kind, id}', () => {
        const envelope = buildEnvelope(row);

        expect(envelope).toEqual({
            id: row.id,
            type: row.type,
            version: 1,
            occurredAt: '2026-11-11T10:00:00.000Z',
            tenant: 'acme',
            actor: { channel: 'system' },
            subject: { kind: 'company', id: 'cmp_1' },
            data: { name: 'Acme' },
            traceId: 'trace-1',
        });
        expect(EnvelopeSchema.parse(envelope)).toEqual(envelope);
    });

    it('AC-5.2: EnvelopeSchema принимает конверт с tenant: null', () => {
        const envelope = buildEnvelope({ ...row, tenant: null });

        expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
    });

    it('AC-5.2: конверт с лишним полем принимается EnvelopeSchema', () => {
        const envelope = { ...buildEnvelope(row), schemaHint: 'future-field' };

        expect(EnvelopeSchema.safeParse(envelope).success).toBe(true);
        expect(parseEnvelope(Buffer.from(JSON.stringify(envelope))).ok).toBe(true);
    });

    it('AC-5.7: parseEnvelope — не JSON → not-json; без id → envelope, fields [id], без значений', () => {
        expect(parseEnvelope(Buffer.from('{oops'))).toEqual({
            ok: false,
            reason: 'not-json',
            fields: [],
        });

        const withoutId: Record<string, unknown> = {
            ...buildEnvelope(row),
            data: { secret: 'Иванов' },
        };
        delete withoutId['id'];
        const result = parseEnvelope(Buffer.from(JSON.stringify(withoutId)));

        expect(result).toEqual({ ok: false, reason: 'envelope', fields: ['id'] });
        expect(JSON.stringify(result)).not.toContain('Иванов');
    });

    it('AC-5.7: parseEnvelope — верный конверт → ok', () => {
        const envelope = buildEnvelope(row);

        expect(parseEnvelope(Buffer.from(JSON.stringify(envelope)))).toEqual({
            ok: true,
            envelope,
        });
    });

    it("AC-5.15: tenantViolation — 'required' + null, 'none' + 'acme' → true; иначе false", () => {
        const data = z.object({});
        const required = defineEvent({ type: 'kit.a.b', version: 1, subject: 'a', data });
        const none = defineEvent({
            type: 'kit.a.c',
            version: 1,
            subject: 'a',
            tenant: 'none',
            data,
        });

        expect(tenantViolation(required, { tenant: null })).toBe(true);
        expect(tenantViolation(none, { tenant: 'acme' })).toBe(true);
        expect(tenantViolation(required, { tenant: 'acme' })).toBe(false);
        expect(tenantViolation(none, { tenant: null })).toBe(false);
    });
});
