// AC-5.1 (UC-5): изменение домена и событие — в одной транзакции; data не по схеме — исключение до записи, откат
// целиком (prd.md §3.4). Обобщение O outbox-atomicity.int-spec.ts (сбой записи outbox → изменения домена нет).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AfterCommitInReadOnlyError, Db } from '../../../src/database/db.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import { TestNoteCreated, createOutboxApp } from '../../support/messaging.js';

async function counts(): Promise<{ notes: number; outbox: number }> {
    const [row] = await adminQuery<{ notes: number; outbox: number }>(
        'select (select count(*)::int from kit.note) as notes, (select count(*)::int from kit.outbox) as outbox',
    );

    return row ?? { notes: -1, outbox: -1 };
}

describe('UC-5: атомарность outbox', () => {
    let app: NestFastifyApplication;
    let db: Db;
    let store: OutboxStore;

    beforeAll(async () => {
        app = await createOutboxApp();
        await app.init();
        db = app.get(Db);
        store = app.get(OutboxStore);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(truncateFixtures);

    it('AC-5.1: data не по схеме — TypeError, строки kit.note и kit.outbox нет', async () => {
        await expect(
            db.transaction(ctx('acme'), async (tx) => {
                await tx.execute(
                    sql`insert into kit.note (id, tenant, body) values ('n1', 'acme', 'x')`,
                );
                await store.add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'n1', title: '' },
                });
            }),
        ).rejects.toThrow(TypeError);

        expect(await counts()).toEqual({ notes: 0, outbox: 0 });
    });

    it('AC-5.1: успех — note и строка outbox видны после COMMIT вместе', async () => {
        await db.transaction(ctx('acme'), async (tx) => {
            await tx.execute(
                sql`insert into kit.note (id, tenant, body) values ('n1', 'acme', 'x')`,
            );
            await store.add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
            });
            // До COMMIT строку не видит другое соединение.
            expect(await counts()).toEqual({ notes: 0, outbox: 0 });
        });

        expect(await counts()).toEqual({ notes: 1, outbox: 1 });
    });

    it('AC-5.1: откат после add — ни note, ни строки', async () => {
        await expect(
            db.transaction(ctx('acme'), async (tx) => {
                await tx.execute(
                    sql`insert into kit.note (id, tenant, body) values ('n1', 'acme', 'x')`,
                );
                await store.add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'n1', title: 'T' },
                });
                throw new Error('откат');
            }),
        ).rejects.toThrow('откат');

        expect(await counts()).toEqual({ notes: 0, outbox: 0 });
    });

    it('AC-5.1: текст ошибки называет путь title, без значения', async () => {
        const error: unknown = await db
            .transaction(ctx('acme'), (tx) =>
                store.add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'секрет-123', title: 42 as unknown as string },
                }),
            )
            .catch((reason: unknown) => reason);

        expect(String(error)).toContain('title');
        expect(String(error)).not.toContain('секрет-123');
        expect(String(error)).not.toContain('42');
    });

    it('§3.4: OutboxStore.add в транзакции Db.read → AfterCommitInReadOnlyError, строки outbox нет', async () => {
        await expect(
            db.read(ctx('acme'), (tx) =>
                store.add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'n1', title: 'T' },
                }),
            ),
        ).rejects.toThrow(AfterCommitInReadOnlyError);

        expect((await counts()).outbox).toBe(0);
    });
});
