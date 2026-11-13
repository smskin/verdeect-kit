// AC-4.19 (UC-14; prd.md §3.8 v1.26–v1.27): createTestDb — Db на пулах как у KitDatabaseModule (чтение read only,
// statement_timeout 5 с), вторая «реплика» для runExclusive с ключом messagingCleanupLockKey(schema); срок соединения —
// KIT_DB_CONNECTION_TIMEOUT_MS. Публичный createTestDb из /testing (не одноимённый помощник test/support/database.ts).
// v1.28: {max} — размер каждого пула, pools {main, read} — те же пулы, что в db (countQueries, totalCount).
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { runExclusive } from '../../../src/database/run-exclusive.js';
import {
    countQueries,
    createTestDb,
    KIT_DB_CONNECTION_TIMEOUT_MS,
    messagingCleanupLockKey,
    tcpProxy,
    TEST_TIMEOUT_SCALE,
    type KitTestDb,
} from '../../../src/testing/index.js';
import { appUrl, truncateFixtures } from '../../support/database.js';
import { createCleanupStand, waitUntil } from '../../support/messaging.js';

const CTX = { tenant: 'acme', traceId: 't', actor: { channel: 'system' } } as const;

describe('UC-14: createTestDb', () => {
    let testDb: KitTestDb | undefined;

    afterEach(async () => {
        await testDb?.close();
        testDb = undefined;
    });

    it('AC-4.19: чтение read only и statement_timeout 5 с, как у модуля', async () => {
        testDb = await createTestDb({ url: appUrl(), service: 'kit' });
        const settings = await testDb.db.read(
            { tenant: 'acme', traceId: 't', actor: { channel: 'system' } },
            async (tx) => {
                const { rows } = await tx.execute<{ ro: string; timeout: string }>(
                    sql`select current_setting('default_transaction_read_only') as ro,
                        current_setting('statement_timeout') as timeout`,
                );

                return rows[0];
            },
        );

        expect(settings).toEqual({ ro: 'on', timeout: '5s' });
    });

    it('AC-4.19: пока createTestDb().db держит runExclusive(db, messagingCleanupLockKey(schema)), проход очистки приложения — {ran: false} без ожидания', async () => {
        await truncateFixtures();
        const { app, cleanup } = await createCleanupStand();
        try {
            testDb = await createTestDb({ url: appUrl(), service: 'kit' });
            const outcome = await runExclusive(
                testDb.db,
                messagingCleanupLockKey('kit'),
                async () => cleanup.run(),
            );

            expect(outcome).toEqual({ ran: true, result: { ran: false } });
        } finally {
            await app.close();
        }
    });

    it('AC-4.19: соединение к tcpProxy без ответа падает не позже KIT_DB_CONNECTION_TIMEOUT_MS × TEST_TIMEOUT_SCALE', async () => {
        const proxy = await tcpProxy(appUrl());
        try {
            proxy.blackhole();
            testDb = await createTestDb({ url: proxy.url, service: 'kit' });
            const db = testDb.db;
            const startedAt = performance.now();

            await expect(
                db.transaction({ tenant: 'acme', traceId: 't', actor: { channel: 'system' } }, () =>
                    Promise.resolve(),
                ),
            ).rejects.toThrow();
            expect(performance.now() - startedAt).toBeLessThan(
                KIT_DB_CONNECTION_TIMEOUT_MS * TEST_TIMEOUT_SCALE + 1000,
            );
        } finally {
            await proxy.close();
        }
    });

    it('AC-4.19: close() закрывает оба пула', async () => {
        testDb = await createTestDb({ url: appUrl(), service: 'kit' });
        await testDb.close();
        const { db, pools } = testDb;
        testDb = undefined;

        expect(pools.main.ended).toBe(true);
        expect(pools.read.ended).toBe(true);

        await expect(
            db.transaction({ tenant: 'acme', traceId: 't', actor: { channel: 'system' } }, () =>
                Promise.resolve(),
            ),
        ).rejects.toThrow();
        await expect(
            db.read({ tenant: 'acme', traceId: 't', actor: { channel: 'system' } }, () =>
                Promise.resolve(),
            ),
        ).rejects.toThrow();
    });

    it('AC-4.19: createTestDb({max: 1}) — у pools.main и pools.read по одному соединению, второй одновременный запрос ждёт', async () => {
        testDb = await createTestDb({ url: appUrl(), service: 'kit', max: 1 });
        const { db, pools } = testDb;

        // Срок ожидания в очереди pg-pool — CONNECTION_TIMEOUT_MS: клиент отпускается, как только запрос встал в очередь.
        const mainClient = await pools.main.connect();
        let mainDone = false;
        const transaction = db
            .transaction(CTX, (tx) => tx.execute(sql`select 1`))
            .finally(() => {
                mainDone = true;
            });
        await waitUntil(() => pools.main.waitingCount === 1, 'транзакция в очереди пула');
        expect(mainDone).toBe(false);
        mainClient.release();
        await expect(transaction).resolves.toBeDefined();
        expect(pools.main.totalCount).toBe(1);

        const readClient = await pools.read.connect();
        let readDone = false;
        const reading = db
            .readGlobal((reader) => reader.execute(sql`select 1`))
            .finally(() => {
                readDone = true;
            });
        await waitUntil(() => pools.read.waitingCount === 1, 'чтение в очереди пула');
        expect(readDone).toBe(false);
        readClient.release();
        await expect(reading).resolves.toBeDefined();
        expect(pools.read.totalCount).toBe(1);
    });

    it('AC-4.19: countQueries(pools.main, …) считает запросы db.transaction', async () => {
        testDb = await createTestDb({ url: appUrl(), service: 'kit' });
        const { db, pools } = testDb;
        const work = (): Promise<void> =>
            db.transaction(CTX, async (tx) => {
                await tx.execute(sql`select 1`);
                await tx.execute(sql`select 1`);
            });

        const main = await countQueries(pools.main, work);
        const read = await countQueries(pools.read, work);

        expect(main.queries.filter((text) => text === 'select 1')).toHaveLength(2);
        expect(read.queries.filter((text) => text === 'select 1')).toHaveLength(0);
    });

    it('AC-4.19: max вне целого ≥ 1 (0, 1.5) — TypeError', async () => {
        for (const max of [0, 1.5]) {
            await expect(createTestDb({ url: appUrl(), service: 'kit', max })).rejects.toThrow(
                new TypeError('createTestDb: max — целое ≥ 1'),
            );
        }
    });

    it('AC-4.19: service вне формата — TypeError', async () => {
        await expect(createTestDb({ url: appUrl(), service: 'Kit' })).rejects.toThrow(TypeError);
    });
});
