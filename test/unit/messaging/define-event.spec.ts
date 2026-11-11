// §3.4, AC-5.15 (U): defineEvent — признак tenant, формат type/version/subject, data без .strict() (prd.md §3.4);
// src/messaging/define-event.ts.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';

const data = z.object({ name: z.string() });

describe('UC-5: defineEvent', () => {
    it("§3.4: defineEvent — tenant по умолчанию 'required'", () => {
        const event = defineEvent({
            type: 'kit.company.created',
            version: 1,
            subject: 'company',
            data,
        });

        expect(event).toMatchObject({
            type: 'kit.company.created',
            version: 1,
            subject: 'company',
            tenant: 'required',
        });
        expect(
            defineEvent({
                type: 'kit.user.seen',
                version: 2,
                subject: 'user',
                tenant: 'none',
                data,
            }).tenant,
        ).toBe('none');
    });

    it('§3.4: defineEvent — strict data → TypeError', () => {
        expect(() =>
            defineEvent({
                type: 'kit.company.created',
                version: 1,
                subject: 'company',
                data: data.strict(),
            }),
        ).toThrow(/data без \.strict\(\)/);
    });

    it.each([
        ['type вне каталога', { type: 'Kit.Company', version: 1, subject: 'company' }],
        ['type без точки', { type: 'kit', version: 1, subject: 'company' }],
        ['version 0', { type: 'kit.company.created', version: 0, subject: 'company' }],
        ['version дробная', { type: 'kit.company.created', version: 1.5, subject: 'company' }],
        ['subject с заглавной', { type: 'kit.company.created', version: 1, subject: 'Company' }],
    ])('§3.4: defineEvent — %s → TypeError', (_name, definition) => {
        expect(() => defineEvent({ ...definition, data })).toThrow(TypeError);
    });

    it("§3.4: tenant вне 'required' | 'none' → TypeError", () => {
        expect(() =>
            defineEvent({
                type: 'kit.company.created',
                version: 1,
                subject: 'company',
                tenant: 'maybe' as 'none',
                data,
            }),
        ).toThrow(TypeError);
    });

    it('§3.4: результат заморожен', () => {
        const event = defineEvent({
            type: 'kit.company.created',
            version: 1,
            subject: 'company',
            data,
        });

        expect(Object.isFrozen(event)).toBe(true);
    });
});
