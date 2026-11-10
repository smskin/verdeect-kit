// AC-2.10 (T, UC-8; KT-10 п. 4): настоящий дочерний процесс — остановка без утечек завершается сама с кодом 0 раньше
// SHUTDOWN_TIMEOUT_MS; оставленный таймер или сервер node:net — код 1 к сроку, error «процесс не завершился после
// остановки» и событие GlitchTip (prd.md §3.2, UC-8 п. 6). Время — от маркера {"signal":true} ребёнка до выхода: загрузка
// @sentry/nestjs, pino и @prometheus-io/client в ребёнке занимает около секунды. Ребёнок импортирует dist, собранный в beforeAll в
// node_modules/.cache (peer разрешаются из node_modules репозитория, dist/ не трогается).
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIST = fileURLToPath(
    new URL('../../../node_modules/.cache/kit-timing-dist/', import.meta.url),
);
const CHILD = fileURLToPath(
    new URL('../../fixtures/observability/shutdown-child.mjs', import.meta.url),
);
const TIMEOUT_MS = 1000;
/** Запас на выход процесса после exit(1) и Sentry.flush. */
const MARGIN_MS = 500 * TEST_TIMEOUT_SCALE;

interface ChildRun {
    readonly code: number | null;
    readonly elapsedMs: number;
    readonly stderr: string;
}

function runChild(mode: 'clean' | 'timer' | 'server'): Promise<ChildRun> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CHILD, mode, DIST, String(TIMEOUT_MS)], {
            cwd: ROOT,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        let stderr = '';
        let signalledAt: number | null = null;
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
            if (signalledAt === null && stderr.includes('{"signal":true}')) {
                signalledAt = performance.now();
            }
        });
        child.once('error', reject);
        child.once('exit', (code) => {
            const exitedAt = performance.now();
            resolve({ code, elapsedMs: exitedAt - (signalledAt ?? exitedAt), stderr });
        });
    });
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

describe('UC-8: выход процесса после остановки', () => {
    it('AC-2.10: остановка без утечек — код 0 раньше SHUTDOWN_TIMEOUT_MS', async () => {
        const run = await runChild('clean');

        expect(run.code, run.stderr).toBe(0);
        expect(run.elapsedMs).toBeLessThan(TIMEOUT_MS);
        expect(run.stderr).toContain('остановка: завершена');
        expect(run.stderr).not.toContain('SHUTDOWN_NOT_EXITED');
    });

    it.each(['timer', 'server'] as const)(
        'AC-2.10: оставленный %s после остановки — код 1 к сроку, error «процесс не завершился после остановки», событие GlitchTip',
        async (mode) => {
            const run = await runChild(mode);

            expect(run.code, run.stderr).toBe(1);
            expect(run.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
            expect(run.elapsedMs).toBeLessThan(TIMEOUT_MS + MARGIN_MS);
            expect(run.stderr).toContain('процесс не завершился после остановки');
            expect(run.stderr).toContain('"code":"SHUTDOWN_NOT_EXITED"');
            expect(run.stderr).toContain('{"sentry":"SHUTDOWN_NOT_EXITED"}');
        },
    );
});
