// §3.2 KitLifecycle (U, UC-8; NFR-8; KT-10, KT-11): программное закрытие close() — шаги 1–5 по порядку, /health 503,
// без сторожа и exit, ошибки участников — отказ close(); режим сигнала — сторож от сигнала, после шагов unref, к сроку
// SHUTDOWN_NOT_EXITED или SHUTDOWN_TIMEOUT и exit(1). Фейковые таймеры, поддельные участники; process.exit подменён.
// Реальные сроки — test/timing/observability (AC-2.10, AC-2.13).
import * as Sentry from '@sentry/nestjs';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    HealthRegistry,
    KitLifecycle,
    type KitShutdownParticipant,
} from '../../../src/observability/index.js';
import { shutdownRemainingMs } from '../../../src/observability/lifecycle.js';
import { collector } from './support.js';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn(), flush: vi.fn(async () => true) }));

const TIMEOUT_MS = 1000;
const DRAIN_MS = 100;

let savedListeners: NodeJS.SignalsListener[];

beforeEach(() => {
    vi.useFakeTimers();
    savedListeners = process.listeners('SIGTERM');
});

afterEach(() => {
    for (const listener of process.listeners('SIGTERM')) {
        if (!savedListeners.includes(listener)) {
            process.removeListener('SIGTERM', listener);
        }
    }
    // Сначала восстановить spy (setTimeout создан поверх фейковых таймеров), затем вернуть реальные таймеры.
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
});

function setup() {
    const output = collector();
    const logger = pino(
        { level: 'trace', base: { service: 'kit-test', replica: 'replica-test' } },
        output.stream,
    );
    const health = new HealthRegistry({ logger });
    const lifecycle = new KitLifecycle({
        logger,
        health,
        env: { SHUTDOWN_TIMEOUT_MS: TIMEOUT_MS, SHUTDOWN_DRAIN_MS: DRAIN_MS },
    });
    const journal: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    return { output, health, lifecycle, journal, exit };
}

function participant(
    name: string,
    journal: string[],
    stop: () => Promise<void> | void = () => undefined,
): KitShutdownParticipant {
    return {
        name,
        stop: async () => {
            journal.push(`${name}:start`);
            await stop();
            journal.push(`${name}:end`);
        },
    };
}

/** Таймер сторожа: вызов setTimeout со сроком SHUTDOWN_TIMEOUT_MS. */
function watchdogTimer(spy: {
    readonly mock: { readonly calls: unknown[][]; readonly results: { value: unknown }[] };
}): NodeJS.Timeout | undefined {
    const index = spy.mock.calls.findIndex((call) => call[1] === TIMEOUT_MS);

    return index === -1 ? undefined : (spy.mock.results[index]?.value as NodeJS.Timeout);
}

