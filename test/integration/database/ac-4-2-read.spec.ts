// AC-4.2 (UC-4): Db.read — тенант обязателен, read-only на пуле чтения; readGlobal — без транзакции и set_config,
// statement_timeout 5 с (prd.md §3.3). Перенос I read-pool.int-spec.ts; по PRD read без тенанта — TenantRequiredError.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TenantRequiredError } from '../../../src/database/db.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { note, setting } from '../../fixtures/database/schema.js';
import {
    adminQuery,
    createTestDb,
    ctx,
    sqlStateOf,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';

describe('UC-4: Db.read и readGlobal', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb();
    });

    afterAll(async () => {
        await test.close();
    });

    beforeEach(async () => {
        await truncateFixtures();
    });

    it('AC-4.2: read без тенанта → TenantRequiredError без запроса к БД', async () => {
        const { count, result } = await countQueries(test.read, () =>
            test.db
                .read(ctx(null), (tx) => tx.select().from(note))
                .catch((error: unknown) => error),
        );

        expect(result).toBeInstanceOf(TenantRequiredError);
        expect(count).toBe(0);
        await expect(test.db.read(ctx(''), () => Promise.resolve(1))).rejects.toBeInstanceOf(
            TenantRequiredError,
        );
    });

    it('AC-4.2: read с тенантом — read only (INSERT → 25006)', async () => {
        const error: unknown = await test.db
            .read(ctx('acme'), (tx) =>
                tx.insert(note).values({ id: 'a1', tenant: 'acme', body: 'x' }),
            )
            .catch((caught: unknown) => caught);

        expect(sqlStateOf(error)).toBe('25006');
    });

    it('AC-4.2: readGlobal без транзакции и set_config, таблица setting читается, INSERT → 25006', async () => {
        await adminQuery("insert into kit.setting (key, value) values ('mode', 'on')");

        const { result, queries } = await countQueries(test.read, () =>
            test.db.readGlobal((reader) => reader.select().from(setting)),
        );
        expect(result).toEqual([{ key: 'mode', value: 'on' }]);
        expect(queries.some((text) => /^begin|set_config/.test(text))).toBe(false);

        const error: unknown = await test.db
            .readGlobal((reader) => reader.insert(setting).values({ key: 'x', value: 'y' }))
            .catch((caught: unknown) => caught);
        expect(sqlStateOf(error)).toBe('25006');
    });

    it('AC-4.2: запрос дольше 5 с в readGlobal → отмена 57014', async () => {
        const error: unknown = await test.db
            .readGlobal((reader) => reader.execute(sql`select pg_sleep(6)`))
            .catch((caught: unknown) => caught);

        expect(sqlStateOf(error)).toBe('57014');
    });

    it('AC-4.2: после read с тенантом соединения пула чтения без тенанта', async () => {
        await test.db.read(ctx('acme'), (tx) => tx.select().from(note));

        const { rows } = await test.db.readGlobal((reader) =>
            reader.execute<{ tenant: string | null }>(
                sql`select current_setting('app.tenant', true) as tenant`,
            ),
        );

        expect(rows[0]?.tenant ?? '').toBe('');
    });
});
