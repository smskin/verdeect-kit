// AC-3.1 (UC-4): ZodValidationPipe — 422 VALIDATION_FAILED с путями и кодами, без значений (prd.md §3.5).
// Перенос O zod-validation.pipe.spec.ts и I zod-validation.pipe.spec.ts (обобщены: DomainError вместо
// ValidationFailedError/RequestValidationError, статус и код — по PRD).
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../../../src/http/errors.js';
import { ZodValidationPipe } from '../../../src/http/zod-validation.pipe.js';

const schema = z
    .object({
        title: z.string().min(1),
        tags: z.array(z.string()),
        remember: z.boolean().default(false),
    })
    .strict();

function rejection(value: unknown): DomainError {
    try {
        new ZodValidationPipe(schema).transform(value);
    } catch (error) {
        if (error instanceof DomainError) {
            return error;
        }
        throw error;
    }
    throw new Error('ожидалась DomainError');
}

beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

describe('UC-4: ZodValidationPipe', () => {
    it('AC-3.1: верный ввод возвращает данные с умолчаниями', () => {
        expect(new ZodValidationPipe(schema).transform({ title: 'a', tags: [] })).toEqual({
            title: 'a',
            tags: [],
            remember: false,
        });
    });

    it('AC-3.1: 422 с путями title и tags.0 через точку, значений в теле нет', () => {
        const error = rejection({ title: '', tags: ['ok', 1] });

        expect(error.status).toBe(422);
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details).toEqual({
            issues: expect.arrayContaining([
                { path: 'title', code: 'too_small' },
                { path: 'tags.1', code: 'invalid_type' },
            ]),
        });
        const nested = rejection({ title: 'x', tags: [1] });
        expect(nested.details).toEqual({ issues: [{ path: 'tags.0', code: 'invalid_type' }] });
        expect(
            JSON.stringify(rejection({ title: 'MARK_SECRET', tags: 'MARK_SECRET' }).toBody()),
        ).not.toContain('MARK_SECRET');
    });

    it('AC-3.1: (body) для unrecognized_keys у strict-схемы', () => {
        const error = rejection({ title: 'a', tags: [], extra: 'MARK_SECRET' });

        expect(error.details).toEqual({ issues: [{ path: '(body)', code: 'unrecognized_keys' }] });
        expect(JSON.stringify(error.toBody())).not.toContain('MARK_SECRET');
    });
});
