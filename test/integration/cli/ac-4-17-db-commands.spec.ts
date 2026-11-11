// AC-4.17 (UC-12): CLI verdeect-kit db prepare --service, migrate, move-journal — JSON в stdout, код выхода, ошибки без
// адресов и паролей (prd.md §3.3 v1.14). Перенос O run-cli db:prepare/migrate (формат — как у команды openapi, без ok).
// Обработчик вызывается в процессе с write и env (без vi.stubEnv); своя БД и сервис kitcli.
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbCommand } from '../../../src/cli/commands/db.js';
import {
    adminQuery,
    adminUrl,
    createDatabase,
    databaseUrl,
    dropDatabase,
    dropServiceRoles,
    uniqueName,
} from '../../support/postgres.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/database/migrations', import.meta.url));
const OWNER_PASSWORD = 'kitcli-owner-password-1234';
const APP_PASSWORD = 'kitcli-app-password-12345';

interface Run {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly result: Record<string, unknown>;
}

/** Копия миграций фикстуры с ролями и схемой kitcli. */
function copyMigrations(target: string): void {
    cpSync(FIXTURE, target, { recursive: true });
    const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);

            return statSync(path).isDirectory() ? files(path) : [path];
        });
    for (const file of files(target)) {
        const text = readFileSync(file, 'utf8')
            .replaceAll('"kit_owner"', '"kitcli_owner"')
            .replaceAll('"kit_app"', '"kitcli_app"')
            .replaceAll('"kit_directory"', '"kitcli_directory"')
            .replaceAll('"kit"', '"kitcli"');
        writeFileSync(file, text);
    }
}

