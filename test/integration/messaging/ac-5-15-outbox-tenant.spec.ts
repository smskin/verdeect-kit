// AC-5.15 (UC-5): признак tenant события при записи — 'required' без тенанта и 'none' с тенантом отклоняются до записи;
// 'none' без тенанта при tenantNullable: true — строка tenant = null, конверт tenant: null (prd.md §3.4).
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

    it("AC-5.15: 'none' с тенантом — TypeError, откат", async () => {
        await expect(
            app.get(Db).transaction(ctx('acme'), (tx) =>
                app.get(OutboxStore).add(tx, TestAccountTouched, {
                    subjectId: 'a1',
                    data: { accountId: 'a1' },
                }),
            ),
        ).rejects.toThrow(/без компании/);

        expect(await outboxRows()).toHaveLength(0);
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
