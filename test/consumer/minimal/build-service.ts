// Сборка сервиса-потребителя tsc (dist/service) — общий шаг globalSetup основного прогона и прогона покрытия (AC-9.1,
// AC-5.13).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TSC = fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url));

/** tsc -p tsconfig.build.json в корне проекта. */
export function buildService(): void {
    execFileSync(process.execPath, [TSC, '-p', 'tsconfig.build.json'], {
        cwd: ROOT,
        stdio: 'inherit',
    });
}
