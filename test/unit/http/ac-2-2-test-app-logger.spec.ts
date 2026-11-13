// AC-2.2 (UC-4, prd.md §3.8 v1.25): createTestApp({logger}) — те же опции логгера, что bootstrapService:
// trustTraceparent: false — входящий traceparent не становится trace-id запроса и строки журнала доступа; без опции —
// становится. trace-id запроса — от адаптера каждого приложения; журнал доступа nestjs-pino — один на процесс (файл).
import 'reflect-metadata';
import { Controller, Get, Module, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { KitConfigModule } from '../../../src/config/index.js';
import { createTestApp } from '../../../src/testing/index.js';
import { useBootstrapStand } from './bootstrap-support.js';
import { accessLines } from './role-support.js';
import { probeEnv } from './support.js';

const TRACE = '0af7651916cd43dd8448eb211c80319c';
const TRACEPARENT = `00-${TRACE}-b7ad6b7169203331-01`;

@Controller()
class TraceController {
    @Get('trace')
    trace(@Req() request: FastifyRequest): { traceId: string } {
        return { traceId: String(request.id) };
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: probeEnv })],
    controllers: [TraceController],
})
class TraceModule {}

const stand = useBootstrapStand({ LOG_LEVEL: 'info' });

async function traceOf(logger?: { trustTraceparent?: boolean }): Promise<string> {
    const app = stand.track(
        await createTestApp({
            module: TraceModule,
            service: 'probe',
            ...(logger === undefined ? {} : { logger }),
        }),
    );
    const res = await app.inject({
        method: 'GET',
        url: '/trace',
        headers: { traceparent: TRACEPARENT },
    });

    return (res.json() as { traceId: string }).traceId;
}

describe('UC-4: createTestApp({logger})', () => {
    it('AC-2.2: createTestApp({logger: {trustTraceparent: false}}) — traceparent не становится trace-id запроса и журнала доступа', async () => {
        const traceId = await traceOf({ trustTraceparent: false });
        const lines = accessLines(stand.records());

        expect(traceId).toMatch(/^[\da-f]{32}$/);
        expect(traceId).not.toBe(TRACE);
        expect(lines.map((line) => line.traceId)).toContain(traceId);
        expect(lines.some((line) => line.traceId === TRACE)).toBe(false);
    });

    it('AC-2.2: createTestApp без logger — trace-id из traceparent', async () => {
        expect(await traceOf()).toBe(TRACE);
    });
});
