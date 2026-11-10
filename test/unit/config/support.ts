// Помощники тестов /config (prd.md §3.1, AC-1.3, NFR-4); эталон — B env.schema.spec.ts parseError/expectKeysOnly.
import { expect } from 'vitest';
import { InvalidEnvironmentError } from '../../../src/config/index.js';

/** Ошибка окружения из fn; иначе тест падает. */
export function errorOf(fn: () => unknown): InvalidEnvironmentError {
    try {
        fn();
    } catch (error) {
        if (error instanceof InvalidEnvironmentError) {
            return error;
        }
        throw error;
    }

    return expect.fail('ожидалась InvalidEnvironmentError');
}

/** Сообщение и keys называют ключ и не содержат значений окружения. */
export function expectKeysOnly(
    error: InvalidEnvironmentError,
    key: string,
    values: readonly string[],
): void {
    expect(error.keys).toContain(key);
    expect(error.message).toContain(key);
    const serialized = `${error.message} ${JSON.stringify(error.keys)}`;
    for (const value of values) {
        expect(serialized).not.toContain(value);
    }
}
