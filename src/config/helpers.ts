// Помощники zod для схем окружения (prd.md §3.1); эталон — O env.schema.ts + port/httpUrl из B.
// Умолчание необязательно у всех помощников: без него ключ обязателен. Issue без входного значения (NFR-4).
import { z } from 'zod';

/** TCP-порт 0–65535; 0 — порт выбирает ОС (тесты). Пустая строка даёт 0, как в эталоне (§3.1). */
export function port(fallback?: number) {
    const schema = z.coerce.number().int().min(0).max(65535);

    return fallback === undefined ? schema : schema.default(fallback);
}

/** Целое > 0 (§3.1). */
export function positiveInt(fallback?: number) {
    const schema = z.coerce.number().int().positive();

    return fallback === undefined ? schema : schema.default(fallback);
}

/** Целое ≥ 0; внутренний помощник фрагментов, из /config не реэкспортируется. */
export function nonNegativeInt(fallback?: number) {
    const schema = z.coerce.number().int().nonnegative();

    return fallback === undefined ? schema : schema.default(fallback);
}

/** Необязательный текст: пусто или пробелы → null, иначе значение без крайних пробелов (§3.1). */
export function optionalText() {
    return z
        .string()
        .default('')
        .transform((value) => (value.trim() === '' ? null : value.trim()));
}

/** Только строки `true`/`false`: приведение zod к boolean сделало бы строку `false` истиной (§3.1). */
export function booleanFlag(fallback?: boolean) {
    const schema = z.enum(['true', 'false']);
    const withDefault =
        fallback === undefined ? schema : schema.default(fallback ? 'true' : 'false');

    return withDefault.transform((value) => value === 'true');
}

/**
 * Ключ с JSON-значением (§3.1). Умолчание — строка до разбора: в zod 4 умолчание после
 * преобразования ожидает уже разобранный тип. Ошибка разбора — без входного значения.
 */
export function jsonValue<T extends z.ZodType>(schema: T, fallback?: string) {
    const raw = fallback === undefined ? z.string() : z.string().default(fallback);

    return raw
        .transform((value, ctx) => {
            try {
                return JSON.parse(value) as unknown;
            } catch {
                ctx.addIssue({ code: 'custom', message: 'неверный JSON', input: '' });

                return z.NEVER;
            }
        })
        .pipe(schema);
}

/** Адрес HTTP-ресурса: только http и https (§3.1). */
export function httpUrl() {
    return z.url({ protocol: /^https?$/ });
}

/** Значения поля `key` элементов массива не повторяются; для `superRefine`, issue — без значений (§3.1). */
export function uniqueBy<T>(key: keyof T): (items: readonly T[], ctx: z.RefinementCtx) => void {
    return (items, ctx) => {
        const seen = new Set(items.map((item) => item[key]));
        if (seen.size !== items.length) {
            ctx.addIssue({ code: 'custom', message: `повтор ${String(key)}`, input: '' });
        }
    };
}
