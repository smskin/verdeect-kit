// parseEnv и InvalidEnvironmentError (prd.md §3.1, AC-1.3, NFR-4); эталон — O env.schema.ts parseWith,
// путь ключа — B issueKeys (полный, через точку; у O — первый сегмент, inventory §4 п. 10 — решено PRD).
import type { z } from 'zod';

/** Ошибка окружения: только пути ключей, без значений (NFR-4). */
export class InvalidEnvironmentError extends Error {
    /** Код ошибки конфигурации. */
    readonly code = 'INVALID_ENVIRONMENT' as const;
    /** Полные пути ключей через точку, без дублей; без пути — `(root)`. */
    readonly keys: readonly string[];

    constructor(keys: readonly string[]) {
        super(`Неверное окружение: ${keys.join(', ')}`);
        this.name = 'InvalidEnvironmentError';
        this.keys = keys;
    }
}

/** Пути ключей issues без дублей, в порядке issues; значения и сообщения zod не берутся. */
function issueKeys(error: z.ZodError): string[] {
    const keys = error.issues.map((issue) =>
        issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.'),
    );

    return [...new Set(keys)];
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
        throw new InvalidEnvironmentError(issueKeys(result.error));
    }

    return result.data;
}
