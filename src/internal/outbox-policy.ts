// Имена таблиц сообщений и политика outbox (prd.md §3.4, §6, AC-4.8): общие для /messaging и /testing
// (assertStrictTenantIsolation, expectOutbox) — /testing не грузит /messaging (без amqplib).

/** Таблица outbox в схеме сервиса. */
export const OUTBOX_TABLE = 'outbox';

/** Таблица inbox в схеме сервиса. */
export const INBOX_TABLE = 'inbox';

/** Политика outbox. */
export const OUTBOX_POLICY = 'outbox_tenant_isolation';

/** Исключение строгой модели (§3.4, §6): пустой тенант — все строки (relay, очистка); иначе — только строки тенанта. */
export const OUTBOX_POLICY_SQL =
    "coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true)";

/**
 * Ключ блокировки `runExclusive` очистки outbox и inbox (§3.8 v1.27, AC-4.19): `verdeect-kit:messaging-cleanup:<schema>`.
 * @param schema схема таблиц outbox/inbox (обычно = имя сервиса).
 */
export function messagingCleanupLockKey(schema: string): string {
    return `verdeect-kit:messaging-cleanup:${schema}`;
}
