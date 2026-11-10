// expectMatchesApi (prd.md §3.8 — E3, AC-3.7; KT-17): ответ соответствует @Api маршрута — тот же построитель, что у CLI
// verdeect-kit openapi. Успешный статус — схема response с конвертом; описанный статус ошибки (стандартные, errors
// маршрута, 401/403/409 guard'а @verdeect/auth) — ErrorResponse. Эталона нет: пишется по PRD. Валидатор — Ajv 2020 (ajv —
// внутренняя деталь /testing, NFR-3), скомпилированная схема кэшируется по маршруту и статусу; утверждения —
// node:assert/strict.
import assert from 'node:assert/strict';
import type { Type } from '@nestjs/common';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { routeResponseSchema, type JsonObject } from '../http/api/openapi-document.js';
import type { KitTestResponse } from './expect-problem.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });

/** Скомпилированные схемы: класс контроллера → `<метод>:<статус>` → валидатор. */
const validators = new WeakMap<Type, Map<string, ValidateFunction>>();

function validatorOf(
    route: readonly [Type, string],
    status: number,
    schema: JsonObject,
): ValidateFunction {
    const [controller, handlerName] = route;
    const byRoute = validators.get(controller) ?? new Map<string, ValidateFunction>();
    validators.set(controller, byRoute);
    const key = `${handlerName}:${status}`;
    const cached = byRoute.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const validate = ajv.compile(schema);
    byRoute.set(key, validate);

    return validate;
}

/**
 * Проверяет ответ маршрута `[Controller, 'method']` по его `@Api` (§3.8). Статус операции — тело по схеме `response` с
 * конвертом `envelope`; описанный статус ошибки — тело `{error: {code, message, details}}`; прочий статус — ошибка.
 * Несовпадение — `AssertionError` с путями ошибок Ajv; маршрут без `@Api` — ошибка с именем маршрута.
 */
export function expectMatchesApi(response: KitTestResponse, route: readonly [Type, string]): void {
    const { status, schema, errorStatuses, errorSchema } = routeResponseSchema(route);
    const name = `${route[0].name}.${route[1]}`;
    const isError = response.statusCode !== status;
    if (isError && !errorStatuses.includes(response.statusCode)) {
        assert.fail(
            `${name}: статус ${response.statusCode} не описан в @Api (успех — ${status}, ошибки — ${errorStatuses.join(', ')})`,
        );
    }
    const expected = isError ? errorSchema : schema;
    if (expected === null) {
        return;
    }
    const validate = validatorOf(route, response.statusCode, expected);
    const body = response.json();
    if (!validate(body)) {
        const errors = (validate.errors ?? [])
            .map((error) => `${error.instancePath || '(root)'} ${error.message ?? ''}`.trim())
            .join('; ');
        assert.fail(`${name}: ответ вне схемы @Api — ${errors}`);
    }
}
