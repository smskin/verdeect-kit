// Список чувствительных имён и KitRedaction (prd.md §3.2, O1, O3, GAP-6, GAP-8; NFR-4). Эталон — REDACT_PATHS O
// observability.module.ts; имена — по PRD, ключи сервисов (O ORCHESTRATOR_KEYS, I csrfToken/stepToken) — в KitRedaction
// сервиса.

/**
 * Базовый список чувствительных имён (§3.2): заголовки, секреты и токены, ПДн, `body.code` и `body.state`.
 * Каждое имя скрывается на уровнях 0–2 в логах и по имени — в событиях GlitchTip. `err.code` не скрывается.
 */
export const SENSITIVE_KEYS: readonly string[] = Object.freeze([
    'authorization',
    'cookie',
    'set-cookie',
    'idempotency-key',
    'password',
    'newPassword',
    'currentPassword',
    'secret',
    'clientSecret',
    'token',
    'access_token',
    'refresh_token',
    'id_token',
    'logout_token',
    'accessToken',
    'code_verifier',
    'nonce',
    'email',
    'givenName',
    'familyName',
    'middleName',
    'body.code',
    'body.state',
]);

/**
 * Правила редактирования сервиса — один объект на сервис (константа `src/redaction.ts`). Передаётся и в
 * `createLoggerOptions`, и в `initSentry`: имена и маска пути для логов и GlitchTip совпадают по построению.
 * `src/redaction.ts` сервиса загружается в `instrument.ts` до Sentry, поэтому импортирует только типы из
 * `@verdeect/kit/observability` (GAP-9).
 */
export interface KitRedaction {
    /** Имена, добавляемые к `SENSITIVE_KEYS` (объединение без дублей); пустой массив базовый список не отключает. */
    readonly sensitiveKeys?: readonly string[];
    /** Маска пути для лога доступа и `request.url` события GlitchTip; по умолчанию путь не меняется. */
    readonly maskPath?: (path: string) => string;
}

/** Сегмент пути pino: имя из `[A-Za-z0-9_]` — через точку, прочее — в скобках `["…"]`. */
const PLAIN_SEGMENT = /^[A-Za-z0-9_]+$/;

/** `SENSITIVE_KEYS` ∪ `redaction.sensitiveKeys` без дублей; базовый список присутствует всегда. */
export function sensitiveNames(redaction?: KitRedaction): readonly string[] {
    return [...new Set([...SENSITIVE_KEYS, ...(redaction?.sensitiveKeys ?? [])])];
}

/** Путь имени без префикса: `body.code` → `body.code`, `set-cookie` → `["set-cookie"]`. */
function namePath(name: string): string {
    return name
        .split('.')
        .map((segment, index) => {
            if (!PLAIN_SEGMENT.test(segment)) {
                return `[${JSON.stringify(segment)}]`;
            }

            return index === 0 ? segment : `.${segment}`;
        })
        .join('');
}

/** Присоединяет путь имени к префиксу `*`/`*.*`: скобка идёт без точки. */
function withPrefix(prefix: string, path: string): string {
    return path.startsWith('[') ? `${prefix}${path}` : `${prefix}.${path}`;
}

/** Пути `redact` pino: каждое имя на уровнях 0–2 (`k`, `*.k`, `*.*.k`). */
export function redactPaths(redaction?: KitRedaction): string[] {
    return sensitiveNames(redaction).flatMap((name) => {
        const path = namePath(name);

        return [path, withPrefix('*', path), withPrefix('*.*', path)];
    });
}

/** Маска пути сервиса; по умолчанию — тождество. */
export function maskPathOf(redaction?: KitRedaction): (path: string) => string {
    return redaction?.maskPath ?? ((path) => path);
}
