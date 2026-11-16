// Построитель OpenAPI 3.1 по метаданным Nest без создания приложения (prd.md §3.5, AC-3.7, AC-3.8). Эталон — I
// openapi-document.ts: путь из PATH_METADATA (`:x` → `{x}`), статус из HTTP_CODE_METADATA (POST 201, иначе 200), тело,
// query и path — из ZodValidationPipe в ROUTE_ARGS_METADATA, z.toJSONSchema без $schema (io: input/output), operationId,
// ErrorResponse, схемы serviceToken/userToken. По PRD: обход метаданных модулей (imports, DynamicModule, промисы forRoot,
// forwardRef; controllers) вместо ModulesContainer; только маршруты с @Api; ошибки — errors маршрута (статусы из реестра
// defineErrors) + стандартные по факту (v1.24): 400/422 — zod-pipe тела или query, 422 — пути, 401/403 у защищённых, 429 —
// только из errors; защита — @UseGuards(VerdeectAuthGuard) и Require*
// @verdeect/auth; X-On-Behalf-Of не переносится (домен I); Idempotency-Key — по метаданным @Idempotent (internal/metadata.ts,
// E4); extra — глубокое слияние. v1.31 (r26): путь Fastify посегментно (fastifyPathToOpenApi: ::, regex, :from-:to,
// file.:ext, * → {wildcard}, :id? → ошибка), параметры пути — из того же разбора; extra — parameters по (name, in);
// статус — @Api({status}) → @HttpCode → @Redirect → POST 201/200, status: null — только ошибки; errors — код или
// {code, status}.
import type { DynamicModule, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import {
    GUARDS_METADATA,
    HTTP_CODE_METADATA,
    METHOD_METADATA,
    MODULE_METADATA,
    PATH_METADATA,
    REDIRECT_METADATA,
    ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { VerdeectAuthGuard } from '@verdeect/auth/nest';
import { IDEMPOTENT_METADATA, type KitIdempotentOptions } from '../../internal/metadata.js';
import type { Logger } from 'pino';
import { z } from 'zod';
import { errorStatuses } from '../errors.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { API_METADATA, type KitApiOptions } from './api.decorator.js';

/** JSON Schema или объект OpenAPI. */
export type JsonObject = Record<string, unknown>;

/** Документ OpenAPI 3.1. */
export interface OpenApiDocument {
    /** Версия спецификации. */
    readonly openapi: '3.1.0';
    /** Название и версия API. */
    readonly info: { readonly title: string; readonly version: string };
    /** Операции по путям. */
    readonly paths: Record<string, Record<string, JsonObject>>;
    /** Схемы безопасности и общие схемы. */
    readonly components: JsonObject;
}

// Ключи метаданных Require* @verdeect/auth 1.0.1 (dist/nest/decorators.js): пакет их не экспортирует.
const REQUIRE_SCOPES = 'verdeect-auth:require-scopes';
const REQUIRE_USER = 'verdeect-auth:require-user';
const REQUIRE_SERVICE = 'verdeect-auth:require-service';
const REQUIRE_TENANT = 'verdeect-auth:require-tenant';

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof METHOD_ORDER)[number];

const METHODS: Partial<Record<RequestMethod, HttpMethod>> = {
    [RequestMethod.GET]: 'get',
    [RequestMethod.POST]: 'post',
    [RequestMethod.PUT]: 'put',
    [RequestMethod.PATCH]: 'patch',
    [RequestMethod.DELETE]: 'delete',
};

const ERROR_RESPONSE_REF = { $ref: '#/components/schemas/ErrorResponse' };

const ERROR_RESPONSE: JsonObject = {
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
            },
            required: ['code', 'message', 'details'],
        },
    },
    required: ['error'],
};

interface RouteArgument {
    readonly index: number;
    readonly data?: unknown;
    readonly pipes?: readonly unknown[];
}

