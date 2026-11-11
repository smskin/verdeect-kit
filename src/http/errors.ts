// kitErrors, defineErrors, DomainError (prd.md §3.5, AC-3.2, AC-3.3). Эталон — O domain-error.ts + error-messages.ts (тело
// {error: {code, message, details}}, name = new.target.name, общий текст «Ошибка запроса»). По PRD: запись словаря
// {status, message}, реестр на процесс (как registerErrorSanitizer), статус берётся из словаря, коды §3.5; заголовков в
// DomainError нет; Retry-After для RATE_LIMITED ставит KitExceptionFilter по details.retryAfterSec (E8, §3.7), третий аргумент — стандартный {cause}. Тексты — O error-messages.ts и guard
// @verdeect/auth.

/** Запись словаря ошибок: HTTP-статус и текст по-русски. */
export interface KitErrorEntry {
    /** HTTP-статус ответа. */
    readonly status: number;
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

/** Реестр кодов процесса; `kitErrors` зарегистрирован всегда. */
const registry = new Map<string, KitErrorEntry>(Object.entries(kitErrors));

/**
 * Регистрирует словарь ошибок сервиса на процесс (§3.5). Повторный вызов объединяет словари; тот же код с другим
 * статусом — `Error` при определении (ошибка разработчика), код пакета с другим статусом — ошибка компиляции.
 * Возвращает тот же словарь.
 */
export function defineErrors<const D extends KitErrorDictionary>(
    dict: D & KitCodesKeepStatus<D>,
): D {
    const entries = Object.entries(dict as KitErrorDictionary);
    for (const [code, entry] of entries) {
        const known = registry.get(code);
        if (known !== undefined && known.status !== entry.status) {
            throw new Error(
                `defineErrors: код ${code} уже зарегистрирован со статусом ${known.status}, а не ${entry.status}`,
            );
        }
    }
    for (const [code, entry] of entries) {
        registry.set(code, { status: entry.status, message: entry.message });
    }

    return dict;
}

/** Текст кода по-русски; неизвестный код — «Ошибка запроса». Внутренняя функция. */
export function errorMessage(code: string): string {
    return registry.get(code)?.message ?? FALLBACK_MESSAGE;
}

/** Статус кода из реестра; `undefined` — код не зарегистрирован. Внутренняя функция. */
export function errorStatus(code: string): number | undefined {
    return registry.get(code)?.status;
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
 * Ожидаемая ошибка домена (§3.5): статус и текст — из словаря `defineErrors`, `warn` без GlitchTip. Незарегистрированный
 * код — ошибка разработчика: статус 500, фильтр отвечает `INTERNAL_ERROR` и отправляет событие. `options.cause` —
 * исходная ошибка (например, срок пула БД). Заголовков нет; `Retry-After` для `RATE_LIMITED` ставит `KitExceptionFilter` по
 * `details.retryAfterSec`.
 */
export class DomainError extends Error {
    /** Код ошибки (SCREAMING_SNAKE). */
    readonly code: string;
    /** HTTP-статус из словаря; незарегистрированный код — 500. */
    readonly status: number;
    /** Подробности без секретов и ПДн; по умолчанию `{}`. */
    readonly details: Readonly<Record<string, unknown>>;

    constructor(code: string, details?: Readonly<Record<string, unknown>>, options?: ErrorOptions) {
        super(errorMessage(code), options);
        this.name = new.target.name;
        this.code = code;
        this.status = errorStatus(code) ?? 500;
        this.details = details ?? {};
    }

    /** Тело ответа `{error: {code, message, details}}`. */
    toBody(): ErrorBody {
        return { error: { code: this.code, message: this.message, details: this.details } };
    }
}
