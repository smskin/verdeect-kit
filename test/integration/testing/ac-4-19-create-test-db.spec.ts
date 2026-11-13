// AC-4.19 (UC-14; prd.md §3.8 v1.26–v1.27): createTestDb — Db на пулах как у KitDatabaseModule (чтение read only,
// statement_timeout 5 с), вторая «реплика» для runExclusive с ключом messagingCleanupLockKey(schema); срок соединения —
// KIT_DB_CONNECTION_TIMEOUT_MS. Публичный createTestDb из /testing (не одноимённый помощник test/support/database.ts).
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { runExclusive } from '../../../src/database/run-exclusive.js';
import {
    createTestDb,
    KIT_DB_CONNECTION_TIMEOUT_MS,
    messagingCleanupLockKey,
    tcpProxy,
    TEST_TIMEOUT_SCALE,
    type KitTestDb,
} from '../../../src/testing/index.js';
import { appUrl, truncateFixtures } from '../../support/database.js';
import { createCleanupStand } from '../../support/messaging.js';

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
        const db = testDb.db;
        testDb = undefined;

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

    it('AC-4.19: service вне формата — TypeError', async () => {
        await expect(createTestDb({ url: appUrl(), service: 'Kit' })).rejects.toThrow(TypeError);
    });
});
