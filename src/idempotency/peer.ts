// Первым импортом index.ts: без pg — текст AC-1.2 с /idempotency, раньше загрузки /database (prd.md §3.3а, NFR-3).
// Проверка синхронная, без top-level await: схему сервиса грузит drizzle-kit через require (ARCHITECTURE.md, П15).
import { requirePeer } from '../internal/peer.js';

requirePeer('pg', 'idempotency');
