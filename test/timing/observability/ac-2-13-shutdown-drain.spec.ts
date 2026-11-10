// AC-2.13 (T, UC-8): SHUTDOWN_DRAIN_MS = 500 — между шагом 1 (/health 503) и шагом 2 проходит ≥ 500 мс; пауза входит в
// SHUTDOWN_TIMEOUT_MS (поддельные участники; prd.md §3.2, CE-7). Порядок — через close() (KT-11), срок — через сигнал.
import * as Sentry from '@sentry/nestjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import { lifecycleStand, signalSnapshot, sleep } from './support.js';

let delivered: DeliveredEvent[];
let restoreSignals: () => void;

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
    restoreSignals();
    vi.restoreAllMocks();
});

describe('UC-8: пауза перед остановкой', () => {
    it('AC-2.13: SHUTDOWN_DRAIN_MS = 500 — между /health 503 (шаг 1) и шагом 2 ≥ 500 мс', async () => {
        const { lifecycle, health } = lifecycleStand({
            SHUTDOWN_TIMEOUT_MS: 5000,
            SHUTDOWN_DRAIN_MS: 500,
        });
        let stoppingAt = NaN;
        let step2At = NaN;
        const markStopping = health.markStopping.bind(health);
        vi.spyOn(health, 'markStopping').mockImplementation(() => {
            stoppingAt = performance.now();
            markStopping();
        });
        lifecycle.register(
            {
                name: 'http',
                stop: async () => {
                    step2At = performance.now();
                    expect(await health.evaluate()).toMatchObject({ status: 'unavailable' });
                },
            },
            { step: 2 },
        );

        await lifecycle.close();

        // Таймер Node не срабатывает раньше срока; 1 мс — округление performance.now().
        expect(step2At - stoppingAt).toBeGreaterThanOrEqual(499);
    });

    it('AC-2.13: пауза входит в SHUTDOWN_TIMEOUT_MS', async () => {
        const { lifecycle, log, exitedAt } = lifecycleStand({
            SHUTDOWN_TIMEOUT_MS: 700,
            SHUTDOWN_DRAIN_MS: 500,
        });
        lifecycle.register({ name: 'relay', stop: () => sleep(300) }, { step: 3 });
        lifecycle.listen(['SIGTERM']);

        const signalledAt = performance.now();
        process.emit('SIGTERM');
        const elapsed = (await exitedAt) - signalledAt;

        expect(elapsed).toBeGreaterThanOrEqual(700);
        // Сторож срабатывает по сроку, а не после окончания шагов (пауза 500 + шаг 300 = 800 мс).
        expect(elapsed).toBeLessThan(700 + 100 * TEST_TIMEOUT_SCALE);
        expect(log.records()).toContainEqual(
            expect.objectContaining({ level: 50, code: 'SHUTDOWN_TIMEOUT', step: 3 }),
        );
        expect(delivered.map((event) => event.tags.code)).toEqual(['SHUTDOWN_TIMEOUT']);
    });
});
