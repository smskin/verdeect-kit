// AC-3.7 (UC-14): OpenAPI 3.1 по метаданным без запуска приложения и expectMatchesApi (prd.md §3.5, §3.8). Перенос I
// test/http/api/openapi.http-spec.ts: документ проходит валидатор, схемы компилируются, безопасность по маршрутам,
// ответы соответствуют схеме.
import { HttpException, Logger, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Validator } from '@seriousme/openapi-schema-validator';
import { VerdeectAuthGuard } from '@verdeect/auth/nest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from '../../../src/http/api/openapi-document.js';
import { expectMatchesApi } from '../../../src/testing/index.js';
import {
    ApiAppModule,
    CatalogController,
    ItemsController,
    PublicController,
    TenantController,
} from '../../fixtures/http/api-app.module.js';

const INFO = { title: 'api-app', version: '1.0.0' };

type Operation = {
    security?: Record<string, string[]>[];
    parameters?: { name: string; in: string; required: boolean; schema: object }[];
    requestBody?: { content: Record<string, { schema: object }> };
    responses: Record<
        string,
        { description: string; content?: Record<string, { schema: object }> }
    >;
};

async function operations() {
    const document = await buildOpenApiDocument(ApiAppModule, INFO);
    const op = (path: string, method: string) =>
        document.paths[path]?.[method] as unknown as Operation;

    return { document, op };
}

function response(statusCode: number, body: unknown) {
    return { statusCode, json: () => body };
}

