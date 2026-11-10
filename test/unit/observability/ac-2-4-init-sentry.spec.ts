// AC-2.4 (U, UC-3 А1): initSentry не включает SDK при NODE_ENV ≠ production или пустом DSN; неверный SENTRY_* не роняет
// процесс (prd.md §3.2). Перенос: O instrument.spec.ts («выключен при пустом DSN», «выключен при NODE_ENV=test с DSN»,
// «включён в production — tracesSampleRate 0, без сбора ПДн», «NODE_ENV не задан — как production»). SDK — подделка.
import * as Sentry from '@sentry/nestjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSentry } from '../../../src/observability/index.js';
import { NO_PERSONAL_DATA } from '../../../src/observability/sentry.js';

vi.mock('@sentry/nestjs', () => ({ init: vi.fn(), captureException: vi.fn(), flush: vi.fn() }));

const DSN = 'https://public@errors.example.invalid/1';

function stubEnv(env: Record<string, string | undefined>): void {
    for (const key of ['SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'SENTRY_RELEASE', 'NODE_ENV']) {
        vi.stubEnv(key, env[key]);
    }
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe('UC-3: инициализация GlitchTip', () => {
    it('AC-2.4: NODE_ENV ≠ production — init не вызывается', () => {
        for (const nodeEnv of ['test', 'development']) {
            stubEnv({ SENTRY_DSN: DSN, NODE_ENV: nodeEnv });
            expect(initSentry({ service: 'kit-test' })).toBe(false);
        }
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('AC-2.4: пустой DSN — не вызывается', () => {
        stubEnv({ SENTRY_DSN: '  ', NODE_ENV: 'production' });

        expect(initSentry({ service: 'kit-test' })).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('AC-2.4: неверный SENTRY_* (NODE_ENV=staging + DSN) — false без исключения, init не вызван', () => {
        stubEnv({ SENTRY_DSN: DSN, NODE_ENV: 'staging' });

        expect(() => initSentry({ service: 'kit-test' })).not.toThrow();
        expect(initSentry({ service: 'kit-test' })).toBe(false);
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('AC-2.4: неверный SENTRY_DSN в production — false, init не вызван', () => {
        for (const dsn of ['not-a-dsn', 'https://pub-key@example.invalid/1', 'ftp://k@h/1']) {
            stubEnv({ SENTRY_DSN: dsn, NODE_ENV: 'production' });
            expect(initSentry({ service: 'kit-test' })).toBe(false);
        }
        expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('AC-2.4: production + DSN — включён, tracesSampleRate 0, без сбора ПДн, тег service', () => {
        stubEnv({ SENTRY_DSN: DSN, NODE_ENV: 'production', SENTRY_RELEASE: 'v1' });

        expect(initSentry({ service: 'kit-test' })).toBe(true);
        expect(Sentry.init).toHaveBeenCalledTimes(1);
        expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]).toMatchObject({
            dsn: DSN,
            environment: 'production',
            release: 'v1',
            tracesSampleRate: 0,
            dataCollection: NO_PERSONAL_DATA,
            initialScope: { tags: { service: 'kit-test' } },
        });
        expect(NO_PERSONAL_DATA).toMatchObject({
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
        });
    });

    it('AC-2.4: NODE_ENV не задан — как production', () => {
        stubEnv({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'stage-1' });

        expect(initSentry({ service: 'kit-test' })).toBe(true);
        expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]).toMatchObject({
            environment: 'stage-1',
        });
    });
});
