// runMigrations, moveJournal (prd.md §3.3, AC-4.7, AC-4.17). Эталон — O migrator.ts: пул max 1, срок соединения 5 с,
// подсчёт применённых двумя запросами, транзакция миграций на выделенном клиенте. По PRD: журнал <schema>.__migrations,
// папка и схема — от сервиса; схема drizzle не создаётся.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import { CONNECTION_TIMEOUT_MS, loadDrizzle, loadPg } from './pg.js';
import type { Pool } from './pg.js';

/** Таблица журнала миграций в схеме сервиса. */
export const MIGRATIONS_TABLE = '__migrations';

/** Журнал drizzle-kit по умолчанию, который переносит `moveJournal`. */
const LEGACY_TABLE = '__drizzle_migrations';

/** Неверное использование (нет журнала drizzle-kit в папке); CLI переводит в код `USAGE`. */
export class KitUsageError extends Error {
    override readonly name = 'KitUsageError';
}

/** Параметры `runMigrations` (prd.md §3.3). */
export interface KitRunMigrationsOptions {
    /** Адрес БД под ролью владельца `<svc>_owner`. */
    readonly url: string;
    /** Папка миграций drizzle-kit (с `meta/_journal.json`). */
    readonly folder: string;
    /** Схема сервиса — и схема журнала `<schema>.__migrations`. */
    readonly schema: string;
}

/** Параметры `moveJournal`. */
export interface KitMoveJournalOptions {
    /** Адрес БД под ролью владельца. */
    readonly url: string;
    /** Схема старого журнала `<from>.__drizzle_migrations` (обычно `drizzle`). */
    readonly from: string;
    /** Схема сервиса — журнал назначения `<to>.__migrations`. */
    readonly to: string;
}

function journalName(schema: string, table: string): string {
    return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

async function countApplied(pool: Pool, schema: string): Promise<number> {
    const journal = journalName(schema, MIGRATIONS_TABLE);
    // Две команды: PostgreSQL разбирает подзапрос до вычисления CASE — отсутствующая таблица даёт 42P01.
    const exists = await pool.query<{ exists: boolean }>(
        'select to_regclass($1) is not null as exists',
        [journal],
    );
    if (exists.rows[0]?.exists !== true) {
        return 0;
    }
    const { rows } = await pool.query<{ count: number }>(
        `select count(*)::int as count from ${journal}`,
    );

    return rows[0]?.count ?? 0;
}

async function openPool(url: string): Promise<Pool> {
    const pg = await loadPg();
    const pool = new pg.Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    // Обрыв простаивающего клиента: pg-pool генерирует 'error' на пуле — без слушателя процесс упал бы.
    pool.on('error', () => undefined);

    return pool;
}

/**
 * Применяет SQL-миграции drizzle-kit из `folder` под ролью владельца; журнал — `<schema>.__migrations`.
 * Повтор — `{applied: 0}`.
 * @throws {TypeError} схема вне формата имени сервиса.
 * @throws {KitUsageError} в папке нет `meta/_journal.json`.
 */
export async function runMigrations(
    options: KitRunMigrationsOptions,
    logger?: Logger,
): Promise<{ readonly applied: number }> {
    assertServiceName(options.schema, 'runMigrations');
    if (!existsSync(join(options.folder, 'meta', '_journal.json'))) {
        throw new KitUsageError(`runMigrations: нет журнала drizzle-kit в ${options.folder}`);
    }
    const { drizzle, migrate } = await loadDrizzle();
    const pool = await openPool(options.url);
    try {
        const before = await countApplied(pool, options.schema);
        logger?.debug({ schema: options.schema, before }, 'runMigrations: применение');
        // Транзакция миграций — на выделенном клиенте: drizzle-orm 0.45.4 в transaction() над пулом выполняет BEGIN
        // вне try/finally — при обрыве на BEGIN клиент не возвращался бы и pool.end() висел (эталон O).
        const client = await pool.connect();
        let failure: Error | undefined;
        try {
            await migrate(drizzle(client), {
                migrationsFolder: options.folder,
                migrationsSchema: options.schema,
                migrationsTable: MIGRATIONS_TABLE,
            });
        } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            throw error;
        } finally {
            client.release(failure);
        }
        const applied = (await countApplied(pool, options.schema)) - before;
        logger?.info({ schema: options.schema, applied }, 'runMigrations: готово');

        return { applied };
    } finally {
        await pool.end();
    }
}

/**
 * Переносит журнал `<from>.__drizzle_migrations` в `<to>.__migrations` (строки, которых нет по `hash`), удаляет старый
 * журнал и пустую схему `<from>` — в одной транзакции. Повтор — `{moved: 0}`.
 * @throws {TypeError} схема вне формата или `from === to`.
 */
export async function moveJournal(
    options: KitMoveJournalOptions,
    logger?: Logger,
): Promise<{ readonly moved: number }> {
    assertServiceName(options.from, 'moveJournal');
    assertServiceName(options.to, 'moveJournal');
    if (options.from === options.to) {
        throw new TypeError('moveJournal: схемы from и to совпадают');
    }
    const source = journalName(options.from, LEGACY_TABLE);
    const target = journalName(options.to, MIGRATIONS_TABLE);
    const pool = await openPool(options.url);
    try {
        const client = await pool.connect();
        let failure: Error | undefined;
        try {
            await client.query('BEGIN');
            const exists = await client.query<{ exists: boolean }>(
                'select to_regclass($1) is not null as exists',
                [source],
            );
            if (exists.rows[0]?.exists !== true) {
                await client.query('COMMIT');
                logger?.info(
                    { from: options.from, to: options.to, moved: 0 },
                    'moveJournal: готово',
                );

                return { moved: 0 };
            }
            await client.query(
                `CREATE TABLE IF NOT EXISTS ${target} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
            );
            const inserted = await client.query(
                `INSERT INTO ${target} (hash, created_at) SELECT s.hash, s.created_at FROM ${source} s ` +
                    `WHERE NOT EXISTS (SELECT 1 FROM ${target} t WHERE t.hash = s.hash) ORDER BY s.created_at`,
            );
            const moved = inserted.rowCount ?? 0;
            await client.query(`DROP TABLE ${source}`);
            await client.query('SAVEPOINT drop_schema');
            try {
                await client.query(`DROP SCHEMA ${quoteIdentifier(options.from)}`);
                await client.query('RELEASE SAVEPOINT drop_schema');
            } catch (error) {
                // 2BP01: в схеме остались объекты — схема остаётся.
                if ((error as { code?: unknown }).code !== '2BP01') {
                    throw error;
                }
                await client.query('ROLLBACK TO SAVEPOINT drop_schema');
            }
            await client.query('COMMIT');
            logger?.info({ from: options.from, to: options.to, moved }, 'moveJournal: готово');

            return { moved };
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: unknown) => {
                failure = rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK');
            });
            throw error;
        } finally {
            client.release(failure);
        }
    } finally {
        await pool.end();
    }
}
