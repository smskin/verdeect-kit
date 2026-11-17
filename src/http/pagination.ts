// Keyset-пагинация (prd.md §3.5, AC-3.6). Эталон — I pagination.ts (encodeCursor, decodeCursor, pageOf, PageQuerySchema).
// По PRD: limit умолч. 100 (у I — 50), макс. 200; неверный курсор → 422 VALIDATION_FAILED path: cursor (у I — 400
// VALIDATION); ключи — JSON-скаляры, а не только строки; новое — afterCursor (условие Drizzle по ключам сортировки).
// v1.35: закрытый список типов столбцов курсора (timestamp, date, numeric, real/double, enum, citext), прочие — ошибка
// afterCursor; cursorTimestamp — timestamptz, timestamp, date.
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

/** Разобранные параметры страницы — выход `PageQuerySchema` (`limit` с умолчанием 100) (§3.5). */
export type PageQuery = z.output<typeof PageQuerySchema>;

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

/**
 * `undefined` → `null`; неразборчивый курсор или другое число ключей → 422 `VALIDATION_FAILED` `path: cursor`.
 * Тип значений по столбцам проверяет `afterCursor`.
 */
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

/**
 * Репозиторий читает `limit + 1` строк: лишняя строка есть → курсор по последней из `limit`. Ключи столбцов
 * `timestamp`/`timestamptz`/`date` в `keyOf` берите через `cursorTimestamp` (строка из БД), а не из JS `Date`.
 */
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

/** Вид столбца для курсора keyset (§3.5): от него зависят проверка значения и приведение в SQL. */
type CursorKind =
    | 'timestamptz'
    | 'timestamp'
    | 'date'
    | 'uuid'
    | 'integer'
    | 'numeric'
    | 'float'
    | 'boolean'
    | 'string'
    | 'enum';

// ponytail: закрытый список columnType Drizzle 0.45 — новый тип Drizzle даёт ошибку afterCursor до явного добавления.
const KIND_BY_COLUMN_TYPE: Readonly<Record<string, CursorKind>> = {
    PgDate: 'date',
    PgDateString: 'date',
    PgUUID: 'uuid',
    PgInteger: 'integer',
    PgSmallInt: 'integer',
    PgSerial: 'integer',
    PgSmallSerial: 'integer',
    PgBigInt53: 'integer',
    PgBigSerial53: 'integer',
    PgNumeric: 'numeric',
    PgNumericNumber: 'numeric',
    PgReal: 'float',
    PgDoublePrecision: 'float',
    PgBoolean: 'boolean',
    PgText: 'string',
    PgVarchar: 'string',
    PgChar: 'string',
    PgEnumColumn: 'enum',
    PgEnumObjectColumn: 'enum',
};

/** Вид столбца или `null` — тип не поддержан курсором. `citext` (`customType`) — строка. */
function cursorKind(col: AnyColumn): CursorKind | null {
    const { columnType } = col;
    if (columnType === 'PgTimestamp' || columnType === 'PgTimestampString') {
        const { withTimezone } = col as AnyColumn & { withTimezone?: unknown };

        return withTimezone === true ? 'timestamptz' : 'timestamp';
    }
    if (columnType === 'PgCustomColumn') {
        return col.getSQLType().endsWith('citext') ? 'string' : null;
    }

    return KIND_BY_COLUMN_TYPE[columnType] ?? null;
}

const ISO_WITH_ZONE = z.iso.datetime({ offset: true });
// local: true принимает и `Z` — зона отсекается отдельно (ZONE_SUFFIX).
const ISO_LOCAL = z.iso.datetime({ local: true });
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ISO_DATE = z.iso.date();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

/** Значение подходит виду столбца (§3.5); особые значения (`now`, `infinity`, `NaN`) не проходят форматы. */
function fitsColumn(col: AnyColumn, kind: CursorKind, value: CursorValue): boolean {
    switch (kind) {
        case 'timestamptz':
            return typeof value === 'string' && ISO_WITH_ZONE.safeParse(value).success;
        case 'timestamp':
            return (
                typeof value === 'string' &&
                !ZONE_SUFFIX.test(value) &&
                ISO_LOCAL.safeParse(value).success
            );
        case 'date':
            return typeof value === 'string' && ISO_DATE.safeParse(value).success;
        case 'uuid':
            return typeof value === 'string' && UUID_PATTERN.test(value);
        case 'integer':
            return typeof value === 'number' && Number.isSafeInteger(value);
        case 'numeric':
            return (
                (typeof value === 'string' && DECIMAL_PATTERN.test(value)) ||
                (typeof value === 'number' && Number.isFinite(value))
            );
        case 'float':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'string':
            return typeof value === 'string';
        case 'enum': {
            const { enumValues } = col as AnyColumn & { enumValues?: readonly string[] };

            return typeof value === 'string' && (enumValues ?? []).includes(value);
        }
    }
}

/** Столбец сортировки с видом курсора. */
interface CursorKey {
    readonly col: AnyColumn;
    readonly kind: CursorKind;
}

