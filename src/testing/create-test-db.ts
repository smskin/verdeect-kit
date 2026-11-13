// createTestDb (prd.md §3.8 v1.26–v1.27, UC-14, AC-4.19): Db на пулах как у KitDatabaseModule — вторая «реплика» теста
// сервиса (runExclusive с messagingCleanupLockKey). Пулы — buildPools из database/pools.ts без kit-database.module.ts
// (KT-77); pg и drizzle — динамически: /testing импортируется без pg (pools.js и pg.js не в статическом графе).
import { Logger } from '@nestjs/common';
import { Db } from '../database/db.js';
import { CONNECTION_TIMEOUT_MS } from '../database/timeouts.js';
import { assertServiceName } from '../internal/service-name.js';

/** Соединений в каждом пуле — умолчание `DB_POOL_MAX` (§3.1). */
const POOL_MAX = 10;

const logger = new Logger('createTestDb');

/** Результат `createTestDb`. */
export interface KitTestDb {
    /** `Db` на основном пуле и пуле чтения (read only, `statement_timeout` 5 с), как у `KitDatabaseModule`. */
    readonly db: Db;
    /** Закрывает оба пула. */
    close(): Promise<void>;
}

/**
 * Только для тестов сервиса: `Db` на собственных пулах (по 10 соединений, срок соединения
 * `KIT_DB_CONNECTION_TIMEOUT_MS`) — вторая «реплика», например чтобы держать
 * `runExclusive(db, messagingCleanupLockKey(schema))`, пока проверяется проход очистки приложения.
 * @param options.url адрес БД (обычно `inject('kitDatabaseUrl')`); не логируется.
 * @param options.service имя сервиса `^[a-z][a-z0-9-]{1,31}$` (в лог).
 * @throws {TypeError} `service` вне формата.
 */
export async function createTestDb(options: {
    readonly url: string;
    readonly service: string;
}): Promise<KitTestDb> {
    assertServiceName(options.service, 'createTestDb');
    const [{ buildPools }, { loadDrizzle }] = await Promise.all([
        import('../database/pools.js'),
        import('../database/pg.js'),
    ]);
    const pools = await buildPools({
        url: options.url,
        max: POOL_MAX,
        connectionTimeoutMs: CONNECTION_TIMEOUT_MS,
        log: {
            warn: (fields, message) => logger.warn(fields, message),
            debug: (fields, message) => logger.debug(fields, message),
        },
    });
    const db = new Db({ ...pools, drizzle: (await loadDrizzle()).drizzle });
    logger.debug({ service: options.service }, 'createTestDb: пулы созданы');

    return {
        db,
        close: async () => {
            await Promise.all([pools.main.end(), pools.read.end()]);
        },
    };
}
