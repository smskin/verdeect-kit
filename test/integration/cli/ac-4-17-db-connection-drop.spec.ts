// AC-4.17 (UC-12, prd.md §3.3 v1.23): обрыв соединения с БД во время `db migrate` и `db move-journal` (BEGIN, запрос
// миграции) → JSON {error: {code: 'DATABASE_UNAVAILABLE'}}, код 1, без необработанного исключения; незавершённая
// миграция не отмечена в журнале. Обрыв — TcpProxy.blackholeOn по тексту запроса, без пауз.
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
});
