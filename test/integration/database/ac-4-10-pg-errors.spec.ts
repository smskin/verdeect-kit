// AC-4.10 (UC-4): распознавание ошибок pg по форме на настоящих ошибках драйвера (prd.md §3.3) — нарушение уникальности
// в глубоком cause и обрыв соединения tcpProxy.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isConnectionError, isUniqueViolation } from '../../../src/internal/pg-errors.js';
import { tcpProxy } from '../../../src/testing/tcp-proxy.js';
import { note } from '../../fixtures/database/schema.js';
import {
    appUrl,
    createTestDb,
    ctx,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';

describe('UC-4: ошибки pg', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb();
    });

    afterAll(async () => {
        await test.close();
    });

    beforeEach(async () => {
        await truncateFixtures();
    });

    it("AC-4.10: isUniqueViolation(err, 'note_pkey') — ошибка повтора id на глубине cause 3", async () => {
        const insert = () =>
            test.db.transaction(ctx('acme'), (tx) =>
                tx.insert(note).values({ id: 'dup', tenant: 'acme', body: 'x' }),
            );
        await insert();
        const original: unknown = await insert().catch((error: unknown) => error);
        const wrapped = new Error('use-case', {
            cause: new Error('service', { cause: original }),
        });

        expect(isUniqueViolation(wrapped, 'note_pkey')).toBe(true);
        expect(isUniqueViolation(wrapped, 'other')).toBe(false);
        expect(isConnectionError(wrapped)).toBe(false);
    });

    it('AC-4.10: isConnectionError — обрыв tcpProxy.break во время запроса', async () => {
        const proxy = await tcpProxy(appUrl());
        const broken = await createTestDb({ url: proxy.url });
        try {
            const error: unknown = await broken.db
                .transaction(ctx('acme'), async (tx) => {
                    await tx.execute(sql`select 1`);
                    await proxy.break();
                    await tx.execute(sql`select 1`);
                })
                .catch((caught: unknown) => caught);

            expect(isConnectionError(error)).toBe(true);
            expect(isUniqueViolation(error)).toBe(false);
        } finally {
            await broken.close();
            await proxy.close();
        }
    });
});
