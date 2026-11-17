// AC-3.6 (UC-4): keyset-пагинация — курсор, limit, pageOf, afterCursor (prd.md §3.5); src/http/pagination.ts.
// Перенос I pagination.spec.ts с правками PRD: limit 100/200, 422 VALIDATION_FAILED path: cursor, ключи — JSON-скаляры.
// v1.31: значение ключа проверяется по типу столбца (timestamptz — строгий ISO с зоной, uuid, целое, boolean, строка).
// v1.35: timestamp без зоны, date, numeric, real/double, enum, citext; неподдержанный тип — ошибка afterCursor;
// cursorTimestamp — timestamptz, timestamp, date.
import {
    bigint,
    boolean,
    customType,
    date,
    doublePrecision,
    integer,
    interval,
    json,
    jsonb,
    numeric,
    PgDialect,
    pgEnum,
    pgTable,
    real,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';
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

const kind = pgEnum('kind', ['a', 'b']);
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const schemaCitext = customType<{ data: string }>({ dataType: () => 'identity"."citext' });
const other = customType<{ data: string }>({ dataType: () => 'ltree' });
const v135 = pgTable('v135', {
    id: text('id').primaryKey(),
    at: timestamp('at', { mode: 'string' }).notNull(),
    atDate: timestamp('at_date').notNull(),
    day: date('day').notNull(),
    dayDate: date('day_date', { mode: 'date' }).notNull(),
    amount: numeric('amount').notNull(),
    amountNumber: numeric('amount_number', { mode: 'number' }).notNull(),
    amountBig: numeric('amount_big', { mode: 'bigint' }).notNull(),
    ratio: real('ratio').notNull(),
    score: doublePrecision('score').notNull(),
    kind: kind('kind').notNull(),
    email: citext('email').notNull(),
    login: schemaCitext('login').notNull(),
    path: other('path').notNull(),
    tags: text('tags').array().notNull(),
    payload: jsonb('payload').notNull(),
    raw: json('raw').notNull(),
    span: interval('span').notNull(),
    big: bigint('big', { mode: 'bigint' }).notNull(),
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

    it('AC-3.6 (К23): cursorTimestamp — timestamptz (UTC, микросекунды), timestamp без зоны (микросекунды) и date (YYYY-MM-DD); другой столбец — TypeError', () => {
        const dialect = new PgDialect();

        expect(dialect.sqlToQuery(cursorTimestamp(items.createdAt)).sql).toBe(
            `to_char("items"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        );
        for (const col of [v135.at, v135.atDate]) {
            expect(dialect.sqlToQuery(cursorTimestamp(col)).sql).toBe(
                `to_char("v135"."${col.name}", 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
            );
        }
        for (const col of [v135.day, v135.dayDate]) {
            expect(dialect.sqlToQuery(cursorTimestamp(col)).sql).toBe(
                `to_char("v135"."${col.name}", 'YYYY-MM-DD')`,
            );
        }
        expect(() => cursorTimestamp(items.id)).toThrow(TypeError);
    });

    it('AC-3.6: afterCursor — timestamp без зоны, date, numeric, real/double, enum: верное значение проходит, неверное (now, today, infinity, epoch, NaN, ISO с зоной у timestamp, 2026-02-30, вне enum) → 422 path: cursor', () => {
        const pass: [Parameters<typeof afterCursor>[0][number], string | number][] = [
            [v135.at, '2026-11-10T10:00:00.123456'],
            [v135.atDate, '2026-11-10T10:00:00'],
            [v135.day, '2026-11-10'],
            [v135.dayDate, '2024-02-29'],
            [v135.amount, '12.50'],
            [v135.amount, '-3'],
            [v135.amount, 7.25],
            [v135.amountNumber, '+1'],
            [v135.ratio, 1.5],
            [v135.score, -2],
            [v135.kind, 'a'],
        ];
        for (const [col, key] of pass) {
            expect(afterCursor([col, v135.id], [key, 'x'], 'asc'), String(key)).toBeDefined();
        }
        const fail: [Parameters<typeof afterCursor>[0][number], string | number | boolean][] = [
            [v135.at, 'now'],
            [v135.at, 'epoch'],
            [v135.at, '2026-11-10T10:00:00Z'],
            [v135.at, '2026-11-10T10:00:00+03:00'],
            [v135.atDate, 'infinity'],
            [v135.at, 42],
            [v135.day, 'infinity'],
            [v135.day, 'today'],
            [v135.day, '2026-02-30'],
            [v135.dayDate, '2026-11-10T00:00:00'],
            [v135.amount, 'abc'],
            [v135.amount, 'NaN'],
            [v135.amount, '1e3'],
            [v135.amount, true],
            [v135.amountNumber, 'Infinity'],
            [v135.ratio, '1.5'],
            [v135.score, 'NaN'],
            [v135.kind, 'c'],
            [v135.kind, 1],
        ];
        for (const [col, key] of fail) {
            expect(() => afterCursor([col, v135.id], [key, 'x'], 'asc'), String(key)).toThrow(
                DomainError,
            );
        }
    });

    it('AC-3.6: сортировка по столбцу массива, jsonb, json, interval, bigint и numeric в режиме bigint → Error afterCursor при вызове, в том числе без курсора', () => {
        for (const col of [
            v135.tags,
            v135.payload,
            v135.raw,
            v135.span,
            v135.big,
            v135.amountBig,
        ]) {
            const message = `afterCursor: столбец ${col.name} (${col.columnType}) не поддержан курсором keyset`;
            expect(() => afterCursor([col, v135.id], null, 'asc')).toThrow(message);
            expect(() => afterCursor([col, v135.id], ['x', 'x'], 'asc')).toThrow(message);
        }
    });

    it('AC-3.6: date — параметр с приведением ::date', () => {
        const condition = afterCursor([v135.day, v135.id], ['2026-11-10', 'x'], 'asc');
        if (condition === undefined) {
            throw new Error('ожидалось условие');
        }

        expect(new PgDialect().sqlToQuery(condition).sql).toBe(
            '("v135"."day" > $1::date or ("v135"."day" = $2::date and "v135"."id" > $3))',
        );
    });

    it("AC-3.6: столбец citext (customType, dataType 'citext' и 'identity\".\"citext') — строка проходит, 42 и true → 422 path: cursor; customType другого типа → Error afterCursor", () => {
        for (const col of [v135.email, v135.login]) {
            expect(afterCursor([col, v135.id], ['a@x', 'x'], 'asc')).toBeDefined();
            for (const key of [42, true]) {
                expect(() => afterCursor([col, v135.id], [key, 'x'], 'asc')).toThrow(DomainError);
            }
        }
        expect(() => afterCursor([v135.path, v135.id], null, 'asc')).toThrow(
            'afterCursor: столбец path (PgCustomColumn) не поддержан курсором keyset',
        );
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
