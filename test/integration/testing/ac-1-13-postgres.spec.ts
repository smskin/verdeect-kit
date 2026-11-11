// AC-1.13 (UC-14): startTestStack({postgres: true}) — PostgreSQL TEST_IMAGES.postgres раз на прогон, адрес через provide,
// подготовка БД — E4 (AC-4.18) (prd.md §3.8). Контейнер поднимает globalSetup пакета (service: 'kit').
import pg from 'pg';
import { describe, expect, inject, it, vi } from 'vitest';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';
import { runningImages } from '../../support/docker.js';

async function query<T>(sql: string, url = inject('kitPostgresUrl')): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
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

    it('AC-1.13: startTestStack({postgres: true}) без migrations — роли kitnomig_* и схема kitnomig есть, таблиц в схеме нет', async () => {
        const provided = new Map<string, unknown>();
        const project = {
            provide: vi.fn((key: string, value: unknown) => provided.set(key, value)),
        };

        const teardown = await startTestStack({ service: 'kitnomig', postgres: true })(
            project as never,
        );
        try {
            const url = String(provided.get('kitDatabaseAdminUrl'));
            const roles = await query<{ rolname: string }>(
                "select rolname from pg_roles where rolname like 'kitnomig\\_%' order by rolname",
                url,
            );
            expect(roles.map((row) => row.rolname)).toEqual([
                'kitnomig_app',
                'kitnomig_directory',
                'kitnomig_owner',
            ]);
            const schemas = await query<{ nspname: string }>(
                "select nspname from pg_namespace where nspname = 'kitnomig'",
                url,
            );
            expect(schemas).toHaveLength(1);
            const tables = await query<{ relname: string }>(
                "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'kitnomig'",
                url,
            );
            expect(tables).toEqual([]);
        } finally {
            await teardown();
        }
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