/** Защита маршрута: схемы безопасности и области. */
interface RouteSecurity {
    readonly schemes: readonly ('serviceToken' | 'userToken')[];
    readonly scopes: readonly string[];
    /** `@RequireTenant()`: guard отвечает 409 `TENANT_REQUIRED` токену без компании (@verdeect/auth 1.0.1). */
    readonly tenant: boolean;
}

/** Маршрут с `@Api`. */
interface ApiRoute {
    readonly controller: Type;
    readonly handlerName: string;
    readonly handler: object;
    readonly api: KitApiOptions;
    readonly method: HttpMethod;
    readonly paths: readonly OpenApiPath[];
    /** Успешный статус; `null` — успешного ответа нет (`@Api({status: null})`). */
    readonly status: number | null;
    /** `@Redirect`: успешный ответ без тела. */
    readonly redirect: boolean;
}

interface BuiltOperation {
    readonly path: string;
    readonly method: HttpMethod;
    readonly operation: JsonObject;
    readonly security: RouteSecurity | null;
}

/** Корень модуля в метаданных `imports`. */
type ModuleEntry = Type | DynamicModule | Promise<DynamicModule> | { forwardRef: () => unknown };

function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
    const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonObject;
    delete json.$schema;

    return json;
}

/** Шаблон OpenAPI пути и имена параметров пути в порядке появления. */
interface OpenApiPath {
    readonly path: string;
    readonly params: readonly string[];
}

const PARAM_NAME = /[A-Za-z0-9_]/;

/** Конец регулярного выражения `(...)` с позиции `start` (на `(`): вложенные скобки и экранирование учитываются. */
function regexEnd(path: string, start: number): number {
    let depth = 0;
    for (let index = start; index < path.length; index += 1) {
        const char = path[index];
        if (char === '\\') {
            index += 1;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) {
                return index + 1;
            }
        }
    }

    return path.length;
}

/**
 * Путь Fastify (find-my-way) → шаблон OpenAPI (§3.5 v1.31): `::` — буквальный `:`, `:name` → `{name}` (имя —
 * `[A-Za-z0-9_]+`, дальше литерал: `:from-:to`, `file.:ext`), регулярное выражение `(...)` после имени отбрасывается
 * целиком, `*` → `{wildcard}`. `:name?` (необязательный параметр) — Error с именем маршрута.
 */
function fastifyPathToOpenApi(parts: readonly string[], routeName: string): OpenApiPath {
    const raw = `/${parts
        .map((part) => part.replace(/^\/+|\/+$/g, ''))
        .filter((part) => part !== '')
        .join('/')}`;
    const params: string[] = [];
    let path = '';
    for (let index = 0; index < raw.length;) {
        const char = raw.charAt(index);
        if (char === '*') {
            params.push('wildcard');
            path += '{wildcard}';
            index += 1;
            continue;
        }
        if (char !== ':') {
            path += char;
            index += 1;
            continue;
        }
        if (raw.charAt(index + 1) === ':') {
            path += ':';
            index += 2;
            continue;
        }
        let end = index + 1;
        while (end < raw.length && PARAM_NAME.test(raw.charAt(end))) {
            end += 1;
        }
        const name = raw.slice(index + 1, end);
        if (name === '') {
            path += char;
            index += 1;
            continue;
        }
        if (raw.charAt(end) === '(') {
            end = regexEnd(raw, end);
        }
        if (raw.charAt(end) === '?') {
            throw new Error(
                `openapi: ${routeName} — необязательный параметр :${name}? не поддерживается`,
            );
        }
        params.push(name);
        path += `{${name}}`;
        index = end;
    }

    return { path, params };
}

function pathsOf(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string');
    }

    return [typeof value === 'string' ? value : ''];
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ключ параметра OpenAPI — пара (`name`, `in`); не объект или без пары — `null`. */
function parameterKey(value: unknown): string | null {
    if (!isObject(value) || typeof value.name !== 'string' || typeof value.in !== 'string') {
        return null;
    }

    return `${value.in}\u0000${value.name}`;
}

