// Сторож замеров времени для globalSetup уровня T (prd.md §3.8, E1); эталон — O test/support/timing-guard.ts (029c25c).
// Единственные строки пакета в stderr в E1: назначение функции — сообщать о среде (process.stderr, не console — NFR-8).
// Vite теряет текст ошибок globalSetup, поэтому сообщение пишется в stderr до throw. v1.31: onE2e: 'warn' — контур
// e2e даёт предупреждение без исключения.
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

/** Опции `timingGuard`. */
export interface KitTimingGuardOptions {
    /** Запущен контур `verdeect-*-e2e`: `fail` (умолчание) — исключение, `warn` — строка в stderr, замеры идут. */
    readonly onE2e?: 'fail' | 'warn';
}

/** Внутренняя логика timingGuard; экспорт для тестов, не из index.ts. */
export async function runTimingGuard(
    deps: TimingGuardDeps,
    options: KitTimingGuardOptions = {},
): Promise<void> {
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
    if (running.length === 0) {
        return;
    }
    if (options.onE2e === 'warn') {
        deps.write(
            `[timingGuard] WARN: запущен e2e-контур ${running.join(', ')} — замеры времени ненадёжны\n`,
        );

        return;
    }
    const message = `[timingGuard] запущен e2e-контур ${running.join(', ')} — остановите его перед замерами времени`;
    deps.write(`${message}\n`);
    throw new Error(message);
}

/**
 * globalSetup уровня T: нагрузка, ядра, запущенный e2e-контур `verdeect-*-e2e` (§3.8) — по умолчанию запрет
 * (исключение), `onE2e: 'warn'` — предупреждение в stderr, замеры идут.
 */
export function timingGuard(options: KitTimingGuardOptions = {}): Promise<void> {
    const exec = promisify(execFile);

    return runTimingGuard(
        {
            load: () => loadavg()[0] ?? 0,
            cores: () => availableParallelism(),
            composeProjects: () => defaultComposeProjects((file, args) => exec(file, [...args])),
            write: (line) => {
                process.stderr.write(line);
            },
        },
        options,
    );
}
