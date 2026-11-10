// AC-2.2 (U, UC-4): trustTraceparent: false — входящий traceparent игнорируется, trace-id новый; иначе — из заголовка
// (prd.md §3.2). Перенос: B observability.module.spec.ts («traceparent браузера не принимается — новый trace-id»),
// O observability.module.spec.ts (requestId). Nest + Fastify: генератор trace-id передан адаптеру (задача 4).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../../../src/observability/index.js';
import {
    accessLines,
    collector,
    LOGGER_ENV,
    startNestApp,
    startPinoHttpApp,
    withStream,
} from './support.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;
const HEX_32 = /^[\da-f]{32}$/;

const nestOutput = collector();
const untrustedOutput = collector();
let nest: NestFastifyApplication;
let untrusted: FastifyInstance;

beforeAll(async () => {
    nest = await startNestApp(
        withStream(
            createLoggerOptions({ service: 'kit-test', entry: 'http', env: LOGGER_ENV }),
            nestOutput.stream,
        ),
    );
    untrusted = await startPinoHttpApp(
        withStream(
            createLoggerOptions({
                service: 'kit-test',
                entry: 'http',
                env: LOGGER_ENV,
                trustTraceparent: false,
            }),
            untrustedOutput.stream,
        ),
    );
});

afterAll(async () => {
    await nest.close();
    await untrusted.close();
});

beforeEach(() => {
    nestOutput.clear();
    untrustedOutput.clear();
});

async function nestGet(headers: Record<string, string>) {
    return nest.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/trace', headers });
}

describe('UC-4: trace-id запроса', () => {
    it('AC-2.2: по умолчанию trace-id из traceparent', async () => {
        const response = await nestGet({ traceparent: TRACEPARENT });

        expect(response.json()).toEqual({ traceId: TRACE_ID });
        const [line] = accessLines(nestOutput.records());
        expect(line).toMatchObject({ traceId: TRACE_ID, req: { id: TRACE_ID } });
    });

    it('AC-2.2: trustTraceparent: false — входящий traceparent игнорируется, trace-id новый (32 hex)', async () => {
        await untrusted.inject({ method: 'GET', url: '/x', headers: { traceparent: TRACEPARENT } });

        const [line] = accessLines(untrustedOutput.records());
        expect(line?.traceId).toMatch(HEX_32);
        expect(line?.traceId).not.toBe(TRACE_ID);
    });

    it('AC-2.2: неверный traceparent → новый trace-id', async () => {
        const response = await nestGet({ traceparent: `00-${TRACE_ID}-zz` });

        const { traceId } = response.json<{ traceId: string }>();
        expect(traceId).toMatch(HEX_32);
        expect(traceId).not.toBe(TRACE_ID);
    });

    it('AC-2.2: без заголовка — новый trace-id у каждого запроса', async () => {
        const first = (await nestGet({})).json<{ traceId: string }>().traceId;
        const second = (await nestGet({})).json<{ traceId: string }>().traceId;

        expect(first).toMatch(HEX_32);
        expect(second).toMatch(HEX_32);
        expect(first).not.toBe(second);
    });
});