describe('UC-8: программное закрытие close()', () => {
    it('§3.2: close() — шаги 1–5 по порядку, /health 503, сторож не взводится: после vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS + 1000) exit не вызван', async () => {
        const { health, lifecycle, journal, exit } = setup();
        lifecycle.register(participant('metrics', journal), { step: 5 });
        lifecycle.register(participant('pools', journal), { step: 4 });
        lifecycle.register(
            participant('http', journal, () => {
                journal.push(`stopping:${String(health.isStopping)}`);
            }),
            { step: 2 },
        );
        lifecycle.register(participant('relay', journal), { step: 3 });
        lifecycle.register(participant('subscriber', journal), { step: 3 });

        const closing = lifecycle.close();
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        await closing;

        expect(journal).toEqual([
            'http:start',
            'stopping:true',
            'http:end',
            'relay:start',
            'subscriber:start',
            'relay:end',
            'subscriber:end',
            'pools:start',
            'pools:end',
            'metrics:start',
            'metrics:end',
        ]);
        expect(await health.evaluate()).toEqual({ status: 'unavailable', checks: {} });
        vi.advanceTimersByTime(TIMEOUT_MS + 1000);
        expect(exit).not.toHaveBeenCalled();
    });

    it('§3.2: close() — ошибка участника: error-лог, следующие шаги выполняются, close() отклоняется этой ошибкой', async () => {
        const { lifecycle, journal, output } = setup();
        const failure = new Error('relay failed');
        lifecycle.register(
            participant('relay', journal, () => {
                throw failure;
            }),
            { step: 3 },
        );
        lifecycle.register(participant('pools', journal), { step: 4 });

        const closing = lifecycle.close();
        const result = expect(closing).rejects.toBe(failure);
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        await result;

        expect(journal).toEqual(['relay:start', 'pools:start', 'pools:end']);
        expect(output.records()).toContainEqual(
            expect.objectContaining({ level: 50, step: 3, participant: 'relay' }),
        );
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('§3.2: close() — несколько ошибок → AggregateError', async () => {
        const { lifecycle } = setup();
        for (const name of ['a', 'b']) {
            lifecycle.register(
                {
                    name,
                    stop: () => {
                        throw new Error(name);
                    },
                },
                { step: 4 },
            );
        }

        const result = expect(lifecycle.close()).rejects.toBeInstanceOf(AggregateError);
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        await result;
    });

    it('§3.2: повторный close() возвращает тот же промис', async () => {
        const { lifecycle, journal } = setup();
        lifecycle.register(participant('pools', journal), { step: 4 });

        const first = lifecycle.close();
        const second = lifecycle.close();
        await vi.advanceTimersByTimeAsync(DRAIN_MS);

        expect(second).toBe(first);
        await first;
        expect(journal).toEqual(['pools:start', 'pools:end']);
    });

    it('§3.2: регистрация после начала остановки — ошибка', async () => {
        const { lifecycle, journal } = setup();

        const closing = lifecycle.close();

        expect(() => lifecycle.register(participant('late', journal), { step: 3 })).toThrow(
            'KitLifecycle: регистрация после начала остановки',
        );
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        await closing;
    });

    it('NFR-8: строки остановки содержат service и replica', async () => {
        const { lifecycle, journal, output } = setup();
        lifecycle.register(participant('pools', journal), { step: 4 });

        const closing = lifecycle.close();
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        await closing;

        const lines = output.records();
        expect(lines.map((line) => line.msg)).toEqual(
            expect.arrayContaining([
                'остановка: начало',
                'остановка: шаг начат',
                'остановка: участник завершён',
                'остановка: шаг завершён',
                'остановка: завершена',
            ]),
        );
        for (const line of lines) {
            expect(line).toMatchObject({ service: 'kit-test', replica: 'replica-test' });
        }
        expect(lines[0]).toMatchObject({ level: 30, mode: 'close' });
    });
});

describe('UC-8: остаток срока остановки', () => {
    it('AC-5.11: до начала остановки остаток неизвестен', () => {
        const { lifecycle } = setup();

        expect(shutdownRemainingMs(lifecycle)).toBeUndefined();
    });

    it('AC-5.11: остаток считается от close()', async () => {
        const { lifecycle } = setup();
        const closing = lifecycle.close();
        await vi.advanceTimersByTimeAsync(DRAIN_MS + 200);

        expect(shutdownRemainingMs(lifecycle)).toBe(TIMEOUT_MS - DRAIN_MS - 200);
        await closing;
    });

    it('AC-5.11: остаток считается от SIGTERM', async () => {
        const { lifecycle } = setup();
        lifecycle.listen(['SIGTERM']);
        process.emit('SIGTERM');
        await vi.advanceTimersByTimeAsync(DRAIN_MS + 200);

        expect(shutdownRemainingMs(lifecycle)).toBe(TIMEOUT_MS - DRAIN_MS - 200);
    });
});

describe('UC-8: остановка по сигналу', () => {
    it('§3.2: сигнал взводит сторожа; после успешной остановки сторож unref (timer.hasRef() === false), до срока exit не вызван, к сроку — SHUTDOWN_NOT_EXITED и exit(1)', async () => {
        const { lifecycle, journal, exit, output } = setup();
        const timeouts = vi.spyOn(globalThis, 'setTimeout');
        lifecycle.register(participant('pools', journal), { step: 4 });
        lifecycle.listen(['SIGTERM']);

        process.emit('SIGTERM');
        const timer = watchdogTimer(timeouts);
        expect(timer?.hasRef()).toBe(true);
        await vi.advanceTimersByTimeAsync(DRAIN_MS);

        expect(journal).toEqual(['pools:start', 'pools:end']);
        expect(timer?.hasRef()).toBe(false);
        expect(exit).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(TIMEOUT_MS - DRAIN_MS);
        expect(exit).toHaveBeenCalledWith(1);
        expect(output.records()).toContainEqual(
            expect.objectContaining({ level: 50, code: 'SHUTDOWN_NOT_EXITED' }),
        );
        expect(Sentry.flush).toHaveBeenCalledWith(2000);
        expect(output.records()[0]).toMatchObject({ signal: 'SIGTERM' });
    });

    it('§3.2: срок истёк во время шагов — SHUTDOWN_TIMEOUT с шагом и незавершёнными участниками, exit(1)', async () => {
        const { lifecycle, journal, exit, output } = setup();
        lifecycle.register(
            participant('relay', journal, () => new Promise(() => undefined)),
            {
                step: 3,
            },
        );
        lifecycle.listen(['SIGTERM']);

        process.emit('SIGTERM');
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

        expect(exit).toHaveBeenCalledWith(1);
        expect(output.records()).toContainEqual(
            expect.objectContaining({
                level: 50,
                code: 'SHUTDOWN_TIMEOUT',
                step: 3,
                pending: ['relay'],
                timeoutMs: TIMEOUT_MS,
            }),
        );
        expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[1]).toEqual({
            tags: { code: 'SHUTDOWN_TIMEOUT' },
        });
    });

    it('§3.2: ошибка участника по сигналу — error-лог и captureError, следующие шаги выполняются', async () => {
        const { lifecycle, journal, output } = setup();
        const failure = new Error('subscriber failed');
        lifecycle.register(
            participant('subscriber', journal, () => {
                throw failure;
            }),
            { step: 3 },
        );
        lifecycle.register(participant('pools', journal), { step: 4 });
        lifecycle.listen(['SIGTERM']);

        process.emit('SIGTERM');
        await vi.advanceTimersByTimeAsync(DRAIN_MS);

        expect(journal).toEqual(['subscriber:start', 'pools:start', 'pools:end']);
        expect(output.records()).toContainEqual(
            expect.objectContaining({ level: 50, participant: 'subscriber' }),
        );
        expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
            tags: { code: 'SHUTDOWN_PARTICIPANT_FAILED' },
        });
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });

    it('§3.2: повторный сигнал не запускает вторую остановку', async () => {
        const { lifecycle, journal } = setup();
        lifecycle.register(participant('pools', journal), { step: 4 });
        lifecycle.listen(['SIGTERM']);

        process.emit('SIGTERM');
        expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
        process.emit('SIGTERM');
        await vi.advanceTimersByTimeAsync(DRAIN_MS);

        expect(journal).toEqual(['pools:start', 'pools:end']);
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });

    it('§3.2: сигнал во время close() взводит сторожа', async () => {
        const { lifecycle, journal, exit } = setup();
        const timeouts = vi.spyOn(globalThis, 'setTimeout');
        lifecycle.register(
            participant('relay', journal, () => new Promise(() => undefined)),
            {
                step: 3,
            },
        );
        lifecycle.listen(['SIGTERM']);

        void lifecycle.close().catch(() => undefined);
        await vi.advanceTimersByTimeAsync(DRAIN_MS);
        expect(watchdogTimer(timeouts)).toBeUndefined();

        process.emit('SIGTERM');
        expect(watchdogTimer(timeouts)).toBeDefined();
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

        expect(journal).toEqual(['relay:start']);
        expect(exit).toHaveBeenCalledWith(1);
    });
});
