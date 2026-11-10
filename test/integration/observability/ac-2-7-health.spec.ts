// AC-2.7 (I, UC-8, UC-13): /health по HTTP — критичная проба down → 503 unavailable, некритичная → 200 degraded, проба
// дольше 2 с — down, после начала остановки — 503 (prd.md §3.2). AC-2.8: /metrics по HTTP. §3.2: port 0 и занятый порт.
// Перенос: O test/http/observability/ac-10-4-health.http-spec.ts (состояния 200/503) и or-106-health-stopping-first
// (барьер в участнике: остановка начата — /health уже 503). Критичная проба — TCP до PostgreSQL контейнера globalSetup.
import { connect, createServer, type Server } from 'node:net';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
    HealthRegistry,
    KitLifecycle,
    kitMetrics,
    MetricsServer,
} from '../../../src/observability/index.js';

const logger = pino({ level: 'silent' });

/** TCP-проба PostgreSQL: соединение установлено — up. */
function tcpProbe(url: string): () => Promise<boolean> {
    const { hostname, port } = new URL(url);

    return () =>
        new Promise((resolve) => {
            const socket = connect({ host: hostname, port: Number(port) });
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.end();
                resolve(true);
            });
            socket.once('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            socket.once('error', () => resolve(false));
        });
}

/** Сервер метрик на порту 0 с управляемыми пробами. */
async function startServer(probes: {
    readonly critical?: () => Promise<boolean>;
    readonly optional?: () => Promise<boolean>;
}) {
    const health = new HealthRegistry({ logger });
    health.register('database', tcpProbe(inject('kitPostgresUrl') ?? ''), { critical: true });
    if (probes.critical) {
        health.register('critical', probes.critical, { critical: true });
    }
    if (probes.optional) {
        health.register('optional', probes.optional, { critical: false });
    }
    const metrics = kitMetrics({ service: 'kit-test' });
    const server = new MetricsServer({ port: 0, registry: metrics.registry, health, logger });
    await server.listen();
    const url = (path: string) => `http://127.0.0.1:${String(server.address())}${path}`;

    return { health, server, url };
}

const servers: MetricsServer[] = [];

async function started(probes: Parameters<typeof startServer>[0] = {}) {
    const result = await startServer(probes);
    servers.push(result.server);

    return result;
}

afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
});

describe('UC-13: /health по HTTP', () => {
    it('AC-2.7: все up → 200 ok, checks up', async () => {
        const { url } = await started({ optional: async () => true });

        const response = await fetch(url('/health'));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            status: 'ok',
            checks: { database: 'up', optional: 'up' },
        });
    });

    it('AC-2.7: критичная down → 503 unavailable', async () => {
        const { url } = await started({ critical: async () => false });

        const response = await fetch(url('/health'));

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            status: 'unavailable',
            checks: { database: 'up', critical: 'down' },
        });
    });

    it('AC-2.7: некритичная down → 200 degraded', async () => {
        const { url } = await started({ optional: async () => false });

        const response = await fetch(url('/health'));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ status: 'degraded' });
    });

    it('AC-2.7: проба дольше 2 с — down', async () => {
        const { url } = await started({ critical: () => new Promise(() => undefined) });

        const startedAt = performance.now();
        const response = await fetch(url('/health'));

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ checks: { critical: 'down' } });
        expect(performance.now() - startedAt).toBeGreaterThanOrEqual(1900);
    });

    it('AC-2.7: после начала остановки (close(), без сторожа — KT-11), пока участник шага 2 ещё работает, /health → 503', async () => {
        const { health, server, url } = await started();
        const lifecycle = new KitLifecycle({
            logger,
            health,
            env: { SHUTDOWN_TIMEOUT_MS: 10_000, SHUTDOWN_DRAIN_MS: 0 },
        });
        let release: () => void = () => undefined;
        let entered: () => void = () => undefined;
        const inStep2 = new Promise<void>((resolve) => {
            entered = resolve;
        });
        lifecycle.register(
            {
                name: 'http',
                stop: () =>
                    new Promise<void>((resolve) => {
                        release = resolve;
                        entered();
                    }),
            },
            { step: 2 },
        );
        lifecycle.register({ name: 'metrics', stop: () => server.close() }, { step: 5 });
        expect((await fetch(url('/health'))).status).toBe(200);

        const closing = lifecycle.close();
        await inStep2;
        const response = await fetch(url('/health'));
        release();
        await closing;

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: 'unavailable', checks: {} });
        expect(server.address()).toBeNull();
    });

    it('AC-2.8: /metrics по HTTP — text/plain, метрики с service', async () => {
        const { url } = await started();

        const response = await fetch(url('/metrics?x=1'));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
        const body = await response.text();
        expect(body).toContain('verdeect_outbox_pending{service="kit-test"}');
        expect(body).toMatch(/^process_cpu_user_seconds_total\{service="kit-test"\}/m);
        expect((await fetch(url('/other'))).status).toBe(404);
    });

    it('§3.2: port 0 — ОС выбирает порт, address() > 0, сервер отвечает (не выключение)', async () => {
        const { server, url } = await started();

        expect(server.address()).toBeGreaterThan(0);
        expect((await fetch(url('/metrics'))).status).toBe(200);
    });
});

describe('§3.2: ошибка прослушивания', () => {
    let busy: Server;

    beforeAll(async () => {
        busy = createServer();
        await new Promise<void>((resolve) => busy.listen(0, resolve));
    });

    afterAll(async () => {
        await new Promise((resolve) => busy.close(resolve));
    });

    it('§3.2: порт занят — listen() отклоняется с EADDRINUSE', async () => {
        const address = busy.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const server = new MetricsServer({
            port,
            registry: kitMetrics({ service: 'kit-test' }).registry,
            health: new HealthRegistry({ logger }),
            logger,
        });

        await expect(server.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
        expect(server.address()).toBeNull();
    });
});