/** `parameters`: элемент `extra` с той же парой (`name`, `in`) сливается поверх, новый — в конец. */
function mergeParameters(target: readonly unknown[], extra: readonly unknown[]): unknown[] {
    const result = [...target];
    for (const item of extra) {
        const key = parameterKey(item);
        const index = key === null ? -1 : result.findIndex((own) => parameterKey(own) === key);
        const current = result[index];
        if (index >= 0 && isObject(current) && isObject(item)) {
            result[index] = deepMerge(current, item);
        } else {
            result.push(item);
        }
    }

    return result;
}

/**
 * Глубокое слияние `extra` (операция, `contracts/openapi.extra.json`, §3.5 v1.31): объекты сливаются; массивы
 * `parameters` — по паре (`name`, `in`): элемент `extra` с той же парой сливается поверх, новый добавляется в конец;
 * прочие массивы (`security`, `tags`, …) и значения заменяются.
 */
export function deepMerge(target: JsonObject, extra: Readonly<JsonObject>): JsonObject {
    const result: JsonObject = { ...target };
    for (const [key, value] of Object.entries(extra)) {
        const current = result[key];
        if (key === 'parameters' && Array.isArray(current) && Array.isArray(value)) {
            result[key] = mergeParameters(current, value);
        } else {
            result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
        }
    }

    return result;
}

function enveloped(schema: JsonObject, envelope: KitApiOptions['envelope']): JsonObject {
    switch (envelope) {
        case 'page':
            return {
                type: 'object',
                properties: {
                    items: { type: 'array', items: schema },
                    nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['items', 'nextCursor'],
                additionalProperties: false,
            };
        case 'items':
            return {
                type: 'object',
                properties: { items: { type: 'array', items: schema } },
                required: ['items'],
                additionalProperties: false,
            };
        case 'array':
            return { type: 'array', items: schema };
        default:
            return schema;
    }
}

function zodPipeOf(argument: RouteArgument): ZodValidationPipe<z.ZodType> | null {
    const pipe = argument.pipes?.find((item) => item instanceof ZodValidationPipe);

    return pipe instanceof ZodValidationPipe ? pipe : null;
}

/** Метаданные метода перекрывают метаданные класса (как у guard'а @verdeect/auth). */
function metadataOf(key: string, handler: object, controller: Type): unknown {
    const own: unknown = Reflect.getMetadata(key, handler);

    return own === undefined ? Reflect.getMetadata(key, controller) : own;
}

function hasAuthGuard(target: object): boolean {
    const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, target);

    return (
        Array.isArray(guards) &&
        guards.some(
            (guard) =>
                guard === VerdeectAuthGuard ||
                guard instanceof VerdeectAuthGuard ||
                (typeof guard === 'function' && guard.name === VerdeectAuthGuard.name),
        )
    );
}

function securityOf(controller: Type, handler: object): RouteSecurity | null {
    const scopes = metadataOf(REQUIRE_SCOPES, handler, controller);
    const user = metadataOf(REQUIRE_USER, handler, controller) === true;
    const service = metadataOf(REQUIRE_SERVICE, handler, controller) === true;
    const tenant = metadataOf(REQUIRE_TENANT, handler, controller) === true;
    const guarded = hasAuthGuard(handler) || hasAuthGuard(controller);
    if (!guarded && !user && !service && !tenant && scopes === undefined) {
        return null;
    }
    const schemes: ('serviceToken' | 'userToken')[] = [];
    if (service || !user) {
        schemes.push('serviceToken');
    }
    if (user || !service) {
        schemes.push('userToken');
    }

    return {
        schemes,
        tenant,
        scopes: Array.isArray(scopes)
            ? scopes.filter((s): s is string => typeof s === 'string')
            : [],
    };
}

