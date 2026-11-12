// Keyset-пагинация (prd.md §3.5, AC-3.6). Эталон — I pagination.ts (encodeCursor, decodeCursor, pageOf, PageQuerySchema).
// По PRD: limit умолч. 100 (у I — 50), макс. 200; неверный курсор → 422 VALIDATION_FAILED path: cursor (у I — 400
// VALIDATION); ключи — JSON-скаляры, а не только строки; новое — afterCursor (условие Drizzle по ключам сортировки).
import { and, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError } from './errors.js';

/** Значение ключа сортировки в курсоре. */
export type CursorValue = string | number | boolean | null;

/** Параметры страницы `?cursor=&limit=`; списки расширяют схему своими фильтрами (`.extend`). */
export const PageQuerySchema = z.object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Ответ списка: `nextCursor = null` — страниц больше нет. */
export interface Page<T> {
    /** Строки страницы (не больше `limit`). */
    readonly items: T[];
    /** Курсор следующей страницы или `null`. */
    readonly nextCursor: string | null;
}

function invalidCursor(): DomainError {
    return new DomainError('VALIDATION_FAILED', { issues: [{ path: 'cursor', code: 'invalid' }] });
}

function isCursorValue(value: unknown): value is CursorValue {
    return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    );
}

/** Курсор — base64url от JSON-массива ключей последней строки; не подписан. */
export function encodeCursor(keys: readonly CursorValue[]): string {
    return Buffer.from(JSON.stringify(keys), 'utf8').toString('base64url');
}

/** `undefined` → `null`; неразборчивый курсор или другое число ключей → 422 `VALIDATION_FAILED` `path: cursor`. */
export function decodeCursor(cursor: string | undefined, arity: number): CursorValue[] | null {
    if (cursor === undefined) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw invalidCursor();
    }
    if (!Array.isArray(value) || value.length !== arity || !value.every(isCursorValue)) {
        throw invalidCursor();
    }

    return value;
}

/** Репозиторий читает `limit + 1` строк: лишняя строка есть → курсор по последней из `limit`. */
export function pageOf<T>(
    rows: readonly T[],
    limit: number,
    keyOf: (row: T) => readonly CursorValue[],
): Page<T> {
    if (rows.length <= limit) {
        return { items: [...rows], nextCursor: null };
    }
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return { items, nextCursor: last === undefined ? null : encodeCursor(keyOf(last)) };
}

/** Столбец `timestamp`/`timestamptz` Drizzle (режимы `date` и `string`). */
function timestampColumn(col: AnyColumn): { readonly withTimezone: boolean } | null {
    const { columnType, withTimezone } = col as AnyColumn & { withTimezone?: unknown };
    if (columnType !== 'PgTimestamp' && columnType !== 'PgTimestampString') {
        return null;
    }

    return { withTimezone: withTimezone === true };
}

/**
 * Ключ курсора по столбцу `timestamptz` без потери точности (§3.5, К23): строка ISO UTC с микросекундами
 * (`2026-11-13T10:00:00.123456Z`) — выбирается вместе со строками и передаётся в `pageOf(…, keyOf)`. JS `Date` хранит
 * миллисекунды: строки одной миллисекунды с разными микросекундами иначе пропускаются или повторяются.
 * @example
 * db.select({ ...getTableColumns(t), cursorAt: cursorTimestamp(t.updatedAt) })…
 * pageOf(rows, limit, (row) => [row.cursorAt, row.id]);
 * @throws {TypeError} столбец не `timestamp with time zone`.
 */
export function cursorTimestamp(col: AnyColumn): SQL<string> {
    if (timestampColumn(col)?.withTimezone !== true) {
        throw new TypeError(`cursorTimestamp: столбец ${col.name} — не timestamp with time zone`);
    }

    return sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Условие «после курсора» для `where`: `(c1, …, cn) > (v1, …, vn)` (`desc` — `<`) как ИЛИ-цепочка
 * `c1 > v1 OR (c1 = v1 AND c2 > v2) OR …`. `cursor = null` → `undefined` (первая страница). Последний столбец обязан
 * быть `primaryKey()` или `unique()` — иначе `Error` (ошибка разработчика). Длина курсора ≠ числу столбцов или `null`
 * в ключе → 422 `VALIDATION_FAILED` `path: cursor`. Значения передаются параметрами без кодировщика столбца; у столбца
 * timestamp значение приводится к `timestamptz`/`timestamp` и сравнивается полностью — ключ с микросекундами даёт
 * `cursorTimestamp` (строка ISO с миллисекундами из `Date.toISOString()` теряет микросекунды, К23).
 */
export function afterCursor(
    cols: readonly AnyColumn[],
    cursor: readonly CursorValue[] | null,
    dir: 'asc' | 'desc',
): SQL | undefined {
    const last = cols[cols.length - 1];
    if (last === undefined || (!last.primary && !last.isUnique)) {
        throw new Error('afterCursor: последний ключ сортировки должен быть уникальным');
    }
    if (cursor === null) {
        return undefined;
    }
    // Ограничение: null в ключе не поддержан — ключи сортировки keyset должны быть NOT NULL (README, «Пагинация»).
    if (cursor.length !== cols.length || cursor.includes(null)) {
        throw invalidCursor();
    }
    const op = dir === 'asc' ? sql.raw('>') : sql.raw('<');
    const value = (col: AnyColumn, raw: CursorValue): SQL => {
        const timestamp = timestampColumn(col);
        if (timestamp === null) {
            return sql`${raw}`;
        }

        return timestamp.withTimezone ? sql`${raw}::timestamptz` : sql`${raw}::timestamp`;
    };
    const branches = cols.map((col, index) =>
        and(
            ...cols
                .slice(0, index)
                .map((prev, prevIndex) => sql`${prev} = ${value(prev, cursor[prevIndex] ?? null)}`),
            sql`${col} ${op} ${value(col, cursor[index] ?? null)}`,
        ),
    );

    return or(...branches);
}
