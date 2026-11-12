// AC-4.17 (UC-12, prd.md §3.3 v1.23): обрыв соединения с БД во время `db migrate` (BEGIN, запрос миграции, COMMIT) и
// `db move-journal` (запрос) → JSON {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1, без необработанного исключения;
// незавершённая миграция не отмечена в журнале и не применена. Обрыв на COMMIT: COMMIT мог дойти до сервера — миграции и
// журнал применены вместе или не применены вместе, повтор migrate доводит до конца (KT-62). Обрыв — TcpProxy.blackholeOn
// по тексту запроса, без пауз.
import {
    cpSync,
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
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
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
const OWNER_PASSWORD = 'kitdrop-owner-password-1234';
const APP_PASSWORD = 'kitdrop-app-password-12345';
/** Миграций в фикстуре (meta/_journal.json). */
const MIGRATIONS = (
    JSON.parse(readFileSync(join(FIXTURE, 'meta', '_journal.json'), 'utf8')) as {
        entries: unknown[];
    }
).entries.length;

/** Копия миграций фикстуры с ролями и схемой kitdrop. */
function copyMigrations(target: string): void {
    cpSync(FIXTURE, target, { recursive: true });
    const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);

            return statSync(path).isDirectory() ? files(path) : [path];
        });
    for (const file of files(target)) {
        const text = readFileSync(file, 'utf8')
            .replaceAll('"kit_owner"', '"kitdrop_owner"')
            .replaceAll('"kit_app"', '"kitdrop_app"')
            .replaceAll('"kit_directory"', '"kitdrop_directory"')
            .replaceAll('"kit"', '"kitdrop"');
        writeFileSync(file, text);
    }
}

