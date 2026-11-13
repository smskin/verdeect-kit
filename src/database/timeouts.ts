// Сроки соединений /database (prd.md §3.3, §3.8 v1.26, AC-4.19): файл без peer — его реэкспортирует /testing
// (KIT_DB_CONNECTION_TIMEOUT_MS) без загрузки pg; pg.ts реэкспортирует для CLI, миграций и prepareDatabase.

/**
 * Срок установки соединения CLI, миграций, `prepareDatabase` и пулов `createTestDb`, мс (эталон O pool-options.ts).
 * В `/testing` — `KIT_DB_CONNECTION_TIMEOUT_MS`.
 */
export const CONNECTION_TIMEOUT_MS = 5000;
