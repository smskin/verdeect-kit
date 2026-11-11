// AC-4.11 (UC-8, UC-9): deleteInBatches — транзакция на пачку, shouldContinue, maxBatches, неполная пачка; остановка Db
// ждёт текущую пачку, новая не начинается (prd.md §3.3). Перенос O batches и I db (batchRuns).
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteInBatches } from '../../../src/database/batches.js';
import { adminQuery, createTestDb, truncateFixtures, type TestDb } from '../../support/database.js';

async function seed(count: number): Promise<void> {
    await adminQuery(
        "insert into kit.setting (key, value) select 'k' || i, 'v' from generate_series(1, $1) as i",
        [count],
    );
}

async function remaining(): Promise<number> {
    const [row] = await adminQuery<{ count: number }>(
        'select count(*)::int as count from kit.setting',
    );

    return row?.count ?? -1;
}

const deleteSettings = (size: number) =>
    sql`WITH d AS (DELETE FROM kit.setting WHERE key IN (SELECT key FROM kit.setting LIMIT ${size}) RETURNING 1) SELECT count(*)::int AS deleted FROM d`;

describe('UC-9: deleteInBatches', () => {
    let test: TestDb;

    beforeEach(async () => {
        await truncateFixtures();
        test = await createTestDb();
    });

    afterEach(async () => {
        await test.close();
    });

    it('AC-4.11: shouldContinue = false после первой пачки — одна пачка, deleted = batchSize', async () => {
        await seed(10);
        let checks = 0;

        const result = await deleteInBatches({
            db: test.db,
            sql: deleteSettings,
            batchSize: 3,
            maxBatches: 100,
            shouldContinue: () => (checks += 1) === 1,
        });

        expect(result).toEqual({ deleted: 3, batches: 1, complete: false });
        expect(await remaining()).toBe(7);
    });

    it('AC-4.11: Db.beforeApplicationShutdown во время пачки — пачка дорабатывает, новая не начинается', async () => {
        await seed(10);
        const slow = (size: number) =>
            sql`WITH s AS (SELECT pg_sleep(0.3)), d AS (DELETE FROM kit.setting WHERE key IN (SELECT key FROM kit.setting LIMIT ${size}) RETURNING 1) SELECT count(*)::int AS deleted FROM d, s`;

        const run = deleteInBatches({ db: test.db, sql: slow, batchSize: 2, maxBatches: 100 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await test.db.beforeApplicationShutdown();

        expect(await run).toEqual({ deleted: 2, batches: 1, complete: false });
        expect(await remaining()).toBe(8);
    });

    it('AC-4.11: неполная пачка завершает проход; maxBatches ограничивает', async () => {
        await seed(5);
        expect(
            await deleteInBatches({
                db: test.db,
                sql: deleteSettings,
                batchSize: 2,
                maxBatches: 10,
            }),
        ).toEqual({ deleted: 5, batches: 3, complete: true });

        await seed(10);
        expect(
            await deleteInBatches({
                db: test.db,
                sql: deleteSettings,
                batchSize: 2,
                maxBatches: 2,
            }),
        ).toEqual({ deleted: 4, batches: 2, complete: false });
        expect(await remaining()).toBe(6);
    });

    it('§3.3: batchSize и maxBatches — целые ≥ 1, иначе RangeError', () => {
        expect(() =>
            deleteInBatches({ db: test.db, sql: deleteSettings, batchSize: 0, maxBatches: 1 }),
        ).toThrow(RangeError);
        expect(() =>
            deleteInBatches({ db: test.db, sql: deleteSettings, batchSize: 1, maxBatches: 1.5 }),
        ).toThrow(RangeError);
    });
});
