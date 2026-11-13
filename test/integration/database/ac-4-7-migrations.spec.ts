// AC-4.7 (UC-1): runMigrations — журнал <schema>.__migrations, схема drizzle не создаётся, повтор — 0, дамп схемы
// сервиса переносится вместе с журналом; moveJournal (prd.md §3.3, §5.4). Перенос O ac-10-8-migrate.int-spec.ts и
// I migrations.int-spec.ts (повтор — applied: 0), обобщён на схему сервиса. Свои БД (пустая и createScratchDatabase), роли kit_* — globalSetup.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { KitUsageError, moveJournal, runMigrations } from '../../../src/database/migrations.js';
import { grantDatabaseAccess } from '../../../src/database/prepare-database.js';
import {
    createScratchDatabase,
    type KitScratchDatabase,
} from '../../../src/testing/scratch-database.js';
import {
    adminQuery,
    adminUrl,
    createDatabase,
    databaseUrl,
    dropDatabase,
    postgresContainerId,
    uniqueName,
} from '../../support/postgres.js';

const FOLDER = fileURLToPath(new URL('../../fixtures/database/migrations', import.meta.url));
/** Миграций фикстуры — из журнала drizzle-kit (не число в коде: фикстура растёт). */
const MIGRATION_COUNT = (
    JSON.parse(readFileSync(join(FOLDER, 'meta', '_journal.json'), 'utf8')) as {
        entries: unknown[];
    }
).entries.length;

describe('UC-1: миграции', () => {
    const database = uniqueName('ac47');
    const restored = uniqueName('ac47r');
    let ownerUrl: string;
    let scratch: KitScratchDatabase;

    /** Пустая БД с правами ролей kit_* globalSetup (без prepareDatabase: роли и пароли прогона не трогаются). */
    async function emptyDatabase(name: string, withSchema: boolean): Promise<string> {
        await createDatabase(name);
        const client = new pg.Client({ connectionString: adminUrl() });
        await client.connect();
        try {
            await grantDatabaseAccess(client, 'kit', name);
        } finally {
            await client.end();
        }
        if (withSchema) {
            await adminQuery(
                databaseUrl(adminUrl(), { database: name }),
                'CREATE SCHEMA kit AUTHORIZATION kit_owner',
            );
        }

        return databaseUrl(String(inject('kitDatabaseOwnerUrl')), { database: name });
    }

    async function schemas(url: string): Promise<string[]> {
        const rows = await adminQuery<{ nspname: string }>(
            url,
            "select nspname from pg_namespace where nspname in ('kit', 'drizzle') order by nspname",
        );

        return rows.map((row) => row.nspname);
    }

    async function seedLegacyJournal(hashes: readonly string[]): Promise<void> {
        await adminQuery(ownerUrl, 'CREATE SCHEMA IF NOT EXISTS drizzle');
        await adminQuery(
            ownerUrl,
            'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
        );
        for (const [index, hash] of hashes.entries()) {
            await adminQuery(
                ownerUrl,
                'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
                [hash, index + 1],
            );
        }
    }

    async function journalHashes(url = ownerUrl): Promise<string[]> {
        const rows = await adminQuery<{ hash: string }>(
            url,
            'select hash from kit.__migrations order by id',
        );

        return rows.map((row) => row.hash);
    }

    beforeAll(async () => {
        ownerUrl = await emptyDatabase(database, true);
        scratch = await createScratchDatabase();
    });

    afterAll(async () => {
        await scratch.drop();
        await dropDatabase(database);
        await dropDatabase(restored);
    });

    it('AC-4.7: runMigrations пишет журнал в kit.__migrations, схема drizzle не создаётся, applied = числу миграций', async () => {
        const result = await runMigrations({ url: ownerUrl, folder: FOLDER, schema: 'kit' });

        expect(result).toEqual({ applied: MIGRATION_COUNT });
        expect(await schemas(ownerUrl)).toEqual(['kit']);
        expect(await journalHashes()).toHaveLength(MIGRATION_COUNT);
    });

    it('AC-4.7: повторный runMigrations — applied: 0', async () => {
        expect(await runMigrations({ url: ownerUrl, folder: FOLDER, schema: 'kit' })).toEqual({
            applied: 0,
        });
    });

    it('AC-4.7: БД createScratchDatabase уже мигрирована — журнал kit.__migrations, runMigrations — applied: 0', async () => {
        expect(await journalHashes(scratch.ownerUrl)).toHaveLength(MIGRATION_COUNT);
        expect(
            await runMigrations({ url: scratch.ownerUrl, folder: FOLDER, schema: 'kit' }),
        ).toEqual({ applied: 0 });
        expect(await schemas(scratch.ownerUrl)).toEqual(['kit']);
    });

    it('AC-4.7: pg_dump -n kit + восстановление в пустую подготовленную БД + runMigrations — applied: 0', async () => {
        // Схему kit с владельцем kit_owner создаёт дамп.
        const restoredUrl = await emptyDatabase(restored, false);
        const container = await postgresContainerId('kit');
        const dump = execFileSync('docker', [
            'exec',
            container,
            'pg_dump',
            '-U',
            'postgres',
            '-n',
            'kit',
            database,
        ]);
        execFileSync(
            'docker',
            [
                'exec',
                '-i',
                container,
                'psql',
                '-U',
                'postgres',
                '-v',
                'ON_ERROR_STOP=1',
                '-q',
                '-d',
                restored,
            ],
            { input: dump, stdio: ['pipe', 'ignore', 'pipe'] },
        );

        expect(await runMigrations({ url: restoredUrl, folder: FOLDER, schema: 'kit' })).toEqual({
            applied: 0,
        });
        expect(await schemas(restoredUrl)).toEqual(['kit']);
    });

    it('AC-4.7: moveJournal переносит drizzle.__drizzle_migrations в kit.__migrations, схема drizzle удалена, повтор — moved: 0', async () => {
        const before = await journalHashes();
        await seedLegacyJournal(['legacy-a', 'legacy-b']);

        expect(await moveJournal({ url: ownerUrl, from: 'drizzle', to: 'kit' })).toEqual({
            moved: 2,
        });
        expect(await journalHashes()).toEqual([...before, 'legacy-a', 'legacy-b']);
        expect(await schemas(ownerUrl)).toEqual(['kit']);
        expect(await moveJournal({ url: ownerUrl, from: 'drizzle', to: 'kit' })).toEqual({
            moved: 0,
        });
    });

    it('AC-4.7: в журнале назначения строки не дублируются при совпадении hash', async () => {
        const before = await journalHashes();
        await seedLegacyJournal(['legacy-a', 'legacy-c']);

        expect(await moveJournal({ url: ownerUrl, from: 'drizzle', to: 'kit' })).toEqual({
            moved: 1,
        });
        expect(await journalHashes()).toEqual([...before, 'legacy-c']);
    });

    it('§3.3: папка без meta/_journal.json → Error с путём папки', async () => {
        const folder = fileURLToPath(new URL('../../fixtures/database', import.meta.url));

        await expect(runMigrations({ url: ownerUrl, folder, schema: 'kit' })).rejects.toThrow(
            new KitUsageError(`runMigrations: нет журнала drizzle-kit в ${folder}`),
        );
    });
});
