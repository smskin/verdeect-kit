// AC-9.1 (C, часть E2; UC-3, UC-8, UC-13; NFR-4, NFR-8): процесс сервиса-потребителя по форме production
// (node --import ./service/instrument.mjs service/main.mjs) на упакованном архиве — /health, /metrics, остановка по
// SIGTERM с выходом 0, отказ запуска при неверном окружении (prd.md §3.2).
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, inject, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DRAIN_MS = 1500;
const TIMEOUT_MS = 5000;

interface Service {
    readonly child: ChildProcess;
    readonly port: Promise<number>;
    readonly exited: Promise<number | null>;
    stderr(): string;
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
    const postgresUrl = inject('kitPostgresUrl');
    const child = spawn(
        process.execPath,
        ['--import', './service/instrument.mjs', 'service/main.mjs'],
        {
            cwd: ROOT,
            env: {
                DATABASE_URL: postgresUrl ?? '',
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
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
    });
    const port = new Promise<number>((resolve, reject) => {
        child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
            stdout += chunk;
            const line = stdout.split('\n')[0];
            if (stdout.includes('\n') && line !== undefined) {
                resolve((JSON.parse(line) as { metricsPort: number }).metricsPort);
            }
        });
        child.once('exit', () => reject(new Error(`процесс вышел до старта:\n${stderr}`)));
    });
    port.catch(() => undefined);
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));

    return { child, port, exited, stderr: () => stderr };
}

function stderrLines(text: string): Record<string, unknown>[] {
    return text
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('UC-13: процесс сервиса-потребителя', () => {
    it('AC-9.1: /health → 200 ok, проба database up', async () => {
        const service = startService();
        const port = await service.port;

        const response = await fetch(`http://127.0.0.1:${port}/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'up' } });
    });

    it('AC-9.1: /metrics — метрики процесса и verdeect_outbox_pending{service="consumer"}', async () => {
        const service = startService();
        const port = await service.port;

        const body = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();

        expect(body).toMatch(/^process_cpu_user_seconds_total\{service="consumer"\}/m);
        expect(body).toContain('verdeect_outbox_pending{service="consumer"}');
    });

    it('AC-9.1: SIGTERM — /health 503 во время паузы, выход 0 в пределах SHUTDOWN_TIMEOUT_MS', async () => {
        const service = startService();
        const port = await service.port;
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

        expect(code, service.stderr()).toBe(0);
        expect(elapsed).toBeLessThan(TIMEOUT_MS);
        expect(statuses).toContain(200);
        expect(statuses).toContain(503);
    });

    it('AC-9.1: строки остановки в stderr содержат service и replica', async () => {
        const service = startService({ SHUTDOWN_DRAIN_MS: '0' });
        await service.port;

        service.child.kill('SIGTERM');
        expect(await service.exited).toBe(0);

        const lines = stderrLines(service.stderr()).filter((line) =>
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
        const [fatal] = stderrLines(service.stderr());
        expect(fatal).toMatchObject({
            level: 60,
            code: 'INVALID_ENVIRONMENT',
            keys: ['METRICS_PORT'],
        });
        expect(service.stderr()).not.toContain('MARK_BAD_PORT');
    });
});
