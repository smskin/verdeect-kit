// DbContext, tenantColumn, tenantPolicy (prd.md §3.3 v1.33, AC-4.8, AC-5.2, P0 — только строгий RLS). Эталон — O columns.ts
// tenantIsolation; I (пустой тенант видит всё) не переносится. Файл не импортирует pg: его грузит drizzle-kit со схемой.
import { sql } from 'drizzle-orm';
import { pgPolicy, text } from 'drizzle-orm/pg-core';
import type { PgColumn, PgPolicy } from 'drizzle-orm/pg-core';

/** Настройка сеанса с тенантом транзакции (`set_config('app.tenant', …, true)`). */
export const TENANT_SETTING = 'app.tenant';

/** Контекст операции с БД (prd.md §3.3): тенант, трассировка, субъект — поля `actor` конверта 01 §7.1. */
export interface DbContext {
    /** Тенант (компания) или `null` — операция без тенанта (системная, `readGlobal`). */
    readonly tenant: string | null;
    /** Идентификатор трассировки запроса. */
    readonly traceId: string;
    /**
     * Субъект операции. `OutboxStore.add` пишет копию как задана (§3.3 v1.33): `null` — `null`, незаданный ключ —
     * пропуск; пакет поля не удаляет и не дополняет.
     */
    readonly actor: {
        /** `client_id` служебного клиента или `null`. */
        readonly clientId?: string | null;
        /** Учётная запись пользователя или `null`. */
        readonly accountId?: string | null;
        /** Участник компании или `null`. */
        readonly memberId?: string | null;
        /** От чьего имени действует агент или служба, или `null`. */
        readonly onBehalfOf?: string | null;
        /** Канал: `http`, `system`, `agent` и т. п. */
        readonly channel: string;
    };
}

/**
 * Колонка тенанта `text not null` (по умолчанию имя `tenant`; проверки `assertStrictTenantIsolation` ищут `tenant`).
 * Nullable-тенант — только у `createIdempotencyTable` и outbox E5.
 */
export function tenantColumn(name = 'tenant') {
    return text(name).notNull();
}

/**
 * Строгая политика RLS `tenant_isolation`: `<column> = current_setting('app.tenant', true)` для чтения и записи.
 * SQL генерирует `drizzle-kit` сервиса. В сервисе нужна SQL-миграция
 * `ALTER TABLE <svc>.<таблица> FORCE ROW LEVEL SECURITY` и права `GRANT … TO <svc>_app` (README).
 */
export function tenantPolicy(column: PgColumn): PgPolicy {
    const condition = sql`${column} = current_setting('app.tenant', true)`;

    return pgPolicy('tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: condition,
        withCheck: condition,
    });
}
