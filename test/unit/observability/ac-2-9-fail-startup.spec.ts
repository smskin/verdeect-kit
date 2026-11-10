// AC-2.9 (U, UC-3; NFR-4, NFR-9): failStartup — fatal-лог, событие GlitchTip отправлено до выхода (поддельный транспорт
// с задержкой 500 мс), код 1; InvalidEnvironmentError — только имена ключей; StartupFailure — startupCode и
// startupDetails(); GlitchTip недоступен — выход через flush 2 с (prd.md §3.2, UC-3 А2). Перенос: O fail-startup.spec.ts
// (it.each по веткам, лог в потоке, выход только после flush). Sentry — настоящий SDK с поддельным транспортом.
import * as Sentry from '@sentry/nestjs';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidEnvironmentError } from '../../../src/config/index.js';
import { failStartup, type StartupFailure } from '../../../src/observability/index.js';
import {
    initFakeSentry,
    type DeliveredEvent,
    type FakeTransportMode,
} from '../../support/fake-sentry.js';
import { collector } from './support.js';

class CatalogError extends Error implements StartupFailure {
    readonly startupCode = 'CATALOG_INVALID';

    startupDetails(): Readonly<Record<string, unknown>> {
        return { path: 'default.modelId' };
    }
}

let mode: FakeTransportMode;
let delivered: DeliveredEvent[];

beforeAll(() => {
    ({ mode, delivered } = initFakeSentry());
});

afterAll(async () => {
    await Sentry.close(1);
});

beforeEach(() => {
    delivered.splice(0);
    mode.delayMs = 0;
});

/** Запускает failStartup с подменённым exit; возвращает строки лога и момент выхода. */
async function run(raw: unknown) {
    const output = collector();
    const logger = pino({ level: 'info', base: { service: 'kit-test' } }, output.stream);
    let exitedAt: number | null = null;
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        exitedAt = performance.now();

        return undefined as never;
    });

    await failStartup(raw, logger);

    return { output, exit, exitedAt: exitedAt as number | null };
}

describe('UC-3: отказ запуска', () => {
    it('AC-2.9: InvalidEnvironmentError — fatal (60) только с именами ключей, без значения; событие отправлено до exit(1)', async () => {
        const error = new InvalidEnvironmentError(['METRICS_PORT', 'DATABASE_URL']);

        const { output, exit } = await run(error);

        expect(exit).toHaveBeenCalledWith(1);
        expect(output.records()).toEqual([
            expect.objectContaining({
                level: 60,
                code: 'INVALID_ENVIRONMENT',
                keys: ['METRICS_PORT', 'DATABASE_URL'],
            }),
        ]);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]?.tags).toMatchObject({ code: 'INVALID_ENVIRONMENT' });
    });

    it('AC-2.9: StartupFailure — startupCode и startupDetails() в логе и теге события', async () => {
        const { output } = await run(new CatalogError('каталог не прошёл проверку'));

        expect(output.records()[0]).toMatchObject({
            level: 60,
            code: 'CATALOG_INVALID',
            path: 'default.modelId',
        });
        expect(delivered[0]?.tags).toMatchObject({ code: 'CATALOG_INVALID' });
    });

    it('AC-2.9: прочая ошибка — через sanitizeError, SQL нет', async () => {
        const pg = Object.assign(new Error('Key (email)=(MARK_EMAIL) insert into x'), {
            code: '23505',
            severity: 'ERROR',
        });

        const { output } = await run(new Error('bootstrap', { cause: pg }));

        expect(output.records()[0]).toMatchObject({
            level: 60,
            code: 'STARTUP_FAILED',
            err: { type: 'SanitizedDbError', code: '23505' },
        });
        expect(output.text()).not.toContain('MARK_EMAIL');
        expect(delivered[0]?.body).not.toContain('MARK_EMAIL');
        expect(delivered[0]?.body).not.toContain('insert into');
    });

    it('AC-2.9: exit(1) не раньше доставки события (транспорт 500 мс)', async () => {
        mode.delayMs = 500;

        const { exitedAt } = await run(new Error('late'));

        expect(delivered).toHaveLength(1);
        expect(exitedAt).not.toBeNull();
        expect(exitedAt ?? 0).toBeGreaterThanOrEqual(delivered[0]?.at ?? Infinity);
    });

    it('AC-2.9: GlitchTip недоступен (транспорт не отвечает) — exit(1) через ≈ 2 с (flush 2000), fatal-лог записан до выхода', async () => {
        mode.delayMs = 'hang';
        vi.useFakeTimers();
        try {
            const output = collector();
            const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
            const pending = failStartup(
                new Error('unreachable'),
                pino({ level: 'info' }, output.stream),
            );

            await vi.advanceTimersByTimeAsync(1900);
            expect(exit).not.toHaveBeenCalled();
            expect(output.records()[0]).toMatchObject({ level: 60 });

            await vi.advanceTimersByTimeAsync(200);
            await pending;
            expect(exit).toHaveBeenCalledWith(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('AC-2.9: startupDetails() бросает — fatal-лог, событие и exit(1) всё равно', async () => {
        const broken: StartupFailure = {
            startupCode: 'BROKEN_DETAILS',
            startupDetails: () => {
                throw new Error('details failed');
            },
        };

        const { output, exit } = await run(broken);

        expect(exit).toHaveBeenCalledWith(1);
        expect(output.records()[0]).toMatchObject({ level: 60, code: 'BROKEN_DETAILS' });
        expect(delivered[0]?.tags).toMatchObject({ code: 'BROKEN_DETAILS' });
    });

    it('NFR-9: сообщения fatal по-русски', async () => {
        const env = await run(new InvalidEnvironmentError(['PORT']));
        const other = await run(new Error('x'));

        for (const output of [env.output, other.output]) {
            expect(String(output.records()[0]?.msg)).toMatch(/[а-яё]/i);
        }
    });
});
