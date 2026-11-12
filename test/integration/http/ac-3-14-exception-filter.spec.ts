// AC-3.14 (UC-4, prd.md §3.5 v1.21): exceptionFilter — фильтр сервиса вместо KitExceptionFilter в APP_FILTER. Через него
// идут ошибка маршрута Nest, 404 ROUTE_NOT_FOUND и ошибка хука Fastify (configureFastify); свой случай — свой ответ как есть,
// остальное — делегирование в kit.catch: 429 + Retry-After, 413, 500 и ровно одно событие GlitchTip. v1.22: тот же объект
// опций http в createTestApp — фильтр сервиса работает так же: все сценарии — на обеих сборках (KT-62).
import 'reflect-metadata';
import {
    Body,
    Catch,
    Controller,
    Get,
    HttpCode,
    Injectable,
    Module,
    Post,
    type ArgumentsHost,
    type ExceptionFilter,
} from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as Sentry from '@sentry/nestjs';
import type { FastifyReply } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import {
    createHttpApp,
    DomainError,
    KitExceptionFilter,
    type KitHttpOptions,
} from '../../../src/http/index.js';
import { createTestApp, expectProblem } from '../../../src/testing/index.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';

/** Свой случай фильтра сервиса: ответ 418 без участия пакета. */
class TeapotError extends Error {}

/** Что увидел фильтр сервиса: имя класса исключения. */
const seen: string[] = [];

@Catch()
@Injectable()
class ServiceFilter implements ExceptionFilter {
    constructor(private readonly kit: KitExceptionFilter) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        seen.push(exception instanceof Error ? exception.constructor.name : typeof exception);
        if (exception instanceof TeapotError) {
            void host.switchToHttp().getResponse<FastifyReply>().status(418).send({ own: true });

            return;
        }
        this.kit.catch(exception, host);
    }
}

@Controller()
class FilterController {
    @Get('teapot')
    teapot(): never {
        throw new TeapotError('свой случай');
    }

    @Get('limited')
    limited(): never {
        throw new DomainError('RATE_LIMITED', { retryAfterSec: 7 });
    }

    @Get('boom')
    boom(): never {
        throw new Error('MARK_SECRET неожиданная');
    }

    @Post('echo')
    @HttpCode(200)
    echo(@Body() body: unknown): unknown {
        return body;
    }
}

const env = defineEnv({ ...envBase });

@Module({
    imports: [KitConfigModule.forRoot({ schema: env })],
    controllers: [FilterController],
})
class FilterModule {}

let delivered: DeliveredEvent[];
let app: NestFastifyApplication;

beforeAll(() => {
    delivered = initFakeSentry().delivered;
});

afterAll(async () => {
    await Sentry.close(1000);
});

/** Один объект опций http — как в main.ts сервиса и в его тестах. */
const http: KitHttpOptions = {
    bodyLimit: 64,
    exceptionFilter: ServiceFilter,
    configureFastify: (fastify) => {
        fastify.addHook('onRequest', async (request) => {
            if (request.headers['x-hook-boom'] !== undefined) {
                throw new TeapotError('ошибка хука');
            }
        });
    },
};

const BUILDS = [
    ['createHttpApp', () => createHttpApp({ module: FilterModule, service: 'probe', ...http })],
    [
        'createTestApp({http})',
        () => createTestApp({ module: FilterModule, service: 'probe', http }),
    ],
] as const;

describe.each(BUILDS)('UC-4: фильтр ошибок сервиса — %s', (_name, build) => {
    beforeEach(async () => {
        vi.stubEnv('LOG_LEVEL', 'silent');
        vi.stubEnv('SHUTDOWN_DRAIN_MS', '0');
        app = await build();
        seen.splice(0);
        delivered.splice(0);
    });

    afterEach(async () => {
        await app.close();
        vi.unstubAllEnvs();
    });

    it('AC-3.14: ошибка маршрута — фильтр сервиса, свой ответ 418 как есть', async () => {
        const res = await app.inject({ method: 'GET', url: '/teapot' });

        expect(res.statusCode).toBe(418);
        expect(res.json()).toEqual({ own: true });
        expect(seen).toEqual(['TeapotError']);
    });

    it('AC-3.14: несуществующий путь — фильтр сервиса, делегирование → 404 ROUTE_NOT_FOUND', async () => {
        const res = await app.inject({ method: 'GET', url: '/nope' });

        expectProblem(res, { status: 404, code: 'ROUTE_NOT_FOUND' });
        expect(seen).toEqual(['NotFoundException']);
    });

    it('AC-3.14: ошибка хука Fastify (configureFastify) — фильтр сервиса, свой ответ; заголовки безопасности пакета на месте', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/ok',
            headers: { 'x-hook-boom': '1' },
        });

        expect(res.statusCode).toBe(418);
        expect(res.json()).toEqual({ own: true });
        expect(seen).toEqual(['TeapotError']);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('AC-3.14: делегирование RATE_LIMITED → 429 с Retry-After', async () => {
        const res = await app.inject({ method: 'GET', url: '/limited' });

        expectProblem(res, { status: 429, code: 'RATE_LIMITED' });
        expect(res.headers['retry-after']).toBe('7');
        expect(seen).toEqual(['DomainError']);
    });

    it('AC-3.14: делегирование — тело больше лимита → 413 PAYLOAD_TOO_LARGE', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/echo',
            payload: { title: 'x'.repeat(256) },
        });

        expectProblem(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
        expect(seen).toEqual(['HttpException']);
    });

    it('AC-3.14: делегирование необработанной ошибки → 500 INTERNAL_ERROR и ровно одно событие GlitchTip', async () => {
        const res = await app.inject({ method: 'GET', url: '/boom' });
        await Sentry.flush(1000);

        expectProblem(res, { status: 500, code: 'INTERNAL_ERROR' });
        expect(res.body).not.toContain('MARK_SECRET');
        expect(seen).toEqual(['Error']);
        expect(delivered).toHaveLength(1);
    });
});
