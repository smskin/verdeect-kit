// quoteIdentifier — экранирование идентификаторов PostgreSQL (KT-20 п. 1); src/internal/sql-identifier.ts.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { quoteIdentifier } from '../../../src/internal/sql-identifier.js';

describe('KT-20: quoteIdentifier', () => {
    it('KT-20: quoteIdentifier("bff-app") → "\\"bff-app\\""', () => {
        expect(quoteIdentifier('bff-app')).toBe('"bff-app"');
    });

    it('KT-20: внутренняя кавычка удваивается', () => {
        expect(quoteIdentifier('a"b')).toBe('"a""b"');
    });

    it('KT-20: пустое имя → TypeError', () => {
        expect(() => quoteIdentifier('')).toThrow(TypeError);
        expect(() => quoteIdentifier('a\0b')).toThrow(TypeError);
    });

    it.each(['kit', 'bff-app', 'Kit_1', 'a"b', '"', 'схема', 'x y'])(
        'KT-20: совпадает с pg.escapeIdentifier на наборе имён («%s»)',
        (name) => {
            expect(quoteIdentifier(name)).toBe(pg.escapeIdentifier(name));
        },
    );
});
