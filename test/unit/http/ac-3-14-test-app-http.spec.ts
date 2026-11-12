// AC-3.14 (UC-4, prd.md §3.8): createTestApp({http}) — тот же объект KitHttpOptions, что bootstrapService({http}):
// bodyLimit (413 по пределу), securityHeaders: false (нет заголовков пакета), configureFastify (хук вызван до маршрутов)
// доходят до createHttpApp (KT-62).
import type { FastifyInstance } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../../src/testing/index.js';
import { ProbeModule, useProbeEnv } from './support.js';

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
});
