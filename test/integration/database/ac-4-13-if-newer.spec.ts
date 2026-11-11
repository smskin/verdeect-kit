// AC-4.13 (UC-6): ifNewer — обновление только событием новее сохранённого occurred_at (prd.md §3.3).
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ifNewer } from '../../../src/database/if-newer.js';
import { note } from '../../fixtures/database/schema.js';
import {
    adminQuery,
    createTestDb,
    ctx,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';

const SAVED = new Date('2026-11-10T10:00:00Z');

describe('UC-6: ifNewer', () => {
    let test: TestDb;

    async function apply(occurredAt: Date): Promise<number> {
        const result = await test.db.transaction(ctx('acme'), (tx) =>
            tx
                .update(note)
                .set({ body: 'новое', occurredAt })
                .where(and(eq(note.id, 'n1'), ifNewer(note.occurredAt, occurredAt))),
        );

        return result.rowCount ?? 0;
    }

    beforeAll(async () => {
        test = await createTestDb();
    });

    afterAll(async () => {
        await test.close();
    });

    beforeEach(async () => {
        await truncateFixtures();
    });

    it('AC-4.13: событие старее сохранённого occurred_at — updated: 0', async () => {
        await adminQuery(
            "insert into kit.note (id, tenant, body, occurred_at) values ('n1', 'acme', 'x', $1)",
            [SAVED],
        );

        expect(await apply(new Date('2026-11-10T09:00:00Z'))).toBe(0);
    });

    it('AC-4.13: новее — обновлено', async () => {
        await adminQuery(
            "insert into kit.note (id, tenant, body, occurred_at) values ('n1', 'acme', 'x', $1)",
            [SAVED],
        );

        expect(await apply(new Date('2026-11-10T11:00:00Z'))).toBe(1);
    });

    it('AC-4.13: occurred_at NULL — обновлено', async () => {
        await adminQuery("insert into kit.note (id, tenant, body) values ('n1', 'acme', 'x')");

        expect(await apply(SAVED)).toBe(1);
    });
});
