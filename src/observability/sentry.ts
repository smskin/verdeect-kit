// initSentry, скраббер событий, captureError и captureThrottled (prd.md §3.2, AC-2.4, AC-2.5, AC-2.6, AC-2.12, NFR-4).
// Эталоны: O instrument.ts (NO_PERSONAL_DATA, условие включения, tracesSampleRate 0), O sentry-scrubber.ts (scrubValue,
// глубина 8 → [Truncated], заголовки, user → {id}, хвост params: и Key (…)=(…), запасной путь при исключении), троттлинг —
// O pool-timeout-reporter.ts (окно 60 с, performance.now()). По PRD: имена — sensitiveNames(redaction) без доменных ключей
// O; query удаляется целиком (и из request.url); путь — через maskPath; envSentry разбирается без исключения.
// envSentry — из fragments.js, не из config/index.js: индекс тянет @nestjs/*, а instrument.ts грузится до Nest (LE-5).
import * as Sentry from '@sentry/nestjs';
import type { Breadcrumb, Event } from '@sentry/nestjs';
import { z } from 'zod';
import { envSentry } from '../config/fragments.js';
import { maskPathOf, sensitiveNames, type KitRedaction } from './redaction.js';
import { sanitizeError } from './sanitize-error.js';

/** Опции `initSentry` (§3.2). */
export interface KitSentryOptions {
    /** Имя сервиса — тег `service` каждого события. */
    readonly service: string;
    /** Правила редактирования сервиса (общие с `createLoggerOptions`). */
    readonly redaction?: KitRedaction;
}

/** Sentry 11: вместо sendDefaultPii — ничего из ПДн, заголовков, тел, query и данных БД не собирается. */
export const NO_PERSONAL_DATA = {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    genAI: { inputs: false, outputs: false },
} satisfies NonNullable<Sentry.NodeOptions['dataCollection']>;

const FILTERED = '[Filtered]';
const TRUNCATED = '[Truncated]';
const MAX_DEPTH = 8;
const DROPPED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-forwarded-for']);
const DEFAULT_WINDOW_MS = 60_000;

// То же выражение, что DSN_REGEX @sentry/core utils/dsn.js: неверный DSN SDK печатает через console.error со значением.
const DSN_REGEX =
    /^(?:(\w+):)\/\/(?:(\w+)(?::(\w+)?)?@)((?:\[[:.%\w]+\]|[\w.-]+))(?::(\d+))?\/(.+)/;
// Хвост сообщения DrizzleQueryError («\nparams: …») и detail pg «Key (sub)=(…)».
const PARAMS_TAIL = /\nparams:[\s\S]*$/;
const KEY_VALUE = /Key \([^)]*\)=\([^)]*\)/g;
const URL_PARTS = /^([a-z][a-z\d+.-]*:\/\/[^/]*)?(.*)$/i;

/** Имена для сравнения без учёта регистра: простые и пары «родитель.ключ». */
interface ScrubNames {
    readonly plain: ReadonlySet<string>;
    readonly dotted: ReadonlySet<string>;
}

function scrubNames(redaction?: KitRedaction): ScrubNames {
    const names = sensitiveNames(redaction).map((name) => name.toLowerCase());

    return {
        plain: new Set(names.filter((name) => !name.includes('.'))),
        dotted: new Set(names.filter((name) => name.includes('.'))),
    };
}

function isSensitive(names: ScrubNames, key: string, parent: string | undefined): boolean {
    const lower = key.toLowerCase();
    if (names.plain.has(lower)) {
        return true;
    }

    return parent !== undefined && names.dotted.has(`${parent.toLowerCase()}.${lower}`);
}

function scrubValue(value: unknown, names: ScrubNames, depth = 0, parent?: string): unknown {
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    if (depth >= MAX_DEPTH) {
        return TRUNCATED;
    }
    if (Array.isArray(value)) {
        return value.map((item) => scrubValue(item, names, depth + 1, parent));
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            isSensitive(names, key, parent) ? FILTERED : scrubValue(item, names, depth + 1, key),
        ]),
    );
}

