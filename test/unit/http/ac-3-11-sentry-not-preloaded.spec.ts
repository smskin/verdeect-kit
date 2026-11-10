// AC-3.11 (UC-3): DSN задан, NODE_ENV=production, Sentry не подключён через instrument.ts → warn SENTRY_NOT_PRELOADED,
// запуск продолжается (prd.md §3.5). Схема сервиса — без envSentry: DSN берётся из process.env. Состояние Sentry —
// процесс-глобальное: случай без init идёт первым.
import * as Sentry from '@sentry/nestjs';
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrapService } from '../../../src/http/index.js';
import { FAKE_DSN, initFakeSentry } from '../../support/fake-sentry.js';
import { useBootstrapStand } from './bootstrap-support.js';
import { probeEnv, ProbeModule } from './support.js';

const stand = useBootstrapStand({ SENTRY_DSN: FAKE_DSN, NODE_ENV: 'production' });

afterAll(async () => {
    await Sentry.close(1000);
});

function preloadWarnings(): Record<string, unknown>[] {
    return stand.records().filter((record) => record.code === 'SENTRY_NOT_PRELOADED');
}

describe('UC-3: Sentry до загрузки приложения', () => {
    it('AC-3.11: DSN + production без instrument → warn SENTRY_NOT_PRELOADED, запуск продолжается', async () => {
        const app = stand.track(
            await bootstrapService({ module: ProbeModule, service: 'probe', env: probeEnv }),
        );

        expect(preloadWarnings()).toHaveLength(1);
        expect(preloadWarnings()[0]?.level).toBe(40);
        expect(app.getHttpServer().listening).toBe(true);
    });

    it('AC-3.11: с Sentry.init — предупреждения нет', async () => {
        initFakeSentry();
        stand.track(
            await bootstrapService({ module: ProbeModule, service: 'probe', env: probeEnv }),
        );

        expect(preloadWarnings()).toEqual([]);
    });
});
