// AC-3.4 (UC-4): неизвестный маршрут → 404 ROUTE_NOT_FOUND (prd.md §3.5). Обработчик Nest (NotFoundException) → фильтр.
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

describe('UC-4: неизвестный маршрут', () => {
    it("AC-3.4: GET /nope → 404 {ROUTE_NOT_FOUND, 'Адрес не найден', {}}", async () => {
        const res = await app.inject({ method: 'GET', url: '/nope' });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({
            error: { code: 'ROUTE_NOT_FOUND', message: 'Адрес не найден', details: {} },
        });
    });
});