/** Пары [столбец, вид]; нет вида (неподдержанный тип) — `Error`, ошибка разработчика (§3.5). */
function cursorKeys(cols: readonly AnyColumn[]): CursorKey[] {
    return cols.map((col) => {
        const kind = cursorKind(col);
        if (kind === null) {
            throw new Error(
                `afterCursor: столбец ${col.name} (${col.columnType}) не поддержан курсором keyset`,
            );
        }

        return { col, kind };
    });
}

/**
 * Ключ курсора по столбцу `timestamptz`, `timestamp` или `date` без потери точности (§3.5, К23): строка из БД —
 * `timestamptz` — ISO UTC с микросекундами (`2026-11-13T10:00:00.123456Z`), `timestamp` — ISO без зоны с микросекундами
 * (`2026-11-13T10:00:00.123456`), `date` — `YYYY-MM-DD`. Выбирается вместе со строками и передаётся в
 * `pageOf(…, keyOf)`; работает при любом `mode` столбца. JS `Date` хранит миллисекунды и сериализуется с `Z`, текст
 * `mode: 'string'` — не ISO: такой ключ курсор не примет или пропустит строки.
 * @example
 * db.select({ ...getTableColumns(t), cursorAt: cursorTimestamp(t.updatedAt) })…
 * pageOf(rows, limit, (row) => [row.cursorAt, row.id]);
 * @throws {TypeError} столбец не `timestamp`, `timestamptz` или `date`.
 */
export function cursorTimestamp(col: AnyColumn): SQL<string> {
    const kind = cursorKind(col);
    if (kind === 'timestamptz') {
        return sql<string>`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    }
    if (kind === 'timestamp') {
        return sql<string>`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
    }
    if (kind === 'date') {
        return sql<string>`to_char(${col}, 'YYYY-MM-DD')`;
    }
    throw new TypeError(
        `cursorTimestamp: столбец ${col.name} — не timestamp, timestamptz или date`,
    );
}

/** Параметр курсора с приведением по виду столбца. */
function cursorParam(kind: CursorKind, raw: CursorValue): SQL {
    switch (kind) {
        case 'timestamptz':
            return sql`${raw}::timestamptz`;
        case 'timestamp':
            return sql`${raw}::timestamp`;
        case 'date':
            return sql`${raw}::date`;
        default:
            return sql`${raw}`;
    }
}

/**
 * Условие «после курсора» для `where`: `(c1, …, cn) > (v1, …, vn)` (`desc` — `<`) как ИЛИ-цепочка
 * `c1 > v1 OR (c1 = v1 AND c2 > v2) OR …`. `cursor = null` → `undefined` (первая страница). Последний столбец обязан
 * быть `primaryKey()` или `unique()` — иначе `Error` (ошибка разработчика). Тип каждого столбца — из закрытого списка,
 * иначе `Error` при каждом вызове, в том числе без курсора: массив, `json`/`jsonb`, `interval`, `bigint`/`numeric`
 * в режиме `bigint`, `time`, сетевые и геометрические типы, `customType` (кроме `citext`). Длина курсора ≠ числу
 * столбцов или `null` в ключе → 422 `VALIDATION_FAILED` `path: cursor`. Значение ключа проверяется по типу столбца до
 * построения SQL, несовпадение — 422 `path: cursor`:
 * - `timestamptz` — строка ISO 8601 с зоной; `timestamp` — ISO 8601 без `Z` и смещения; `date` — `YYYY-MM-DD`
 *   (календарная дата); `now`, `today`, `infinity`, `epoch` не проходят;
 * - `uuid` — строка UUID; целые — безопасное целое; `numeric` — десятичная строка или конечное число;
 *   `real`/`double precision` — конечное число; `boolean` — логическое;
 * - `text`/`varchar`/`char`, `citext` — строка; enum — строка из значений enum.
 *
 * Ключи `timestamptz`, `timestamp` и `date` берите через `cursorTimestamp` (`Date` теряет микросекунды и даёт `Z`).
 * Значения передаются параметрами без кодировщика столбца; у `timestamptz`/`timestamp`/`date` параметр приводится
 * к типу столбца.
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
    const keys = cursorKeys(cols);
    if (cursor === null) {
        return undefined;
    }
    // Ограничение: null в ключе не поддержан — ключи сортировки keyset должны быть NOT NULL (README, «Пагинация»).
    if (cursor.length !== cols.length || cursor.includes(null)) {
        throw invalidCursor();
    }
    // Один проход по парам: значение проверяется по виду столбца и становится параметром с приведением.
    const params = keys.map(({ col, kind }, index) => {
        const raw = cursor[index] ?? null;
        if (!fitsColumn(col, kind, raw)) {
            throw invalidCursor();
        }

        return { col, param: cursorParam(kind, raw) };
    });
    const op = dir === 'asc' ? sql.raw('>') : sql.raw('<');
    const branches = params.map((key, index) =>
        and(
            ...params.slice(0, index).map((prev) => sql`${prev.col} = ${prev.param}`),
            sql`${key.col} ${op} ${key.param}`,
        ),
    );

    return or(...branches);
}