function queryParameters(schema: JsonObject, data: unknown): JsonObject[] {
    if (typeof data === 'string') {
        return [{ name: data, in: 'query', required: false, schema }];
    }
    const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
    const required = new Set((schema.required ?? []) as string[]);

    return Object.entries(properties).map(([name, property]) => ({
        name,
        in: 'query',
        required: required.has(name),
        schema: property,
    }));
}

/** Схема успешного ответа маршрута (с конвертом). */
function responseSchemaOf(api: KitApiOptions): JsonObject | null {
    return api.response === undefined
        ? null
        : enveloped(toSchema(api.response, 'output'), api.envelope);
}

/** Опции `@Idempotent` обработчика (декоратор методный) или `null`. */
function idempotentOf(route: ApiRoute): KitIdempotentOptions | null {
    const options: unknown = Reflect.getMetadata(IDEMPOTENT_METADATA, route.handler);

    return typeof options === 'object' && options !== null
        ? (options as KitIdempotentOptions)
        : null;
}

/** Какие zod-pipe у маршрута: тела или query, пути (стандартные ошибки по факту, AC-3.7). */
function pipesOf(route: ApiRoute): { readonly bodyOrQuery: boolean; readonly path: boolean } {
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, route.handlerName) ??
        {}) as Record<string, RouteArgument>;
    let bodyOrQuery = false;
    let path = false;
    for (const [key, argument] of Object.entries(args)) {
        if (zodPipeOf(argument) === null) {
            continue;
        }
        const paramtype = Number(key.split(':', 1)[0]);
        if (paramtype === RouteParamtypes.BODY || paramtype === RouteParamtypes.QUERY) {
            bodyOrQuery = true;
        } else if (paramtype === RouteParamtypes.PARAM) {
            path = true;
        }
    }

    return { bodyOrQuery, path };
}

/**
 * Ошибки операции: статус → коды. Стандартные — по факту (§3.5 v1.24): 400/422 — zod-pipe тела или query, 422 — zod-pipe
 * пути, 401/403 — декораторы `@verdeect/auth`; 429 `RATE_LIMITED` — только из `@Api({errors})`.
 */
function errorsOf(route: ApiRoute, security: RouteSecurity | null): Map<number, string[]> {
    const errors = new Map<number, string[]>();
    const pipes = pipesOf(route);
    if (pipes.bodyOrQuery) {
        errors.set(400, ['BAD_REQUEST']);
    }
    if (pipes.bodyOrQuery || pipes.path) {
        errors.set(422, ['VALIDATION_FAILED']);
    }
    if (security !== null) {
        errors.set(401, ['UNAUTHENTICATED']);
        errors.set(
            403,
            security.scopes.length > 0 ? ['FORBIDDEN', 'SCOPE_REQUIRED'] : ['FORBIDDEN'],
        );
        if (security.tenant) {
            // Тело — {error: {code: 'TENANT_REQUIRED', message: 'Не выбрана компания', details: {}}} guard'а.
            errors.set(409, ['TENANT_REQUIRED']);
        }
    }
    const routeName = `${route.controller.name}.${route.handlerName}`;
    for (const item of route.api.errors ?? []) {
        const code = typeof item === 'string' ? item : item.code;
        const statuses = errorStatuses(code);
        if (statuses === undefined) {
            throw new Error(
                `openapi: ${routeName} — код ${code} не зарегистрирован в defineErrors`,
            );
        }
        if (typeof item !== 'string' && !statuses.includes(item.status)) {
            throw new Error(
                `openapi: ${routeName} — статус ${String(item.status)} не объявлен для кода ${code}`,
            );
        }
        // Строка — все объявленные статусы кода, {code, status} — только status (AC-3.15).
        for (const status of typeof item === 'string' ? statuses : [item.status]) {
            errors.set(status, [...(errors.get(status) ?? []), code]);
        }
    }
    const idempotent = idempotentOf(route);
    if (idempotent !== null) {
        const add = (status: number, code: string): void =>
            void errors.set(status, [...(errors.get(status) ?? []), code]);
        add(409, 'IDEMPOTENCY_IN_PROGRESS');
        add(422, 'IDEMPOTENCY_KEY_REUSED');
        if (idempotent.required === true) {
            add(400, 'IDEMPOTENCY_KEY_REQUIRED');
        }
    }

    return errors;
}

