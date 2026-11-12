// AC-3.12 (UC-3): опции bootstrapService по роли сервиса (prd.md §3.5): BFF — trustTraceparent: false; P, O — quietRoutes;
// http.bodyLimit; O — redaction (одно правило для лога и GlitchTip); v1.21 — http.configureFastify (onRoute bodyLimit маршрута,
// ошибка → failStartup). nestjs-pino держит один pino-http на процесс,
// поэтому файл запускает все приложения с одной конфигурацией роли; умолчания — ac-3-12-role-defaults.spec.ts.
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapService } from '../../../src/http/index.js';
import type { KitRedaction } from '../../../src/observability/redaction.js';
import { expectProblem } from '../../../src/testing/index.js';
import { expectExit } from './bootstrap-support.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { useBootstrapStand } from './bootstrap-support.js';
import { accessLines, RoleModule, SECRETS } from './role-support.js';
import { probeEnv } from './support.js';

const stand = useBootstrapStand({ LOG_LEVEL: 'debug' });
const redaction: KitRedaction = { sensitiveKeys: ['projectSecret'] };
const TRACE = '0af7651916cd43dd8448eb211c80319c';

let delivered: DeliveredEvent[];

beforeAll(() => {
    delivered = initFakeSentry({ redaction }).delivered;
});

afterAll(async () => {
    await Sentry.close(1000);
});

async function start() {
    return stand.track(
        await bootstrapService({
            module: RoleModule,
            service: 'probe',
            env: probeEnv,
            logger: { trustTraceparent: false, quietRoutes: ['/probe'] },
            http: { bodyLimit: 1024 },
            redaction,
        }),
    );
}

describe('UC-3: опции по роли', () => {
    it('AC-3.12: trustTraceparent: false — trace-id в логе доступа ≠ из traceparent', async () => {
        const app = await start();
        await app.inject({
            method: 'GET',
            url: '/ok',
            headers: { traceparent: `00-${TRACE}-b7ad6b7169203331-01` },
        });
        await app.inject({
            method: 'POST',
            url: '/probe',
            headers: { traceparent: `00-${TRACE}-b7ad6b7169203331-01` },
            payload: { title: 'a', tags: [] },
        });
        const lines = accessLines(stand.records());

        expect(lines.length).toBeGreaterThan(0);
        expect(
            lines.every((line) => typeof line.traceId === 'string' && line.traceId !== TRACE),
        ).toBe(true);
    });

    it("AC-3.12: quietRoutes: ['/probe'] — успешный на debug, 422 — info", async () => {
        const app = await start();
        await app.inject({ method: 'POST', url: '/probe', payload: { title: 'a', tags: [] } });
        await app.inject({ method: 'POST', url: '/probe', payload: { title: '' } });
        const levels = accessLines(stand.records()).map((line) => [
            (line.res as { statusCode: number }).statusCode,
            line.level,
        ]);

        expect(levels).toEqual([
            [200, 20],
            [422, 30],
        ]);
    });

    it('AC-3.12: http.bodyLimit: 1024 → тело 2 KiB → 413 PAYLOAD_TOO_LARGE', async () => {
        const app = await start();
        const res = await app.inject({
            method: 'POST',
            url: '/probe',
            payload: { title: 'x'.repeat(2048), tags: [] },
        });

        expectProblem(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    it('AC-3.12: redaction.sensitiveKeys: [projectSecret] скрыт в логе и в событии GlitchTip; authorization, password, refresh_token тоже скрыты', async () => {
        const app = await start();
        delivered.splice(0);
        await app.inject({ method: 'GET', url: '/report' });
        await Sentry.flush(1000);
        const text = stand.text();
        const event = delivered.map((item) => item.body).join('\n');

        expect(text).toContain('отчёт с секретами');
        expect(delivered).toHaveLength(1);
        for (const secret of Object.values(SECRETS)) {
            expect(text).not.toContain(secret);
            expect(event).not.toContain(secret);
        }
    });
});

describe('UC-3: configureFastify', () => {
    const logger = { trustTraceparent: false, quietRoutes: ['/probe'] };

    it('AC-3.12: configureFastify ставит в onRoute bodyLimit 16384 маршруту /probe — 20 КиБ → 413, на /echo — общий предел (200)', async () => {
        const app = stand.track(
            await bootstrapService({
                module: RoleModule,
                service: 'probe',
                env: probeEnv,
                logger,
                http: {
                    configureFastify: (fastify) => {
                        fastify.addHook('onRoute', (route) => {
                            if (route.url === '/probe') {
                                route.bodyLimit = 16384;
                            }
                        });
                    },
                },
                redaction,
            }),
        );
        const payload = { title: 'x'.repeat(20 * 1024), tags: [] };

        expectProblem(await app.inject({ method: 'POST', url: '/probe', payload }), {
            status: 413,
            code: 'PAYLOAD_TOO_LARGE',
        });
        expect((await app.inject({ method: 'POST', url: '/echo', payload })).statusCode).toBe(200);
    });

    it('AC-3.12: ошибка в configureFastify → failStartup (fatal, exit 1), порт не открыт', async () => {
        const exit = await expectExit(
            bootstrapService({
                module: RoleModule,
                service: 'probe',
                env: probeEnv,
                logger,
                http: {
                    configureFastify: () => {
                        throw new Error('configureFastify сломан');
                    },
                },
                redaction,
            }),
        );
        const records = stand.records();

        expect(exit.code).toBe(1);
        expect(records.some((record) => record['level'] === 60)).toBe(true);
        expect(records.some((record) => record['msg'] === 'сервис слушает')).toBe(false);
    });
});
