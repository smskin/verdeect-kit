// sanitizeError и registerErrorSanitizer (prd.md §3.2, AC-2.3, NFR-4). Эталон — O sanitize-error.ts (SanitizedDbError,
// проверка pg по форме, «Failed query (<code>)», стек без первой строки, sanitizeLogObject, serializeError); ветка
// ioredis — B sanitize-error.ts (SanitizedRedisError). По PRD: Drizzle распознаётся по форме, без импорта drizzle-orm;
// цепочка cause — не глубже 10 звеньев и без зацикливания; ветки сервисов — через registerErrorSanitizer (SMTP Identity).
import { stdSerializers } from 'pino';

/** Предел обхода цепочки `cause` (§3.2). */
export const MAX_CAUSE_DEPTH = 10;

const PG_FIELDS = ['code', 'constraint', 'table', 'column', 'severity'] as const;
const SQLSTATE = /^[\dA-Z]{5}$/;
const DRIZZLE_QUERY_ERROR = 'DrizzleQueryError';

type PgField = (typeof PG_FIELDS)[number];

/** Ошибка БД без SQL, параметров и значений: только метаданные pg. */
export class SanitizedDbError extends Error {
    override readonly name = 'SanitizedDbError';
    /** SQLSTATE. */
    readonly code?: string;
    /** Имя ограничения. */
    readonly constraint?: string;
    /** Имя таблицы. */
    readonly table?: string;
    /** Имя столбца. */
    readonly column?: string;
    /** Уровень pg (`ERROR`, `FATAL`). */
    readonly severity?: string;
}

/** Ошибка ioredis без аргументов команды: имя, код и имя команды. */
export class SanitizedRedisError extends Error {
    override readonly name = 'SanitizedRedisError';
    /** Код ошибки ioredis. */
    code?: string;
    /** Имя команды Redis без аргументов. */
    command?: string;
}

interface ErrorSanitizer {
    readonly match: (error: unknown) => boolean;
    readonly sanitize: (error: unknown) => Error;
}

/** Ветки сервисов — глобально на процесс, в порядке регистрации. */
const registered: ErrorSanitizer[] = [];

/** Результаты sanitizeError: повторно не обрабатываются. */
const sanitizedResults = new WeakSet<object>();

/**
 * Регистрирует ветку очистки сервиса (§3.2), например SMTP Identity. Глобально на процесс; повторная
 * регистрация того же `match` игнорируется. `match` проверяется на каждом звене цепочки `cause`, `sanitize`
 * получает совпавшее звено.
 */
export function registerErrorSanitizer(
    match: (error: unknown) => boolean,
    sanitize: (error: unknown) => Error,
): void {
    if (registered.some((item) => item.match === match)) {
        return;
    }
    registered.push({ match, sanitize });
}

/** Цепочка error → cause → … не длиннее MAX_CAUSE_DEPTH, без повторов; truncated — дальше есть звенья. */
function causeChain(error: unknown): { readonly chain: object[]; readonly truncated: boolean } {
    const chain: object[] = [];
    const seen = new Set<object>();
    let current: unknown = error;
    while (typeof current === 'object' && current !== null) {
        if (seen.has(current) || chain.length >= MAX_CAUSE_DEPTH) {
            return { chain, truncated: true };
        }
        seen.add(current);
        chain.push(current);
        current = (current as { cause?: unknown }).cause;
    }

    return { chain, truncated: false };
}

/** Ошибка драйвера pg (DatabaseError): SQLSTATE в code и строковый severity — без импорта pg. */
function isPgError(value: object): boolean {
    const { code, severity } = value as { code?: unknown; severity?: unknown };

    return typeof code === 'string' && SQLSTATE.test(code) && typeof severity === 'string';
}

/**
 * DrizzleQueryError по форме: `name` экземпляра или `type` сериализованной формы (pino-http сначала
 * применяет stdSerializers.err). Без импорта drizzle-orm (§3.2).
 */
function isDrizzleQueryError(value: object): boolean {
    const { name, type } = value as { name?: unknown; type?: unknown };

    return name === DRIZZLE_QUERY_ERROR || type === DRIZZLE_QUERY_ERROR;
}

/** Ошибка ioredis: поле command `{name, args}` — без импорта ioredis. */
function isRedisCommandError(value: object): boolean {
    const command = (value as { command?: unknown }).command;

    return typeof command === 'object' && command !== null && 'args' in command;
}

/** Строки стека без первой (в ней message исходной ошибки). */
function framesOnly(stack: unknown): string {
    if (typeof stack !== 'string') {
        return '';
    }
    const start = stack.indexOf('\n    at ');

    return start === -1 ? '' : stack.slice(start);
}

