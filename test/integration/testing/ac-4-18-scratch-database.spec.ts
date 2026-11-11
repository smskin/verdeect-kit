// AC-4.18 (UC-14): startTestStack готовит и мигрирует БД kit, createScratchDatabase — пустая мигрированная БД из шаблона
// за < 1 с (prd.md §3.8). Шаблон и роли — globalSetup пакета (service: 'kit', migrations — фикстура).
import { readdirSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, expect, inject, it } from 'vitest';
import { createScratchDatabase } from '../../../src/testing/scratch-database.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { adminQuery } from '../../support/postgres.js';

const MIGRATIONS = fileURLToPath(new URL('../../fixtures/database/migrations', import.meta.url));

describe('UC-14: пустая БД из шаблона', () => {
    it('AC-4.18: kitDatabaseUrl, kitDatabaseOwnerUrl, kitDatabaseAdminUrl, kitDatabaseService, kitDatabaseTemplate переданы через provide', () => {
        expect(inject('kitDatabaseUrl')).toMatch(/^postgres:\/\/kit_app:[0-9a-f]{32}@.+\/kit$/);
        expect(inject('kitDatabaseOwnerUrl')).toMatch(
            /^postgres:\/\/kit_owner:[0-9a-f]{32}@.+\/kit$/,
        );
        expect(inject('kitDatabaseAdminUrl')).toMatch(/^postgres:\/\/postgres:.+\/kit$/);
        expect(inject('kitDatabaseService')).toBe('kit');
        expect(inject('kitDatabaseTemplate')).toBe('kit_template');
    });

    it('AC-4.18: БД kit подготовлена и мигрирована — журнал kit.__migrations, таблицы note, setting и idempotency_key, FORCE RLS у note и idempotency_key', async () => {
        const tables = await adminQuery<{ relname: string; force: boolean }>(
            String(inject('kitDatabaseAdminUrl')),
            `select c.relname, c.relforcerowsecurity as force from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'kit' and c.relkind = 'r' order by c.relname`,
        );

        expect(tables).toEqual([
            { relname: '__migrations', force: false },
            { relname: 'idempotency_key', force: true },
            { relname: 'note', force: true },
            { relname: 'setting', force: false },
        ]);
    });

    it('AC-4.18: первая строка 0000_*.sql фикстуры — CREATE SCHEMA IF NOT EXISTS "kit"', () => {
        const first = readdirSync(MIGRATIONS).find((name) => name.startsWith('0000_'));
        expect(first).toBeDefined();
        const text = readFileSync(`${MIGRATIONS}/${String(first)}`, 'utf8');

        expect(text.split('\n')[0]).toBe('CREATE SCHEMA IF NOT EXISTS "kit";');
    });

    it('AC-4.18: createScratchDatabase — пустая мигрированная БД за < 1 с', async () => {
        const started = performance.now();
        const scratch = await createScratchDatabase();
        const elapsed = performance.now() - started;
        try {
            expect(elapsed).toBeLessThan(1000 * TEST_TIMEOUT_SCALE);
            const [count] = await adminQuery<{ count: number }>(
                scratch.adminUrl,
                'select count(*)::int as count from kit.note',
            );
            expect(count?.count).toBe(0);
        } finally {
            await scratch.drop();
        }
    });

    it('AC-4.18: роль kit_app подключается к пустой БД, drop() удаляет её, повторный drop() — без ошибки', async () => {
        const scratch = await createScratchDatabase();
        const [row] = await adminQuery<{ user: string; db: string }>(
            scratch.url,
            'select current_user as user, current_database() as db',
        );
        expect(row).toEqual({ user: 'kit_app', db: scratch.name });

        await scratch.drop();
        await scratch.drop();
        const exists = await adminQuery(
            String(inject('kitPostgresUrl')),
            'select 1 from pg_database where datname = $1',
            [scratch.name],
        );
        expect(exists).toEqual([]);
    });

    it('AC-4.18: два одновременных createScratchDatabase — обе БД созданы', async () => {
        const [a, b] = await Promise.all([createScratchDatabase(), createScratchDatabase()]);
        try {
            expect(a.name).not.toBe(b.name);
            const names = await adminQuery<{ datname: string }>(
                String(inject('kitPostgresUrl')),
                'select datname from pg_database where datname = any($1)',
                [[a.name, b.name]],
            );
            expect(names).toHaveLength(2);
        } finally {
            await Promise.all([a.drop(), b.drop()]);
        }
    });
});
