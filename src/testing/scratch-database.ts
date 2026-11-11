// createScratchDatabase (prd.md §3.8, AC-4.18, UC-14): CREATE DATABASE … TEMPLATE <svc>_template; адреса — из inject
// (startTestStack). pg и vitest — loadPeer внутри функции: /testing импортируется без pg.
import { randomBytes } from 'node:crypto';
import type Pg from 'pg';
import type * as Vitest from 'vitest';
import { loadPeer } from '../internal/peer.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';

/** Пустая мигрированная БД теста (§3.8). */
export interface KitScratchDatabase {
    /** Имя БД `<svc>_s<8 hex>`. */
    readonly name: string;
    /** Роль приложения `<svc>_app`. */
    readonly url: string;
    /** Роль владельца `<svc>_owner`. */
    readonly ownerUrl: string;
    /** Суперпользователь. */
    readonly adminUrl: string;
    /** Удаляет БД (`WITH (FORCE)`); повторный вызов — без ошибки. */
    readonly drop: () => Promise<void>;
}

/** Шаблон занят другим копированием (`CREATE DATABASE … TEMPLATE`). */
const OBJECT_IN_USE = '55006';
const MAX_ATTEMPTS = 5;
const RETRY_STEP_MS = 50;

function withDatabase(base: string, database: string): string {
    const url = new URL(base);
    url.pathname = `/${database}`;

    return url.toString();
}

async function withClient(
    pg: typeof Pg,
    url: string,
    work: (client: Pg.Client) => Promise<void>,
): Promise<void> {
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => undefined);
    await client.connect();
    try {
        await work(client);
    } finally {
        await client.end();
    }
}

async function createFromTemplate(pg: typeof Pg, url: string, sql: string): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            await withClient(pg, url, async (client) => {
                await client.query(sql);
            });

            return;
        } catch (error) {
            if ((error as { code?: unknown }).code !== OBJECT_IN_USE || attempt >= MAX_ATTEMPTS) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, RETRY_STEP_MS * attempt));
        }
    }
}

function required(value: string | undefined): string {
    if (value === undefined) {
        throw new Error('createScratchDatabase: startTestStack({postgres: true}) не запускался');
    }

    return value;
}

/**
 * Пустая мигрированная БД из шаблона `startTestStack` за доли секунды (AC-4.18); права ролей сервиса выданы. Тест
 * сам вызывает `drop()` в `afterAll`/`afterEach`.
 * @throws {Error} `startTestStack({postgres: true})` не запускался (нет `kitDatabaseTemplate`).
 */
export async function createScratchDatabase(): Promise<KitScratchDatabase> {
    const { inject } = await loadPeer<typeof Vitest>('vitest', 'testing');
    const template = required(inject('kitDatabaseTemplate'));
    const service = required(inject('kitDatabaseService'));
    const postgresUrl = required(inject('kitPostgresUrl'));
    const appUrl = required(inject('kitDatabaseUrl'));
    const ownerUrl = required(inject('kitDatabaseOwnerUrl'));
    const adminUrl = required(inject('kitDatabaseAdminUrl'));
    const pg = (await loadPeer<{ default: typeof Pg }>('pg', 'testing')).default;
    const { grantDatabaseAccess } = await import('../database/prepare-database.js');
    const name = `${service}_s${randomBytes(4).toString('hex')}`;
    await createFromTemplate(
        pg,
        postgresUrl,
        `CREATE DATABASE ${quoteIdentifier(name)} TEMPLATE ${quoteIdentifier(template)}`,
    );
    await withClient(pg, postgresUrl, (client) => grantDatabaseAccess(client, service, name));

    return {
        name,
        url: withDatabase(appUrl, name),
        ownerUrl: withDatabase(ownerUrl, name),
        adminUrl: withDatabase(adminUrl, name),
        drop: () =>
            withClient(pg, postgresUrl, async (client) => {
                await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
            }),
    };
}
