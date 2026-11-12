// AC-9.1 (UC-1): БД потребителя на упакованном архиве — startTestStack подготовил и мигрировал БД (drizzle-kit,
// idempotencyPurgeSql), роль приложения не владелец, строгий RLS схемы consumer (prd.md §3.3, §3.8).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newId } from '@verdeect/kit/database';
import { idempotencyPurgeSql } from '@verdeect/kit/idempotency';
import {
    assertAppRoleIsNotOwner,
    assertStrictTenantIsolation,
    createScratchDatabase,
    workerScope,
} from '@verdeect/kit/testing';
import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { consumer } from './service/schema.js';

const DRIZZLE = fileURLToPath(new URL('../drizzle', import.meta.url));

function provided(key: 'kitDatabaseUrl' | 'kitDatabaseAdminUrl'): string {
    const value = inject(key);
    if (value === undefined) {
        return expect.fail(`${key} не передан`);
    }

    return value;
}

async function query<T>(url: string, sql: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        return (await client.query(sql)).rows as T[];
    } finally {
        await client.end();
    }
}

describe('UC-1: БД потребителя', () => {
    it('AC-9.1: startTestStack подготовил и мигрировал БД — журнал consumer.__migrations, роли consumer_*', async () => {
        const admin = provided('kitDatabaseAdminUrl');
        const journal = await query<{ count: number }>(
            admin,
            'select count(*)::int as count from consumer.__migrations',
        );
        const roles = await query<{ rolname: string }>(
            admin,
            "select rolname from pg_roles where rolname like 'consumer\\_%' order by rolname",
        );

        expect(journal[0]?.count).toBe(5);
        expect(roles.map((row) => row.rolname)).toEqual([
            'consumer_app',
            'consumer_directory',
            'consumer_owner',
        ]);
    });

    it('AC-9.1: assertAppRoleIsNotOwner проходит под kitDatabaseUrl', async () => {
        const client = new pg.Client({ connectionString: provided('kitDatabaseUrl') });
        await client.connect();
        try {
            await assertAppRoleIsNotOwner(client);
        } finally {
            await client.end();
        }
    });

    it("AC-9.1: assertStrictTenantIsolation({schema: 'consumer'}) проходит после вставки строк двух компаний", async () => {
        await query(
            provided('kitDatabaseAdminUrl'),
            `insert into consumer.company (id, tenant, name) values
             ('${newId('cmp')}', '${workerScope().tenant}', 'Первая'), ('${newId('cmp')}', 'globex', 'Вторая')`,
        );
        const pool = new pg.Pool({ connectionString: provided('kitDatabaseUrl'), max: 2 });
        try {
            await assertStrictTenantIsolation(pool, { schema: 'consumer' });
        } finally {
            await pool.end();
        }
    });

    it('AC-9.1: 0005_idempotency_purge_v125.sql (поверх 0001) содержит idempotencyPurgeSql(consumer) без изменений', () => {
        const file = readdirSync(DRIZZLE).find((name) => name.startsWith('0005_'));

        expect(file).toBe('0005_idempotency_purge_v125.sql');
        expect(readFileSync(`${DRIZZLE}/${String(file)}`, 'utf8')).toContain(
            idempotencyPurgeSql(consumer),
        );
    });

    it('AC-9.1: createScratchDatabase — пустая мигрированная БД, drop()', async () => {
        const scratch = await createScratchDatabase();
        try {
            const rows = await query<{ count: number }>(
                scratch.adminUrl,
                'select count(*)::int as count from consumer.company',
            );
            expect(rows[0]?.count).toBe(0);
        } finally {
            await scratch.drop();
        }
    });

    it("AC-9.1: newId('cmp') по формату", () => {
        expect(newId('cmp')).toMatch(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/);
    });
});
