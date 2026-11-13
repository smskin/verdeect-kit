// createOutboxTable, createInboxTable (prd.md §3.4, §6, AC-5.15). Эталон — O outbox.schema.ts, inbox.schema.ts; из I —
// nullable tenant (tenantNullable), тип tenant по tenantNullable — перегрузки (AC-5.21); по PRD §6 — subject_id вместо subject jsonb, id inbox — id события. Файл без pg и
// без ./peer.js: схему сервиса грузит drizzle-kit через require; проверку peer делает index.ts.
import { sql } from 'drizzle-orm';
import {
    bigint,
    getTableConfig,
    index,
    integer,
    jsonb,
    pgPolicy,
    text,
    timestamp,
    type PgSchema,
} from 'drizzle-orm/pg-core';
import {
    INBOX_TABLE,
    OUTBOX_POLICY,
    OUTBOX_POLICY_SQL,
    OUTBOX_TABLE,
} from '../internal/outbox-policy.js';
import { assertServiceName } from '../internal/service-name.js';

/** Опции `createOutboxTable`. */
export interface KitOutboxTableOptions {
    /** `true` — колонка `tenant` допускает NULL (события `tenant: 'none'`, роль Identity). По умолчанию `false`. */
    readonly tenantNullable?: boolean;
}

/** Колонка `tenant` без NOT NULL. */
type NullableTenantColumn = ReturnType<
    typeof text<'tenant', string, readonly [string, ...string[]]>
>;
/** Колонка `tenant` с NOT NULL. */
type TenantColumn = ReturnType<NullableTenantColumn['notNull']>;

/** Таблица outbox с колонкой `tenant` вида `TTenant`; DDL одинаков, отличается только тип `tenant`. */
function outboxTable<TTenant extends NullableTenantColumn | TenantColumn>(
    schema: PgSchema,
    tenant: TTenant,
) {
    return schema.table(
        OUTBOX_TABLE,
        {
            id: text('id').primaryKey(),
            seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
            tenant,
            type: text('type').notNull(),
            version: integer('version').notNull(),
            subjectId: text('subject_id').notNull(),
            actor: jsonb('actor').$type<Record<string, unknown>>().notNull(),
            traceId: text('trace_id').notNull(),
            data: jsonb('data').$type<Record<string, unknown>>().notNull(),
            occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
                .notNull()
                .defaultNow(),
            publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
            attempts: integer('attempts').notNull().default(0),
            lastError: text('last_error'),
        },
        (t) => [
            index('outbox_unpublished_seq_idx')
                .on(t.seq)
                .where(sql`${t.publishedAt} is null`),
            index('outbox_published_at_idx')
                .on(t.publishedAt)
                .where(sql`${t.publishedAt} is not null`),
            pgPolicy(OUTBOX_POLICY, {
                as: 'permissive',
                for: 'all',
                to: 'public',
                using: sql.raw(OUTBOX_POLICY_SQL),
                withCheck: sql.raw(OUTBOX_POLICY_SQL),
            }),
        ],
    );
}

/** Таблица outbox с `tenant NOT NULL`: select даёт `tenant: string`. */
export type KitOutboxTableStrict = ReturnType<typeof outboxTable<TenantColumn>>;

/** Таблица outbox с nullable `tenant`: select даёт `tenant: string | null`. */
export type KitOutboxTableNullable = ReturnType<typeof outboxTable<NullableTenantColumn>>;

/**
 * Таблица `<schema>.outbox` (§6): `id` (`evt_` + ULID), `seq` (identity, порядок публикации), `tenant`, `type`,
 * `version`, `subject_id`, `actor`, `trace_id`, `data`, `occurred_at`, `published_at`, `attempts`, `last_error`;
 * индексы неопубликованных по `seq` и опубликованных по `published_at`; политика `outbox_tenant_isolation` —
 * исключение строгой модели (пустой тенант видит все строки для relay и очистки). Сервис добавляет миграцией
 * `ALTER TABLE <schema>.outbox FORCE ROW LEVEL SECURITY` и `GRANT SELECT, INSERT, UPDATE, DELETE` роли `<svc>_app`.
 *
 * Без опций или с `tenantNullable: false` — `tenant NOT NULL`, select даёт `tenant: string` (AC-5.21).
 * @throws {TypeError} имя схемы вне `^[a-z][a-z0-9-]{1,31}$`.
 */
export function createOutboxTable(
    schema: PgSchema,
    options?: { readonly tenantNullable?: false },
): KitOutboxTableStrict;
/**
 * Таблица `<schema>.outbox` с nullable `tenant` (события `tenant: 'none'`, роль Identity): select даёт
 * `tenant: string | null` (AC-5.21).
 * @throws {TypeError} имя схемы вне `^[a-z][a-z0-9-]{1,31}$`.
 */
export function createOutboxTable(
    schema: PgSchema,
    options: { readonly tenantNullable: true },
): KitOutboxTableNullable;
export function createOutboxTable(
    schema: PgSchema,
    options: KitOutboxTableOptions = {},
): KitOutboxTable {
    assertServiceName(schema.schemaName, 'createOutboxTable');

    return options.tenantNullable === true
        ? outboxTable(schema, text('tenant'))
        : outboxTable(schema, text('tenant').notNull());
}

/**
 * Таблица `<schema>.inbox` (§6): `id` (PK, id события), `type`, `received_at`; индекс по `received_at` для очистки.
 * Без RLS (служебная). Сервис выдаёт миграцией `GRANT SELECT, INSERT, DELETE` роли `<svc>_app`.
 * @throws {TypeError} имя схемы вне `^[a-z][a-z0-9-]{1,31}$`.
 */
export function createInboxTable(schema: PgSchema) {
    assertServiceName(schema.schemaName, 'createInboxTable');

    return schema.table(
        INBOX_TABLE,
        {
            id: text('id').primaryKey(),
            type: text('type').notNull(),
            receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
                .notNull()
                .defaultNow(),
        },
        (t) => [index('inbox_received_at_idx').on(t.receivedAt)],
    );
}

/** Таблица outbox (`createOutboxTable`): объединение форм с `tenant` NOT NULL и nullable. */
export type KitOutboxTable = KitOutboxTableStrict | KitOutboxTableNullable;

/** Таблица inbox (`createInboxTable`). */
export type KitInboxTable = ReturnType<typeof createInboxTable>;

/** Колонка `tenant` таблицы outbox допускает NULL (`tenantNullable: true`). */
export function outboxTenantNullable(table: KitOutboxTable): boolean {
    return (
        getTableConfig(table).columns.find((column) => column.name === 'tenant')?.notNull !== true
    );
}
