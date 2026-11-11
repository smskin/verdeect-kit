// Проверка опционального peer /redis при загрузке подпути (prd.md NFR-3, AC-1.2; П15): без top-level await. Первый
// импорт index.ts — текст AC-1.2 называет /redis. Сам ioredis грузит client.ts динамическим import() в фабрике провайдера.
import { requirePeer } from '../internal/peer.js';

requirePeer('ioredis', 'redis');
