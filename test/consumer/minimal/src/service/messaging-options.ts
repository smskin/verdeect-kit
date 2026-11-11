// Опции KitMessagingModule сервиса-потребителя (AC-9.1; prd.md §3.4): один объект — AppModule и in-process тест
// messaging.spec.ts.
import type { KitMessagingModuleOptions } from '@verdeect/kit/messaging';
import { PUBLISHED_EVENTS } from './events.js';
import * as schema from './schema.js';

export const messagingOptions = {
    service: 'consumer',
    outbox: { table: schema.outbox, events: PUBLISHED_EVENTS },
    subscriber: { inbox: schema.inbox },
} satisfies KitMessagingModuleOptions;
