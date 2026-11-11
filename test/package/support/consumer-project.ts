// Проект-потребитель (AC-9.1, AC-1.1, AC-1.2): шаблон test/consumer/* вне репозитория с упакованным архивом.
// Образец — verdeect-platform-client test/package/support/consumer-project.ts.
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, runCommand, runOrThrow, type CommandResult } from './pack.js';

/** Шаблон проекта-потребителя. */
export type ConsumerTemplate = 'minimal' | 'no-testcontainers';

const PACKAGE_NAME = '@verdeect/kit';

/**
 * Копирует шаблон во временный каталог вне репозитория (без self-reference пакета), подставляет
 * архив вместо `file:__TARBALL__` и ставит зависимости с --strict-peer-dependencies. Маркер
 * `repo-fixture.link` — копия эталонной фикстуры AC-1.8 в `<проект>/repo-fixture/`.
 */
export async function createConsumerProject(
    template: ConsumerTemplate,
    tarball: string,
): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `verdeect-kit-consumer-${template}-`));
    console.info(`[package-check] consumer template ${template} → ${dir}`);
    await cp(join(REPO_ROOT, 'test', 'consumer', template), dir, { recursive: true });
    if (existsSync(join(dir, 'repo-fixture.link'))) {
        await cp(
            join(REPO_ROOT, 'test', 'fixtures', 'repo-conventions', 'valid'),
            join(dir, 'repo-fixture'),
            { recursive: true },
        );
    }
    const manifestPath = join(dir, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        dependencies: Record<string, string>;
    };
    manifest.dependencies[PACKAGE_NAME] = `file:${tarball}`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await runOrThrow('pnpm', ['install', '--strict-peer-dependencies'], dir);
    return dir;
}

/** Выполняет команду в проекте; код, stdout и stderr проверяет тест. */
export function runInConsumer(
    dir: string,
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string>> = {},
): Promise<CommandResult> {
    return runCommand(command, args, dir, env);
}

/** Удаляет временный проект. */
export async function removeConsumerProject(dir: string | undefined): Promise<void> {
    if (dir === undefined) {
        return;
    }
    await rm(dir, { recursive: true, force: true });
}
