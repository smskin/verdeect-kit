// AC-2.16 (U, UC-13): серия сбоев фоновой задачи — backgroundFailed/backgroundSucceeded, verdeect_background_failures_total
// {task} (prd.md §3.2 v1.34 стр. 81, 84). Эталон — O background-failures.ts (5b74b27). SDK Sentry — подделка; счётчик —
// на процесс, поэтому у каждого теста свой task и прирост сравнивается с началом теста.
import * as Sentry from '@sentry/nestjs';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    backgroundFailed,
    backgroundSucceeded,
    kitMetrics,
    type KitBackgroundLogger,
} from '../../../src/observability/index.js';

vi.mock('@sentry/nestjs', () => ({ init: vi.fn(), captureException: vi.fn(), flush: vi.fn() }));

afterEach(() => {
    vi.clearAllMocks();
});

interface LogCall {
    readonly level: 'error' | 'warn' | 'info';
    readonly fields: Record<string, unknown>;
    readonly message: string;
}

function recordingLogger(): { logger: KitBackgroundLogger; calls: LogCall[] } {
    const calls: LogCall[] = [];
    const record =
        (level: LogCall['level']) =>
        (fields: Record<string, unknown>, message: string): void => {
            calls.push({ level, fields, message });
        };

    return {
        logger: { error: record('error'), warn: record('warn'), info: record('info') },
        calls,
    };
}

const metrics = kitMetrics({ service: 'kit-test' });

async function failures(task: string): Promise<number> {
    const metric = await metrics.registry
        .getSingleMetric('verdeect_background_failures_total')
        ?.get();

    return metric?.values.find((value) => value.labels['task'] === task)?.value ?? 0;
}

describe('UC-13: серия сбоев фоновой задачи', () => {
    it('AC-2.16: три сбоя подряд → одно событие GlitchTip, verdeect_background_failures_total{task} = 3, логи error, warn, warn (warn с failures 2 и 3)', async () => {
        const { logger, calls } = recordingLogger();
        const before = await failures('three-in-row');

        for (let index = 0; index < 3; index += 1) {
            backgroundFailed('three-in-row', new Error(`сбой ${index}`), logger);
        }

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        expect((await failures('three-in-row')) - before).toBe(3);
        expect(calls.map((call) => call.level)).toEqual(['error', 'warn', 'warn']);
        expect(calls.map((call) => call.fields['failures'])).toEqual([undefined, 2, 3]);
        expect(calls.every((call) => call.fields['task'] === 'three-in-row')).toBe(true);
    });

    it('AC-2.16: backgroundSucceeded закрывает серию (info с failures), новый сбой — второе событие и error', () => {
        const { logger, calls } = recordingLogger();

        backgroundFailed('close-series', new Error('a'), logger);
        backgroundFailed('close-series', new Error('b'), logger);
        backgroundSucceeded('close-series', logger);
        backgroundFailed('close-series', new Error('c'), logger);

        expect(calls.map((call) => call.level)).toEqual(['error', 'warn', 'info', 'error']);
        expect(calls[2]?.fields).toEqual({ task: 'close-series', failures: 2 });
        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    });

    it('AC-2.16: серии разных task независимы', async () => {
        const { logger, calls } = recordingLogger();
        const before = await failures('series-b');

        backgroundFailed('series-a', new Error('a1'), logger);
        backgroundFailed('series-b', new Error('b1'), logger);
        backgroundFailed('series-a', new Error('a2'), logger);
        backgroundSucceeded('series-a', logger);
        backgroundFailed('series-b', new Error('b2'), logger);

        expect(calls.map((call) => `${call.level}:${String(call.fields['task'])}`)).toEqual([
            'error:series-a',
            'error:series-b',
            'warn:series-a',
            'info:series-a',
            'warn:series-b',
        ]);
        expect(Sentry.captureException).toHaveBeenCalledTimes(2);
        expect((await failures('series-b')) - before).toBe(2);
    });

    it('AC-2.16: backgroundSucceeded без открытой серии — без лога', () => {
        const { logger, calls } = recordingLogger();

        backgroundSucceeded('no-series', logger);

        expect(calls).toHaveLength(0);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("AC-2.16: task вне формата (A, a, 'a b', 65 символов) → TypeError у обеих функций", () => {
        const { logger, calls } = recordingLogger();

        for (const task of ['A', 'a', 'a b', `a${'b'.repeat(64)}`]) {
            expect(() => backgroundFailed(task, new Error('x'), logger)).toThrow(TypeError);
            expect(() => backgroundSucceeded(task, logger)).toThrow(TypeError);
        }
        expect(() => backgroundFailed('a.b-c_1', new Error('x'), logger)).not.toThrow();
        expect(() => backgroundSucceeded('a.b-c_1', logger)).not.toThrow();
        expect(calls.map((call) => call.level)).toEqual(['error', 'info']);
    });

    it('AC-2.16: в лог и событие уходит sanitizeError(err)', () => {
        const { logger, calls } = recordingLogger();
        const pg = Object.assign(new Error('connection refused'), {
            code: '08006',
            severity: 'FATAL',
        });
        const error = new DrizzleQueryError(
            'select * from kit.note where id = $1',
            ['secret-value'],
            pg,
        );

        backgroundFailed('sanitized', error, logger);

        const logged = JSON.stringify(calls[0]?.fields['err']);
        const sent = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]?.[0]);
        expect(logged).not.toContain('secret-value');
        expect(sent).not.toContain('secret-value');
        expect(calls[0]?.fields['err']).not.toBe(error);
    });

    it('AC-2.16: DrizzleQueryError без pg-причины (тайм-аут) — в лог и событие не уходят SQL и параметры', () => {
        const { logger, calls } = recordingLogger();
        const error = new DrizzleQueryError(
            'select * from kit.note where id = $1',
            ['secret-value'],
            new Error('Query read timeout'),
        );

        backgroundFailed('sanitized-no-pg', error, logger);

        const logged = JSON.stringify(calls[0]?.fields['err']) + String(calls[0]?.fields['err']);
        const sent = vi.mocked(Sentry.captureException).mock.calls[0]?.[0] as Error;
        for (const text of [logged, JSON.stringify(sent) + String(sent.message)]) {
            expect(text).not.toContain('secret-value');
            expect(text).not.toContain('kit.note');
        }
    });
});
