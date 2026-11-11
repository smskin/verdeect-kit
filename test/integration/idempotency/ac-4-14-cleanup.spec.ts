// AC-4.14, AC-9.5, AC-4.11 (UC-9): очистка идемпотентности под kit_app функцией idempotency_purge — записи старше 24 ч
// всех компаний и без компании, одна реплика (runExclusive), метрика verdeect_cleanup_runs_total ok/partial/error,
// остановка во время прохода → interrupted, DB_POOL_MAX=1 (prd.md §3.3а v1.14; KT-22 п. 4, 5). Перенос O idempotency-cleanup.int-spec.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { createScratchDatabase } from '../../../src/testing/scratch-database.js';
import { adminQuery as adminAt } from '../../support/postgres.js';
import { adminQuery } from '../../support/database.js';
import {
    OTHER_TENANT,
    cleanupRuns,
    createStand,
    truncateIdempotency,
    type IdempotencyStand,
} from './support.js';

const LOCK_KEY = 'verdeect-kit:idempotency-cleanup:kit';

async function seed(rows: readonly (readonly [string | null, string, number])[]): Promise<void> {
    for (const [tenant, key, hours] of rows) {
        await adminQuery(
            `insert into kit.idempotency_key (tenant, subject, key, fingerprint, state, created_at)
             values ($1, 'user:u', $2, 'f', 'done', now() - make_interval(hours => $3))`,
            [tenant, key, hours],
        );
    }
}

async function keys(): Promise<string[]> {
    const rows = await adminQuery<{ key: string }>(
        'select key from kit.idempotency_key order by key',
    );

    return rows.map((row) => row.key);
}

describe('UC-9: очистка идемпотентности', () => {
    let first: IdempotencyStand;
    let second: IdempotencyStand;

    beforeAll(async () => {
        first = await createStand();
        second = await createStand();
    });

    afterAll(async () => {
        await Promise.all([first.close(), second.close()]);
    });

    beforeEach(async () => {
        await truncateIdempotency();
    });

    it('AC-4.14: очистка под kit_app удаляет записи старше 24 ч двух компаний и запись без компании, запись моложе 24 ч остаётся', async () => {
        await seed([
            ['acme', 'acme-25h', 25],
            [OTHER_TENANT, 'globex-30h', 30],
            [null, 'none-26h', 26],
            ['acme', 'acme-1h', 1],
        ]);

        await first.cleanup.run();

        expect(await keys()).toEqual(['acme-1h']);
    });

    it('AC-4.14: две реплики одновременно — проход выполняет одна, вторая не берёт блокировку и метрику не меняет', async () => {
        await seed([['acme', 'old', 25]]);
        const before = await cleanupRuns(second.metrics, 'ok');
        // Первая реплика держит блокировку прохода на своём соединении.
        const client = await mainPoolOf(first.app.get(Db)).connect();
        try {
            await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [LOCK_KEY]);
            await second.cleanup.run();

            expect(await cleanupRuns(second.metrics, 'ok')).toBe(before);
            expect(await keys()).toEqual(['old']);
        } finally {
            await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_KEY]);
            client.release();
        }
    });

    it('AC-9.5: обычный проход → verdeect_cleanup_runs_total{result="ok"} +1, лог с deleted', async () => {
        await seed([
            ['acme', 'a', 25],
            ['acme', 'b', 25],
        ]);
        const before = await cleanupRuns(first.metrics, 'ok');

        await first.cleanup.run();

        expect(await cleanupRuns(first.metrics, 'ok')).toBe(before + 1);
        expect(await keys()).toEqual([]);
    });

    it('AC-9.5: записей больше batchSize × maxBatches → result="partial"', async () => {
        await seed([1, 2, 3, 4, 5].map((n) => ['acme', `p${n}`, 25] as const));
        const before = await cleanupRuns(first.metrics, 'partial');

        await first.cleanup.run({ batchSize: 2, maxBatches: 2 });

        expect(await cleanupRuns(first.metrics, 'partial')).toBe(before + 1);
        expect(await keys()).toHaveLength(1);
    });

    it('AC-9.5: ошибка БД во время прохода → result="error", error-лог, captureError', async () => {
        const scratch = await createScratchDatabase();
        const broken = await createStand({ url: scratch.url });
        try {
            await adminAt(
                scratch.adminUrl,
                `CREATE OR REPLACE FUNCTION kit.idempotency_purge(batch integer) RETURNS integer
                 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'сбой очистки'; END $$`,
            );
            const before = await cleanupRuns(broken.metrics, 'error');

            await expect(broken.cleanup.run()).resolves.toBeUndefined();

            expect(await cleanupRuns(broken.metrics, 'error')).toBe(before + 1);
        } finally {
            await broken.close();
            await scratch.drop();
        }
    });

    it('AC-4.11, AC-9.5: остановка во время прохода — пачка дорабатывает, новая не начинается, result="interrupted"', async () => {
        const scratch = await createScratchDatabase();
        const stand = await createStand({ url: scratch.url });
        try {
            for (let n = 1; n <= 6; n += 1) {
                await adminAt(
                    scratch.adminUrl,
                    `insert into kit.idempotency_key (tenant, subject, key, fingerprint, state, created_at)
                     values ('acme', 'user:u', $1, 'f', 'done', now() - interval '25 hours')`,
                    [`s${n}`],
                );
            }
            const before = await cleanupRuns(stand.metrics, 'interrupted');
            let signal = (): void => undefined;
            const firstBatch = new Promise<void>((resolve) => {
                signal = resolve;
            });
            const { queries } = await countQueries(
                mainPoolOf(stand.app.get(Db)),
                async () => {
                    const run = stand.cleanup.run({ batchSize: 2, maxBatches: 100 });
                    // Сигнал — отправка первой пачки; остановка ставится раньше, чем пачка вернётся с сервера.
                    await firstBatch;
                    await stand.cleanup.beforeApplicationShutdown();
                    await run;
                },
                {
                    onQuery: (text) => {
                        if (text.includes('idempotency_purge')) {
                            signal();
                        }
                    },
                },
            );

            expect(queries.filter((text) => text.includes('idempotency_purge'))).toHaveLength(1);
            const [left] = await adminAt<{ count: number }>(
                scratch.adminUrl,
                'select count(*)::int as count from kit.idempotency_key',
            );
            expect(left?.count).toBe(4);
            expect(await cleanupRuns(stand.metrics, 'interrupted')).toBe(before + 1);
        } finally {
            await stand.close();
            await scratch.drop();
        }
    });

    it('AC-4.14: DB_POOL_MAX=1 — очистка выполняется на соединении блокировки, result="ok" (KT-22 п. 4)', async () => {
        const stand = await createStand({
            env: { DB_POOL_MAX: '1', DB_POOL_ACQUIRE_TIMEOUT_MS: '500' },
        });
        try {
            await seed([
                ['acme', 'pool-1', 25],
                [OTHER_TENANT, 'pool-2', 26],
            ]);
            const before = await cleanupRuns(stand.metrics, 'ok');

            await stand.cleanup.run();

            expect(await cleanupRuns(stand.metrics, 'ok')).toBe(before + 1);
            expect(await cleanupRuns(stand.metrics, 'error')).toBe(0);
            expect(await keys()).toEqual([]);
        } finally {
            await stand.close();
        }
    });
});
