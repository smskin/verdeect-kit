// createIdempotencyTable, idempotencyPurgeSql (prd.md §3.3а v1.14, §6, AC-4.8, AC-4.14). Эталон — O idempotency.schema.ts,
// 0002_functions.sql idempotency_purge. По PRD: tenant nullable, subject вместо actor, ответ с Location, политика
// IS NOT DISTINCT FROM nullif(…). Файл без pg: его грузит drizzle-kit со схемой сервиса.
import { sql } from 'drizzle-orm';
import {
    check,
    index,
    jsonb,
    pgPolicy,
    smallint,
    text,
    timestamp,
    unique,
    uuid,
    type PgSchema,
} from 'drizzle-orm/pg-core';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';

/** Имя таблицы идемпотентности в схеме сервиса. */
export const IDEMPOTENCY_TABLE = 'idempotency_key';

/** Имя функции очистки `SECURITY DEFINER` в схеме сервиса. */
export const PURGE_FUNCTION = 'idempotency_purge';

/** Уникальное ограничение области и ключа (`ON CONFLICT ON CONSTRAINT`). */
export const SCOPE_CONSTRAINT = 'idempotency_key_scope_key';

/** Разделитель операторов миграций Drizzle. */
const BREAKPOINT = '\n--> statement-breakpoint\n';

function defineTable(schema: PgSchema) {
    return schema.table(
        IDEMPOTENCY_TABLE,
        {
            tenant: text('tenant'),
            subject: text('subject').notNull(),
            key: text('key').notNull(),
            fingerprint: text('fingerprint').notNull(),
            // Метка попытки, захватившей строку: ответ пишет только она (KT-22 п. 3).
            attempt: uuid('attempt').notNull().defaultRandom(),
            state: text('state').notNull().default('in_progress'),
            responseStatus: smallint('response_status'),
            responseBody: jsonb('response_body'),
            responseLocation: text('response_location'),
            createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        },
        (t) => [
            // PK по nullable-колонке невозможен: область и ключ — уникальное ограничение NULLS NOT DISTINCT (PG ≥ 15).
            unique(SCOPE_CONSTRAINT).on(t.tenant, t.subject, t.key).nullsNotDistinct(),
            index('idempotency_key_created_idx').on(t.createdAt),
            check('idempotency_key_state_check', sql`${t.state} IN ('in_progress', 'done')`),
            pgPolicy('idempotency_key_scope', {
                as: 'permissive',
                for: 'all',
                to: 'public',
                using: sql`${t.tenant} IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')`,
                withCheck: sql`${t.tenant} IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')`,
            }),
        ],
    );
}

/** Таблица идемпотентности сервиса (`createIdempotencyTable`). */
export type KitIdempotencyTable = ReturnType<typeof defineTable>;

/**
 * Таблица `idempotency_key` в схеме сервиса (§6): область (`tenant?`, `subject`), ключ, отпечаток запроса, метка
 * попытки `attempt` (ответ пишет только захватившая строку попытка), состояние,
 * сохранённый ответ (статус, тело, `Location`), время создания; RLS
 * `tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')`. SQL генерирует `drizzle-kit` сервиса;
 * `FORCE ROW LEVEL SECURITY`, права `<svc>_app` и функцию очистки (`idempotencyPurgeSql`) — SQL-миграция сервиса.
 */
export function createIdempotencyTable(schema: PgSchema): KitIdempotencyTable {
    return defineTable(schema);
}

/**
 * Текст SQL функции очистки `<схема>.idempotency_purge(batch integer)` для SQL-миграции сервиса (`drizzle-kit generate
 * --custom`): `SECURITY DEFINER`, владелец `<схема>_directory`, `search_path`, `REVOKE ALL … FROM PUBLIC`,
 * `GRANT EXECUTE … TO <схема>_app`; удаляет записи старше 24 ч пачкой. Без функции `KitIdempotencyModule` отказывает
 * при старте. Операторы разделены `--> statement-breakpoint`.
 * @throws {TypeError} имя схемы вне формата имени сервиса `^[a-z][a-z0-9-]{1,31}$`.
 */
export function idempotencyPurgeSql(schema: PgSchema): string {
    const name = schema.schemaName;
    assertServiceName(name, 'idempotencyPurgeSql');
    const s = quoteIdentifier(name);
    const table = `${s}.${quoteIdentifier(IDEMPOTENCY_TABLE)}`;
    const fn = `${s}.${quoteIdentifier(PURGE_FUNCTION)}`;
    const directory = quoteIdentifier(`${name}_directory`);
    const app = quoteIdentifier(`${name}_app`);

    return [
        `CREATE OR REPLACE FUNCTION ${fn}(batch integer) RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ${s}, pg_temp AS $$
DECLARE deleted integer;
BEGIN
    DELETE FROM ${table} i WHERE i.ctid IN (
        SELECT o.ctid FROM ${table} o
        WHERE o.created_at < now() - interval '24 hours' ORDER BY o.created_at LIMIT batch);
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END $$;`,
        `GRANT SELECT, DELETE ON ${table} TO ${directory};`,
        `GRANT CREATE ON SCHEMA ${s} TO ${directory};`,
        `ALTER FUNCTION ${fn}(integer) OWNER TO ${directory};`,
        `REVOKE CREATE ON SCHEMA ${s} FROM ${directory};`,
        `REVOKE ALL ON FUNCTION ${fn}(integer) FROM PUBLIC;`,
        `GRANT EXECUTE ON FUNCTION ${fn}(integer) TO ${app};`,
    ].join(BREAKPOINT);
}
