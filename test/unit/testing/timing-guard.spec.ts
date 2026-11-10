// timingGuard (prd.md §3.8, E1) с подставными зависимостями; эталон — O test/support/timing-guard.ts.
import { describe, expect, it, vi } from 'vitest';
import {
    defaultComposeProjects,
    runTimingGuard,
    type TimingGuardDeps,
} from '../../../src/testing/timing-guard.js';

function deps(overrides: Partial<TimingGuardDeps> = {}): TimingGuardDeps & { lines: string[] } {
    const lines: string[] = [];

    return {
        load: () => 0.5,
        cores: () => 8,
        composeProjects: () => Promise.resolve([]),
        write: (line) => {
            lines.push(line);
        },
        ...overrides,
        lines,
    };
}

describe('§3.8: timingGuard', () => {
    it('§3.8: timingGuard — печатает load и cores', async () => {
        const guard = deps();
        await runTimingGuard(guard);

        expect(guard.lines).toEqual(['[timingGuard] load=0.50 cores=8\n']);
    });

    it('§3.8: timingGuard — load > cores → WARN', async () => {
        const guard = deps({ load: () => 9.25 });
        await runTimingGuard(guard);

        expect(guard.lines[1]).toContain('WARN: нагрузка выше числа ядер');
    });

    it('§3.8: timingGuard — e2e-контур verdeect-orchestrator-e2e запущен → ошибка с именем, строка в write до throw', async () => {
        const guard = deps({
            composeProjects: () => Promise.resolve(['verdeect-orchestrator-e2e', 'other']),
        });

        await expect(runTimingGuard(guard)).rejects.toThrow(
            '[timingGuard] запущен e2e-контур verdeect-orchestrator-e2e',
        );
        expect(guard.lines.at(-1)).toContain('verdeect-orchestrator-e2e');
    });

    it('§3.8: timingGuard — docker CLI нет → пропуск без ошибки', async () => {
        const guard = deps({ composeProjects: () => Promise.resolve(null) });

        await expect(runTimingGuard(guard)).resolves.toBeUndefined();
        expect(guard.lines.at(-1)).toContain('docker недоступен');
    });

    it('§3.8: timingGuard — docker ps завершился с ошибкой (демон остановлен) → пропуск без ошибки', async () => {
        const exec = vi.fn(() =>
            Promise.reject(
                Object.assign(new Error('Cannot connect to the Docker daemon'), { code: 1 }),
            ),
        );

        expect(await defaultComposeProjects(exec)).toBeNull();
        expect(exec).toHaveBeenCalledWith('docker', [
            'ps',
            '--format',
            '{{.Label "com.docker.compose.project"}}',
        ]);
    });

    it('§3.8: timingGuard — проект verdeect-orchestrator (без -e2e) → без ошибки', async () => {
        const exec = vi.fn(() =>
            Promise.resolve({ stdout: ' verdeect-orchestrator\n\nverdeect-orchestrator\n' }),
        );
        const projects = await defaultComposeProjects(exec);
        expect(projects).toEqual(['verdeect-orchestrator']);

        const guard = deps({ composeProjects: () => Promise.resolve(projects) });
        await expect(runTimingGuard(guard)).resolves.toBeUndefined();
    });
});
