// AC-4.12 (UC-9): runExclusive — pg_try_advisory_lock между «репликами» (два Db на разных пулах), без ожидания; снятие
// блокировки после исключения (prd.md §3.3). O job-lock (Redis) не переносится.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExclusive } from '../../../src/database/run-exclusive.js';
import { createTestDb, type TestDb } from '../../support/database.js';

describe('UC-9: runExclusive', () => {
    let first: TestDb;
    let second: TestDb;

    beforeAll(async () => {
        first = await createTestDb();
        second = await createTestDb();
    });

    afterAll(async () => {
        await Promise.all([first.close(), second.close()]);
    });

    it('AC-4.12: одновременно — fn выполняется ровно раз, вторая {ran: false} без ожидания', async () => {
        let calls = 0;
        let entered = (): void => undefined;
        const inside = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const running = runExclusive(first.db, 'kit:test-job', async () => {
            calls += 1;
            entered();
            await gate;

            return 'first';
        });
        await inside;

        // Первая держит блокировку, пока шлагбаум закрыт: вторая обязана вернуться, не дожидаясь первой.
        const other = await runExclusive(second.db, 'kit:test-job', async () => {
            calls += 1;

            return 'second';
        });
        release();

        expect(other).toEqual({ ran: false });
        expect(await running).toEqual({ ran: true, result: 'first' });
        expect(calls).toBe(1);
    });

    it('AC-4.12: исключение в fn — блокировка снята, следующий runExclusive выполняется', async () => {
        await expect(
            runExclusive(first.db, 'kit:failing-job', () => Promise.reject(new Error('сбой'))),
        ).rejects.toThrow('сбой');

        expect(await runExclusive(second.db, 'kit:failing-job', () => Promise.resolve(42))).toEqual(
            { ran: true, result: 42 },
        );
    });

    it('AC-4.12: fn получает соединение блокировки — запрос на нём идёт в сеансе, который держит блокировку (KT-22 п. 4)', async () => {
        const outcome = await runExclusive(first.db, 'kit:connection-job', async (connection) => {
            const { rows } = await connection.query<{ held: boolean }>(
                `select exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                 and granted) as held`,
            );

            return rows[0]?.held;
        });

        expect(outcome).toEqual({ ran: true, result: true });
    });

    it('§3.3: пустой ключ → TypeError', async () => {
        await expect(runExclusive(first.db, '', () => Promise.resolve(1))).rejects.toThrow(
            TypeError,
        );
    });
});
