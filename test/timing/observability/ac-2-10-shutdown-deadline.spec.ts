// AC-2.10 (T, UC-8 А1): остановка на поддельных участниках шагов 2–5 без HTTP — порядок шагов (журнал вызовов),
// участник шага 3 вызывается после завершения шага 2; пауза и шаги дольше SHUTDOWN_TIMEOUT_MS от сигнала → error-лог
// SHUTDOWN_TIMEOUT, событие GlitchTip, exit(1); в срок — exit до срока не вызывается, к сроку (дескрипторы Vitest
// открыты) — SHUTDOWN_NOT_EXITED и exit(1) (prd.md §3.2, CE-7; KT-10, KT-11). Образец срока от сигнала — P
// test/timing/observability/ac-6-6-shutdown-deadline.timing-spec.ts. Sentry — настоящий SDK с поддельным транспортом.
import * as Sentry from '@sentry/nestjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { lifecycleStand, signalSnapshot, sleep } from './support.js';

let delivered: DeliveredEvent[];
let restoreSignals: () => void;
let releaseHanging: () => void = () => undefined;

beforeAll(() => {
    ({ delivered } = initFakeSentry());
});

afterAll(async () => {
    await Sentry.close(1);
});

beforeEach(() => {
    delivered.splice(0);
    restoreSignals = signalSnapshot();
});

afterEach(() => {
    // Сторож каждого теста сигнала уже сработал (тест ждёт exit); затем снять обработчики и подмены.
    releaseHanging();
    restoreSignals();
    vi.restoreAllMocks();
});

describe('UC-8: срок остановки', () => {
    it('AC-2.10: шаги 2–5 по порядку (журнал вызовов), участник шага 3 вызывается после завершения шага 2', async () => {
        const { lifecycle, exit } = lifecycleStand({
            SHUTDOWN_TIMEOUT_MS: 5000,
            SHUTDOWN_DRAIN_MS: 0,
        });
        const journal: { readonly event: string; readonly at: number }[] = [];
        const record = (event: string) => journal.push({ event, at: performance.now() });
        for (const [step, name, ms] of [
            [5, 'metrics', 10],
            [2, 'http', 100],
            [4, 'pools', 10],
            [3, 'relay', 50],
            [2, 'sse', 30],
        ] as const) {
            lifecycle.register(
                {
                    name,
                    stop: async () => {
                        record(`${name}:start`);
                        await sleep(ms);
                        record(`${name}:end`);
                    },
                },
                { step },
            );
        }

        await lifecycle.close();

        expect(journal.map((item) => item.event)).toEqual([
            'http:start',
            'sse:start',
            'sse:end',
            'http:end',
            'relay:start',
            'relay:end',
            'pools:start',
            'pools:end',
            'metrics:start',
            'metrics:end',
        ]);
        const at = (event: string) => journal.find((item) => item.event === event)?.at ?? NaN;
        expect(at('relay:start')).toBeGreaterThanOrEqual(at('http:end'));
        expect(exit).not.toHaveBeenCalled();
    });

    it('AC-2.10: пауза + шаги дольше SHUTDOWN_TIMEOUT_MS от сигнала → error-лог SHUTDOWN_TIMEOUT, событие GlitchTip, exit(1)', async () => {
        const { lifecycle, log, exit, exitedAt } = lifecycleStand({
            SHUTDOWN_TIMEOUT_MS: 300,
            SHUTDOWN_DRAIN_MS: 100,
        });
        lifecycle.register(
            {
                name: 'relay',
                stop: () =>
                    new Promise<void>((resolve) => {
                        releaseHanging = resolve;
                    }),
            },
            { step: 3 },
        );
        lifecycle.listen(['SIGTERM']);

        const signalledAt = performance.now();
        process.emit('SIGTERM');
        const elapsed = (await exitedAt) - signalledAt;

        expect(exit).toHaveBeenCalledWith(1);
        expect(elapsed).toBeGreaterThanOrEqual(300);
        expect(log.records()).toContainEqual(
            expect.objectContaining({
                level: 50,
                code: 'SHUTDOWN_TIMEOUT',
                step: 3,
                pending: ['relay'],
            }),
        );
        expect(delivered.map((event) => event.tags.code)).toEqual(['SHUTDOWN_TIMEOUT']);
        expect(delivered[0]?.at ?? Infinity).toBeLessThanOrEqual(await exitedAt);
    });

    it('AC-2.10: в срок — до срока exit не вызывается, к сроку в процессе Vitest (дескрипторы открыты) — SHUTDOWN_NOT_EXITED и exit(1)', async () => {
        const { lifecycle, log, exit, exitedAt } = lifecycleStand({
            SHUTDOWN_TIMEOUT_MS: 400,
            SHUTDOWN_DRAIN_MS: 50,
        });
        lifecycle.register({ name: 'pools', stop: () => sleep(50) }, { step: 4 });
        lifecycle.listen(['SIGTERM']);

        const signalledAt = performance.now();
        process.emit('SIGTERM');
        await sleep(250);
        expect(log.records()).toContainEqual(
            expect.objectContaining({ msg: 'остановка: завершена' }),
        );
        expect(exit).not.toHaveBeenCalled();

        const elapsed = (await exitedAt) - signalledAt;
        expect(elapsed).toBeGreaterThanOrEqual(400);
        expect(exit).toHaveBeenCalledWith(1);
        expect(log.records()).toContainEqual(
            expect.objectContaining({ level: 50, code: 'SHUTDOWN_NOT_EXITED' }),
        );
        expect(delivered.map((event) => event.tags.code)).toEqual(['SHUTDOWN_NOT_EXITED']);
    });
});
