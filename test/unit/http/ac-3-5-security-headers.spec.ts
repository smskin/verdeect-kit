// AC-3.5 (UC-4): заголовки безопасности API на всех ответах и /ok (prd.md §3.5). Перенос I
// ac-8-3-security-headers.http-spec.ts — только базовые заголовки API (HSTS, CSP — сервис и Traefik). v1.21: securityHeaders
// {referrerPolicy} и false, неверная политика — TypeError до открытия порта.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpApp, type KitSecurityHeaders } from '../../../src/http/index.js';
import { createTestApp } from '../../../src/testing/index.js';
import { ProbeModule, useProbeEnv } from './support.js';

useProbeEnv();

let app: NestFastifyApplication;

beforeEach(async () => {
    app = await createTestApp({ module: ProbeModule, service: 'probe' });
});

afterEach(async () => {
    await app.close();
});

describe('UC-4: заголовки безопасности', () => {
    it('AC-3.5: nosniff и no-referrer на 200, 422, 404, 500 и /ok', async () => {
        const responses = await Promise.all([
            app.inject({
                method: 'POST',
                url: '/probe',
                payload: { title: 'a', tags: [] },
            }),
            app.inject({ method: 'POST', url: '/probe', payload: { title: '' } }),
            app.inject({ method: 'GET', url: '/nope' }),
            app.inject({ method: 'GET', url: '/boom' }),
            app.inject({ method: 'GET', url: '/ok' }),
        ]);

        expect(responses.map((res) => res.statusCode)).toEqual([200, 422, 404, 500, 200]);
        for (const res of responses) {
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['referrer-policy']).toBe('no-referrer');
        }
    });

    it("§3.5: /ok → 200 {status: 'ok'}, no-store", async () => {
        const res = await app.inject({ method: 'GET', url: '/ok' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok' });
        expect(res.headers['cache-control']).toBe('no-store');
    });
});

describe('UC-4: securityHeaders по роли', () => {
    async function withHeaders(
        securityHeaders: KitSecurityHeaders,
    ): Promise<NestFastifyApplication> {
        return createHttpApp({ module: ProbeModule, service: 'probe', securityHeaders });
    }

    it("AC-3.5: securityHeaders: {referrerPolicy: 'same-origin'} → Referrer-Policy: same-origin, nosniff на месте (200, 404, 500)", async () => {
        const custom = await withHeaders({ referrerPolicy: 'same-origin' });
        try {
            const responses = await Promise.all(
                ['/ok', '/nope', '/boom'].map((url) => custom.inject({ method: 'GET', url })),
            );

            expect(responses.map((res) => res.statusCode)).toEqual([200, 404, 500]);
            for (const res of responses) {
                expect(res.headers['referrer-policy']).toBe('same-origin');
                expect(res.headers['x-content-type-options']).toBe('nosniff');
            }
        } finally {
            await custom.close();
        }
    });

    it('AC-3.5: securityHeaders: false → ни одного заголовка безопасности от пакета', async () => {
        const bare = await withHeaders(false);
        try {
            for (const url of ['/ok', '/nope']) {
                const res = await bare.inject({ method: 'GET', url });

                expect(res.headers['referrer-policy']).toBeUndefined();
                expect(res.headers['x-content-type-options']).toBeUndefined();
            }
        } finally {
            await bare.close();
        }
    });

    it('AC-3.5: неверная политика → TypeError до сборки приложения', async () => {
        await expect(withHeaders({ referrerPolicy: 'never' as 'same-origin' })).rejects.toThrow(
            TypeError,
        );
        await expect(withHeaders({ referrerPolicy: 'never' as 'same-origin' })).rejects.toThrow(
            /referrerPolicy «never»/,
        );
    });
});
