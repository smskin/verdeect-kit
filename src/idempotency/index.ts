// Точка входа @verdeect/kit/idempotency (prd.md §3.3а, E4): явный список экспортов. Первый импорт — ./peer.js: без pg
// ошибка AC-1.2 называет /idempotency (requirePeer синхронно, без top-level await — П15).
import './peer.js';

export { Idempotent } from './idempotent.decorator.js';
export { KitIdempotencyModule } from './kit-idempotency.module.js';
export type { KitIdempotencyModuleOptions } from './kit-idempotency.module.js';
export { createIdempotencyTable, idempotencyPurgeSql } from './table.js';
export type { KitIdempotencyTable } from './table.js';
export type { KitIdempotentOptions } from '../internal/metadata.js';
