// occurredAtColumn, ifNewer (prd.md §3.3, AC-4.13, UC-6): порядок по occurredAt — помощник обработчика, не поведение
// подписчика (inventory §4 п. 9). Файл без pg.
import { sql, type SQL } from 'drizzle-orm';
import { timestamp, type PgColumn } from 'drizzle-orm/pg-core';

/** Колонка времени последнего применённого события: `timestamp with time zone`, nullable. */
export function occurredAtColumn(name: string) {
    return timestamp(name, { withTimezone: true, mode: 'date' });
}

/**
 * Условие `WHERE` обновления: `(<column> IS NULL OR <column> < occurredAt)`. `rowCount` 0 — нормальный итог для
 * устаревшего события.
 */
export function ifNewer(column: PgColumn, occurredAt: Date): SQL {
    return sql`(${column} IS NULL OR ${column} < ${occurredAt})`;
}
