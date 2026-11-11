// AC-9.1 (C; UC-3, UC-8, UC-13; NFR-4, NFR-8): процесс сервиса-потребителя по форме production
// (node --import ./dist/service/instrument.js dist/service/main.js) на упакованном архиве через bootstrapService — /ok,
// /health (пробы KitDatabaseModule), /metrics, очистка идемпотентности (AC-9.5), остановка по SIGTERM с выходом 0 (пулы —
// шаг 4, очистка — шаг 3), отказ запуска при неверном окружении (prd.md §3.2, §3.5).
// Логи bootstrapService (entry http) — JSON в stdout; порты — из строки «сервис слушает». Сборка dist — globalSetup.
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, inject, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DRAIN_MS = 1500;
const TIMEOUT_MS = 5000;

interface Ports {
    readonly port: number;
    readonly metricsPort: number;
}

interface Service {
    readonly child: ChildProcess;
    readonly ports: Promise<Ports>;
    readonly exited: Promise<number | null>;
    output(): string;
    /** Первая строка лога с сообщением msg (ожидание по потоку stdout, без sleep). */
    line(msg: string): Promise<Record<string, unknown>>;
}

const running: ChildProcess[] = [];

afterEach(() => {
    for (const child of running.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
    }
});

function startService(overrides: Record<string, string> = {}): Service {
    const databaseUrl = inject('kitDatabaseUrl');
    const child = spawn(
        process.execPath,
        ['--import', './dist/service/instrument.js', 'dist/service/main.js'],
        {
            cwd: ROOT,
            env: {
                DATABASE_URL: databaseUrl ?? '',
                AUTH_ISSUER: 'https://id.verdeect.ru',
                AUTH_JWKS_URI: 'http://127.0.0.1:9/jwks',
                AUTH_RESOURCE: 'https://api.verdeect.ru',
                METRICS_PORT: '0',
                PORT: '0',
                SHUTDOWN_DRAIN_MS: String(DRAIN_MS),
                SHUTDOWN_TIMEOUT_MS: String(TIMEOUT_MS),
                SENTRY_DSN: '',
                REPLICA_ID: 'consumer-1',
                ...overrides,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    running.push(child);
    let stdout = '';
    let stderr = '';
    const waiters: { msg: string; resolve: (line: Record<string, unknown>) => void }[] = [];
    const check = (): void => {
        for (const waiter of [...waiters]) {
            const found = logLines(stdout).find((line) => line.msg === waiter.msg);
            if (found !== undefined) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve(found);
            }
        }
    };
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
    });
    const ports = new Promise<Ports>((resolve, reject) => {
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
            stdout += chunk;
            check();
            const listening = logLines(stdout).find((line) => line.msg === 'сервис слушает');
            if (listening !== undefined) {
                resolve(listening as unknown as Ports);
            }
        });
        child.once('exit', () =>
            reject(new Error(`процесс вышел до старта:\n${stdout}\n${stderr}`)),
        );
    });
    ports.catch(() => undefined);
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));

    return {
        child,
        ports,
        exited,
        output: () => `${stdout}${stderr}`,
        line: (msg) =>
            new Promise((resolve) => {
                waiters.push({ msg, resolve });
                check();
            }),
    };
}

