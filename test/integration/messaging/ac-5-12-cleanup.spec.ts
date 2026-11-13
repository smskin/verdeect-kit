// AC-5.12 (UC-9), AC-5.11, AC-9.5: очистка outbox и inbox — опубликованные и полученные старше 7 дней, пачки, одна
// реплика (runExclusive), DB_POOL_MAX = 1, остановка во время прохода → interrupted, ошибка одной таблицы не мешает
// другой (prd.md §3.4). Эквивалентность — O messaging-cleanup.int-spec; приёмы — E4 ac-4-14-cleanup.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { runExclusive } from '../../../src/database/run-exclusive.js';
import { messagingCleanupLockKey } from '../../../src/internal/outbox-policy.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { adminQuery, createTestDb, truncateFixtures } from '../../support/database.js';
import { barrier, createCleanupStand, messagingCleanupRuns } from '../../support/messaging.js';

const LOCK_KEY = messagingCleanupLockKey('kit');

async function seedOutbox(
    id: string,
    publishedDaysAgo: number | null,
    occurredDaysAgo = 1,
): Promise<void> {
    await adminQuery(
        `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data, occurred_at, published_at)
         values ($1, 'acme', 'kit.note.created', 1, 's', '{}', 't', '{}', now() - make_interval(days => $2),
                 case when $3::int is null then null else now() - make_interval(days => $3::int) end)`,
        [id, occurredDaysAgo, publishedDaysAgo],
    );
}

async function seedInbox(id: string, daysAgo: number): Promise<void> {
    await adminQuery(
        "insert into kit.inbox (id, type, received_at) values ($1, 'kit.note.created', now() - make_interval(days => $2))",
        [id, daysAgo],
    );
}

async function ids(table: 'outbox' | 'inbox'): Promise<string[]> {
    return (await adminQuery<{ id: string }>(`select id from kit.${table} order by id`)).map(
        (row) => row.id,
    );
}

describe('UC-9: очистка сообщений', () => {
    beforeEach(truncateFixtures);
    afterEach(truncateFixtures);

    it('AC-5.12: опубликованные outbox и inbox старше 7 дней удаляются, неопубликованные — никогда', async () => {
        const { app, cleanup } = await createCleanupStand();
        try {
            await seedOutbox('evt_old', 8);
            await seedOutbox('evt_new', 1);
            await seedOutbox('evt_pending', null, 30);
            await seedInbox('m_old', 8);
            await seedInbox('m_new', 1);
            const before = {
                outbox: await messagingCleanupRuns(app, 'outbox', 'ok'),
                inbox: await messagingCleanupRuns(app, 'inbox', 'ok'),
            };

            await cleanup.run();

            expect(await ids('outbox')).toEqual(['evt_new', 'evt_pending']);
            expect(await ids('inbox')).toEqual(['m_new']);
            expect(await messagingCleanupRuns(app, 'outbox', 'ok')).toBe(before.outbox + 1);
            expect(await messagingCleanupRuns(app, 'inbox', 'ok')).toBe(before.inbox + 1);
        } finally {
            await app.close();
        }
    });

    it('AC-5.12: пачки по 1000, не больше 100 за проход — 2 пачки по 2 при maxBatches 2 и 5 строках → partial, удалено 4', async () => {
        const { app, cleanup } = await createCleanupStand();
        try {
            for (let n = 1; n <= 5; n += 1) {
                await seedOutbox(`evt_${n}`, 8);
            }
            const before = await messagingCleanupRuns(app, 'outbox', 'partial');

            await cleanup.run({ batchSize: 2, maxBatches: 2 });

            expect(await ids('outbox')).toHaveLength(1);
            expect(await messagingCleanupRuns(app, 'outbox', 'partial')).toBe(before + 1);
        } finally {
            await app.close();
        }
    });

    it('AC-5.12: одна реплика за раз — пока блокировка занята, проход — другая реплика, метрика не меняется', async () => {
        const { app, cleanup } = await createCleanupStand();
        const other = await createTestDb();
        const gate = barrier();
        const held = barrier();
        try {
            await seedOutbox('evt_old', 8);
            const holding = runExclusive(other.db, LOCK_KEY, async () => {
                held.release();
                await gate.wait;
            });
            await held.wait;
            const before = await messagingCleanupRuns(app, 'outbox', 'ok');

            await cleanup.run();

            expect(await ids('outbox')).toEqual(['evt_old']);
            expect(await messagingCleanupRuns(app, 'outbox', 'ok')).toBe(before);
            gate.release();
            await holding;
        } finally {
            gate.release();
            await other.close();
            await app.close();
        }
    });

    it('AC-5.12: DB_POOL_MAX = 1 — проход проходит на соединении блокировки', async () => {
        const { app, cleanup } = await createCleanupStand({
            env: { DB_POOL_MAX: '1', DB_POOL_ACQUIRE_TIMEOUT_MS: '500' },
        });
        try {
            await seedOutbox('evt_old', 8);
            await seedInbox('m_old', 8);
            const before = await messagingCleanupRuns(app, 'outbox', 'ok');

            await cleanup.run();

            expect(await ids('outbox')).toEqual([]);
            expect(await ids('inbox')).toEqual([]);
            expect(await messagingCleanupRuns(app, 'outbox', 'ok')).toBe(before + 1);
        } finally {
            await app.close();
        }
    });

    it('AC-5.11: остановка во время прохода — текущая пачка дорабатывает, новая не начинается → interrupted', async () => {
        const { app, cleanup } = await createCleanupStand();
        for (let n = 1; n <= 6; n += 1) {
            await seedOutbox(`evt_${n}`, 8);
        }
        const before = await messagingCleanupRuns(app, 'outbox', 'interrupted');
        const isPurge = (text: string): boolean => text.includes('delete from "kit"."outbox"');
        const first = barrier();
        const { queries } = await countQueries(
            mainPoolOf(app.get(Db)),
            async () => {
                const run = cleanup.run({ batchSize: 2, maxBatches: 100 });
                // Сигнал — отправка первой пачки; остановка ставится раньше, чем пачка вернётся с сервера.
                await first.wait;
                await cleanup.beforeApplicationShutdown();
                await run;
            },
            {
                onQuery: (text) => {
                    if (isPurge(text)) {
                        first.release();
                    }
                },
            },
        );
        await app.close();

        expect(queries.filter(isPurge)).toHaveLength(1);
        expect(await ids('outbox')).toHaveLength(4);
        expect(await messagingCleanupRuns(app, 'outbox', 'interrupted')).toBe(before + 1);
    });

    it('AC-9.5: ошибка БД таблицы outbox → result="error" outbox, inbox — ok', async () => {
        const { app, cleanup } = await createCleanupStand();
        try {
            await seedInbox('m_old', 8);
            const before = {
                error: await messagingCleanupRuns(app, 'outbox', 'error'),
                ok: await messagingCleanupRuns(app, 'inbox', 'ok'),
            };
            await adminQuery('REVOKE DELETE ON kit.outbox FROM kit_app');
            try {
                await cleanup.run();
            } finally {
                await adminQuery('GRANT DELETE ON kit.outbox TO kit_app');
            }

            expect(await messagingCleanupRuns(app, 'outbox', 'error')).toBe(before.error + 1);
            expect(await messagingCleanupRuns(app, 'inbox', 'ok')).toBe(before.ok + 1);
            expect(await ids('inbox')).toEqual([]);
        } finally {
            await app.close();
        }
    });
});
