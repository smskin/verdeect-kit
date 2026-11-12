// AC-3.15 (UC-4, prd.md §3.5 v1.23; К4 Orchestrator): DomainError(code, details?, {message?, headers?, status?}) —
// текст случая вместо текста словаря; заголовки ответа (имена — к нижнему регистру); запрещённые заголовки — ошибка
// при создании; код с несколькими объявленными статусами: status из объявленных → он, без status или вне — 500 и одно
// событие GlitchTip; все статусы кода — в OpenAPI и expectMatchesApi.
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KitConfigModule } from '../../../src/config/index.js';
import { buildOpenApiDocument } from '../../../src/http/api/openapi-document.js';
import { Api, defineErrors, DomainError, kitErrors } from '../../../src/http/index.js';
import { createTestApp, expectMatchesApi, expectProblem } from '../../../src/testing/index.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { probeEnv, useProbeEnv } from './support.js';

defineErrors({
    ...kitErrors,
    PLAN_LIMIT: { status: [403, 429], message: 'Лимит тарифа' },
    UPGRADE_REQUIRED: { status: 426, message: 'Нужно обновить клиент' },
});

@Controller('plan')
class PlanController {
    @Get('message')
    message(): never {
        throw new DomainError('PLAN_LIMIT', {}, { status: 403, message: 'Лимит проектов: 3' });
    }

    @Get('upgrade')
    upgrade(): never {
        throw new DomainError('UPGRADE_REQUIRED', {}, { headers: { Upgrade: 'websocket' } });
    }

    @Get('rate')
    @Api({ summary: 'Лимит', response: z.object({ ok: z.boolean() }), errors: ['PLAN_LIMIT'] })
    rate(): never {
        throw new DomainError('PLAN_LIMIT', {}, { status: 429 });
    }

    @Get('no-status')
    noStatus(): never {
        throw new DomainError('PLAN_LIMIT');
    }

    @Get('wrong-status')
    wrongStatus(): never {
        throw new DomainError('PLAN_LIMIT', {}, { status: 500 });
    }
}

@Module({ imports: [KitConfigModule.forRoot({ schema: probeEnv })], controllers: [PlanController] })
class PlanModule {}

useProbeEnv();

let delivered: DeliveredEvent[];
let app: NestFastifyApplication;

beforeAll(() => {
    delivered = initFakeSentry().delivered;
});

afterAll(async () => {
    await Sentry.close(1000);
});

beforeEach(async () => {
    delivered.splice(0);
    app = await createTestApp({ module: PlanModule, service: 'probe' });

    return () => app.close();
});

async function get(url: string) {
    const res = await app.inject({ method: 'GET', url });
    await Sentry.flush(1000);

    return res;
}

describe('UC-4: DomainError с опциями', () => {
    it('AC-3.15: message — текст случая вместо текста словаря', async () => {
        const res = await get('/plan/message');

        expectProblem(res, { status: 403, code: 'PLAN_LIMIT' });
        expect(res.json()).toMatchObject({ error: { message: 'Лимит проектов: 3' } });
    });

    it("AC-3.15: headers: {Upgrade: 'websocket'} у кода со статусом 426 → заголовок upgrade в ответе (имя в нижнем регистре)", async () => {
        const res = await get('/plan/upgrade');

        expectProblem(res, { status: 426, code: 'UPGRADE_REQUIRED' });
        expect(res.headers['upgrade']).toBe('websocket');
        expect(delivered).toHaveLength(0);
    });

    it.each([
        ['set-cookie', 'UPGRADE_REQUIRED'],
        ['Set-Cookie', 'UPGRADE_REQUIRED'],
        ['retry-after', 'RATE_LIMITED'],
        ['referrer-policy', 'UPGRADE_REQUIRED'],
        ['x-content-type-options', 'UPGRADE_REQUIRED'],
    ])('AC-3.15: запрещённый заголовок %s у %s → TypeError при создании', (name, code) => {
        expect(() => new DomainError(code, {}, { headers: { [name]: 'x' } })).toThrow(TypeError);
    });

    it.each([
        ['x bad', 'ok'],
        ['x-note', 'a\r\nset-cookie: s=1'],
    ])(
        'AC-3.15: недопустимое имя «%s» или значение заголовка → TypeError при создании',
        (name, value) => {
            expect(
                () => new DomainError('UPGRADE_REQUIRED', {}, { headers: { [name]: value } }),
            ).toThrow(TypeError);
        },
    );

    it('AC-3.15: retry-after разрешён коду кроме RATE_LIMITED (PLAN_LIMIT 429)', () => {
        const error = new DomainError(
            'PLAN_LIMIT',
            {},
            { status: 429, headers: { 'Retry-After': '60' } },
        );

        expect(error.headers).toEqual({ 'retry-after': '60' });
    });

    it('AC-3.15: код {status: [403, 429]} со status: 429 → 429, без события GlitchTip', async () => {
        const res = await get('/plan/rate');

        expectProblem(res, { status: 429, code: 'PLAN_LIMIT' });
        expect(delivered).toHaveLength(0);
    });

    it.each(['/plan/no-status', '/plan/wrong-status'])(
        'AC-3.15: код с несколькими статусами — %s → 500 INTERNAL_ERROR и одно событие GlitchTip',
        async (url) => {
            const res = await get(url);

            expectProblem(res, { status: 500, code: 'INTERNAL_ERROR' });
            expect(delivered).toHaveLength(1);
        },
    );

    it('AC-3.15: оба статуса кода — в документе OpenAPI и в expectMatchesApi', async () => {
        const document = await buildOpenApiDocument(PlanModule, { title: 'plan', version: '1' });
        const responses = (
            document.paths['/plan/rate']?.['get'] as {
                responses: Record<string, { description: string }>;
            }
        ).responses;

        expect(responses['403']?.description).toContain('PLAN_LIMIT');
        expect(responses['429']?.description).toContain('PLAN_LIMIT');
        const body = { error: { code: 'PLAN_LIMIT', message: 'Лимит тарифа', details: {} } };
        for (const statusCode of [403, 429]) {
            expectMatchesApi({ statusCode, json: () => body }, [PlanController, 'rate']);
        }
    });
});
