// AC-2.6 (U, UC-4 А4): captureThrottled — 100 однотипных ошибок за 60 с дают одно событие; ошибка, отправленная
// границей, повторно не отправляется; §3.2: captureError — ровно одно событие на ошибку. Троттлинг — по образцу O
// pool-timeout-reporter.ts (окно 60 с, performance.now()). SDK — подделка.
import * as Sentry from '@sentry/nestjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureError, captureThrottled } from '../../../src/observability/index.js';

vi.mock('@sentry/nestjs', () => ({ init: vi.fn(), captureException: vi.fn(), flush: vi.fn() }));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('UC-4: всплеск однотипных ошибок', () => {
    it('AC-2.6: 100 однотипных ошибок за 60 с — одно событие', () => {
        const sent: boolean[] = [];
        for (let index = 0; index < 100; index += 1) {
            sent.push(captureThrottled('pool-timeout', new Error(`timeout ${index}`)));
            vi.advanceTimersByTime(500);
        }

        expect(sent.filter(Boolean)).toHaveLength(1);
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('AC-2.6: после окна — следующее событие', () => {
        expect(captureThrottled('window', new Error('a'), { windowMs: 1000 })).toBe(true);
        vi.advanceTimersByTime(999);
        expect(captureThrottled('window', new Error('b'), { windowMs: 1000 })).toBe(false);
        vi.advanceTimersByTime(1);
        expect(captureThrottled('window', new Error('c'), { windowMs: 1000 })).toBe(true);
        expect(captureThrottled('other-key', new Error('d'), { windowMs: 1000 })).toBe(true);

        expect(Sentry.captureException).toHaveBeenCalledTimes(3);
    });

    it('AC-2.6: ошибка, отправленная границей (captureError), повторно не отправляется', () => {
        const error = new Error('boundary');

        captureError(error);
        const sent = captureThrottled('boundary-key', error);

        expect(sent).toBe(false);
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('§3.2: captureError — ровно одно событие на ошибку', () => {
        const error = new Error('once');

        captureError(error, { tags: { code: 'X' } });
        captureError(error);
        captureError(new Error('another'));

        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
        expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[1]).toEqual({
            tags: { code: 'X' },
        });
    });

    it('§3.2: captureError отправляет ошибку через sanitizeError', () => {
        const pg = Object.assign(new Error('Key (email)=(MARK)'), {
            code: '23505',
            severity: 'ERROR',
        });

        captureError(pg);

        expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[0]).toMatchObject({
            name: 'SanitizedDbError',
            message: 'Failed query (23505)',
        });
    });
});
