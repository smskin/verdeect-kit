// Проверка опциональных peer /messaging при загрузке подпути (prd.md NFR-3, AC-1.2; П15 E4): без top-level await.
// Первый импорт index.ts — текст AC-1.2 называет /messaging. Сами пакеты грузит rabbit-connection.ts при подключении.
import { requirePeer } from '../internal/peer.js';

requirePeer('amqplib', 'messaging');
requirePeer('amqp-connection-manager', 'messaging');
