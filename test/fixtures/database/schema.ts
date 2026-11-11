// Схема фикстуры сервиса kit для уровня I (prd.md §3.3, AC-4.6–AC-4.8, AC-4.13): таблица компании под строгим RLS и
// таблица без тенанта, таблица идемпотентности (AC-4.14). Миграции генерирует drizzle-kit (pnpm db:fixtures) — проверка SQL tenantPolicy.
import { integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { tenantColumn, tenantPolicy } from '../../../src/database/tenant.js';
import { createIdempotencyTable } from '../../../src/idempotency/table.js';

export const kit = pgSchema('kit');

export const note = kit.table(
    'note',
    {
        id: text('id').primaryKey(),
        tenant: tenantColumn(),
        body: text('body').notNull(),
        occurredAt: timestamp('occurred_at', { withTimezone: true }),
        counter: integer('counter').notNull().default(0),
    },
    (t) => [tenantPolicy(t.tenant)],
);

// global: настройки без тенанта — для readGlobal.
export const setting = kit.table('setting', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

// Таблица идемпотентности (§3.3а, §6); функция очистки — SQL-миграция 0003 (idempotencyPurgeSql).
export const idempotency = createIdempotencyTable(kit);
