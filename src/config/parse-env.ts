// parseEnv и InvalidEnvironmentError (prd.md §3.1 v1.35, AC-1.3, NFR-4); эталон — O env.schema.ts parseWith,
// путь ключа — B issueKeys (полный, через точку; у O — первый сегмент, inventory §4 п. 10 — решено PRD);
// issues с message схемы и страховкой от значения — v1.35.
import type { z } from 'zod';

/** Запись об ошибке окружения: путь ключа и текст схемы без значения (§3.1). */
export interface KitEnvironmentIssue {
    /** Полный путь ключа через точку; без пути — `(root)`. */
    readonly key: string;
    /**
     * Текст схемы; содержащий фрагмент значения ключа — «неверное значение (<code>)» (у `(root)` — значения
     * ключей схемы).
     */
    readonly message: string;
}

/** Ошибка окружения: пути ключей и тексты схемы, без значений (NFR-4). */
export class InvalidEnvironmentError extends Error {
    /** Код ошибки конфигурации. */
    readonly code = 'INVALID_ENVIRONMENT' as const;
    /** Полные пути ключей через точку, без дублей, в порядке issues; без пути — `(root)`. */
    readonly keys: readonly string[];
    /** Запись на каждую ошибку схемы, в порядке ошибок; значений окружения нет. */
    readonly issues: readonly KitEnvironmentIssue[];

    /**
     * Принимает записи `issues`; `keys` выводятся из них (уникальные `key` в порядке появления).
     * `message` записи — без значения ключа: сервис, создающий ошибку сам, отвечает за это.
     */
    constructor(issues: readonly KitEnvironmentIssue[]) {
        const keys = [...new Set(issues.map((issue) => issue.key))];
        super(`Неверное окружение: ${keys.join(', ')}`);
        this.name = 'InvalidEnvironmentError';
        this.keys = keys;
        this.issues = issues;
    }
}

/** Длина фрагмента значения, который не должен попасть в текст ошибки (§3.1). */
const FRAGMENT_LENGTH = 8;

/** Путь issue: полный через точку, без пути — `(root)`. */
function issueKey(issue: z.core.$ZodIssue): string {
    return issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.');
}

/**
 * Значения для ошибки без пути: ключи, объявленные в схеме (то, что видит проверка корня), а не всё окружение —
 * иначе текст совпадёт со значением чужой переменной (`NODE_ENV=production`). Схема без `shape` — всё окружение.
 */
function rootValues(schema: z.ZodType, env: Readonly<Record<string, unknown>>): unknown[] {
    const { shape } = schema as { shape?: unknown };
    if (typeof shape !== 'object' || shape === null) {
        return Object.values(env);
    }

    return Object.keys(shape).map((key) => env[key]);
}

/** Строковые значения, фрагменты которых проверяются: ключ верхнего уровня или ключи схемы — для `(root)`. */
function checkedValues(
    issue: z.core.$ZodIssue,
    env: Readonly<Record<string, unknown>>,
    root: readonly unknown[],
): readonly unknown[] {
    const top = issue.path[0];

    return top === undefined ? root : [env[String(top)]];
}

/** Есть ли в тексте подстрока значения длиной FRAGMENT_LENGTH. */
function containsFragment(message: string, value: string): boolean {
    // ponytail: окно 8 символов — O(длина значения) проверок includes на issue, для окружения сервиса достаточно.
    for (let start = 0; start + FRAGMENT_LENGTH <= value.length; start++) {
        if (message.includes(value.slice(start, start + FRAGMENT_LENGTH))) {
            return true;
        }
    }

    return false;
}

/** Текст схемы или «неверное значение (<code>)», если в нём фрагмент значения ключа (§3.1). */
function safeMessage(
    issue: z.core.$ZodIssue,
    env: Readonly<Record<string, unknown>>,
    root: readonly unknown[],
): string {
    const leaks = checkedValues(issue, env, root).some(
        (value) => typeof value === 'string' && containsFragment(issue.message, value),
    );

    return leaks ? `неверное значение (${issue.code})` : issue.message;
}

/** Запись на каждый issue zod; значения и input не берутся. */
function environmentIssues(
    error: z.ZodError,
    schema: z.ZodType,
    env: Readonly<Record<string, unknown>>,
): KitEnvironmentIssue[] {
    const root = rootValues(schema, env);

    return error.issues.map((issue) => ({
        key: issueKey(issue),
        message: safeMessage(issue, env, root),
    }));
}

/**
 * Результат схемы или InvalidEnvironmentError (§3.1). Ошибка zod не сохраняется ни в `cause`, ни в
 * полях: её issues содержат входные значения.
 */
export function parseEnv<S extends z.ZodType>(
    schema: S,
    env: Readonly<Record<string, unknown>>,
): z.output<S> {
    const result = schema.safeParse(env);
    if (!result.success) {
        throw new InvalidEnvironmentError(environmentIssues(result.error, schema, env));
    }

    return result.data;
}
