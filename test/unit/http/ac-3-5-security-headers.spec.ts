// AC-3.5 (UC-4): заголовки безопасности API на всех ответах и /ok (prd.md §3.5). Перенос I
// ac-8-3-security-headers.http-spec.ts — только базовые заголовки API (HSTS, CSP — сервис и Traefik).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
