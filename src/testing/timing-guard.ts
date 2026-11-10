// Сторож замеров времени для globalSetup уровня T (prd.md §3.8, E1); эталон — O test/support/timing-guard.ts (029c25c).
// Единственные строки пакета в stderr в E1: назначение функции — сообщать о среде (process.stderr, не console — NFR-8).
// Vite теряет текст ошибок globalSetup, поэтому сообщение пишется в stderr до throw.
import { execFile } from 'node:child_process';
import { availableParallelism, loadavg } from 'node:os';
import { promisify } from 'node:util';

const E2E_PROJECT = /^verdeect-.*-e2e$/;

/** Зависимости runTimingGuard (подменяются в тестах). */
export interface TimingGuardDeps {
    /** Load average за минуту. */
    readonly load: () => number;
    /** Число ядер. */
    readonly cores: () => number;
    /** Имена compose-проектов запущенных контейнеров; null — docker недоступен. */
    readonly composeProjects: () => Promise<readonly string[] | null>;
    /** Вывод строки (stderr). */
    readonly write: (line: string) => void;
}

/** Запуск внешней команды: stdout. */
type Exec = (file: string, args: readonly string[]) => Promise<{ stdout: string }>;

/** Compose-проекты через `docker ps`; любая неудача (нет CLI, демон остановлен, нет прав) → null. */
export async function defaultComposeProjects(exec: Exec): Promise<readonly string[] | null> {
    try {
        const { stdout } = await exec('docker', [
            'ps',
            '--format',
            '{{.Label "com.docker.compose.project"}}',
        ]);
        const names = stdout.split('\n').map((line) => line.trim());

        return [...new Set(names.filter((name) => name !== ''))];
    } catch {
        return null;
    }
}

/** Внутренняя логика timingGuard; экспорт для тестов, не из index.ts. */
export async function runTimingGuard(deps: TimingGuardDeps): Promise<void> {
    const load = deps.load();
    const cores = deps.cores();
    deps.write(`[timingGuard] load=${load.toFixed(2)} cores=${cores}\n`);
    if (load > cores) {
        deps.write('[timingGuard] WARN: нагрузка выше числа ядер — замеры времени ненадёжны\n');
    }
    const projects = await deps.composeProjects();
    if (projects === null) {
        deps.write('[timingGuard] docker недоступен — проверка e2e-контура пропущена\n');

        return;
    }
    const running = projects.filter((name) => E2E_PROJECT.test(name));
    if (running.length > 0) {
        const message = `[timingGuard] запущен e2e-контур ${running.join(', ')} — остановите его перед замерами времени`;
        deps.write(`${message}\n`);
        throw new Error(message);
    }
}

/** globalSetup уровня T: нагрузка, ядра, запрет при запущенном e2e-контуре verdeect-*-e2e (§3.8). */
export function timingGuard(): Promise<void> {
    const exec = promisify(execFile);

    return runTimingGuard({
        load: () => loadavg()[0] ?? 0,
        cores: () => availableParallelism(),
        composeProjects: () => defaultComposeProjects((file, args) => exec(file, [...args])),
        write: (line) => {
            process.stderr.write(line);
        },
    });
}
