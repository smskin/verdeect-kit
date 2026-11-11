// Точка входа @verdeect/kit/messaging (prd.md §3.4, E5): явный список экспортов. Первый импорт — ./peer.js: без amqplib
// или amqp-connection-manager ошибка AC-1.2 называет /messaging (requirePeer синхронно, без top-level await — П15).
import './peer.js';

export { defineEvent } from './define-event.js';
export type { KitEvent, KitEventTenant } from './define-event.js';
export { EnvelopeSchema } from './envelope.js';
export type { Envelope } from './envelope.js';
export { ExpectedMessageError, InvalidMessageError, MessagingStartupError } from './errors.js';
export { KitMessagingModule } from './kit-messaging.module.js';
export { OutboxStore } from './outbox-store.js';
export { KitSubscriber } from './subscriber.js';
export type { KitEventHandler, KitReplicaHandler } from './subscriber.js';
export type { KitMessagingModuleOptions } from './kit-messaging.module.js';
export { createInboxTable, createOutboxTable } from './tables.js';
export type { KitInboxTable, KitOutboxTable, KitOutboxTableOptions } from './tables.js';
