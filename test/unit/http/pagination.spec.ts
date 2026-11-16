// AC-3.6 (UC-4): keyset-пагинация — курсор, limit, pageOf, afterCursor (prd.md §3.5); src/http/pagination.ts.
// Перенос I pagination.spec.ts с правками PRD: limit 100/200, 422 VALIDATION_FAILED path: cursor, ключи — JSON-скаляры.
// v1.31: значение ключа проверяется по типу столбца (timestamptz — строгий ISO с зоной, uuid, целое, boolean, строка).
import { boolean, integer, PgDialect, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../src/http/errors.js';
import {
    afterCursor,
    cursorTimestamp,
    decodeCursor,
    encodeCursor,
    pageOf,
    PageQuerySchema,
} from '../../../src/http/pagination.js';

const items = pgTable('items', {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    title: text('title').notNull(),
});
const typed = pgTable('typed', {
    id: text('id').primaryKey(),
    flag: boolean('flag').notNull(),
    rank: integer('rank').notNull(),
    ref: uuid('ref').notNull(),
});

function invalidCursor(cursor: string, arity: number): DomainError {
    try {
        decodeCursor(cursor, arity);
    } catch (error) {
        if (error instanceof DomainError) {
            return error;
        }
        throw error;
    }
    throw new Error('ожидалась DomainError');
}

describe('UC-4: keyset-пагинация', () => {
    it('AC-3.6: limit по умолчанию 100, 200 принимается, 0 и 201 — ошибка схемы', () => {
        expect(PageQuerySchema.parse({}).limit).toBe(100);
        expect(PageQuerySchema.parse({ limit: '200' }).limit).toBe(200);
        expect(PageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
        expect(PageQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    });

    it('AC-3.6: круговой обмен курсора (строки, числа, логические значения)', () => {
        const keys = ['2026-11-10T00:00:00.000Z', 42, true, 'item-1'];

        expect(decodeCursor(encodeCursor(keys), 4)).toEqual(keys);
        expect(decodeCursor(undefined, 2)).toBeNull();
    });

    it('AC-3.6: неверный курсор (%%%, другая арность, не массив) → 422 VALIDATION_FAILED path: cursor', () => {
        for (const cursor of [
            '%%%',
            encodeCursor(['one']),
            Buffer.from('{"a":1}').toString('base64url'),
            Buffer.from('[{"a":1},"b"]').toString('base64url'),
        ]) {
            const error = invalidCursor(cursor, 2);
            expect(error.status).toBe(422);
            expect(error.toBody().error).toMatchObject({
                code: 'VALIDATION_FAILED',
                details: { issues: [{ path: 'cursor', code: 'invalid' }] },
            });
        }
    });

    it('AC-3.6: pageOf — limit+1 строк → курсор последнего, ровно limit → null', () => {
        const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        const page = pageOf(rows, 2, (row) => [row.id]);

        expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
        expect(decodeCursor(page.nextCursor ?? undefined, 1)).toEqual(['b']);
        expect(pageOf(rows.slice(0, 2), 2, (row) => [row.id]).nextCursor).toBeNull();
    });

    it('AC-3.6: afterCursor строит ИЛИ-цепочку; без курсора — undefined', () => {
        const dialect = new PgDialect();
        const condition = afterCursor(
            [items.createdAt, items.id],
            ['2026-11-10T00:00:00Z', 'b'],
            'desc',
        );
        if (condition === undefined) {
            throw new Error('ожидалось условие');
        }
        const query = dialect.sqlToQuery(condition);

        expect(query.sql).toBe(
            '("items"."created_at" < $1::timestamptz or ("items"."created_at" = $2::timestamptz and "items"."id" < $3))',
        );
        expect(query.params).toEqual(['2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z', 'b']);
        expect(afterCursor([items.id], null, 'asc')).toBeUndefined();
    });

    it('AC-3.6: afterCursor без уникального последнего столбца — ошибка помощника', () => {
        expect(() => afterCursor([items.id, items.createdAt], null, 'asc')).toThrow(
            /последний ключ сортировки должен быть уникальным/,
        );
        expect(() => afterCursor([items.title], ['x'], 'asc')).toThrow(Error);
    });

    it('AC-3.6: afterCursor с курсором другой длины → 422 path: cursor', () => {
        expect(() => afterCursor([items.createdAt, items.id], ['x'], 'asc')).toThrow(DomainError);
    });

    it('AC-3.6 (К23): cursorTimestamp — ISO UTC с микросекундами из БД; столбец не timestamptz — TypeError', () => {
        const query = new PgDialect().sqlToQuery(cursorTimestamp(items.createdAt));

        expect(query.sql).toBe(
            `to_char("items"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        );
        expect(() => cursorTimestamp(items.id)).toThrow(TypeError);
    });

    it('AC-3.6: afterCursor — значение по типу столбца: верный тип проходит, неверный → 422 path: cursor', () => {
        const dialect = new PgDialect();
        const pass: [Parameters<typeof afterCursor>[0], (string | number | boolean)[]][] = [
            [
                [typed.flag, typed.id],
                [true, 'a'],
            ],
            [
                [typed.rank, typed.id],
                [42, 'a'],
            ],
            [
                [typed.ref, typed.id],
                ['0193a5b2-7c1d-7e4f-8a9b-0c1d2e3f4a5b', 'a'],
            ],
            [
                [items.title, items.id],
                ['x', 'a'],
            ],
            [
                [items.createdAt, items.id],
                ['2026-11-10T00:00:00Z', 'a'],
            ],
            [
                [items.createdAt, items.id],
                ['2026-11-10T00:00:00.123456+03:00', 'a'],
            ],
        ];
        for (const [cols, cursor] of pass) {
            const condition = afterCursor(cols, cursor, 'asc');
            if (condition === undefined) {
                throw new Error('ожидалось условие');
            }
            expect(dialect.sqlToQuery(condition).params).toEqual([cursor[0], cursor[0], cursor[1]]);
        }
        const fail: [Parameters<typeof afterCursor>[0], (string | number | boolean)[]][] = [
            [
                [typed.flag, typed.id],
                ['true', 'a'],
            ],
            [
                [typed.rank, typed.id],
                [1.5, 'a'],
            ],
            [
                [typed.rank, typed.id],
                ['42', 'a'],
            ],
            [
                [typed.ref, typed.id],
                ['x', 'a'],
            ],
            [
                [items.title, items.id],
                [42, 'a'],
            ],
            [
                [items.createdAt, items.id],
                ['2026-11-10', 'a'],
            ],
            [
                [items.createdAt, items.id],
                ['infinity', 'a'],
            ],
            [
                [items.createdAt, items.id],
                ['now', 'a'],
            ],
            [
                [items.createdAt, items.id],
                [42, 'a'],
            ],
            [[typed.id], [1]],
        ];
        for (const [cols, cursor] of fail) {
            expect(() => afterCursor(cols, cursor, 'asc'), JSON.stringify(cursor)).toThrow(
                DomainError,
            );
        }
    });
});
