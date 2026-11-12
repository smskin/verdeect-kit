// AC-3.14 (UC-4, prd.md §3.8): createTestApp({http}) — тот же объект KitHttpOptions, что bootstrapService({http}):
// bodyLimit (413 по пределу), securityHeaders: false (нет заголовков пакета), configureFastify (хук вызван до маршрутов)
// доходят до createHttpApp (KT-62). v1.25: overrides useClass и useFactory, extraProviders, env объектом без process.env
// (два приложения с разным env параллельно), errorBody совпадает с телом ответа 429.
import 'reflect-metadata';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyInstance } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitConfigModule } from '../../../src/config/index.js';
import { DomainError, errorBody } from '../../../src/http/index.js';
import { createTestApp } from '../../../src/testing/index.js';
import { Greeter, ProbeModule, probeEnv, useProbeEnv } from './support.js';

@Injectable()
class FakeGreeter extends Greeter {
    override greet(): string {
        return 'подделка';
    }
}

/** Провайдер только тестового модуля (extraProviders). */
@Injectable()
class TestClock {
    now(): string {
        return '2026-11-13T00:00:00Z';
    }
}

@Controller()
class LimitedController {
    @Get('limited')
    limited(): never {
        throw new DomainError('RATE_LIMITED', { retryAfterSec: 2 });
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: probeEnv })],
    controllers: [LimitedController],
})
class LimitedModule {}

useProbeEnv();

let app: NestFastifyApplication | undefined;

afterEach(async () => {
    await app?.close();
    app = undefined;
});

describe('UC-4: createTestApp({http})', () => {
    it('AC-3.14: http.bodyLimit — тело больше предела → 413, в пределе → 200', async () => {
        app = await createTestApp({
            module: ProbeModule,
            service: 'probe',
            http: { bodyLimit: 64 },
        });
        const small = await app.inject({
            method: 'POST',
            url: '/probe',
            payload: { title: 'a', tags: [] },
        });
        const large = await app.inject({
            method: 'POST',
            url: '/probe',
            payload: { title: 'x'.repeat(100), tags: [] },
        });

        expect(small.statusCode).toBe(200);
        expect(large.statusCode).toBe(413);
        expect(large.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    });

    it('AC-3.14: http.securityHeaders: false — ответы 200, 404, 500 без заголовков безопасности пакета', async () => {
        app = await createTestApp({
            module: ProbeModule,
            service: 'probe',
            http: { securityHeaders: false },
        });
        const responses = await Promise.all(
            ['/ok', '/nope', '/boom'].map((url) => app?.inject({ method: 'GET', url })),
        );

        expect(responses.map((res) => res?.statusCode)).toEqual([200, 404, 500]);
        for (const res of responses) {
            expect(res?.headers['x-content-type-options']).toBeUndefined();
            expect(res?.headers['referrer-policy']).toBeUndefined();
        }
    });

    it('AC-3.14: http.configureFastify — вызван с экземпляром Fastify приложения, onRoute видит маршруты сервиса', async () => {
        const routes: string[] = [];
        const configureFastify = vi.fn((fastify: FastifyInstance) => {
            fastify.addHook(
                'onRoute',
                (route) => void routes.push(`${String(route.method)} ${route.url}`),
            );
        });
        app = await createTestApp({
            module: ProbeModule,
            service: 'probe',
            http: { configureFastify },
        });

        expect(configureFastify).toHaveBeenCalledTimes(1);
        expect(configureFastify).toHaveBeenCalledWith(app.getHttpAdapter().getInstance());
        expect(routes).toContain('POST /probe');
    });

    it('AC-3.14: overrides useClass и useFactory (с inject) заменяют провайдер; extraProviders доступны в тестовом модуле', async () => {
        app = await createTestApp({
            module: ProbeModule,
            service: 'probe',
            overrides: [{ provide: Greeter, useClass: FakeGreeter }],
            extraProviders: [TestClock],
        });
        expect(app.get(Greeter).greet()).toBe('подделка');
        expect(app.get(TestClock).now()).toBe('2026-11-13T00:00:00Z');
        await app.close();

        app = await createTestApp({
            module: ProbeModule,
            service: 'probe',
            extraProviders: [TestClock],
            overrides: [
                {
                    provide: Greeter,
                    useFactory: (clock: TestClock) => ({ greet: () => `фабрика ${clock.now()}` }),
                    inject: [TestClock],
                },
            ],
        });
        expect(app.get(Greeter).greet()).toBe('фабрика 2026-11-13T00:00:00Z');
    });

    it('AC-3.14: env объектом — process.env не читается и не меняется, два приложения с разным env параллельно', async () => {
        vi.stubEnv('REPLICA_ID', 'from-process');
        const before = { ...process.env };
        const [first, second] = await Promise.all(
            ['replica-a', 'replica-b'].map((replica) =>
                createTestApp({
                    module: ProbeModule,
                    service: 'probe',
                    env: { LOG_LEVEL: 'silent', SHUTDOWN_DRAIN_MS: '0', REPLICA_ID: replica },
                }),
            ),
        );
        try {
            expect(first?.get(ConfigService).get('REPLICA_ID')).toBe('replica-a');
            expect(second?.get(ConfigService).get('REPLICA_ID')).toBe('replica-b');
            expect(process.env).toEqual(before);
        } finally {
            await Promise.all([first?.close(), second?.close()]);
        }
    });

    it("AC-3.14: errorBody('RATE_LIMITED', {retryAfterSec: 2}) совпадает с телом ответа 429", async () => {
        app = await createTestApp({ module: LimitedModule, service: 'probe' });
        const res = await app.inject({ method: 'GET', url: '/limited' });

        expect(res.statusCode).toBe(429);
        expect(res.json()).toEqual(errorBody('RATE_LIMITED', { retryAfterSec: 2 }));
        expect(() => errorBody('NO_SUCH_CODE')).toThrow(TypeError);
    });
});
