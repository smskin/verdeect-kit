// Схема фикстуры сервиса kit для уровня I (prd.md §3.3, AC-4.6–AC-4.8, AC-4.13): таблица компании под строгим RLS и
// таблица без тенанта, таблица идемпотентности (AC-4.14), outbox (tenantNullable) и inbox (§3.4, §6, E5). Миграции генерирует drizzle-kit (pnpm db:fixtures) — проверка SQL tenantPolicy.
import { integer, pgSchema, text, timestamp } from 'drizzle-orm/pg-core';
import { tenantColumn, tenantPolicy } from '../../../src/database/tenant.js';
import { createIdempotencyTable } from '../../../src/idempotency/table.js';
import { createInboxTable, createOutboxTable } from '../../../src/messaging/tables.js';

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

// Outbox с nullable tenant — события 'required' и 'none' (AC-5.15); импорт из tables.js — без проверки peer index.ts.
export const outbox = createOutboxTable(kit, { tenantNullable: true });

export const inbox = createInboxTable(kit);
