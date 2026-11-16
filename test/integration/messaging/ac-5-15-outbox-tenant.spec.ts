// AC-5.15 (UC-5, UC-6): признак tenant события при записи (prd.md §3.4 v1.33 стр. 129): 'none' — всегда null при любом
// тенанте транзакции, явный tenant у 'none' — TypeError; 'required' — tenant вызова или тенант DbContext, пусто — TypeError,
// явный ≠ непустого тенанта транзакции — TypeError; ошибка до записи откатывает транзакцию.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestAccountTouched,
    TestNoteCreated,
    createOutboxApp,
    outboxRows,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-5: признак tenant при записи', () => {
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        broker = await BrokerClient.connect();
        app = await createOutboxApp();
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    beforeEach(truncateFixtures);

    it("AC-5.15: 'required' без тенанта в DbContext — TypeError, строки домена нет", async () => {
        await expect(
            app.get(Db).transaction(ctx(null), async (tx) => {
                await tx.execute(sql`insert into kit.setting (key, value) values ('k', 'v')`);
                await app.get(OutboxStore).add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'n1', title: 'T' },
                });
            }),
        ).rejects.toThrow(/требует компанию/);

        expect(await adminQuery('select 1 from kit.setting')).toHaveLength(0);
        expect(await outboxRows()).toHaveLength(0);
    });

    /** Транзакция с изменением домена и `add`; ожидается TypeError, ни строки домена, ни outbox. */
    async function expectRejected(
        tenant: string | null,
        add: (store: OutboxStore, tx: Parameters<OutboxStore['add']>[0]) => Promise<string>,
        message: RegExp,
    ): Promise<void> {
        await expect(
            app.get(Db).transaction(ctx(tenant), async (tx) => {
                await tx.execute(sql`insert into kit.setting (key, value) values ('k', 'v')`);
                await add(app.get(OutboxStore), tx);
            }),
        ).rejects.toThrow(message);

        expect(await adminQuery('select 1 from kit.setting')).toHaveLength(0);
        expect(await outboxRows()).toHaveLength(0);
    }

    /** `add` события компании в транзакции `tenant` и tenant вызова `explicit`; строка и конверт. */
    async function addNote(
        tenant: string | null,
        explicit: string,
    ): Promise<{ row: unknown; envelope: unknown }> {
        const captured = await broker.capture('kit.note.#');
        await app.get(Db).transaction(ctx(tenant), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'T' },
                tenant: explicit,
            }),
        );
        await waitUntil(() => captured.length === 1, 'одно сообщение');

        return { row: (await outboxRows())[0]?.tenant, envelope: captured[0]?.body['tenant'] };
    }

    it("AC-5.15: 'none' в транзакции с тенантом acme → строка и конверт tenant: null", async () => {
        const captured = await broker.capture('kit.account.#');
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestAccountTouched, {
                subjectId: 'a1',
                data: { accountId: 'a1' },
            }),
        );
        await waitUntil(() => captured.length === 1, 'одно сообщение');

        expect((await outboxRows())[0]?.tenant).toBeNull();
        expect(captured[0]?.body['tenant']).toBeNull();
    });

    it("AC-5.15: 'none' с явным tenant → TypeError, откат (строки домена нет)", async () => {
        for (const tenant of [null, 'acme']) {
            for (const explicit of ['acme', '']) {
                await expectRejected(
                    tenant,
                    (store, tx) =>
                        store.add(tx, TestAccountTouched, {
                            subjectId: 'a1',
                            data: { accountId: 'a1' },
                            tenant: explicit,
                        }),
                    /без компании \(tenant: 'none'\) — tenant вызова не задаётся/,
                );
            }
        }
    });

    it("AC-5.15: 'required' с явным slug acme в транзакции с пустым тенантом → строка и конверт tenant: acme", async () => {
        expect(await addNote(null, 'acme')).toEqual({ row: 'acme', envelope: 'acme' });
    });

    it("AC-5.15: 'required' с явным чужим slug other в транзакции acme → TypeError до записи, откат", async () => {
        await expectRejected(
            'acme',
            (store, tx) =>
                store.add(tx, TestNoteCreated, {
                    subjectId: 'n1',
                    data: { noteId: 'n1', title: 'T' },
                    tenant: 'other',
                }),
            /tenant вызова не совпадает с тенантом транзакции/,
        );
    });

    it("AC-5.15: 'required' с явным acme в транзакции acme → tenant: acme", async () => {
        expect(await addNote('acme', 'acme')).toEqual({ row: 'acme', envelope: 'acme' });
    });

    it("AC-5.15: 'required' с tenant: '' → TypeError, откат", async () => {
        for (const tenant of [null, 'acme']) {
            await expectRejected(
                tenant,
                (store, tx) =>
                    store.add(tx, TestNoteCreated, {
                        subjectId: 'n1',
                        data: { noteId: 'n1', title: 'T' },
                        tenant: '',
                    }),
                /tenant вызова пуст/,
            );
        }
    });

    it("AC-5.15: 'none' без тенанта при tenantNullable: true — строка tenant = null, конверт tenant: null", async () => {
        const captured = await broker.capture('kit.account.#');
        await app.get(Db).transaction(ctx(null, 'system'), (tx) =>
            app.get(OutboxStore).add(tx, TestAccountTouched, {
                subjectId: 'a1',
                data: { accountId: 'a1' },
            }),
        );
        await waitUntil(() => captured.length === 1, 'одно сообщение');

        expect((await outboxRows())[0]?.tenant).toBeNull();
        expect(captured[0]?.body['tenant']).toBeNull();
    });
});
