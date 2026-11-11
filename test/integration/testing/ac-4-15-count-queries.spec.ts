// AC-4.15 (UC-4, UC-14): countQueries — все запросы пула за время fn по порядку, клиенты восстановлены, onQuery на
// каждый запрос (review E4) (prd.md §3.8).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countQueries } from '../../../src/testing/count-queries.js';
import { createTestDb, ctx, type TestDb } from '../../support/database.js';

describe('UC-14: countQueries', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb({ poolMax: 1 });
    });

    afterAll(async () => {
        await test.close();
    });

    it('AC-4.15: transaction с одним запросом домена — count 4 (begin, set_config, запрос, commit), queries по порядку', async () => {
        const { result, count, queries } = await countQueries(test.main, () =>
            test.db.transaction(ctx('acme'), async (tx) => {
                await tx.execute(sql`select 42 as answer`);

                return 'ok';
            }),
        );

        expect(result).toBe('ok');
        expect(count).toBe(4);
        expect(queries[0]).toMatch(/^begin/);
        expect(queries[1]).toContain("set_config('app.tenant'");
        expect(queries[2]).toBe('select 42 as answer');
        expect(queries[3]).toBe('commit');
    });

    it('AC-4.15: запросы до вызова не считаются, методы клиентов восстановлены после', async () => {
        await test.main.query('select 1');

        const { count } = await countQueries(test.main, () => test.main.query('select 2'));
        const client = await test.main.connect();
        try {
            expect(count).toBe(1);
            expect(Object.hasOwn(client, 'query')).toBe(false);
        } finally {
            client.release();
        }
        const after = await countQueries(test.main, () => Promise.resolve());
        expect(after.count).toBe(0);
    });

    it('AC-4.15: onQuery получает текст каждого запроса по порядку', async () => {
        const seen: string[] = [];
        const { queries } = await countQueries(
            test.main,
            () =>
                test.db.transaction(ctx('acme'), async (tx) => {
                    await tx.execute(sql`select 7 as seven`);
                }),
            { onQuery: (text) => seen.push(text) },
        );

        expect(seen).toEqual(queries);
        expect(seen).toContain('select 7 as seven');
    });

    it('AC-4.15: исключение onQuery не прерывает запрос и пробрасывается после fn', async () => {
        let finished = false;
        await expect(
            countQueries(
                test.main,
                async () => {
                    await test.main.query('select 1');
                    finished = true;
                },
                {
                    onQuery: () => {
                        throw new Error('колбэк');
                    },
                },
            ),
        ).rejects.toThrow('колбэк');
        expect(finished).toBe(true);
    });
});
