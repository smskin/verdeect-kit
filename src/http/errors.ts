// kitErrors, defineErrors, DomainError (prd.md §3.5, AC-3.2, AC-3.3). Эталон — O domain-error.ts + error-messages.ts (тело
// {error: {code, message, details}}, name = new.target.name, общий текст «Ошибка запроса»). По PRD: запись словаря
// {status, message}, реестр на процесс (как registerErrorSanitizer), статус берётся из словаря, коды §3.5; Retry-After для
// RATE_LIMITED ставит KitExceptionFilter по details.retryAfterSec (E8, §3.7). v1.23 (К4, AC-3.15): status словаря — число
// или список объявленных; DomainError(code, details?, {message?, headers?, status?, cause?}). Тексты — O error-messages.ts
// и guard @verdeect/auth.

import { validateHeaderName, validateHeaderValue } from 'node:http';

/** Запись словаря ошибок: HTTP-статус и текст по-русски. */
export interface KitErrorEntry {
    /** HTTP-статус ответа; список — код законно отвечает несколькими статусами (выбор — `DomainError({status})`). */
    readonly status: number | readonly number[];
    /** Текст для пользователя по-русски. */
    readonly message: string;
}

/** Словарь ошибок: код (SCREAMING_SNAKE) → статус и текст. */
export type KitErrorDictionary = Readonly<Record<string, KitErrorEntry>>;

/** Общие коды пакета (§3.5); сервис дополняет их своими через `defineErrors({...kitErrors, …})`. */
export const kitErrors = {
    UNAUTHENTICATED: { status: 401, message: 'Требуется вход' },
    FORBIDDEN: { status: 403, message: 'Доступ запрещён' },
    VALIDATION_FAILED: { status: 422, message: 'Некорректные данные запроса' },
    BAD_REQUEST: { status: 400, message: 'Некорректный запрос' },
    PAYLOAD_TOO_LARGE: { status: 413, message: 'Слишком большой запрос' },
    UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Неподдерживаемый формат запроса' },
    ROUTE_NOT_FOUND: { status: 404, message: 'Адрес не найден' },
    VERSION_CONFLICT: {
        status: 409,
        message: 'Данные изменились в другом окне. Обновите страницу.',
    },
    RATE_LIMITED: { status: 429, message: 'Слишком много запросов. Повторите позже.' },
    INTERNAL_ERROR: { status: 500, message: 'Внутренняя ошибка сервиса' },
    SERVICE_UNAVAILABLE: {
        status: 503,
        message: 'Сервис временно недоступен. Повторите попытку позже.',
    },
    SERVICE_STOPPING: {
        status: 503,
        message: 'Сервис перезапускается. Повторите через несколько секунд.',
    },
    PLATFORM_UNAVAILABLE: {
        status: 503,
        message: 'Сервис прав временно недоступен. Повторите позже',
    },
    IDEMPOTENCY_KEY_REUSED: {
        status: 422,
        message: 'Ключ Idempotency-Key уже использован с другим запросом.',
    },
    IDEMPOTENCY_IN_PROGRESS: { status: 409, message: 'Запрос с этим ключом ещё выполняется.' },
    IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Нужен заголовок Idempotency-Key.' },
} as const satisfies KitErrorDictionary;

/** Коды пакета в словаре сервиса сохраняют свой статус: иначе свойство — `never` и ошибка компиляции (AC-3.2). */
type KitCodesKeepStatus<D> = {
    readonly [K in keyof D & keyof typeof kitErrors]: D[K] extends {
        readonly status: (typeof kitErrors)[K]['status'];
    }
        ? unknown
        : never;
};

/** Общий текст неизвестного кода (O error-messages.ts FALLBACK_MESSAGE). */
const FALLBACK_MESSAGE = 'Ошибка запроса';

/** Запись реестра: объявленные статусы по возрастанию и текст. */
interface RegistryEntry {
    readonly statuses: readonly number[];
    readonly message: string;
}

function statusesOf(status: KitErrorEntry['status']): readonly number[] {
    return [...new Set(typeof status === 'number' ? [status] : status)].sort((a, b) => a - b);
}

/** Реестр кодов процесса; `kitErrors` зарегистрирован всегда. */
const registry = new Map<string, RegistryEntry>(
    Object.entries(kitErrors).map(([code, entry]) => [
        code,
        { statuses: statusesOf(entry.status), message: entry.message },
    ]),
);

/**
 * Регистрирует словарь ошибок сервиса на процесс (§3.5). Повторный вызов объединяет словари; тот же код с другим
 * статусом — `Error` при определении (ошибка разработчика), код пакета с другим статусом — ошибка компиляции.
 * Возвращает тот же словарь.
 */
export function defineErrors<const D extends KitErrorDictionary>(
    dict: D & KitCodesKeepStatus<D>,
): D {
    const entries = Object.entries(dict as KitErrorDictionary).map(
        ([code, entry]) => [code, statusesOf(entry.status), entry.message] as const,
    );
    for (const [code, statuses] of entries) {
        if (statuses.length === 0) {
            throw new Error(`defineErrors: у кода ${code} пустой список статусов`);
        }
        const known = registry.get(code);
        if (known !== undefined && known.statuses.join() !== statuses.join()) {
            throw new Error(
                `defineErrors: код ${code} уже зарегистрирован со статусом ${known.statuses.join(', ')}, а не ${statuses.join(', ')}`,
            );
        }
    }
    for (const [code, statuses, message] of entries) {
        registry.set(code, { statuses, message });
    }

    return dict;
}

