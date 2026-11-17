// AC-3.6 (UC-4): keyset-пагинация на PostgreSQL (prd.md §3.5): обход страниц по (created_at, id) desc без дублей и
// пропусков, вставка между страницами, неуникальный последний ключ, limit 201 и неверный курсор → 422. PostgreSQL —
// globalSetup уровня I (startTestStack); своя временная схема на файл, удаляется в afterAll. Порядок — по уникальному id.
// v1.31 (r26): значение ключа курсора проверяется по типу столбца до запроса (timestamptz, uuid) → 422 path: cursor.
// v1.35 (r30): timestamp без зоны, date, numeric, enum, citext; jsonb — ошибка afterCursor; обход по timestamp и date.
import { randomBytes } from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
    customType,
    date,
    jsonb,
    numeric,
    pgSchema,
    pgTable,
    text,
    timestamp,
    uuid,
} from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { DomainError } from '../../../src/http/errors.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import {
    afterCursor,
    cursorTimestamp,
    decodeCursor,
    encodeCursor,
    pageOf,
    PageQuerySchema,
    type Page,
} from '../../../src/http/pagination.js';

const SCHEMA = `kit_keyset_${randomBytes(4).toString('hex')}`;
const schema = pgSchema(SCHEMA);
const items = schema.table('items', {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    title: text('title').notNull(),
    ref: uuid('ref'),
});
type Row = typeof items.$inferSelect;
/** Время в режиме date (JS Date, как у сервисов): микросекунды timestamptz в Date теряются (К23). */
const events = schema.table('events', {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull(),
});

/** Типы столбцов v1.35: timestamp без зоны и date — в режиме date (JS Date), как у сервисов. */
const kind = schema.enum('kind', ['a', 'b']);
const typed = schema.table('typed', {
    id: text('id').primaryKey(),
    at: timestamp('at').notNull(),
    day: date('day', { mode: 'date' }).notNull(),
    amount: numeric('amount').notNull(),
    kind: kind('kind').notNull(),
    payload: jsonb('payload').notNull(),
});
/** citext — customType, как у Identity (account.email); расширение — в схеме public. */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const names = pgTable(`${SCHEMA}_names`, { email: citext('email').primaryKey() });

let pool: pg.Pool;
let db: NodePgDatabase;

beforeAll(async () => {
    pool = new pg.Pool({ connectionString: inject('kitPostgresUrl'), max: 2 });
    db = drizzle(pool);
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(
        sql.raw(
            `create table "${SCHEMA}".items (id text primary key, created_at timestamptz not null, title text not null, ref uuid)`,
        ),
    );
    await db.execute(
        sql.raw(`create table "${SCHEMA}".events (id text primary key, at timestamptz not null)`),
    );
    await db.execute(sql.raw(`create type "${SCHEMA}".kind as enum ('a', 'b')`));
    await db.execute(
        sql.raw(
            `create table "${SCHEMA}".typed (id text primary key, at timestamp not null, day date not null, amount numeric not null, kind "${SCHEMA}".kind not null, payload jsonb not null)`,
        ),
    );
    await db.execute(sql.raw('create extension if not exists citext'));
    await db.execute(sql.raw(`create table public."${SCHEMA}_names" (email citext primary key)`));
});

afterAll(async () => {
    await db.execute(sql.raw(`drop table if exists public."${SCHEMA}_names"`));
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await pool.end();
});

beforeEach(async () => {
    await db.delete(items);
    await db.delete(events);
    await db.delete(typed);
    await db.delete(names);
});

/** Ошибка вызова или undefined. */
async function failureOf(work: () => Promise<unknown>): Promise<unknown> {
    try {
        await work();
    } catch (caught) {
        return caught;
    }

    return undefined;
}

/** Строки: по две на каждую минуту — ключ created_at неуникален, порядок держит id. */
async function seed(count: number): Promise<void> {
    await db.insert(items).values(
        Array.from({ length: count }, (_, index) => ({
            id: `item-${String(index).padStart(3, '0')}`,
            createdAt: `2026-11-10T10:${String(Math.floor(index / 2)).padStart(2, '0')}:00Z`,
            title: `запись ${index}`,
        })),
    );
}

async function page(
    cursor: string | undefined,
    limit: number,
): Promise<Page<Row & { cursorAt: string }>> {
    const keys = decodeCursor(cursor, 2);
    const rows = await db
        .select({
            id: items.id,
            createdAt: items.createdAt,
            title: items.title,
            ref: items.ref,
            cursorAt: cursorTimestamp(items.createdAt),
        })
        .from(items)
        .where(afterCursor([items.createdAt, items.id], keys, 'desc'))
        .orderBy(desc(items.createdAt), desc(items.id))
        .limit(limit + 1);

    return pageOf(rows, limit, (row) => [row.cursorAt, row.id]);
}