/** Ошибка БД → SanitizedDbError: поля pg из первого pg-звена, сообщение «Failed query» (+ code). */
function sanitizeDbError(error: unknown, chain: readonly object[]): SanitizedDbError {
    const fields: Partial<Record<PgField, string>> = {};
    const pg = chain.find(isPgError) as Partial<Record<PgField, unknown>> | undefined;
    for (const field of PG_FIELDS) {
        const value = pg?.[field];
        if (typeof value === 'string') {
            fields[field] = value;
        }
    }

    const sanitized = new SanitizedDbError(
        fields.code === undefined ? 'Failed query' : `Failed query (${fields.code})`,
    );
    Object.assign(sanitized, fields);
    sanitized.stack = `${sanitized.name}: ${sanitized.message}${framesOnly((error as { stack?: unknown }).stack)}`;

    return sanitized;
}

/** Ошибка ioredis → SanitizedRedisError: code и имя команды, без args. */
function sanitizeRedisError(error: unknown, redis: object): SanitizedRedisError {
    const { code, command } = redis as { code?: unknown; command: { name?: unknown } };
    const commandName = typeof command.name === 'string' ? command.name : undefined;
    const sanitized = new SanitizedRedisError(
        commandName === undefined
            ? 'Redis command failed'
            : `Redis command failed (${commandName})`,
    );
    if (typeof code === 'string') {
        sanitized.code = code;
    }
    if (commandName !== undefined) {
        sanitized.command = commandName;
    }
    sanitized.stack = `${sanitized.name}: ${sanitized.message}${framesOnly((error as { stack?: unknown }).stack)}`;

    return sanitized;
}

/** Копия звеньев chain (прототип и собственные свойства), последняя — без cause. */
function truncatedCopy(chain: readonly object[]): object {
    const copies = chain.map(
        (link) =>
            Object.create(
                Object.getPrototypeOf(link) as object | null,
                Object.getOwnPropertyDescriptors(link),
            ) as object,
    );
    copies.forEach((copy, index) => {
        const next = copies[index + 1];
        if (next === undefined) {
            delete (copy as { cause?: unknown }).cause;

            return;
        }
        Object.defineProperty(copy, 'cause', {
            value: next,
            writable: true,
            configurable: true,
            enumerable: Object.getOwnPropertyDescriptor(copy, 'cause')?.enumerable ?? false,
        });
    });

    return copies[0] ?? {};
}

/** Применяет ветку и помечает результат очищенным. */
function mark<T extends object>(result: T): T {
    sanitizedResults.add(result);

    return result;
}

/**
 * Ошибка без SQL, параметров и значений (§3.2, AC-2.3). Ветки по форме объекта на любом звене цепочки `cause`
 * (до 10): PostgreSQL/Drizzle → `code`, `constraint`, `table`, `column`, `severity` и «Failed query (<code>)»;
 * ioredis → `name`, `code`, имя команды; затем ветки `registerErrorSanitizer`. Срабатывает первая. Ветки нет —
 * исходная ошибка; цепочка глубже 10 или с циклом — копия с обрезанной цепочкой. Уже очищенная — как есть.
 */
export function sanitizeError(error: unknown): unknown {
    if (typeof error !== 'object' || error === null || sanitizedResults.has(error)) {
        return error;
    }
    const { chain, truncated } = causeChain(error);

    if (chain.some((link) => isDrizzleQueryError(link) || isPgError(link))) {
        return mark(sanitizeDbError(error, chain));
    }
    const redis = chain.find(isRedisCommandError);
    if (redis !== undefined) {
        return mark(sanitizeRedisError(error, redis));
    }
    for (const branch of registered) {
        const link = chain.find((item) => branch.match(item));
        if (link !== undefined) {
            return mark(branch.sanitize(link));
        }
    }

    return truncated ? mark(truncatedCopy(chain)) : error;
}

/**
 * formatters.log для pino: ключ `err` и любые Error верхнего уровня (error, cause, …) — через sanitizeError.
 * Вызывается до сериализаторов с исходным объектом: поля pg из cause ещё доступны.
 */
export function sanitizeLogObject(object: Record<string, unknown>): Record<string, unknown> {
    let result = object;
    for (const [key, value] of Object.entries(object)) {
        if (key !== 'err' && !(value instanceof Error)) {
            continue;
        }
        const sanitized = sanitizeError(value);
        if (sanitized !== value) {
            result = result === object ? { ...object } : result;
            result[key] = sanitized;
        }
    }

    return result;
}

/**
 * Сериализатор `err` для pino: любой logger.error({err}) проходит через sanitizeError. Получает и Error (pino), и
 * сериализованный объект (pino-http оборачивает через wrapErrorSerializer).
 */
export function serializeError(error: unknown): unknown {
    const safe = sanitizeError(error);

    return safe instanceof Error ? stdSerializers.err(safe) : safe;
}
