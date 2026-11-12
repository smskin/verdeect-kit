// AC-3.7 (UC-14): заголовки идемпотентности в OpenAPI по метаданным @Idempotent (prd.md §3.5, §3.3а; П10):
// Idempotency-Key — параметр заголовка, Idempotent-Replayed — заголовок успешного ответа, ошибки 409/422 и 400 (required).
import 'reflect-metadata';
import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { Validator } from '@seriousme/openapi-schema-validator';
import { VerdeectAuthGuard } from '@verdeect/auth/nest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Api } from '../../../src/http/api/api.decorator.js';
import { buildOpenApiDocument } from '../../../src/http/api/openapi-document.js';
import { ZodValidationPipe } from '../../../src/http/zod-validation.pipe.js';
import { Idempotent } from '../../../src/idempotency/idempotent.decorator.js';
import { expectMatchesApi } from '../../../src/testing/expect-matches-api.js';

const Order = z.object({ id: z.string() });
const CreateOrder = z.strictObject({ title: z.string() });

@Controller('orders')
@UseGuards(VerdeectAuthGuard)
class OrdersController {
    @Post()
    @Api({ summary: 'Создать заказ', response: Order })
    @Idempotent()
    create(@Body(new ZodValidationPipe(CreateOrder)) _body: z.output<typeof CreateOrder>) {
        return { id: 'o1' };
    }

    @Post('strict')
    @Api({ summary: 'Создать заказ с обязательным ключом', response: Order })
    @Idempotent({ required: true })
    strict() {
        return { id: 'o2' };
    }

    @Post('plain')
    @Api({ summary: 'Без идемпотентности', response: Order })
    plain() {
        return { id: 'o3' };
    }
}

@Module({ controllers: [OrdersController] })
class OrdersModule {}

type Operation = {
    parameters?: { name: string; in: string; required: boolean; schema: object }[];
    responses: Record<string, { description: string; headers?: Record<string, object> }>;
};

async function operations() {
    const document = await buildOpenApiDocument(OrdersModule, {
        title: 'orders',
        version: '1.0.0',
    });
    const op = (path: string) => document.paths[path]?.post as unknown as Operation;

    return { document, op };
}

function response(statusCode: number, body: unknown) {
    return { statusCode, json: () => body };
}

function error(code: string) {
    return { error: { code, message: 'x', details: {} } };
}

describe('UC-14: OpenAPI идемпотентности', () => {
    it('AC-3.7: Idempotency-Key в parameters, required по опции, pattern O', async () => {
        const { op } = await operations();
        const key = (path: string) =>
            op(path).parameters?.find((item) => item.name === 'Idempotency-Key');

        expect(key('/orders')).toEqual({
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', pattern: '^[\\x21-\\x7E]{1,200}$' },
        });
        expect(key('/orders/strict')?.required).toBe(true);
        expect(op('/orders/strict').parameters?.at(-1)?.name).toBe('Idempotency-Key');
    });

    it('AC-3.7: Idempotent-Replayed в заголовках успешного ответа', async () => {
        const { op } = await operations();

        expect(op('/orders').responses['201']?.headers).toEqual({
            'Idempotent-Replayed': {
                schema: { type: 'string', enum: ['true'] },
                description: 'ответ сохранён и повторён',
            },
        });
    });

    it('AC-3.7: 409 IDEMPOTENCY_IN_PROGRESS, 422 IDEMPOTENCY_KEY_REUSED, 400 IDEMPOTENCY_KEY_REQUIRED (только required)', async () => {
        const { op } = await operations();
        const optional = op('/orders').responses;
        const strict = op('/orders/strict').responses;

        expect(optional['409']?.description).toBe('IDEMPOTENCY_IN_PROGRESS');
        expect(optional['422']?.description).toBe('VALIDATION_FAILED, IDEMPOTENCY_KEY_REUSED');
        expect(optional['400']?.description).toBe('BAD_REQUEST');
        // Без zod-pipe тела BAD_REQUEST не добавляется (стандартные ошибки по факту, v1.24).
        expect(strict['400']?.description).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('AC-3.7: маршрут без @Idempotent — без этих заголовков', async () => {
        const { op } = await operations();
        const plain = op('/orders/plain');

        expect(plain.parameters?.some((item) => item.name === 'Idempotency-Key') ?? false).toBe(
            false,
        );
        expect(plain.responses['201']?.headers).toBeUndefined();
        expect(plain.responses['409']).toBeUndefined();
    });

    it('AC-3.7: expectMatchesApi принимает 409 IDEMPOTENCY_IN_PROGRESS и 400 IDEMPOTENCY_KEY_REQUIRED на маршруте с @Idempotent({required: true})', () => {
        expectMatchesApi(response(409, error('IDEMPOTENCY_IN_PROGRESS')), [
            OrdersController,
            'strict',
        ]);
        expectMatchesApi(response(400, error('IDEMPOTENCY_KEY_REQUIRED')), [
            OrdersController,
            'strict',
        ]);
        expectMatchesApi(response(422, error('IDEMPOTENCY_KEY_REUSED')), [
            OrdersController,
            'strict',
        ]);
    });

    it('AC-3.7: документ с заголовками идемпотентности валиден (OpenAPI 3.1)', async () => {
        const { document } = await operations();
        const result = await new Validator().validate(document as never);

        expect(result.errors).toBeUndefined();
        expect(result.valid).toBe(true);
    });
});