/** Текст кода по-русски; неизвестный код — «Ошибка запроса». Внутренняя функция. */
export function errorMessage(code: string): string {
    return registry.get(code)?.message ?? FALLBACK_MESSAGE;
}

/** Объявленные статусы кода по возрастанию; `undefined` — код не зарегистрирован. Внутренняя функция. */
export function errorStatuses(code: string): readonly number[] | undefined {
    return registry.get(code)?.statuses;
}

/** Опции `DomainError` (§3.5, AC-3.15). */
export interface KitDomainErrorOptions extends ErrorOptions {
    /** Текст этого случая вместо текста словаря. */
    readonly message?: string;
    /**
     * Заголовки ответа; имена приводятся к нижнему регистру. Запрещены (ошибка при создании): `set-cookie`, заголовки
     * безопасности пакета, `retry-after` у `RATE_LIMITED` (его ставит фильтр по `details.retryAfterSec`).
     */
    readonly headers?: Readonly<Record<string, string>>;
    /**
     * Статус — для кода с несколькими объявленными; у кода с одним статусом не передаётся или совпадает с ним. Иначе —
     * ошибка разработчика: 500 `INTERNAL_ERROR` и GlitchTip.
     */
    readonly status?: number;
}

/** Заголовки, которые ставит пакет или которые нельзя отдавать из ошибки (AC-3.15). */
const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
    'set-cookie',
    'x-content-type-options',
    'referrer-policy',
]);

function headersOf(
    code: string,
    headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [raw, value] of Object.entries(headers ?? {})) {
        const name = raw.toLowerCase();
        if (FORBIDDEN_HEADERS.has(name) || (name === 'retry-after' && code === 'RATE_LIMITED')) {
            throw new TypeError(
                `DomainError ${code}: заголовок ${name} ставит пакет или он запрещён`,
            );
        }
        if (typeof value !== 'string') {
            throw new TypeError(`DomainError ${code}: значение заголовка ${name} — не строка`);
        }
        try {
            // Те же проверки, что у res.writeHead: иначе ошибка всплыла бы при отправке ответа об ошибке.
            validateHeaderName(name);
            validateHeaderValue(name, value);
        } catch {
            throw new TypeError(
                `DomainError ${code}: недопустимое имя или значение заголовка ${name}`,
            );
        }
        result[name] = value;
    }

    return result;
}

/** Статус экземпляра: один объявленный — он; несколько — `status` из объявленных; иначе — 500 (ошибка разработчика). */
function statusOf(code: string, status: number | undefined): number {
    const declared = errorStatuses(code);
    if (declared === undefined) {
        return 500;
    }
    if (status === undefined) {
        return declared.length === 1 ? (declared[0] ?? 500) : 500;
    }

    return declared.includes(status) ? status : 500;
}

/** Тело ответа ошибки (§3.5). */
interface ErrorBody {
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details: Readonly<Record<string, unknown>>;
    };
}

/**
 * Ожидаемая ошибка домена (§3.5): статус и текст — из словаря `defineErrors`, `warn` без GlitchTip. `options.message` —
 * текст этого случая, `options.headers` — заголовки ответа, `options.status` — один из объявленных статусов кода,
 * `options.cause` — исходная ошибка (например, срок пула БД). Незарегистрированный код или статус вне объявленных —
 * ошибка разработчика: статус 500, фильтр отвечает `INTERNAL_ERROR` и отправляет событие. `Retry-After` для
 * `RATE_LIMITED` ставит `KitExceptionFilter` по `details.retryAfterSec`.
 * @throws {TypeError} запрещённый заголовок в `options.headers`.
 */
export class DomainError extends Error {
    /** Код ошибки (SCREAMING_SNAKE). */
    readonly code: string;
    /** HTTP-статус из словаря; незарегистрированный код или статус вне объявленных — 500. */
    readonly status: number;
    /** Подробности без секретов и ПДн; по умолчанию `{}`. */
    readonly details: Readonly<Record<string, unknown>>;
    /** Заголовки ответа (имена в нижнем регистре); по умолчанию `{}`. */
    readonly headers: Readonly<Record<string, string>>;

    constructor(
        code: string,
        details?: Readonly<Record<string, unknown>>,
        options?: KitDomainErrorOptions,
    ) {
        super(
            options?.message ?? errorMessage(code),
            options?.cause === undefined ? undefined : { cause: options.cause },
        );
        this.name = new.target.name;
        this.code = code;
        this.headers = headersOf(code, options?.headers);
        this.status = statusOf(code, options?.status);
        this.details = details ?? {};
    }

    /** Тело ответа `{error: {code, message, details}}`. */
    toBody(): ErrorBody {
        return { error: { code: this.code, message: this.message, details: this.details } };
    }
}
