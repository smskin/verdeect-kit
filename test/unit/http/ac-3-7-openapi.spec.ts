// AC-3.7 (UC-14): OpenAPI 3.1 по метаданным без запуска приложения и expectMatchesApi (prd.md §3.5, §3.8). Перенос I
// test/http/api/openapi.http-spec.ts: документ проходит валидатор, схемы компилируются, безопасность по маршрутам,
// ответы соответствуют схеме.
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/http/api/openapi-document.js';
import { expectMatchesApi } from '../../../src/testing/index.js';
import {
    ApiAppModule,
    ItemsController,
    PublicController,
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
        expect(Object.keys(document.paths)).toEqual(['/items', '/items/{id}', '/public/info']);
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

    it('AC-3.7: ошибки маршрута (409) и стандартные 400/401/403/422/429', async () => {
        const { op } = await operations();
        const create = op('/items', 'post');

        expect(Object.keys(create.responses)).toEqual([
            '201',
            '400',
            '401',
            '403',
            '409',
            '422',
            '429',
        ]);
        expect(create.responses['409']?.description).toBe('VERSION_CONFLICT');
        expect(Object.keys(op('/public/info', 'get').responses)).toEqual([
            '200',
            '400',
            '422',
            '429',
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
});
