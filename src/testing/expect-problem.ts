// expectProblem (prd.md §3.8 — E3, §3.5): утверждение об ответе-ошибке {error: {code, message, details}}. Эталона нет —
// ближайшее O test/support/http.ts (errorCode). Утверждения — node:assert/strict: peer vitest не загружается.
import assert from 'node:assert/strict';

/** Ответ inject Fastify или похожий: статус и разбор тела. */
export interface KitTestResponse {
    /** HTTP-статус. */
    readonly statusCode: number;
    /** Тело ответа, разобранное как JSON. */
    json(): unknown;
}

/** Ожидаемая ошибка. */
export interface KitExpectedProblem {
    /** HTTP-статус. */
    readonly status: number;
    /** Код ошибки словаря. */
    readonly code: string;
    /** Ожидаемые `details.issues` (глубокое сравнение), для 422 `VALIDATION_FAILED`. */
    readonly issues?: readonly { readonly path: string; readonly code: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверяет ответ-ошибку (§3.5): статус, форма `{error: {code, message: string, details: object}}`, код и (если задано)
 * `details.issues`. Несовпадение — `AssertionError` с понятным текстом.
 */
export function expectProblem(response: KitTestResponse, expected: KitExpectedProblem): void {
    const body = response.json();
    const text = JSON.stringify(body);
    assert.strictEqual(
        response.statusCode,
        expected.status,
        `статус ${response.statusCode}, ожидался ${expected.status}: ${text}`,
    );
    const error = isRecord(body) ? body.error : undefined;
    assert.ok(isRecord(error), `тело не в форме {error: {code, message, details}}: ${text}`);
    assert.strictEqual(typeof error.message, 'string', `error.message не строка: ${text}`);
    assert.ok(isRecord(error.details), `error.details не объект: ${text}`);
    assert.strictEqual(
        error.code,
        expected.code,
        `код ${String(error.code)}, ожидался ${expected.code}`,
    );
    if (expected.issues !== undefined) {
        assert.deepStrictEqual(error.details.issues, expected.issues, `details.issues: ${text}`);
    }
}