function parametersOf(
    route: ApiRoute,
    pathParams: readonly string[],
): { parameters: JsonObject[]; body?: JsonObject } {
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, route.handlerName) ??
        {}) as Record<string, RouteArgument>;
    const pathSchemas = new Map<string, JsonObject>();
    const parameters: JsonObject[] = [];
    let body: JsonObject | undefined;
    for (const [key, argument] of Object.entries(args)) {
        const paramtype = Number(key.split(':', 1)[0]);
        const pipe = zodPipeOf(argument);
        if (pipe === null) {
            continue;
        }
        const schema = toSchema(pipe.schema, 'input');
        if (paramtype === RouteParamtypes.BODY) {
            body = { required: true, content: { 'application/json': { schema } } };
        } else if (paramtype === RouteParamtypes.QUERY) {
            parameters.push(...queryParameters(schema, argument.data));
        } else if (paramtype === RouteParamtypes.PARAM && typeof argument.data === 'string') {
            pathSchemas.set(argument.data, schema);
        }
    }
    const pathParameters = [...new Set(pathParams)].map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: pathSchemas.get(name) ?? { type: 'string' },
    }));

    const idempotent = idempotentOf(route);
    const idempotencyKey =
        idempotent === null
            ? []
            : [
                  {
                      name: 'Idempotency-Key',
                      in: 'header',
                      required: idempotent.required === true,
                      schema: { type: 'string', pattern: '^[\\x21-\\x7E]{1,200}$' },
                  },
              ];

    return {
        parameters: [...pathParameters, ...parameters, ...idempotencyKey],
        ...(body === undefined ? {} : { body }),
    };
}

/** Успешный ответ операции: нет при `status: null`, без тела при `@Redirect` или без `response`. */
function successResponses(route: ApiRoute): Record<string, JsonObject> {
    if (route.status === null) {
        return {};
    }
    const schema = route.redirect ? null : responseSchemaOf(route.api);
    const success: JsonObject = route.redirect
        ? { description: 'редирект' }
        : schema === null
          ? { description: 'успех, без тела' }
          : { description: 'успех', content: { 'application/json': { schema } } };
    if (idempotentOf(route) !== null) {
        success.headers = {
            'Idempotent-Replayed': {
                schema: { type: 'string', enum: ['true'] },
                description: 'ответ сохранён и повторён',
            },
        };
    }

    return { [String(route.status)]: success };
}

function buildOperation(route: ApiRoute, { path, params }: OpenApiPath): BuiltOperation {
    const security = securityOf(route.controller, route.handler);
    const { parameters, body } = parametersOf(route, params);
    const responses = successResponses(route);
    for (const [status, codes] of [...errorsOf(route, security).entries()].sort(
        ([a], [b]) => a - b,
    )) {
        responses[String(status)] = {
            description: [...new Set(codes)].join(', '),
            content: { 'application/json': { schema: ERROR_RESPONSE_REF } },
            ...(status === 429
                ? {
                      headers: {
                          'Retry-After': {
                              schema: { type: 'integer' },
                              description: 'секунды до повтора',
                          },
                      },
                  }
                : {}),
        };
    }
    const name = route.controller.name.replace(/Controller$/, '');
    const operationId = `${name.charAt(0).toLowerCase()}${name.slice(1)}${route.handlerName.charAt(0).toUpperCase()}${route.handlerName.slice(1)}`;
    const operation: JsonObject = {
        operationId,
        summary: route.api.summary,
        ...(security === null
            ? {}
            : { security: security.schemes.map((scheme) => ({ [scheme]: [...security.scopes] })) }),
        ...(parameters.length === 0 ? {} : { parameters }),
        ...(body === undefined ? {} : { requestBody: body }),
        responses,
    };

    return {
        path,
        method: route.method,
        operation:
            route.api.extra === undefined ? operation : deepMerge(operation, route.api.extra),
        security,
    };
}

