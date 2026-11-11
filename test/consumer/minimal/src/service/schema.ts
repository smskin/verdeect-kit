// Схема БД сервиса-потребителя (AC-9.1, AC-4.8, AC-4.14): таблица компании под строгим RLS и таблица идемпотентности.
// SQL генерирует drizzle-kit (drizzle/); FORCE, права и функцию очистки — SQL-миграция 0001.
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { tenantColumn, tenantPolicy } from '@verdeect/kit/database';
import { createIdempotencyTable } from '@verdeect/kit/idempotency';

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