function logLines(text: string): Record<string, unknown>[] {
    return text
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('UC-13: процесс сервиса-потребителя', () => {
    it('AC-9.1: /ok на PORT → 200', async () => {
        const service = startService();
        const { port } = await service.ports;

        const response = await fetch(`http://127.0.0.1:${port}/ok`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('AC-9.1: /health — database и database-read up', async () => {
        const service = startService();
        const { metricsPort: port } = await service.ports;

        const response = await fetch(`http://127.0.0.1:${port}/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: 'ok',
            checks: { database: 'up', 'database-read': 'up' },
        });
    });

    it('AC-9.5: после старта — лог «очистка идемпотентности: проход» с service consumer и replica consumer-1; /metrics — verdeect_cleanup_runs_total с метками table="idempotency_key", result="ok", service="consumer" ≥ 1', async () => {
        const service = startService();
        const { metricsPort: port } = await service.ports;
        const pass = await service.line('очистка идемпотентности: проход');

        expect(pass).toMatchObject({
            service: 'consumer',
            replica: 'consumer-1',
            table: 'idempotency_key',
            result: 'ok',
        });
        expect(pass.deleted).toBeTypeOf('number');
        const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
        const sample = body
            .split('\n')
            .find(
                (line) =>
                    line.startsWith('verdeect_cleanup_runs_total{') &&
                    line.includes('table="idempotency_key"') &&
                    line.includes('result="ok"') &&
                    line.includes('service="consumer"'),
            );
        expect(Number(sample?.split(' ').at(-1))).toBeGreaterThanOrEqual(1);
    });

    it('AC-9.1: /metrics — метрики процесса и verdeect_outbox_pending{service="consumer"}', async () => {
        const service = startService();
        const { metricsPort: port } = await service.ports;

        const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();

        expect(body).toMatch(/^process_cpu_user_seconds_total\{service="consumer"\}/m);
        expect(body).toContain('verdeect_outbox_pending{service="consumer"}');
    });

    it('AC-9.1: SIGTERM — /health 503 во время паузы, выход 0 в пределах SHUTDOWN_TIMEOUT_MS', async () => {
        const service = startService();
        const { metricsPort: port } = await service.ports;
        const statuses: number[] = [];
        let polling = true;
        let firstOk: () => void = () => undefined;
        const ready = new Promise<void>((resolve) => {
            firstOk = resolve;
        });
        // Опрос и есть предмет теста: 503 должен появиться за паузу SHUTDOWN_DRAIN_MS до выхода.
        const poll = (async () => {
            while (polling) {
                try {
                    const status = (await fetch(`http://127.0.0.1:${port}/health`)).status;
                    statuses.push(status);
                    if (status === 200) {
                        firstOk();
                    }
                } catch {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        })();

        await ready;
        const signalledAt = performance.now();
        service.child.kill('SIGTERM');
        const code = await service.exited;
        const elapsed = performance.now() - signalledAt;
        polling = false;
        await poll;

        expect(code, service.output()).toBe(0);
        expect(elapsed).toBeLessThan(TIMEOUT_MS);
        expect(statuses).toContain(200);
        expect(statuses).toContain(503);
    });

    it('AC-9.1: строки остановки содержат service и replica', async () => {
        const service = startService({ SHUTDOWN_DRAIN_MS: '0' });
        await service.ports;

        service.child.kill('SIGTERM');
        expect(await service.exited).toBe(0);

        const lines = logLines(service.output()).filter((line) =>
            String(line.msg).startsWith('остановка'),
        );
        expect(lines.map((line) => line.msg)).toEqual(
            expect.arrayContaining(['остановка: начало', 'остановка: завершена']),
        );
        for (const line of lines) {
            expect(line).toMatchObject({ service: 'consumer', replica: 'consumer-1' });
        }
    });

    it('AC-9.1: неверный METRICS_PORT → fatal с именем ключа без значения, выход 1', async () => {
        const service = startService({ METRICS_PORT: 'MARK_BAD_PORT' });

        expect(await service.exited).toBe(1);
        const fatal = logLines(service.output()).find((line) => line.level === 60);
        expect(fatal).toMatchObject({
            level: 60,
            code: 'INVALID_ENVIRONMENT',
            keys: ['METRICS_PORT'],
        });
        expect(service.output()).not.toContain('MARK_BAD_PORT');
    });

    it('AC-9.1: неверное окружение → fatal без значения, выход 1, порт не открыт', async () => {
        const service = startService({ PORT: 'MARK_BAD_PORT' });

        expect(await service.exited).toBe(1);
        const lines = logLines(service.output());
        expect(lines.find((line) => line.level === 60)).toMatchObject({
            code: 'INVALID_ENVIRONMENT',
            keys: ['PORT'],
        });
        expect(lines.some((line) => line.msg === 'сервис слушает')).toBe(false);
        expect(service.output()).not.toContain('MARK_BAD_PORT');
    });
});