/**
 * Маршрут `[Controller, 'method']` с `@Api`; без `@Api` — `null`; `@Api` без метода HTTP или путь с `:name?` — Error.
 */
function apiRouteOf(controller: Type, handlerName: string): ApiRoute | null {
    const prototype = controller.prototype as Record<string, unknown>;
    const handler = prototype[handlerName];
    if (typeof handler !== 'function') {
        return null;
    }
    const api = Reflect.getMetadata(API_METADATA, handler) as KitApiOptions | undefined;
    if (api === undefined) {
        return null;
    }
    const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
    const handlerPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    if (method === undefined || handlerPath === undefined) {
        throw new Error(
            `openapi: ${controller.name}.${handlerName} — @Api без пути или метода HTTP`,
        );
    }
    const redirect = Reflect.getMetadata(REDIRECT_METADATA, handler) as
        { readonly statusCode?: number } | undefined;
    // Приоритет (§3.5 v1.31): @Api({status}) → @HttpCode → @Redirect (умолчание Nest 302) → POST 201, иначе 200.
    const status =
        api.status !== undefined
            ? api.status
            : ((Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
              (redirect === undefined ? undefined : (redirect.statusCode ?? 302)) ??
              (method === 'post' ? 201 : 200));
    const paths = pathsOf(Reflect.getMetadata(PATH_METADATA, controller)).flatMap((prefix) =>
        pathsOf(handlerPath).map((suffix) =>
            fastifyPathToOpenApi([prefix, suffix], `${controller.name}.${handlerName}`),
        ),
    );

    return {
        controller,
        handlerName,
        handler,
        api,
        method,
        paths,
        status,
        redirect: redirect !== undefined && api.status !== null,
    };
}

/**
 * Схема успешного ответа, статус (`null` — успешного ответа нет) и описанные статусы ошибок маршрута для
 * `expectMatchesApi`; у `@Redirect` схемы тела нет. Внутренняя функция.
 */
export function routeResponseSchema(route: readonly [Type, string]): {
    readonly status: number | null;
    readonly schema: JsonObject | null;
    readonly errorStatuses: readonly number[];
    readonly errorSchema: JsonObject;
} {
    const [controller, handlerName] = route;
    const api = apiRouteOf(controller, handlerName);
    if (api === null) {
        throw new Error(`expectMatchesApi: у ${controller.name}.${handlerName} нет @Api`);
    }
    const errors = errorsOf(api, securityOf(api.controller, api.handler));

    return {
        status: api.status,
        schema: api.redirect ? null : responseSchemaOf(api.api),
        errorStatuses: [...errors.keys()].sort((a, b) => a - b),
        errorSchema: ERROR_RESPONSE,
    };
}

/**
 * Имена методов класса и его предков до `Object.prototype`, как у `MetadataScanner` Nest: метод наследника с тем же
 * именем заменяет метод предка (берётся `prototype[name]` наследника).
 */
function handlerNamesOf(controller: Type): string[] {
    const names = new Set<string>();
    let prototype: unknown = controller.prototype;
    while (typeof prototype === 'object' && prototype !== null && prototype !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(prototype)) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
            if (name !== 'constructor' && typeof descriptor?.value === 'function') {
                names.add(name);
            }
        }
        prototype = Object.getPrototypeOf(prototype);
    }

    return [...names].sort();
}