describe('UC-14: OpenAPI из кода', () => {
    it('AC-3.7: документ проходит валидатор OpenAPI 3.1', async () => {
        const { document } = await operations();
        const result = await new Validator().validate(document as never);

        expect(result.errors).toBeUndefined();
        expect(result.valid).toBe(true);
        expect(Object.keys(document.paths)).toEqual([
            '/catalog/count',
            '/catalog/list',
            '/items',
            '/items/{id}',
            '/public/info',
            '/public/limited',
            '/public/notes',
            '/public/search',
            '/tenant/settings',
        ]);
    });

    it('AC-3.7: схемы тела, query и ответа ({items, nextCursor})', async () => {
        const { op } = await operations();
        const list = op('/items', 'get');

        expect(list.parameters?.map((item) => [item.name, item.in, item.required])).toEqual([
            ['cursor', 'query', false],
            ['limit', 'query', false],
        ]);
        expect(list.responses['200']?.content?.['application/json']?.schema).toMatchObject({
            type: 'object',
            properties: {
                items: { type: 'array' },
                nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            },
            required: ['items', 'nextCursor'],
        });
        expect(op('/items', 'post').requestBody?.content['application/json']?.schema).toMatchObject(
            {
                type: 'object',
                required: ['title'],
            },
        );
        expect(op('/items/{id}', 'get').parameters?.[0]).toMatchObject({
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^item-\\d+$' },
        });
    });

    it('AC-3.7: ошибки маршрута (409) и стандартные по факту — zod-pipe тела: 400 и 422, @verdeect/auth: 401/403, 429 нет', async () => {
        const { op } = await operations();
        const create = op('/items', 'post');

        expect(Object.keys(create.responses)).toEqual(['201', '400', '401', '403', '409', '422']);
        expect(create.responses['409']?.description).toBe('VERSION_CONFLICT');
    });

    it('AC-3.7: маршрут без zod-pipe, errors и аутентификации — без стандартных ошибок (нет 400, 422, 429)', async () => {
        const { op } = await operations();

        expect(Object.keys(op('/public/info', 'get').responses)).toEqual(['200']);
    });

    it('AC-3.7: @Body() и @Query() без zod-pipe — нет 400 и 422; expectMatchesApi отклоняет 400 и 422 у такого маршрута', async () => {
        const { op } = await operations();
        const failed = { error: { code: 'VALIDATION_FAILED', message: 'x', details: {} } };

        expect(Object.keys(op('/public/notes', 'post').responses)).toEqual(['201']);
        expect(Object.keys(op('/public/search', 'get').responses)).toEqual(['200']);
        for (const route of [
            [PublicController, 'note'],
            [PublicController, 'search'],
        ] as const) {
            for (const status of [400, 422]) {
                expect(() => expectMatchesApi(response(status, failed), route)).toThrow(
                    new RegExp(`статус ${String(status)} не описан`),
                );
            }
        }
    });

    it("AC-3.7: errors: ['RATE_LIMITED'] — 429 с Retry-After; без zod-pipe — нет 400 и 422", async () => {
        const { op } = await operations();
        const limited = op('/public/limited', 'get');

        expect(Object.keys(limited.responses)).toEqual(['200', '429']);
        expect(limited.responses['429']?.description).toBe('RATE_LIMITED');
    });

    it('AC-3.7: zod-pipe только пути — 422 VALIDATION_FAILED без 400; query (keyset) — 400 и 422', async () => {
        const { op } = await operations();

        expect(Object.keys(op('/items/{id}', 'get').responses)).toEqual([
            '200',
            '401',
            '403',
            '422',
        ]);
        expect(Object.keys(op('/items', 'get').responses)).toEqual([
            '200',
            '400',
            '401',
            '403',
            '422',
        ]);
    });

    it('AC-3.7: схема безопасности serviceToken с областью items:read; незащищённый маршрут без security', async () => {
        const { document, op } = await operations();

        expect(op('/items', 'get').security).toEqual([
            { serviceToken: ['items:read'] },
            { userToken: ['items:read'] },
        ]);
        expect(op('/public/info', 'get').security).toBeUndefined();
        expect(JSON.stringify(document.components)).toContain('"items:read"');
    });

    it('AC-3.7: expectMatchesApi проходит на верном ответе и падает на ответе вне схемы (лишнее поле, неверный тип)', () => {
        expectMatchesApi(
            response(200, { items: [{ id: 'item-1', title: 'Первый' }], nextCursor: null }),
            [ItemsController, 'list'],
        );
        expectMatchesApi(response(200, { name: 'api-app' }), [PublicController, 'info']);

        expect(() =>
            expectMatchesApi(response(201, { id: 'item-3', title: 'x', extra: 1 }), [
                ItemsController,
                'create',
            ]),
        ).toThrow(/ответ вне схемы @Api/);
        expect(() =>
            expectMatchesApi(response(201, { id: 3, title: 'x' }), [ItemsController, 'create']),
        ).toThrow(/\/id/);
        expect(() => expectMatchesApi(response(200, {}), [PublicController, 'hidden'])).toThrow(
            /нет @Api/,
        );
    });

    it('AC-3.7: маршрут с @RequireTenant() — ответ 409 TENANT_REQUIRED в responses (KT-17)', async () => {
        const { op } = await operations();
        const settings = op('/tenant/settings', 'get');

        expect(settings.responses['409']?.description).toBe('TENANT_REQUIRED');
        expect(settings.responses['409']?.content?.['application/json']?.schema).toEqual({
            $ref: '#/components/schemas/ErrorResponse',
        });
        expect(op('/items', 'get').responses['409']).toBeUndefined();
    });

    it('AC-3.7: expectMatchesApi принимает настоящий ответ guard’а @verdeect/auth 409 TENANT_REQUIRED (KT-17)', async () => {
        const verifier = {
            verify: () => Promise.resolve({ kind: 'service', sub: 's', clientId: 's', scopes: [] }),
        };
        vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
        const guard = new VerdeectAuthGuard(verifier as never, new Reflector());
        const context = {
            getHandler: () => TenantController.prototype.settings,
            getClass: () => TenantController,
            switchToHttp: () => ({
                getRequest: () => ({ headers: { authorization: 'Bearer t' } }),
            }),
        } as unknown as ExecutionContext;
        const denied: unknown = await guard.canActivate(context).catch((error: unknown) => error);
        if (!(denied instanceof HttpException)) {
            throw new Error('guard не отказал');
        }

        expect(denied.getStatus()).toBe(409);
        expect(denied.getResponse()).toEqual({
            error: { code: 'TENANT_REQUIRED', message: 'Не выбрана компания', details: {} },
        });
        expectMatchesApi(response(denied.getStatus(), denied.getResponse()), [
            TenantController,
            'settings',
        ]);
        expect(() =>
            expectMatchesApi(response(409, { error: 'x' }), [TenantController, 'settings']),
        ).toThrow(/ответ вне схемы @Api/);
        expect(() =>
            expectMatchesApi(response(500, denied.getResponse()), [TenantController, 'settings']),
        ).toThrow(/статус 500 не описан/);
    });

    it('AC-3.7: expectMatchesApi — схема Ajv компилируется один раз на маршрут и статус (KT-17)', () => {
        const compile = vi.spyOn(Ajv2020.prototype, 'compile');
        const ok = response(200, { tenant: 'acme' });

        expectMatchesApi(ok, [TenantController, 'settings']);
        expectMatchesApi(ok, [TenantController, 'settings']);

        expect(compile).toHaveBeenCalledTimes(1);
    });

    it('AC-3.7: @Api базового абстрактного контроллера — маршрут с путём наследника; переопределённый метод — один маршрут (KT-17)', async () => {
        const { document, op } = await operations();
        const operations_ = Object.values(document.paths).flatMap((item) => Object.values(item));

        expect(op('/catalog/list', 'get')).toMatchObject({ summary: 'Каталог: список' });
        expect(op('/catalog/count', 'get')).toMatchObject({ summary: 'Каталог: число записей' });
        expect(
            operations_.filter((item) => String(item.summary).startsWith('Каталог: число')),
        ).toHaveLength(1);
        expectMatchesApi(response(200, { items: [] }), [CatalogController, 'list']);
    });
});
