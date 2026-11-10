// AC-3.9 (T, UC-8; KT-15 п. 1): остановка HTTP под нагрузкой в настоящем дочернем процессе на bootstrapService (prd.md §3.2
// шаги 1–5, §3.5): /health 503 раньше, чем HTTP перестаёт принимать соединения; начатый долгий запрос дорабатывает с 200;
// новый после шага 2 — отказ соединения; выход 0 в срок; открытый поток SSE закрывает участник шага 2 сервиса. Перенос O
// ac-10-8-shutdown.http-spec.ts и or-106-health-stopping-first.http-spec.ts. Ребёнок импортирует dist, собранный в
// beforeAll в node_modules/.cache (dist/ не трогается).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = fileURLToPath(
    new URL('../../../node_modules/.cache/kit-timing-dist/', import.meta.url),
);
const CHILD = fileURLToPath(new URL('../../fixtures/http/shutdown-app.mjs', import.meta.url));
const TIMEOUT_MS = 5000;
const DRAIN_MS = 500;
const POLL_MS = 25;

interface Started {
    readonly child: ChildProcess;
    readonly port: number;
    readonly metricsPort: number;
    readonly exited: Promise<{ code: number | null; at: number }>;
    readonly output: () => string;
}

function start(mode: 'plain' | 'sse'): Promise<Started> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CHILD, mode, DIST], {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PORT: '0',
                METRICS_PORT: '0',
                LOG_LEVEL: 'info',
                SHUTDOWN_DRAIN_MS: String(DRAIN_MS),
                SHUTDOWN_TIMEOUT_MS: String(TIMEOUT_MS),
            },
        });
        let output = '';
        const exited = new Promise<{ code: number | null; at: number }>((done) => {
            child.once('exit', (code) => done({ code, at: performance.now() }));
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            output += chunk;
        });
        child.stdout.on('data', (chunk: string) => {
            output += chunk;
            const line = output.split('\n').find((item) => item.includes('"сервис слушает"'));
            if (line !== undefined) {
                const { port, metricsPort } = JSON.parse(line) as {
                    port: number;
                    metricsPort: number;
                };
                resolve({ child, port, metricsPort, exited, output: () => output });
            }
        });
        child.once('error', reject);
        void exited.then(() => reject(new Error(`ребёнок вышел до запуска:\n${output}`)));
    });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Время первого ответа /health 503 и первого отказа соединения /ok от начала опроса. */
async function poll(app: Started, until: Promise<unknown>) {
    let healthDown: number | null = null;
    let okRefused: number | null = null;
    let refusalCode: unknown = null;
    let done = false;
    void until.then(() => {
        done = true;
    });
    while (!done && (healthDown === null || okRefused === null)) {
        const now = performance.now();
        if (healthDown === null) {
            const res = await fetch(`http://127.0.0.1:${app.metricsPort}/health`).catch(() => null);
            if (res !== null && res.status === 503) {
                healthDown = now;
            }
            await res?.text();
        }
        if (okRefused === null) {
            try {
                await (await fetch(`http://127.0.0.1:${app.port}/ok`)).text();
            } catch (error) {
                okRefused = now;
                refusalCode = (error as { cause?: { code?: unknown } }).cause?.code;
            }
        }
        await sleep(POLL_MS);
    }

    return { healthDown, okRefused, refusalCode };
}

beforeAll(() => {
    execFileSync(
        process.execPath,
        [
            fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
            '-p',
            'tsconfig.build.json',
            '--outDir',
            DIST,
        ],
        { cwd: ROOT, stdio: 'inherit' },
    );
});

describe('UC-8: остановка HTTP под нагрузкой', () => {
    let result: {
        healthDown: number | null;
        okRefused: number | null;
        refusalCode: unknown;
        slowStatus: number;
        exit: { code: number | null; at: number };
        signalledAt: number;
        output: string;
    };

    beforeAll(async () => {
        const app = await start('plain');
        const slow = fetch(`http://127.0.0.1:${app.port}/slow`);
        await sleep(100);
        const signalledAt = performance.now();
        app.child.kill('SIGTERM');
        const polled = await poll(app, app.exited);
        const slowRes = await slow;
        await slowRes.text();
        result = {
            ...polled,
            slowStatus: slowRes.status,
            exit: await app.exited,
            signalledAt,
            output: app.output(),
        };
    });

    it('AC-3.9: /health 503 раньше, чем HTTP перестаёт принимать соединения', () => {
        expect(result.healthDown, result.output).not.toBeNull();
        expect(result.okRefused, result.output).not.toBeNull();
        expect(result.healthDown ?? Infinity).toBeLessThan(result.okRefused ?? -Infinity);
        expect((result.okRefused ?? 0) - result.signalledAt).toBeGreaterThanOrEqual(
            DRAIN_MS - POLL_MS * 2,
        );
    });

    it('AC-3.9: долгий запрос, начатый до сигнала, дорабатывает с 200', () => {
        expect(result.slowStatus).toBe(200);
    });

    it('AC-3.9: новый запрос после шага 2 — отказ соединения (ECONNREFUSED)', () => {
        expect(result.refusalCode).toBe('ECONNREFUSED');
    });

    it('AC-3.9: выход 0 в пределах SHUTDOWN_TIMEOUT_MS', () => {
        expect(result.exit.code, result.output).toBe(0);
        expect(result.exit.at - result.signalledAt).toBeLessThan(TIMEOUT_MS);
        expect(result.output).toContain('остановка: завершена');
    });

    it('AC-3.9: открытый долгий поток SSE закрывает участник шага 2 сервиса, шаг 2 завершается до SHUTDOWN_TIMEOUT_MS, выход 0', async () => {
        const app = await start('sse');
        const stream = await fetch(`http://127.0.0.1:${app.port}/stream`);
        const body = stream.text();
        await sleep(100);
        const signalledAt = performance.now();
        app.child.kill('SIGTERM');
        await body;
        const exit = await app.exited;

        expect(stream.status).toBe(200);
        expect(exit.code, app.output()).toBe(0);
        expect(exit.at - signalledAt).toBeLessThan(TIMEOUT_MS / 2);
        expect(app.output()).not.toContain('SHUTDOWN_TIMEOUT');
    });
});
