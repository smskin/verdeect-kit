// AC-4.1 (UC-5): Db.transaction — ровно один set_config('app.tenant', …, true), значение не переживает транзакцию,
// строгий RLS (prd.md §3.3, P0). Перенос O db.int-spec.ts и I rls.int-spec.ts (без режима «пустой тенант видит всё»).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { countQueries } from '../../../src/testing/count-queries.js';
import { note } from '../../fixtures/database/schema.js';
import {
    adminQuery,
    createTestDb,
    ctx,
    sqlStateOf,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';

describe('UC-5: Db.transaction', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb({ poolMax: 1 });
    });

    afterAll(async () => {
        await test.close();
    });

    beforeEach(async () => {
        await truncateFixtures();
    });

    it("AC-4.1: transaction ставит ровно один set_config('app.tenant', …, true)", async () => {
        const { queries } = await countQueries(test.main, () =>
            test.db.transaction(ctx('acme'), (tx) => tx.execute(sql`select 1`)),
        );

        expect(queries.filter((text) => text.includes('set_config'))).toHaveLength(1);
        expect(queries[0]).toMatch(/^begin/);
        expect(queries.at(-1)).toBe('commit');
    });

    it("AC-4.1: значение не переживает транзакцию — то же соединение после COMMIT видит пустое current_setting('app.tenant', true)", async () => {
        const inside = await test.db.transaction(ctx('acme'), async (tx) => {
            const { rows } = await tx.execute<{ pid: number; tenant: string }>(
                sql`select pg_backend_pid() as pid, current_setting('app.tenant', true) as tenant`,
            );

            return rows[0];
        });
        const { rows } = await test.main.query<{ pid: number; tenant: string | null }>(
            "select pg_backend_pid() as pid, current_setting('app.tenant', true) as tenant",
        );

        expect(inside?.tenant).toBe('acme');
        expect(rows[0]?.pid).toBe(inside?.pid);
        expect(rows[0]?.tenant ?? '').toBe('');
    });

    it('AC-4.1: под tenant acme видны и пишутся только строки acme, строка globex не видна; запись строки globex под acme → ошибка политики (42501)', async () => {
        await adminQuery(
            "insert into kit.note (id, tenant, body) values ('g1', 'globex', 'чужая')",
        );
        await test.db.transaction(ctx('acme'), (tx) =>
            tx.insert(note).values({ id: 'a1', tenant: 'acme', body: 'своя' }),
        );

        const rows = await test.db.transaction(ctx('acme'), (tx) => tx.select().from(note));
        expect(rows.map((row) => row.id)).toEqual(['a1']);

        const error: unknown = await test.db
            .transaction(ctx('acme'), (tx) =>
                tx.insert(note).values({ id: 'g2', tenant: 'globex', body: 'подлог' }),
            )
            .catch((caught: unknown) => caught);
        expect(sqlStateOf(error)).toBe('42501');
    });

    it('AC-4.1: transaction с tenant null — 0 строк компаний (строгий RLS, P0)', async () => {
        await adminQuery("insert into kit.note (id, tenant, body) values ('a1', 'acme', 'x')");

        const rows = await test.db.transaction(ctx(null, 'system'), (tx) => tx.select().from(note));

        expect(rows).toEqual([]);
    });
});
