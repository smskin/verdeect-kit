// createTestDb (prd.md §3.8 v1.26–v1.27, UC-14, AC-4.19): Db на пулах как у KitDatabaseModule — вторая «реплика» теста
// сервиса (runExclusive с messagingCleanupLockKey). Пулы — buildPools из database/pools.ts без kit-database.module.ts
// (KT-77); pg и drizzle — динамически: /testing импортируется без pg (pools.js и pg.js не в статическом графе). v1.28 —
// опция max и поле pools (те же пулы, что в db).
import { Logger } from '@nestjs/common';
import { Db } from '../database/db.js';
import type { KitPools } from '../database/pools.js';
import { CONNECTION_TIMEOUT_MS } from '../database/timeouts.js';
import { assertServiceName } from '../internal/service-name.js';

/** Соединений в каждом пуле — умолчание `DB_POOL_MAX` (§3.1). */
const POOL_MAX = 10;

const logger = new Logger('createTestDb');

/** Результат `createTestDb`. */
export interface KitTestDb {
    /** `Db` на основном пуле и пуле чтения (read only, `statement_timeout` 5 с), как у `KitDatabaseModule`. */
    readonly db: Db;
    /**
     * Те же `pg.Pool`, что внутри `db`: `main` — основной, `read` — чтения. Для `countQueries`, `totalCount`,
     * `waitingCount` и прямых запросов.
     */
    readonly pools: KitPools;
    /** Закрывает оба пула. */
    close(): Promise<void>;
}

/**
 * Только для тестов сервиса: `Db` на собственных пулах (по `max` соединений, срок установки соединения
 * `KIT_DB_CONNECTION_TIMEOUT_MS` — это не `DB_POOL_ACQUIRE_TIMEOUT_MS` пула приложения) — вторая «реплика», например
 * чтобы держать `runExclusive(db, messagingCleanupLockKey(schema))`, пока проверяется проход очистки приложения.
 * @param options.url адрес БД (обычно `inject('kitDatabaseUrl')`); не логируется.
 * @param options.service имя сервиса `^[a-z][a-z0-9-]{1,31}$` (в лог).
 * @param options.max соединений в каждом пуле, целое ≥ 1; умолчание 10.
 * @throws {TypeError} `service` вне формата или `max` не целое ≥ 1.
 */
export async function createTestDb(options: {
    readonly url: string;
    readonly service: string;
    readonly max?: number;
}): Promise<KitTestDb> {
    assertServiceName(options.service, 'createTestDb');
    const max = options.max ?? POOL_MAX;
    if (!Number.isInteger(max) || max < 1) {
        throw new TypeError('createTestDb: max — целое ≥ 1');
    }
    const [{ buildPools }, { loadDrizzle }] = await Promise.all([
        import('../database/pools.js'),
        import('../database/pg.js'),
    ]);
    const pools = await buildPools({
        url: options.url,
        max,
        connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
        log: {
            warn: (fields, message) => logger.warn(fields, message),
            debug: (fields, message) => logger.debug(fields, message),
        },
    });
    const db = new Db({ ...pools, drizzle: (await loadDrizzle()).drizzle });
    logger.debug({ service: options.service, max }, 'createTestDb: пулы созданы');

    return {
        db,
        pools,
        close: async () => {
            await Promise.all([pools.main.end(), pools.read.end()]);
        },
    };
}
