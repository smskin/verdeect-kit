// AC-3.12 (UC-3): умолчания bootstrapService (prd.md §3.5): доверять traceparent; sensitiveKeys: [] базовый список не
// отключает (лог и GlitchTip). Отдельный файл: nestjs-pino держит один pino-http на процесс.
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapService } from '../../../src/http/index.js';
import type { KitRedaction } from '../../../src/observability/redaction.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { useBootstrapStand } from './bootstrap-support.js';
import { accessLines, RoleModule, SECRETS } from './role-support.js';
import { probeEnv } from './support.js';

const stand = useBootstrapStand();
const redaction: KitRedaction = { sensitiveKeys: [] };
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
        await bootstrapService({ module: RoleModule, service: 'probe', env: probeEnv, redaction }),
    );
}

describe('UC-3: умолчания опций', () => {
    it('AC-3.12: по умолчанию trace-id берётся из traceparent', async () => {
        const app = await start();
        await app.inject({
            method: 'POST',
            url: '/probe',
            headers: { traceparent: `00-${TRACE}-b7ad6b7169203331-01` },
            payload: { title: 'a', tags: [] },
        });

        expect(accessLines(stand.records()).map((line) => line.traceId)).toEqual([TRACE]);
    });

    it('AC-3.12: sensitiveKeys: [] базовый список не отключает', async () => {
        const app = await start();
        delivered.splice(0);
        await app.inject({ method: 'GET', url: '/report' });
        await Sentry.flush(1000);
        const text = stand.text();
        const event = delivered.map((item) => item.body).join('\n');

        expect(text).toContain('отчёт с секретами');
        for (const secret of [SECRETS.password, SECRETS.refresh_token, SECRETS.authorization]) {
            expect(text).not.toContain(secret);
            expect(event).not.toContain(secret);
        }
        expect(text).toContain(SECRETS.projectSecret);
    });
});
