// AC-2.4 (U, UC-3; NFR-4) на настоящем SDK: неверный SENTRY_DSN не печатается SDK (console.error «Invalid Sentry Dsn:
// <значение>») — initSentry отсекает его до Sentry.init; production + DSN — dataCollection NO_PERSONAL_DATA и
// tracesSampleRate 0 у клиента (prd.md §3.2). Без vi.mock: с подделкой initSentry проверял бы только её.
import * as Sentry from '@sentry/nestjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSentry } from '../../../src/observability/index.js';
import { NO_PERSONAL_DATA } from '../../../src/observability/sentry.js';

afterEach(async () => {
    vi.unstubAllEnvs();
    await Sentry.close(1);
});

function spyOutput(): () => string {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stderr = vi.spyOn(process.stderr, 'write');

    return () => JSON.stringify([...consoleError.mock.calls, ...stderr.mock.calls]);
}

describe('UC-3: GlitchTip на настоящем SDK', () => {
    it('AC-2.4: неверный SENTRY_DSN — значение не попадает в console.error и process.stderr', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SENTRY_DSN', 'MARK_BAD_DSN_VALUE');
        const output = spyOutput();

        expect(initSentry({ service: 'kit-test' })).toBe(false);
        expect(output()).not.toContain('MARK_BAD_DSN_VALUE');
        expect(Sentry.getClient()).toBeUndefined();
    });

    it('AC-2.4: DSN с ключом вне \\w (https://pub-key@example.invalid/1) — false, значения нет в console.error и process.stderr', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SENTRY_DSN', 'https://pub-key@example.invalid/1');
        const output = spyOutput();

        expect(initSentry({ service: 'kit-test' })).toBe(false);
        expect(output()).not.toContain('pub-key');
    });

    it('AC-2.4: production + DSN — dataCollection NO_PERSONAL_DATA, tracesSampleRate 0', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');

        expect(initSentry({ service: 'kit-test' })).toBe(true);
        const options = Sentry.getClient()?.getOptions();
        expect(options).toMatchObject({ tracesSampleRate: 0, dataCollection: NO_PERSONAL_DATA });
    });
});
