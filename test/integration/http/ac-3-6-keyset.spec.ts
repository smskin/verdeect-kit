// AC-3.6 (UC-4): keyset-пагинация на PostgreSQL (prd.md §3.5): обход страниц по (created_at, id) desc без дублей и
// пропусков, вставка между страницами, неуникальный последний ключ, limit 201 и неверный курсор → 422. PostgreSQL —
// globalSetup уровня I (startTestStack); своя временная схема на файл, удаляется в afterAll. Порядок — по уникальному id.
import { randomBytes } from 'node:crypto';
import { asc, desc, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { DomainError } from '../../../src/http/errors.js';
import {
    afterCursor,
    cursorTimestamp,
    decodeCursor,
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
});
type Row = typeof items.$inferSelect;
/** Время в режиме date (JS Date, как у сервисов): микросекунды timestamptz в Date теряются (К23). */
const events = schema.table('events', {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull(),
});

let pool: pg.Pool;
let db: NodePgDatabase;

beforeAll(async () => {
    pool = new pg.Pool({ connectionString: inject('kitPostgresUrl'), max: 2 });
    db = drizzle(pool);
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(
        sql.raw(
            `create table "${SCHEMA}".items (id text primary key, created_at timestamptz not null, title text not null)`,
        ),
    );
    await db.execute(
        sql.raw(`create table "${SCHEMA}".events (id text primary key, at timestamptz not null)`),
    );
});

afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await pool.end();
});

beforeEach(async () => {
    await db.delete(items);
    await db.delete(events);
});

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

async function page(cursor: string | undefined, limit: number): Promise<Page<Row>> {
    const keys = decodeCursor(cursor, 2);
    const rows = await db
        .select()
        .from(items)
        .where(afterCursor([items.createdAt, items.id], keys, 'desc'))
        .orderBy(desc(items.createdAt), desc(items.id))
        .limit(limit + 1);

    return pageOf(rows, limit, (row) => [row.createdAt, row.id]);
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
});
