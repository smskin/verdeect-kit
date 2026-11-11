// Точка входа @verdeect/kit/database (prd.md §3.3, E4): явный список экспортов. Первый импорт — ./pg.js: без pg ошибка
// AC-1.2 при импорте подпути, раньше остальных модулей (requirePeer синхронно, без top-level await — П15).
import './pg.js';

export { deleteInBatches } from './batches.js';
export type { KitDeleteInBatchesOptions, KitDeleteInBatchesResult } from './batches.js';
export {
    AfterCommitInReadOnlyError,
    AfterCommitOutsideTransactionError,
    Db,
    TenantRequiredError,
} from './db.js';
export type { AfterCommitTask, DbReader, DbTx } from './db.js';
export { ifNewer, occurredAtColumn } from './if-newer.js';
export { DRIZZLE, DRIZZLE_READ, KitDatabaseModule } from './kit-database.module.js';
export type { KitDatabaseModuleOptions } from './kit-database.module.js';
export { runMigrations } from './migrations.js';
export type { KitRunMigrationsOptions } from './migrations.js';
export { prepareDatabase } from './prepare-database.js';
export type { KitPrepareDatabaseOptions, KitPrepareDatabaseResult } from './prepare-database.js';
export { runExclusive } from './run-exclusive.js';
export { tenantColumn, tenantPolicy } from './tenant.js';
export type { DbContext } from './tenant.js';
export { newId, ulid } from '../internal/ids.js';
export { isConnectionError, isPoolTimeout, isUniqueViolation } from '../internal/pg-errors.js';