describe('UC-12: CLI db', () => {
    const database = uniqueName('ac417');
    const temp = mkdtempSync(join(tmpdir(), 'kit-ac417-'));
    const folder = join(temp, 'migrations');
    let admin: string;
    let owner: string;

    async function db(args: readonly string[], env: Record<string, string>): Promise<Run> {
        const lines: string[] = [];
        const errors: string[] = [];
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            errors.push(String(chunk));

            return true;
        });
        try {
            const code = await dbCommand(args, {
                cwd: temp,
                write: (line) => void lines.push(line),
                env: { LOG_LEVEL: 'debug', ...env },
            });
            const stdout = lines.join('');

            return {
                code,
                stdout,
                stderr: errors.join(''),
                result: JSON.parse(stdout) as Record<string, unknown>,
            };
        } finally {
            spy.mockRestore();
        }
    }

    function prepareEnv(url = admin): Record<string, string> {
        return {
            DATABASE_ADMIN_URL: url,
            DB_OWNER_PASSWORD: OWNER_PASSWORD,
            DB_APP_PASSWORD: APP_PASSWORD,
        };
    }

    function migrateEnv(url = owner): Record<string, string> {
        return { DATABASE_MIGRATOR_URL: url };
    }

    function expectNoSecrets(run: Run, ...secrets: string[]): void {
        for (const secret of [OWNER_PASSWORD, APP_PASSWORD, ...secrets]) {
            expect(run.stdout).not.toContain(secret);
            expect(run.stderr).not.toContain(secret);
        }
    }

    beforeAll(async () => {
        copyMigrations(folder);
        await createDatabase(database);
        admin = databaseUrl(adminUrl(), { database });
        owner = databaseUrl(adminUrl(), {
            database,
            user: 'kitcli_owner',
            password: OWNER_PASSWORD,
        });
    });

    afterAll(async () => {
        rmSync(temp, { recursive: true, force: true });
        await dropServiceRoles('kitcli', [database]);
        await dropDatabase(database);
    });

    it('AC-4.17: db prepare --service kitcli — {database, roles, created} в stdout, код 0; повтор — created: []', async () => {
        const first = await db(['prepare', '--service', 'kitcli'], prepareEnv());

        expect(first.code).toBe(0);
        expect(first.result).toEqual({
            database,
            roles: ['kitcli_owner', 'kitcli_app', 'kitcli_directory'],
            created: ['kitcli_owner', 'kitcli_app', 'kitcli_directory'],
        });
        expectNoSecrets(first, new URL(admin).password);

        const second = await db(['prepare', '--service', 'kitcli'], prepareEnv());
        expect(second.code).toBe(0);
        expect(second.result).toMatchObject({ created: [] });
    });

    it("AC-4.17: db prepare без --service → {error: {code: 'USAGE'}}, код 1", async () => {
        const run = await db(['prepare'], prepareEnv());

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'USAGE' } });
    });

    it("AC-4.17: db prepare --service Kit_1 → {error: {code: 'USAGE'}}, код 1, значение флага не в выводе", async () => {
        const run = await db(['prepare', '--service', 'Kit_1'], prepareEnv());

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'USAGE' } });
        expect(run.stdout).not.toContain('Kit_1');
        expect(run.stderr).not.toContain('Kit_1');
    });

    it('AC-4.17: db prepare без DB_APP_PASSWORD → INVALID_ENVIRONMENT, keys содержит DB_APP_PASSWORD, значений нет', async () => {
        const env: Record<string, string> = prepareEnv();
        delete env.DB_APP_PASSWORD;
        const run = await db(['prepare', '--service', 'kitcli'], env);

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({
            error: {
                code: 'INVALID_ENVIRONMENT',
                keys: expect.arrayContaining(['DB_APP_PASSWORD']),
            },
        });
        expectNoSecrets(run);
    });

    it('AC-4.17: db prepare с недоступной БД (порт 1) → DATABASE_UNAVAILABLE, код 1; адрес, пароль и хост не в stdout и stderr', async () => {
        const unreachable = 'postgres://postgres:secret-pass-777@127.0.0.1:1/none';
        const run = await db(['prepare', '--service', 'kitcli'], prepareEnv(unreachable));

        expect(run.code).toBe(1);
        expect(run.result).toEqual({
            error: { code: 'DATABASE_UNAVAILABLE', message: 'БД недоступна' },
        });
        expectNoSecrets(run, 'secret-pass-777', '127.0.0.1', ':1/');
    });

    it("AC-4.17: db migrate --folder <копия фикстуры> --schema kitcli на подготовленной БД — {schema: 'kitcli', applied > 0}; повтор — applied: 0", async () => {
        const first = await db(
            ['migrate', '--folder', 'migrations', '--schema', 'kitcli'],
            migrateEnv(),
        );

        expect(first.code).toBe(0);
        expect(first.result).toMatchObject({ schema: 'kitcli' });
        expect(first.result.applied).toBeGreaterThan(0);
        expectNoSecrets(first);

        const second = await db(
            ['migrate', '--folder', folder, '--schema', 'kitcli'],
            migrateEnv(),
        );
        expect(second.result).toEqual({ schema: 'kitcli', applied: 0 });
    });

    it('AC-4.17: db migrate без --schema → USAGE; --folder без журнала → USAGE с путём папки', async () => {
        const noSchema = await db(['migrate', '--folder', folder], migrateEnv());
        expect(noSchema.code).toBe(1);
        expect(noSchema.result).toMatchObject({ error: { code: 'USAGE' } });

        const noJournal = await db(
            ['migrate', '--folder', '.', '--schema', 'kitcli'],
            migrateEnv(),
        );
        expect(noJournal.code).toBe(1);
        expect(noJournal.result).toMatchObject({
            error: { code: 'USAGE', message: expect.stringContaining(temp) },
        });
    });

    it('AC-4.17: db move-journal --from drizzle --to kitcli — {moved: 2}; повтор — moved: 0', async () => {
        await adminQuery(owner, 'CREATE SCHEMA drizzle');
        await adminQuery(
            owner,
            'CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
        );
        await adminQuery(
            owner,
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('cli-a', 1), ('cli-b', 2)",
        );

        const first = await db(
            ['move-journal', '--from', 'drizzle', '--to', 'kitcli'],
            migrateEnv(),
        );
        expect(first.code).toBe(0);
        expect(first.result).toEqual({ from: 'drizzle', to: 'kitcli', moved: 2 });

        const second = await db(
            ['move-journal', '--from', 'drizzle', '--to', 'kitcli'],
            migrateEnv(),
        );
        expect(second.result).toEqual({ from: 'drizzle', to: 'kitcli', moved: 0 });
    });

    it('AC-4.17: неверный пароль владельца → DB_COMMAND_FAILED с sqlState 28P01, без текста ошибки pg', async () => {
        const wrong = databaseUrl(owner, { database, password: 'wrong-password' });
        const run = await db(
            ['migrate', '--folder', folder, '--schema', 'kitcli'],
            migrateEnv(wrong),
        );

        expect(run.code).toBe(1);
        expect(run.result).toEqual({
            error: {
                code: 'DB_COMMAND_FAILED',
                message: 'команда db завершилась ошибкой',
                sqlState: '28P01',
            },
        });
        expect(run.stdout).not.toContain('kitcli_owner');
        expectNoSecrets(run, 'wrong-password');
    });

    it('AC-4.17: ошибка SQL миграции — DB_COMMAND_FAILED с sqlState из cause (DrizzleQueryError), без текста SQL', async () => {
        const broken = join(temp, 'broken');
        mkdirSync(join(broken, 'meta'), { recursive: true });
        writeFileSync(
            join(broken, 'meta', '_journal.json'),
            JSON.stringify({
                version: '7',
                dialect: 'postgresql',
                entries: [
                    {
                        idx: 0,
                        version: '7',
                        // Позже применённых миграций: drizzle применяет только более новые записи журнала.
                        when: 4_102_444_800_000,
                        tag: '0000_broken',
                        breakpoints: true,
                    },
                ],
            }),
        );
        writeFileSync(
            join(broken, '0000_broken.sql'),
            'SELECT * FROM kitcli.no_such_table_marker;',
        );

        const run = await db(['migrate', '--folder', broken, '--schema', 'kitcli'], migrateEnv());

        expect(run.code).toBe(1);
        expect(run.result).toEqual({
            error: {
                code: 'DB_COMMAND_FAILED',
                message: 'команда db завершилась ошибкой',
                sqlState: '42P01',
            },
        });
        expect(run.stdout + run.stderr).not.toContain('no_such_table_marker');
    });
});
