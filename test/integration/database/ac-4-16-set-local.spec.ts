// AC-4.16 (UC-5): Db.setLocal — имя ^app\.[a-z_]{1,48}$, имя и значение параметрами, значение живёт до конца
// транзакции (prd.md §3.3).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, ctx, type TestDb } from '../../support/database.js';

describe('UC-5: Db.setLocal', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb({ poolMax: 1 });
    });

    afterAll(async () => {
        await test.close();
    });

    it.each(['app.Tenant', 'tenant', 'app.', `app.${'a'.repeat(49)}`])(
        'AC-4.16: имя вне ^app\\.[a-z_]{1,48}$ → TypeError («%s»)',
        async (name) => {
            await expect(
                test.db.transaction(ctx('acme'), (tx) => test.db.setLocal(tx, name, 'x')),
            ).rejects.toThrow(TypeError);
        },
    );

    it("AC-4.16: значение со ' передаётся параметром и читается current_setting", async () => {
        const value = await test.db.transaction(ctx('acme'), async (tx) => {
            await test.db.setLocal(tx, 'app.request_note', "o'reilly; drop table x");
            const { rows } = await tx.execute<{ value: string }>(
                sql`select current_setting('app.request_note', true) as value`,
            );

            return rows[0]?.value;
        });

        expect(value).toBe("o'reilly; drop table x");
    });

    it('AC-4.16: значение не переживает транзакцию', async () => {
        await test.db.transaction(ctx('acme'), (tx) => test.db.setLocal(tx, 'app.flag', 'on'));

        const { rows } = await test.main.query<{ value: string | null }>(
            "select current_setting('app.flag', true) as value",
        );

        expect(rows[0]?.value ?? '').toBe('');
    });

    it('§3.3: setLocal на дескрипторе readGlobal → TypeError', async () => {
        await expect(
            test.db.readGlobal((reader) => test.db.setLocal(reader, 'app.flag', 'on')),
        ).rejects.toThrow(TypeError);
    });
});
