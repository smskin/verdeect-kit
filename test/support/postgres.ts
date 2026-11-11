// Помощники уровня I для PostgreSQL контура startTestStack (prd.md §3.3, §3.8): админ-запрос, БД теста, URL роли,
// контейнер для pg_dump. Имена БД — префикс файла и случайный суффикс: файлы не мешают друг другу.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { inject } from 'vitest';
import { TEST_IMAGES } from '../../src/testing/images.js';

const exec = promisify(execFile);

/** Адрес суперпользователя контура (`kitPostgresUrl`). */
export function adminUrl(): string {
    const url = inject('kitPostgresUrl');
    if (url === undefined) {
        throw new Error('kitPostgresUrl не передан: globalSetup без postgres');
    }

    return url;
}

/** Запрос коротким клиентом; строки результата. */
export async function adminQuery<T extends object = Record<string, unknown>>(
    url: string,
    sql: string,
    params: readonly unknown[] = [],
): Promise<T[]> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        return (await client.query<T>(sql, [...params])).rows;
    } finally {
        await client.end();
    }
}

/** Новый адрес на основе `base`: другая БД, пользователь, пароль. */
export function databaseUrl(
    base: string,
    target: { readonly database: string; readonly user?: string; readonly password?: string },
): string {
    const url = new URL(base);
    url.pathname = `/${target.database}`;
    if (target.user !== undefined) {
        url.username = target.user;
    }
    if (target.password !== undefined) {
        url.password = target.password;
    }

    return url.toString();
}

/** Имя БД теста: `<prefix>_<8 hex>`. */
export function uniqueName(prefix: string): string {
    return `${prefix}_${randomBytes(4).toString('hex')}`;
}

/** Создаёт БД на кластере контура. */
export async function createDatabase(name: string): Promise<void> {
    await adminQuery(adminUrl(), `CREATE DATABASE ${pg.escapeIdentifier(name)}`);
}

/** Удаляет БД, обрывая соединения. */
export async function dropDatabase(name: string): Promise<void> {
    await adminQuery(
        adminUrl(),
        `DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`,
    );
}

/** Удаляет роли сервиса во всех перечисленных БД (`DROP OWNED` в каждой, затем `DROP ROLE`). */
export async function dropServiceRoles(
    service: string,
    databases: readonly string[],
): Promise<void> {
    const roles = ['owner', 'app', 'directory'].map((kind) => `${service}_${kind}`);
    const existing = await adminQuery<{ rolname: string }>(
        adminUrl(),
        'select rolname from pg_roles where rolname = any($1)',
        [roles],
    );
    const names = existing.map((row) => pg.escapeIdentifier(row.rolname));
    if (names.length === 0) {
        return;
    }
    for (const database of databases) {
        await adminQuery(
            databaseUrl(adminUrl(), { database }),
            `DROP OWNED BY ${names.join(', ')} CASCADE`,
        );
    }
    await adminQuery(adminUrl(), `DROP ROLE ${names.join(', ')}`);
}

/** Идентификатор контейнера PostgreSQL контура по метке `verdeect.kit.service` и образу `TEST_IMAGES.postgres`. */
export async function postgresContainerId(service: string): Promise<string> {
    const { stdout } = await exec('docker', [
        'ps',
        '-q',
        '--filter',
        `label=verdeect.kit.service=${service}`,
        '--filter',
        `ancestor=${TEST_IMAGES.postgres}`,
    ]);
    const id = stdout.split('\n')[0]?.trim() ?? '';
    if (id === '') {
        throw new Error(`контейнер PostgreSQL сервиса ${service} не найден`);
    }

    return id;
}