describe('UC-4: keyset на PostgreSQL', () => {
    it('AC-3.6: обход всех страниц по (created_at, id) desc с limit 3 — все строки по одному разу', async () => {
        await seed(10);
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
            const current = await page(cursor, 3);
            seen.push(...current.items.map((row) => row.id));
            cursor = current.nextCursor ?? undefined;
        } while (cursor !== undefined);

        const expected = Array.from(
            { length: 10 },
            (_, index) => `item-${String(9 - index).padStart(3, '0')}`,
        );
        expect(seen).toEqual(expected);
    });

    it('AC-3.6: вставка строк между страницами не даёт дублей и пропусков', async () => {
        await seed(8);
        const first = await page(undefined, 3);
        await db.insert(items).values([
            { id: 'item-new', createdAt: '2026-11-10T11:00:00Z', title: 'новее курсора' },
            { id: 'item-old', createdAt: '2026-11-10T09:00:00Z', title: 'старше курсора' },
        ]);
        const rest: string[] = [];
        let cursor = first.nextCursor ?? undefined;
        while (cursor !== undefined) {
            const current = await page(cursor, 3);
            rest.push(...current.items.map((row) => row.id));
            cursor = current.nextCursor ?? undefined;
        }
        const all = [...first.items.map((row) => row.id), ...rest];

        expect(new Set(all).size).toBe(all.length);
        expect(rest).toContain('item-old');
        expect(rest).not.toContain('item-new');
        expect(all.filter((id) => id !== 'item-old').sort()).toEqual(
            Array.from({ length: 8 }, (_, index) => `item-${String(index).padStart(3, '0')}`),
        );
    });

    it('AC-3.6: сортировка без уникального последнего ключа — ошибка помощника', () => {
        expect(() => afterCursor([items.id, items.createdAt], null, 'desc')).toThrow(
            /последний ключ сортировки должен быть уникальным/,
        );
    });

    it('AC-3.6: limit 201 и неверный курсор → 422', () => {
        expect(PageQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
        let error: unknown;
        try {
            decodeCursor('%%%', 2);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).status).toBe(422);
        expect((error as DomainError).details).toEqual({
            issues: [{ path: 'cursor', code: 'invalid' }],
        });
    });

    it('AC-3.6 (К23): 6 строк в одну миллисекунду с разными микросекундами, обход по (at, id) desc и asc с limit 2 — все строки ровно один раз', async () => {
        // Порядок id обратен порядку микросекунд: потеря микросекунд в курсоре даёт пропуски и повторы.
        await db.execute(
            sql.raw(
                `insert into "${SCHEMA}".events (id, at) values ${Array.from(
                    { length: 6 },
                    (_, index) =>
                        `('ev-${String(index)}', '2026-11-13T10:00:00.123${String(6 - index).padStart(3, '0')}Z')`,
                ).join(', ')}`,
            ),
        );
        for (const dir of ['desc', 'asc'] as const) {
            const order = dir === 'desc' ? desc : asc;
            const seen: string[] = [];
            let cursor: string | undefined;
            do {
                const keys = decodeCursor(cursor, 2);
                const rows = await db
                    .select({ id: events.id, cursorAt: cursorTimestamp(events.at) })
                    .from(events)
                    .where(afterCursor([events.at, events.id], keys, dir))
                    .orderBy(order(events.at), order(events.id))
                    .limit(3);
                const current = pageOf(rows, 2, (row) => [row.cursorAt, row.id]);
                seen.push(...current.items.map((row) => row.id));
                cursor = current.nextCursor ?? undefined;
            } while (cursor !== undefined && seen.length < 20);

            const byTime = ['ev-0', 'ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5'];
            expect(seen, dir).toEqual(dir === 'desc' ? byTime : [...byTime].reverse());
        }
    });

    it('AC-3.6: курсор с ключом timestamptz = 42, "abc", "now" и ключом uuid = "x" → 422 path: cursor, без события GlitchTip и запроса к БД', async () => {
        const cases = [
            { cols: [items.createdAt, items.id], cursor: encodeCursor([42, 'id-1']) },
            { cols: [items.createdAt, items.id], cursor: encodeCursor(['abc', 'id-1']) },
            { cols: [items.createdAt, items.id], cursor: encodeCursor(['now', 'id-1']) },
            { cols: [items.ref, items.id], cursor: encodeCursor(['x', 'id-1']) },
        ];
        for (const { cols, cursor } of cases) {
            let error: unknown;
            const { count } = await countQueries(pool, async () => {
                try {
                    await db
                        .select()
                        .from(items)
                        .where(afterCursor(cols, decodeCursor(cursor, 2), 'desc'))
                        .limit(2);
                } catch (caught) {
                    error = caught;
                }
            });

            // DomainError: фильтр пишет warn без GlitchTip (ac-3-3-exception-filter.spec.ts).
            expect(error, cursor).toBeInstanceOf(DomainError);
            expect((error as DomainError).status).toBe(422);
            expect((error as DomainError).details).toEqual({
                issues: [{ path: 'cursor', code: 'invalid' }],
            });
            expect(count, cursor).toBe(0);
        }
    });

    it('AC-3.6: курсор с ключом timestamp = "now", date = "infinity", numeric = "abc", enum вне списка → 422 path: cursor без запроса к БД', async () => {
        const cases: [Parameters<typeof afterCursor>[0], string][] = [
            [[typed.at, typed.id], 'now'],
            [[typed.at, typed.id], 'epoch'],
            [[typed.at, typed.id], '2026-11-10T10:00:00Z'],
            [[typed.day, typed.id], 'infinity'],
            [[typed.day, typed.id], 'today'],
            [[typed.amount, typed.id], 'abc'],
            [[typed.amount, typed.id], 'NaN'],
            [[typed.kind, typed.id], 'c'],
        ];
        for (const [cols, key] of cases) {
            const cursor = encodeCursor([key, 'id-1']);
            let error: unknown;
            const { count } = await countQueries(pool, async () => {
                error = await failureOf(() =>
                    db
                        .select()
                        .from(typed)
                        .where(afterCursor(cols, decodeCursor(cursor, 2), 'asc'))
                        .limit(2),
                );
            });

            expect(error, key).toBeInstanceOf(DomainError);
            expect((error as DomainError).status, key).toBe(422);
            expect((error as DomainError).details).toEqual({
                issues: [{ path: 'cursor', code: 'invalid' }],
            });
            expect(count, key).toBe(0);
        }
    });

    it('AC-3.6: сортировка по столбцу jsonb → ошибка afterCursor', async () => {
        let error: unknown;
        const { count } = await countQueries(pool, async () => {
            error = await failureOf(() =>
                db
                    .select()
                    .from(typed)
                    .where(afterCursor([typed.payload, typed.id], null, 'asc'))
                    .limit(2),
            );
        });

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(DomainError);
        expect((error as Error).message).toBe(
            'afterCursor: столбец payload (PgJsonb) не поддержан курсором keyset',
        );
        expect(count).toBe(0);
    });

    it('AC-3.6: курсор по столбцу citext проходится до конца без дублей, неверное значение (42) → 422 path: cursor без запроса к БД', async () => {
        const emails = ['a@x', 'B@x', 'c@x', 'D@x', 'e@x'];
        await db.insert(names).values(emails.map((email) => ({ email })));
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
            const keys = decodeCursor(cursor, 1);
            const rows = await db
                .select({ email: names.email })
                .from(names)
                .where(afterCursor([names.email], keys, 'asc'))
                .orderBy(asc(names.email))
                .limit(3);
            const current = pageOf(rows, 2, (row) => [row.email]);
            seen.push(...current.items.map((row) => row.email));
            cursor = current.nextCursor ?? undefined;
        } while (cursor !== undefined && seen.length < 20);

        // citext сравнивает без учёта регистра: порядок a, B, c, D, e.
        expect(seen).toEqual(emails);
        let error: unknown;
        const { count } = await countQueries(pool, async () => {
            error = await failureOf(() =>
                db
                    .select()
                    .from(names)
                    .where(afterCursor([names.email], decodeCursor(encodeCursor([42]), 1), 'asc')),
            );
        });
        expect(error).toBeInstanceOf(DomainError);
        expect((error as DomainError).status).toBe(422);
        expect(count).toBe(0);
    });

    it('AC-3.6: страница по столбцу timestamp проходится до конца без дублей', async () => {
        // 6 строк в одну миллисекунду, порядок id обратен микросекундам; date — 6 строк на 3 дня.
        await db.execute(
            sql.raw(
                `insert into "${SCHEMA}".typed (id, at, day, amount, kind, payload) values ${Array.from(
                    { length: 6 },
                    (_, index) =>
                        `('t-${String(index)}', '2026-11-13T10:00:00.123${String(6 - index).padStart(3, '0')}', '2026-11-${String(10 + Math.floor(index / 2))}', 1, 'a', '{}')`,
                ).join(', ')}`,
            ),
        );
        const byTime = ['t-5', 't-4', 't-3', 't-2', 't-1', 't-0'];
        const byDay = ['t-0', 't-1', 't-2', 't-3', 't-4', 't-5'];
        for (const [col, ascOrder] of [
            [typed.at, byTime],
            [typed.day, byDay],
        ] as const) {
            for (const dir of ['desc', 'asc'] as const) {
                const order = dir === 'desc' ? desc : asc;
                const seen: string[] = [];
                let cursor: string | undefined;
                do {
                    const keys = decodeCursor(cursor, 2);
                    const rows = await db
                        .select({ id: typed.id, cursorAt: cursorTimestamp(col) })
                        .from(typed)
                        .where(afterCursor([col, typed.id], keys, dir))
                        .orderBy(order(col), order(typed.id))
                        .limit(3);
                    const current = pageOf(rows, 2, (row) => [row.cursorAt, row.id]);
                    seen.push(...current.items.map((row) => row.id));
                    cursor = current.nextCursor ?? undefined;
                } while (cursor !== undefined && seen.length < 20);

                const expected = dir === 'asc' ? ascOrder : [...ascOrder].reverse();
                expect(seen, `${col.name} ${dir}`).toEqual(expected);
            }
        }
    });
});
