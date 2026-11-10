// AC-3.1 (UC-4): ошибки запросов на createTestApp — 422/400/415/413 с кодами PRD, без GlitchTip (prd.md §3.5; правило
// «Expected Errors Are Not Reported»). Перенос P/O test/http/errors/request-errors.http-spec.ts и B
// test/http/shared/request-errors.http-spec.ts (коды PRD вместо кодов сервисов).
import * as Sentry from '@sentry/nestjs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, expectProblem } from '../../../src/testing/index.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { ProbeModule, useProbeEnv } from './support.js';

useProbeEnv();

let app: NestFastifyApplication;
let delivered: DeliveredEvent[];

beforeAll(() => {
    delivered = initFakeSentry().delivered;
});

afterAll(async () => {
    await Sentry.close(1000);
});

beforeEach(async () => {
    app = await createTestApp({ module: ProbeModule, service: 'probe' });
    delivered.splice(0);
});

afterEach(async () => {
    await app.close();
});

function post(payload: string, contentType = 'application/json') {
    return app.inject({
        method: 'POST',
        url: '/probe',
        headers: { 'content-type': contentType },
        payload,
    });
}

describe('UC-4: ошибки запросов', () => {
    it('AC-3.1: неверное тело → 422 VALIDATION_FAILED, issues title/tags.0, значений нет', async () => {
        const res = await post(JSON.stringify({ title: '', tags: [1], note: 'MARK_SECRET' }));

        expectProblem(res, {
            status: 422,
            code: 'VALIDATION_FAILED',
            issues: [
                { path: 'title', code: 'too_small' },
                { path: 'tags.0', code: 'invalid_type' },
                { path: '(body)', code: 'unrecognized_keys' },
            ],
        });
        expect(res.body).not.toContain('MARK_SECRET');
    });

    it('AC-3.1: не JSON → 400 BAD_REQUEST', async () => {
        expectProblem(await post('{"title":'), { status: 400, code: 'BAD_REQUEST' });
    });

    it('AC-3.1: Content-Type: application/xml → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
        expectProblem(await post('<a/>', 'application/xml'), {
            status: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
        });
    });

    it('AC-3.1: тело больше 1 MiB → 413 PAYLOAD_TOO_LARGE', async () => {
        const res = await post(JSON.stringify({ title: 'x'.repeat(1024 * 1024), tags: [] }));

        expectProblem(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    it('AC-3.1: ошибки запроса не отправляются в GlitchTip, /boom — ровно одно событие', async () => {
        await post('{"title":');
        await post('<a/>', 'application/xml');
        await post(JSON.stringify({ title: '' }));
        await Sentry.flush(1000);
        expect(delivered).toHaveLength(0);

        const boom = await app.inject({ method: 'GET', url: '/boom' });
        await Sentry.flush(1000);

        expectProblem(boom, { status: 500, code: 'INTERNAL_ERROR' });
        expect(boom.body).not.toContain('MARK_SECRET');
        expect(delivered).toHaveLength(1);
    });
});
