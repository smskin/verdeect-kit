// expectMatchesApi (prd.md §3.8 — E3, AC-3.7): ответ соответствует схеме @Api маршрута — тот же построитель, что у CLI
// verdeect-kit openapi. Эталона нет: пишется по PRD. Валидатор — Ajv 2020 (ajv — внутренняя деталь /testing, NFR-3);
// утверждения — node:assert/strict.
import assert from 'node:assert/strict';
import type { Type } from '@nestjs/common';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { routeResponseSchema } from '../http/api/openapi-document.js';
import type { KitTestResponse } from './expect-problem.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });

/**
 * Проверяет ответ маршрута `[Controller, 'method']` по его `@Api` (§3.8): статус совпадает со статусом операции, тело
 * проходит JSON Schema `response` с конвертом `envelope`. Несовпадение — `AssertionError` с путями ошибок; маршрут без
 * `@Api` — ошибка с именем маршрута.
 */
export function expectMatchesApi(response: KitTestResponse, route: readonly [Type, string]): void {
    const { status, schema } = routeResponseSchema(route);
    const name = `${route[0].name}.${route[1]}`;
    assert.strictEqual(
        response.statusCode,
        status,
        `${name}: статус ${response.statusCode}, по @Api — ${status}`,
    );
    if (schema === null) {
        return;
    }
    const validate = ajv.compile(schema);
    const body = response.json();
    if (!validate(body)) {
        const errors = (validate.errors ?? [])
            .map((error) => `${error.instancePath || '(root)'} ${error.message ?? ''}`.trim())
            .join('; ');
        assert.fail(`${name}: ответ вне схемы @Api — ${errors}`);
    }
}
