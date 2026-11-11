// Схема БД сервиса-потребителя (AC-9.1, AC-4.8, AC-4.14, AC-5.12): таблица компании под строгим RLS, таблица
// идемпотентности, outbox и inbox (E5). SQL генерирует drizzle-kit (drizzle/); FORCE, права и функцию очистки — SQL-миграции
// 0001 и 0004.
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { tenantColumn, tenantPolicy } from '@verdeect/kit/database';
import { createIdempotencyTable } from '@verdeect/kit/idempotency';
import { createInboxTable, createOutboxTable } from '@verdeect/kit/messaging';

export const consumer = pgSchema('consumer');

export const company = consumer.table(
    'company',
    {
        id: text('id').primaryKey(),
        tenant: tenantColumn(),
        name: text('name').notNull(),
    },
    (t) => [tenantPolicy(t.tenant)],
);

export const idempotency = createIdempotencyTable(consumer);

export const outbox = createOutboxTable(consumer);

export const inbox = createInboxTable(consumer);
