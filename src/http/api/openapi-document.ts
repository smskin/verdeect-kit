// Построитель OpenAPI 3.1 по метаданным Nest без создания приложения (prd.md §3.5, AC-3.7, AC-3.8). Эталон — I
// openapi-document.ts: путь из PATH_METADATA (`:x` → `{x}`), статус из HTTP_CODE_METADATA (POST 201, иначе 200), тело,
// query и path — из ZodValidationPipe в ROUTE_ARGS_METADATA, z.toJSONSchema без $schema (io: input/output), operationId,
// ErrorResponse, схемы serviceToken/userToken. По PRD: обход метаданных модулей (imports, DynamicModule, промисы forRoot,
// forwardRef; controllers) вместо ModulesContainer; только маршруты с @Api; ошибки — errors маршрута (статусы из реестра
// defineErrors) + стандартные 400, 422, 429 и 401/403 у защищённых; защита — @UseGuards(VerdeectAuthGuard) и Require*
// @verdeect/auth; X-On-Behalf-Of не переносится (домен I); Idempotency-Key — по метаданным @Idempotent (internal/metadata.ts,
// E4); extra — глубокое слияние.
import type { DynamicModule, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import {
    GUARDS_METADATA,
    HTTP_CODE_METADATA,
    METHOD_METADATA,
    MODULE_METADATA,
    PATH_METADATA,
    ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { VerdeectAuthGuard } from '@verdeect/auth/nest';
import { IDEMPOTENT_METADATA, type KitIdempotentOptions } from '../../internal/metadata.js';
import type { Logger } from 'pino';
import { z } from 'zod';
import { errorStatus } from '../errors.js';
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
    readonly paths: readonly string[];
    readonly status: number;
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

function joinPath(...parts: string[]): string {
    const path = parts
        .flatMap((part) => part.split('/'))
        .filter((segment) => segment !== '')
        .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
        .join('/');

    return `/${path}`;
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

/** Глубокое слияние `extra` (операция, `contracts/openapi.extra.json`): объекты сливаются, прочее заменяется. */
export function deepMerge(target: JsonObject, extra: Readonly<JsonObject>): JsonObject {
    const result: JsonObject = { ...target };
    for (const [key, value] of Object.entries(extra)) {
        const current = result[key];
        result[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
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

/** Ошибки операции: статус → коды. */
function errorsOf(route: ApiRoute, security: RouteSecurity | null): Map<number, string[]> {
    const errors = new Map<number, string[]>([
        [400, ['BAD_REQUEST']],
        [422, ['VALIDATION_FAILED']],
        [429, ['RATE_LIMITED']],
    ]);
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
    for (const code of route.api.errors ?? []) {
        const status = errorStatus(code);
        if (status === undefined) {
            throw new Error(
                `openapi: ${route.controller.name}.${route.handlerName} — код ${code} не зарегистрирован в defineErrors`,
            );
        }
        errors.set(status, [...(errors.get(status) ?? []), code]);
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
    path: string,
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
    const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => {
        const name = match[1] ?? '';

        return {
            name,
            in: 'path',
            required: true,
            schema: pathSchemas.get(name) ?? { type: 'string' },
        };
    });

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

function buildOperation(route: ApiRoute, path: string): BuiltOperation {
    const security = securityOf(route.controller, route.handler);
    const { parameters, body } = parametersOf(route, path);
    const schema = responseSchemaOf(route.api);
    const responses: Record<string, JsonObject> = {
        [String(route.status)]:
            schema === null
                ? { description: 'успех, без тела' }
                : { description: 'успех', content: { 'application/json': { schema } } },
    };
    if (idempotentOf(route) !== null) {
        const success = responses[String(route.status)];
        responses[String(route.status)] = {
            ...success,
            headers: {
                'Idempotent-Replayed': {
                    schema: { type: 'string', enum: ['true'] },
                    description: 'ответ сохранён и повторён',
                },
            },
        };
    }
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

/** Маршрут `[Controller, 'method']` с `@Api`; без `@Api` — `null`; `@Api` без метода HTTP — Error. */
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
    const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
        (method === 'post' ? 201 : 200);
    const paths = pathsOf(Reflect.getMetadata(PATH_METADATA, controller)).flatMap((prefix) =>
        pathsOf(handlerPath).map((suffix) => joinPath(prefix, suffix)),
    );

    return { controller, handlerName, handler, api, method, paths, status };
}

/** Схема успешного ответа, статус и описанные статусы ошибок маршрута для `expectMatchesApi`. Внутренняя функция. */
export function routeResponseSchema(route: readonly [Type, string]): {
    readonly status: number;
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
        schema: responseSchemaOf(api.api),
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
