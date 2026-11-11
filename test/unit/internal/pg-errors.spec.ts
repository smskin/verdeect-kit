// Распознавание ошибок PostgreSQL по форме (prd.md §3.3, AC-3.3 — основа; KT-15 п. 9; метка пула — AC-4.5); src/internal/pg-errors.ts.
// Перенос I pg-errors.spec.ts, переписанного на объекты по форме (без DrizzleQueryError и pg.DatabaseError).
import { describe, expect, it } from 'vitest';
import {
    isConnectionError,
    isPoolTimeout,
    isUniqueViolation,
    poolTimeoutOf,
    sqlStateOf,
    tagPoolTimeout,
} from '../../../src/internal/pg-errors.js';

/** Ошибка, вложенная `depth` раз в `cause` (depth 0 — сама ошибка). */
function nested(inner: object, depth: number): object {
    let current: object = inner;
    for (let index = 0; index < depth; index += 1) {
        current = new Error(`обёртка ${index}`, { cause: current });
    }

    return current;
}

function pgError(code: string, extra: Record<string, unknown> = {}): object {
    return Object.assign(new Error('pg'), { code, ...extra });
}

describe('§3.3: isUniqueViolation', () => {
    it('§3.3: 23505 без constraint и с совпадающим constraint — true, с другим — false', () => {
        const error = pgError('23505', { constraint: 'items_slug_uq' });
        expect(isUniqueViolation(error)).toBe(true);
        expect(isUniqueViolation(error, 'items_slug_uq')).toBe(true);
        expect(isUniqueViolation(error, 'other_uq')).toBe(false);
    });

    it('§3.3: 23505 во 2-м cause (обёртка Drizzle) — true', () => {
        expect(isUniqueViolation(nested(pgError('23505'), 2))).toBe(true);
    });

    it('§3.3: цикл cause не зацикливает, другие коды — false', () => {
        const a: { cause?: unknown; code: string } = { code: '40001' };
        const b = { code: '23503', cause: a };
        a.cause = b;
        expect(isUniqueViolation(a)).toBe(false);
        expect(isUniqueViolation(new Error('x'))).toBe(false);
        expect(isUniqueViolation('23505')).toBe(false);
    });
});

describe('§3.3: isPoolTimeout', () => {
    it.each([
        'timeout exceeded when trying to connect',
        'Connection terminated due to connection timeout',
    ])('§3.3: сообщение pg-pool «%s» — true', (message) => {
        expect(isPoolTimeout(new Error(message))).toBe(true);
    });

    it('§3.3: срок пула в cause DomainError-подобной ошибки — true', () => {
        const domain = Object.assign(
            new Error('Сервис временно недоступен', {
                cause: new Error('timeout exceeded when trying to connect'),
            }),
            { code: 'SERVICE_UNAVAILABLE' },
        );
        expect(isPoolTimeout(domain)).toBe(true);
    });

    it('§3.3: срок пула на 11-м уровне cause — false; прочие сообщения — false', () => {
        expect(isPoolTimeout(nested(new Error('timeout exceeded when trying to connect'), 9))).toBe(
            true,
        );
        expect(
            isPoolTimeout(nested(new Error('timeout exceeded when trying to connect'), 10)),
        ).toBe(false);
        expect(isPoolTimeout(new Error('timeout'))).toBe(false);
    });
});

describe('§3.3: isConnectionError', () => {
    it.each([
        ['08006', pgError('08006')],
        ['08001', pgError('08001')],
        ['57P01', pgError('57P01')],
        ['57P02', pgError('57P02')],
        ['57P03', pgError('57P03')],
        ['ECONNRESET', pgError('ECONNRESET')],
        ['ECONNREFUSED', pgError('ECONNREFUSED')],
        ['ETIMEDOUT', pgError('ETIMEDOUT')],
        ['EPIPE', pgError('EPIPE')],
        ['ENOTFOUND', pgError('ENOTFOUND')],
        ['Connection terminated unexpectedly', new Error('Connection terminated unexpectedly')],
        [
            'terminating connection due to administrator command',
            new Error('terminating connection due to administrator command'),
        ],
        [
            'Client has encountered a connection error and is not queryable',
            new Error('Client has encountered a connection error and is not queryable'),
        ],
    ])('§3.3: форма %s — ошибка соединения', (_name, error) => {
        expect(isConnectionError(error)).toBe(true);
    });

    it('§3.3: форма во 2-м cause — true, на 11-м уровне — false', () => {
        expect(isConnectionError(nested(pgError('ECONNRESET'), 2))).toBe(true);
        expect(isConnectionError(nested(pgError('ECONNRESET'), 10))).toBe(false);
    });

    it('§3.3: 23505, 57014 и обычная Error — не ошибка соединения', () => {
        expect(isConnectionError(pgError('23505'))).toBe(false);
        expect(isConnectionError(pgError('57014'))).toBe(false);
        expect(isConnectionError(new Error('domain'))).toBe(false);
    });
});

describe('AC-4.5: метка пула', () => {
    const timeout = (): Error => new Error('timeout exceeded when trying to connect');

    it('AC-4.5: tagPoolTimeout ставит имя пула на узел срока в cause глубины 2, poolTimeoutOf его читает', () => {
        const error = nested(timeout(), 2);
        expect(poolTimeoutOf(error)).toBeNull();
        expect(tagPoolTimeout(error, 'read')).toBe(true);
        expect(poolTimeoutOf(error)).toBe('read');
        expect(isPoolTimeout(error)).toBe(true);
    });

    it('AC-4.5: повторная пометка возвращает false, имя не меняется', () => {
        const error = nested(timeout(), 1);
        expect(tagPoolTimeout(error, 'main')).toBe(true);
        expect(tagPoolTimeout(error, 'read')).toBe(false);
        expect(poolTimeoutOf(error)).toBe('main');
    });

    it('AC-4.5: ошибка не срока пула — false, poolTimeoutOf null', () => {
        const error = pgError('08006');
        expect(tagPoolTimeout(error, 'main')).toBe(false);
        expect(poolTimeoutOf(error)).toBeNull();
        expect(tagPoolTimeout('строка', 'main')).toBe(false);
    });

    it('AC-4.5: метка не видна в JSON.stringify и Object.keys', () => {
        const error = Object.assign(timeout(), { code: 'X' });
        tagPoolTimeout(error, 'main');
        expect(Object.keys(error)).toEqual(['code']);
        expect(JSON.stringify(error)).toBe('{"code":"X"}');
    });
});

describe('AC-4.17: sqlStateOf', () => {
    it('AC-4.17: SQLSTATE во вложенном cause (DrizzleQueryError) находится; глубже 10 уровней — null', () => {
        expect(sqlStateOf(nested(pgError('42P01'), 3))).toBe('42P01');
        expect(sqlStateOf(pgError('28P01'))).toBe('28P01');
        expect(sqlStateOf(nested(pgError('42P01'), 10))).toBeNull();
    });

    it('AC-4.17: системные коды Node (EPIPE, EPERM) и прочие значения — не SQLSTATE', () => {
        expect(sqlStateOf(pgError('EPIPE'))).toBeNull();
        expect(sqlStateOf(pgError('EPERM'))).toBeNull();
        expect(sqlStateOf(nested(pgError('EPIPE'), 1))).toBeNull();
        expect(sqlStateOf(new Error('x'))).toBeNull();
        expect(sqlStateOf('42P01')).toBeNull();
    });
});
