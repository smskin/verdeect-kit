// §3.2 HealthRegistry (U, UC-13; AC-2.7 — логика без HTTP): все up → ok, критичная down → unavailable, некритичная →
// degraded, проба дольше 2 с → down, исключение → down; после markStopping — unavailable без проб; лог только при смене
// состояния. Перенос: O health-registry.spec.ts.
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthRegistry, kitMetrics, MetricsServer } from '../../../src/observability/index.js';
import { collector } from './support.js';

function registry() {
    const output = collector();

    return {
        output,
        health: new HealthRegistry({ logger: pino({ level: 'trace' }, output.stream) }),
    };
}

const up = async (): Promise<boolean> => true;
const down = async (): Promise<boolean> => false;

afterEach(() => {
    vi.useRealTimers();
});

describe('UC-13: пробы готовности', () => {
    it('§3.2: все пробы up → ok', async () => {
        const { health } = registry();
        health.register('database', up, { critical: true });
        health.register('rabbitmq', up, { critical: false });

        expect(await health.evaluate()).toEqual({
            status: 'ok',
            checks: { database: 'up', rabbitmq: 'up' },
        });
    });

    it('§3.2: упавшая критичная проба → unavailable', async () => {
        const { health } = registry();
        health.register('database', down, { critical: true });
        health.register('redis', up, { critical: false });

        expect(await health.evaluate()).toEqual({
            status: 'unavailable',
            checks: { database: 'down', redis: 'up' },
        });
    });

    it('§3.2: упавшая некритичная → degraded', async () => {
        const { health } = registry();
        health.register('database', up, { critical: true });
        health.register('redis', down, { critical: false });

        expect((await health.evaluate()).status).toBe('degraded');
    });

    it('§3.2: проба дольше 2 с → down', async () => {
        vi.useFakeTimers();
        const { health } = registry();
        health.register('database', () => new Promise(() => undefined), { critical: true });

        const report = health.evaluate();
        await vi.advanceTimersByTimeAsync(2000);

        expect(await report).toEqual({ status: 'unavailable', checks: { database: 'down' } });
    });

    it('§3.2: исключение пробы → down', async () => {
        const { health } = registry();
        health.register('redis', () => Promise.reject(new Error('ECONNREFUSED')), {
            critical: false,
        });

        expect(await health.evaluate()).toEqual({ status: 'degraded', checks: { redis: 'down' } });
    });

    it('§3.2: повторная регистрация имени заменяет пробу', async () => {
        const { health } = registry();
        health.register('database', down, { critical: true });
        health.register('database', up, { critical: true });

        expect((await health.evaluate()).status).toBe('ok');
    });

    it('§3.2: после markStopping — unavailable без запуска проб', async () => {
        const { health } = registry();
        const probe = vi.fn(up);
        health.register('database', probe, { critical: true });

        health.markStopping();

        expect(health.isStopping).toBe(true);
        expect(await health.evaluate()).toEqual({ status: 'unavailable', checks: {} });
        expect(probe).not.toHaveBeenCalled();
    });

    it('Logging: warn только при смене up → down, info — при down → up', async () => {
        const { health, output } = registry();
        let state = true;
        health.register('redis', async () => state, { critical: false });

        await health.evaluate();
        await health.evaluate();
        expect(output.records()).toEqual([]);

        state = false;
        await health.evaluate();
        await health.evaluate();
        state = true;
        await health.evaluate();

        expect(output.records()).toEqual([
            expect.objectContaining({ level: 40, check: 'redis', critical: false }),
            expect.objectContaining({ level: 30, check: 'redis' }),
        ]);
    });

    it('Logging: первый результат down — warn с причиной через sanitizeError', async () => {
        const { health, output } = registry();
        const pg = Object.assign(new Error('Key (email)=(MARK)'), {
            code: '57P01',
            severity: 'FATAL',
        });
        health.register('database', () => Promise.reject(pg), { critical: true });

        await health.evaluate();

        expect(output.records()).toEqual([
            expect.objectContaining({ level: 40, check: 'database', critical: true }),
        ]);
        expect(output.text()).not.toContain('MARK');
    });
});

describe('§3.2: MetricsServer без сети', () => {
    it('§3.2: listen() после close() — ошибка разработчика, порт не открывается', async () => {
        const logger = pino({ level: 'silent' });
        const server = new MetricsServer({
            port: 0,
            registry: kitMetrics({ service: 'kit-test' }).registry,
            health: new HealthRegistry({ logger }),
            logger,
        });

        await server.close();

        await expect(server.listen()).rejects.toThrow('MetricsServer: listen() после close()');
        expect(server.address()).toBeNull();
    });
});