describe('UC-12: обрыв соединения в CLI db', () => {
    const database = uniqueName('ac417drop');
    const temp = mkdtempSync(join(tmpdir(), 'kit-ac417drop-'));
    const folder = join(temp, 'migrations');
    let owner: string;
    let proxy: TcpProxy;
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => void uncaught.push(error);

    async function db(args: readonly string[], url: string) {
        const lines: string[] = [];
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const code = await dbCommand(args, {
                cwd: temp,
                write: (line) => void lines.push(line),
                env: { LOG_LEVEL: 'silent', DATABASE_MIGRATOR_URL: url },
            });

            return { code, result: JSON.parse(lines.join('')) as Record<string, unknown> };
        } finally {
            spy.mockRestore();
        }
    }

    beforeAll(async () => {
        copyMigrations(folder);
        await createDatabase(database);
        const admin = databaseUrl(adminUrl(), { database });
        const prepared = await dbCommand(['prepare', '--service', 'kitdrop'], {
            cwd: temp,
            write: () => undefined,
            env: {
                LOG_LEVEL: 'silent',
                DATABASE_ADMIN_URL: admin,
                DB_OWNER_PASSWORD: OWNER_PASSWORD,
                DB_APP_PASSWORD: APP_PASSWORD,
            },
        });
        expect(prepared).toBe(0);
        owner = databaseUrl(adminUrl(), {
            database,
            user: 'kitdrop_owner',
            password: OWNER_PASSWORD,
        });
        process.on('uncaughtException', onUncaught);
    });

    afterAll(async () => {
        process.off('uncaughtException', onUncaught);
        await proxy?.close();
        rmSync(temp, { recursive: true, force: true });
        await dropServiceRoles('kitdrop', [database]);
        await dropDatabase(database);
    });

    /** Строк журнала kitdrop.__migrations (нет таблицы — 0) и есть ли таблица первой миграции. */
    async function migrationState(): Promise<{ journal: number; applied: boolean }> {
        const [state] = await adminQuery<{ journal: string | null; setting: string | null }>(
            owner,
            "select to_regclass('kitdrop.__migrations')::text as journal, to_regclass('kitdrop.setting')::text as setting",
        );
        const journal =
            state?.journal == null
                ? 0
                : ((
                      await adminQuery<{ count: number }>(
                          owner,
                          'select count(*)::int as count from kitdrop.__migrations',
                      )
                  )[0]?.count ?? 0);

        return { journal, applied: state?.setting != null };
    }

    it("AC-4.17: обрыв на BEGIN db migrate → {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1, без необработанного исключения; миграция не отмечена в журнале", async () => {
        proxy = await tcpProxy(owner);
        proxy.blackholeOn(/\bbegin\b/i);

        const run = await db(['migrate', '--folder', folder, '--schema', 'kitdrop'], proxy.url);

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
        expect(uncaught).toEqual([]);
        const journal = await adminQuery<{ count: number }>(
            owner,
            "select count(*)::int as count from information_schema.tables where table_schema = 'kitdrop' and table_name = '__migrations'",
        );
        const applied =
            journal[0]?.count === 1
                ? await adminQuery<{ count: number }>(
                      owner,
                      'select count(*)::int as count from kitdrop.__migrations',
                  )
                : [{ count: 0 }];
        expect(applied[0]?.count).toBe(0);
        await proxy.close();
    });

    it("AC-4.17: обрыв на запросе миграции db migrate → {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1, без необработанного исключения; миграция откатилась и не отмечена", async () => {
        proxy = await tcpProxy(owner);
        // Второй оператор первой миграции: таблица kitdrop.note той же транзакции уже создана.
        proxy.blackholeOn(/CREATE TABLE "kitdrop"\."setting"/);

        const run = await db(['migrate', '--folder', folder, '--schema', 'kitdrop'], proxy.url);

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
        expect(uncaught).toEqual([]);
        expect(await migrationState()).toEqual({ journal: 0, applied: false });
        const [note] = await adminQuery<{ note: string | null }>(
            owner,
            "select to_regclass('kitdrop.note')::text as note",
        );
        expect(note?.note).toBeNull();
        await proxy.close();
    });

    it("AC-4.17: обрыв на запросе db move-journal → {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1, без необработанного исключения; старый журнал на месте", async () => {
        await adminQuery(owner, 'CREATE SCHEMA IF NOT EXISTS drizzle');
        await adminQuery(
            owner,
            'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
        );
        await adminQuery(
            owner,
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('drop-a', 1)",
        );
        proxy = await tcpProxy(owner);
        proxy.blackholeOn(/INSERT INTO/);

        const run = await db(['move-journal', '--from', 'drizzle', '--to', 'kitdrop'], proxy.url);

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
        expect(uncaught).toEqual([]);
        const legacy = await adminQuery<{ count: number }>(
            owner,
            'select count(*)::int as count from drizzle.__drizzle_migrations',
        );
        expect(legacy[0]?.count).toBe(1);
    });

    it("AC-4.17: обрыв на COMMIT db migrate → {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1; миграции и журнал — вместе (все или ни одной), повтор migrate доводит до конца", async () => {
        proxy = await tcpProxy(owner);
        proxy.blackholeOn(/\bcommit\b/i);

        const run = await db(['migrate', '--folder', folder, '--schema', 'kitdrop'], proxy.url);
        await proxy.close();

        expect(run.code).toBe(1);
        expect(run.result).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
        expect(uncaught).toEqual([]);
        const after = await migrationState();
        // COMMIT мог дойти до сервера до обрыва: тогда применено всё, иначе — ничего; частичного состояния нет. На деле
        // TcpProxy передаёт пакет с COMMIT до обрыва — наблюдается «применено всё» (неоднозначный COMMIT), ветка «ничего»
        // здесь практически не выполняется.
        expect([
            { journal: 0, applied: false },
            { journal: MIGRATIONS, applied: true },
        ]).toContainEqual(after);

        const again = await db(['migrate', '--folder', folder, '--schema', 'kitdrop'], owner);

        expect(again.code).toBe(0);
        expect(again.result).toEqual({
            schema: 'kitdrop',
            applied: after.journal === 0 ? MIGRATIONS : 0,
        });
        expect(await migrationState()).toEqual({ journal: MIGRATIONS, applied: true });
    });
});