/** Адрес без query и фрагмента, путь — через maskPath. */
function scrubUrl(url: string, maskPath: (path: string) => string): string {
    const base = url.split(/[?#]/, 1)[0] ?? '';
    const [, origin = '', path = ''] = URL_PARTS.exec(base) ?? [];

    return `${origin}${maskPath(path)}`;
}

function scrubExceptionText(value: string): string {
    return value.replace(PARAMS_TAIL, '').replace(KEY_VALUE, 'Key [Filtered]');
}

/**
 * Текст исключений: ошибка, которую изменил sanitizeError (БД, ioredis, ветка сервиса), — его сообщение во всех values
 * (linkedErrors добавляет цепочку cause отдельными values; текст ioredis повторяет ключи Redis); прочие — без хвоста
 * params: и «Key (…)=(…)».
 */
function scrubException(event: Event, originalException: unknown): void {
    const values = event.exception?.values;
    if (!values) {
        return;
    }
    const sanitized = sanitizeError(originalException);
    const safeMessage =
        sanitized instanceof Error && sanitized !== originalException ? sanitized.message : null;
    for (const value of values) {
        if (safeMessage !== null) {
            value.value = scrubExceptionText(safeMessage);
        } else if (value.value !== undefined) {
            value.value = scrubExceptionText(value.value);
        }
    }
}

function scrubRequest(
    request: NonNullable<Event['request']>,
    names: ScrubNames,
    maskPath: (path: string) => string,
): void {
    if (typeof request.url === 'string') {
        request.url = scrubUrl(request.url, maskPath);
    }
    delete request.query_string;
    delete request.cookies;
    delete request.data;
    if (request.headers) {
        const headers = Object.fromEntries(
            Object.entries(request.headers).filter(
                ([name]) => !DROPPED_HEADERS.has(name.toLowerCase()),
            ),
        );
        request.headers = scrubValue(headers, names) as Record<string, string>;
    }
}

/** Хлебная крошка без чувствительных данных; адрес — без query и через maskPath. Внутренняя функция. */
export function scrubBreadcrumb(crumb: Breadcrumb, redaction?: KitRedaction): Breadcrumb {
    if (!crumb.data) {
        return crumb;
    }
    const data = scrubValue(crumb.data, scrubNames(redaction)) as Record<string, unknown>;
    if (typeof data.url === 'string') {
        data.url = scrubUrl(data.url, maskPathOf(redaction));
    }

    return { ...crumb, data };
}

/**
 * Событие без query, `request.data`, cookie, ПДн пользователя (кроме `id`) и значений чувствительных имён в
 * extra, contexts, tags и breadcrumbs (§3.2, AC-2.5). Внутренняя функция. При исключении отбрасываются
 * request, extra, breadcrumbs и exception.
 */
export function scrubEvent<T extends Event>(
    event: T,
    originalException: unknown,
    redaction?: KitRedaction,
): T {
    try {
        const names = scrubNames(redaction);
        scrubException(event, originalException);
        if (event.request) {
            scrubRequest(event.request, names, maskPathOf(redaction));
        }
        if (event.user) {
            event.user = event.user.id === undefined ? {} : { id: event.user.id };
        }
        if (event.extra) {
            event.extra = scrubValue(event.extra, names) as T['extra'];
        }
        if (event.contexts) {
            event.contexts = scrubValue(event.contexts, names) as T['contexts'];
        }
        if (event.tags) {
            event.tags = scrubValue(event.tags, names) as T['tags'];
        }
        if (event.breadcrumbs) {
            event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb, redaction));
        }

        return event;
    } catch {
        delete event.request;
        delete event.extra;
        delete event.breadcrumbs;
        delete event.exception;

        return event;
    }
}

/**
 * DSN в форме, которую принимает SDK: иначе он сам печатает значение в console.error (NFR-4). Внутренняя функция: её же
 * использует bootstrapService для SENTRY_NOT_PRELOADED.
 */
export function isValidDsn(dsn: string): boolean {
    const match = DSN_REGEX.exec(dsn);
    if (!match) {
        return false;
    }
    const [, protocol, , , , , path = ''] = match;
    const projectId = path.split('/').pop() ?? '';

    return (protocol === 'http' || protocol === 'https') && /^\d+$/.test(projectId);
}

/**
 * Включает GlitchTip (§3.2): вызывается в `instrument.ts` сервиса, подключённом через `node --import` до загрузки
 * приложения. Включается только при непустом и верном `SENTRY_DSN` и `NODE_ENV = production` (не задан — production);
 * неверное окружение — Sentry выключен, без исключения и лога. `dataCollection: NO_PERSONAL_DATA`,
 * `tracesSampleRate: 0`, тег `service`. Возвращает, включён ли SDK.
 */
export function initSentry(options: KitSentryOptions): boolean {
    const parsed = z.object(envSentry).safeParse(process.env);
    if (!parsed.success) {
        return false;
    }
    const env = parsed.data;
    if (env.SENTRY_DSN === null || env.NODE_ENV !== 'production' || !isValidDsn(env.SENTRY_DSN)) {
        return false;
    }

    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT ?? 'production',
        ...(env.SENTRY_RELEASE === null ? {} : { release: env.SENTRY_RELEASE }),
        dataCollection: NO_PERSONAL_DATA,
        tracesSampleRate: 0,
        initialScope: { tags: { service: options.service } },
        beforeSend: (event, hint) => scrubEvent(event, hint.originalException, options.redaction),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb, options.redaction),
    });

    return true;
}

/** Ошибки, уже отправленные в GlitchTip. */
const sentErrors = new WeakSet<object>();

/** Время последней отправки по ключу `captureThrottled` (performance.now()). */
const lastSentAt = new Map<string, number>();

/** Контекст события `captureError`. */
interface CaptureContext {
    /** Теги события. */
    readonly tags?: Readonly<Record<string, string>>;
    /** Дополнительные данные (проходят скраббер). */
    readonly extra?: Readonly<Record<string, unknown>>;
}

function wasSent(error: unknown): boolean {
    return typeof error === 'object' && error !== null && sentErrors.has(error);
}

/**
 * Отправляет ошибку в GlitchTip через `sanitizeError` — ровно одно событие на ошибку (§3.2): объект ошибки
 * помечается отправленным, повторный вызов ничего не шлёт.
 */
export function captureError(error: unknown, context?: CaptureContext): void {
    if (wasSent(error)) {
        return;
    }
    Sentry.captureException(sanitizeError(error), {
        ...(context?.tags === undefined ? {} : { tags: { ...context.tags } }),
        ...(context?.extra === undefined ? {} : { extra: { ...context.extra } }),
    });
    if (typeof error === 'object' && error !== null) {
        sentErrors.add(error);
    }
}

/**
 * Одно событие за окно `windowMs` (умолч. 60 000) на ключ в процессе (§3.2, AC-2.6). Уже отправленная ошибка
 * (например, границей через `captureError`) повторно не шлётся. Возвращает, отправлено ли событие.
 */
export function captureThrottled(
    key: string,
    error: unknown,
    options?: { readonly windowMs?: number },
): boolean {
    if (wasSent(error)) {
        return false;
    }
    const now = performance.now();
    const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    if (now - (lastSentAt.get(key) ?? -Infinity) < windowMs) {
        return false;
    }
    lastSentAt.set(key, now);
    captureError(error);

    return true;
}
