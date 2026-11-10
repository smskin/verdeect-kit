// AC-1.13 (UC-14): startTestStack({postgres: true}) — PostgreSQL TEST_IMAGES.postgres раз на прогон, адрес через provide,
// без подготовки БД и миграций (prd.md §3.8, E1). Контейнер поднимает globalSetup пакета (service: 'kit').
import pg from 'pg';
import { describe, expect, inject, it, vi } from 'vitest';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';
import { runningImages } from '../../support/docker.js';

async function query<T>(sql: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: inject('kitPostgresUrl') });
    await client.connect();
    try {
        return (await client.query(sql)).rows as T[];
    } finally {
        await client.end();
    }
}

describe('UC-14: PostgreSQL тестового контура', () => {
    it('AC-1.13: kitPostgresUrl передан через provide, PostgreSQL 17.11 отвечает', async () => {
        expect(inject('kitPostgresUrl')).toMatch(/^postgres:\/\/postgres:/);

        const [row] = await query<{ server_version: string }>('show server_version');

        expect(row?.server_version).toMatch(/^17\.11/);
    });

    it('AC-1.13: контейнер — образ TEST_IMAGES.postgres', async () => {
        expect(await runningImages('kit')).toContain(TEST_IMAGES.postgres);
    });

    it('AC-1.13: подготовки БД нет', async () => {
        const roles = await query<{ count: string }>(
            "select count(*) from pg_roles where rolname like '%\\_app'",
        );
        expect(Number(roles[0]?.count)).toBe(0);

        const schemas = await query<{ nspname: string }>(
            "select nspname from pg_namespace where nspname not in ('public', 'information_schema') and nspname not like 'pg\\_%'",
        );
        expect(schemas).toEqual([]);
    });

    it('AC-1.13: без флага postgres контейнер не стартует', async () => {
        const project = { provide: vi.fn() };

        const teardown = await startTestStack({ service: 'kit-no-pg', mailpit: false })(
            project as never,
        );

        expect(await runningImages('kit-no-pg')).toEqual([]);
        expect(project.provide).not.toHaveBeenCalledWith('kitPostgresUrl', expect.anything());
        await teardown();
    });
});
