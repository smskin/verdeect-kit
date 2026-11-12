// AC-3.2 (UC-4): словарь ошибок kitErrors/defineErrors и DomainError (prd.md §3.5); src/http/errors.ts.
// Эталон — O domain-error.spec.ts (тело, name, статус из словаря). Реестр — на процесс: коды тестов уникальны.
import { describe, expect, it } from 'vitest';
import { defineErrors, DomainError, errorMessage, kitErrors } from '../../../src/http/errors.js';

describe('AC-3.2: словарь ошибок', () => {
    it('AC-3.2: неизвестный код — общий русский текст «Ошибка запроса»', () => {
        expect(errorMessage('NO_SUCH_CODE_DICT')).toBe('Ошибка запроса');
    });

    it('§3.5: DomainError берёт статус и текст из словаря, тело {error: {code, message, details}}', () => {
        defineErrors({ DICT_ITEM_NOT_FOUND: { status: 404, message: 'Запись не найдена' } });
        const error = new DomainError('DICT_ITEM_NOT_FOUND', { id: 'x' });

        expect(error.status).toBe(404);
        expect(error.name).toBe('DomainError');
        expect(error.toBody()).toEqual({
            error: {
                code: 'DICT_ITEM_NOT_FOUND',
                message: 'Запись не найдена',
                details: { id: 'x' },
            },
        });
        expect(new DomainError('FORBIDDEN').toBody().error.details).toEqual({});
    });

    it('AC-3.2: повторный defineErrors объединяет словари — коды обоих вызовов дают свои статусы', () => {
        defineErrors({ DICT_FIRST: { status: 409, message: 'Первый' } });
        defineErrors({ DICT_SECOND: { status: 410, message: 'Второй' } });

        expect(new DomainError('DICT_FIRST').status).toBe(409);
        expect(new DomainError('DICT_SECOND').status).toBe(410);
    });

    it('AC-3.2: тот же код с другим статусом во втором defineErrors — ошибка при определении', () => {
        defineErrors({ DICT_TWICE: { status: 409, message: 'x' } });
        expect(() => defineErrors({ DICT_TWICE: { status: 409, message: 'x' } })).not.toThrow();
        expect(() => defineErrors({ DICT_TWICE: { status: 400, message: 'x' } })).toThrow(
            /DICT_TWICE/,
        );
        expect(new DomainError('DICT_TWICE').status).toBe(409);
    });

    it('AC-3.2: DomainError с незарегистрированным кодом — статус 500', () => {
        expect(new DomainError('DICT_NOT_REGISTERED').status).toBe(500);
    });

    it('§3.5: cause передаётся третьим аргументом', () => {
        const cause = new Error('исходная');
        expect(new DomainError('SERVICE_UNAVAILABLE', {}, { cause }).cause).toBe(cause);
    });

    it('§3.5: все коды §3.5 и их статусы в kitErrors', () => {
        const statuses = Object.fromEntries(
            Object.entries(kitErrors).map(([code, entry]) => [code, entry.status]),
        );
        expect(statuses).toEqual({
            UNAUTHENTICATED: 401,
            FORBIDDEN: 403,
            VALIDATION_FAILED: 422,
            BAD_REQUEST: 400,
            PAYLOAD_TOO_LARGE: 413,
            UNSUPPORTED_MEDIA_TYPE: 415,
            ROUTE_NOT_FOUND: 404,
            VERSION_CONFLICT: 409,
            RATE_LIMITED: 429,
            INTERNAL_ERROR: 500,
            SERVICE_UNAVAILABLE: 503,
            SERVICE_STOPPING: 503,
            PLATFORM_UNAVAILABLE: 503,
            IDEMPOTENCY_KEY_REUSED: 422,
            IDEMPOTENCY_IN_PROGRESS: 409,
            IDEMPOTENCY_KEY_REQUIRED: 400,
        });
        expect(kitErrors.UNAUTHENTICATED.message).toBe('Требуется вход');
        expect(kitErrors.FORBIDDEN.message).toBe('Доступ запрещён');
    });

    it('AC-3.2: status списком — тот же набор в другом порядке не ошибка, другой набор или число — ошибка при определении', () => {
        defineErrors({ DICT_MULTI: { status: [429, 403], message: 'x' } });
        expect(() =>
            defineErrors({ DICT_MULTI: { status: [403, 429], message: 'x' } }),
        ).not.toThrow();
        expect(() => defineErrors({ DICT_MULTI: { status: [403], message: 'x' } })).toThrow(
            /DICT_MULTI уже зарегистрирован со статусом 403, 429/,
        );
        expect(() => defineErrors({ DICT_MULTI: { status: 403, message: 'x' } })).toThrow();
        expect(() => defineErrors({ DICT_EMPTY: { status: [], message: 'x' } })).toThrow(
            /пустой список/,
        );
    });

    it('§3.5: DomainError кода со списком статусов: status из объявленных — он, без status или вне — 500', () => {
        defineErrors({ DICT_PAIR: { status: [403, 429], message: 'x' } });

        expect(new DomainError('DICT_PAIR', {}, { status: 429 }).status).toBe(429);
        expect(new DomainError('DICT_PAIR').status).toBe(500);
        expect(new DomainError('DICT_PAIR', {}, { status: 404 }).status).toBe(500);
        expect(new DomainError('DICT_FIRST', {}, { status: 409 }).status).toBe(409);
        expect(new DomainError('DICT_FIRST', {}, { status: 400 }).status).toBe(500);
    });
});
