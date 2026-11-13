// pg и драйвер Drizzle для /database (prd.md §3.3, AC-1.2, NFR-3): requirePeer('pg', 'database') синхронно при импорте;
// pg, drizzle-orm/node-postgres и его migrator — ленивый import() (драйвер импортирует pg статически). Top-level await
// нет: drizzle-kit загружает схему сервиса через require (ARCHITECTURE.md «Правила зависимостей», П15).
import type * as DrizzleNodePg from 'drizzle-orm/node-postgres';
import type * as DrizzleMigrator from 'drizzle-orm/node-postgres/migrator';
import type Pg from 'pg';
import { requirePeer } from '../internal/peer.js';

requirePeer('pg', 'database');

export type { NodePgDatabase } from 'drizzle-orm/node-postgres';
export type { Pool, PoolClient, PoolConfig } from 'pg';

/** Модуль `pg` (значение по умолчанию: `Pool`, `Client`, `escapeLiteral`). */
export type PgModule = typeof Pg;

export { CONNECTION_TIMEOUT_MS } from './timeouts.js';

/** Драйвер и migrator Drizzle для node-postgres. */
export interface DrizzleDriver {
    /** `drizzle()` из `drizzle-orm/node-postgres`. */
    readonly drizzle: typeof DrizzleNodePg.drizzle;
    /** `migrate()` из `drizzle-orm/node-postgres/migrator`. */
    readonly migrate: typeof DrizzleMigrator.migrate;
}

let pgPromise: Promise<PgModule> | undefined;
let drizzlePromise: Promise<DrizzleDriver> | undefined;

/** Модуль `pg`, загружается один раз при первом вызове. */
export function loadPg(): Promise<PgModule> {
    pgPromise ??= import('pg').then((module) => module.default);

    return pgPromise;
}

/** Драйвер Drizzle (`drizzle`, `migrate`), загружается один раз при первом вызове. */
export function loadDrizzle(): Promise<DrizzleDriver> {
    drizzlePromise ??= Promise.all([
        import('drizzle-orm/node-postgres'),
        import('drizzle-orm/node-postgres/migrator'),
    ]).then(([driver, migrator]) => ({ drizzle: driver.drizzle, migrate: migrator.migrate }));

    return drizzlePromise;
}