async function resolveEntry(
    entry: unknown,
): Promise<{ cls: Type; dynamic?: DynamicModule } | null> {
    const resolved: unknown = await entry;
    if (resolved === null || resolved === undefined) {
        return null;
    }
    if (isObject(resolved) && typeof resolved.forwardRef === 'function') {
        return resolveEntry((resolved.forwardRef as () => unknown)());
    }
    if (isObject(resolved) && typeof resolved.module === 'function') {
        return { cls: resolved.module as Type, dynamic: resolved as unknown as DynamicModule };
    }
    if (typeof resolved === 'function') {
        return { cls: resolved as Type };
    }

    return null;
}

/** Контроллеры графа модулей по метаданным: приложение не создаётся. */
async function collectControllers(root: ModuleEntry): Promise<Type[]> {
    const seen = new Set<unknown>();
    const controllers = new Set<Type>();
    const queue: unknown[] = [root];
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        const resolved = await resolveEntry(entry);
        const key = resolved?.dynamic ?? resolved?.cls;
        if (resolved === null || seen.has(key)) {
            continue;
        }
        seen.add(key);
        const staticImports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, resolved.cls) ??
            []) as unknown[];
        const staticControllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, resolved.cls) ??
            []) as Type[];
        queue.push(...staticImports, ...(resolved.dynamic?.imports ?? []));
        for (const controller of [...staticControllers, ...(resolved.dynamic?.controllers ?? [])]) {
            controllers.add(controller);
        }
    }

    return [...controllers];
}

function securitySchemes(built: readonly BuiltOperation[]): JsonObject {
    const scopesOf = (scheme: 'serviceToken' | 'userToken') =>
        Object.fromEntries(
            [
                ...new Set(
                    built.flatMap((item) =>
                        item.security?.schemes.includes(scheme) === true
                            ? item.security.scopes
                            : [],
                    ),
                ),
            ]
                .sort()
                .map((scope) => [scope, scope]),
        );

    return {
        serviceToken: {
            type: 'oauth2',
            description: 'сервисный токен client_credentials (at+jwt) Identity',
            flows: {
                clientCredentials: { tokenUrl: '/oidc/token', scopes: scopesOf('serviceToken') },
            },
        },
        userToken: {
            type: 'oauth2',
            description: 'токен пользователя (at+jwt) Identity',
            flows: {
                authorizationCode: {
                    authorizationUrl: '/oidc/auth',
                    tokenUrl: '/oidc/token',
                    scopes: scopesOf('userToken'),
                },
            },
        },
    };
}

/**
 * Документ OpenAPI 3.1 сервиса по метаданным модулей и контроллеров (§3.5): приложение не создаётся, окружение не
 * нужно. В документ входят только маршруты с `@Api`; пути и коды отсортированы. Внутренняя функция (CLI, тесты).
 */
export async function buildOpenApiDocument(
    module: ModuleEntry,
    info: { readonly title: string; readonly version: string },
    logger?: Pick<Logger, 'debug'>,
): Promise<OpenApiDocument> {
    const built: BuiltOperation[] = [];
    for (const controller of await collectControllers(module)) {
        for (const handlerName of handlerNamesOf(controller)) {
            const route = apiRouteOf(controller, handlerName);
            for (const path of route?.paths ?? []) {
                built.push(buildOperation(route as ApiRoute, path));
            }
        }
    }
    const paths: Record<string, Record<string, JsonObject>> = {};
    const sorted = [...built].sort(
        (a, b) =>
            a.path.localeCompare(b.path) ||
            METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
    );
    for (const item of sorted) {
        const operations = paths[item.path] ?? {};
        operations[item.method] = item.operation;
        paths[item.path] = operations;
    }
    logger?.debug({ operations: built.length }, 'openapi: собран');

    return {
        openapi: '3.1.0',
        info: { title: info.title, version: info.version },
        paths,
        components: {
            securitySchemes: securitySchemes(built),
            schemas: { ErrorResponse: ERROR_RESPONSE },
        },
    };
}
