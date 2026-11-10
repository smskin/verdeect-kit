// AC-1.1 (UC-16): архив пакета — publint --strict, attw esm-only, состав архива, dist рабочих подпутей без testing
// (prd.md G1, NFR-4). Запуск — pnpm pack:check после pnpm build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packTarball, REPO_ROOT, removeTarball, runCommand, runOrThrow } from './support/pack.js';

let tarball: string | undefined;

beforeAll(async () => {
    tarball = await packTarball();
});

afterAll(async () => {
    await removeTarball(tarball);
});

function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);

        return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}

const ALLOWED_ENTRY = /^package\/(package\.json|README\.md|CHANGELOG\.md|dist\/.+\.(js|d\.ts))$/;
const IMPORT_SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

describe('UC-16: архив пакета', () => {
    it('AC-1.1: publint --strict без замечаний', async () => {
        const result = await runCommand('pnpm', ['exec', 'publint', '--strict'], REPO_ROOT);

        expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout).not.toMatch(/Warning|Error/);
    });

    it('AC-1.1: attw --profile esm-only без замечаний', async () => {
        const result = await runCommand(
            'pnpm',
            ['exec', 'attw', '--pack', '.', '--profile', 'esm-only'],
            REPO_ROOT,
        );

        expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    });

    it('AC-1.1: состав архива', async () => {
        const { stdout } = await runOrThrow('tar', ['-tzf', tarball ?? ''], REPO_ROOT);
        const entries = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '' && !line.endsWith('/'));

        expect(entries.filter((entry) => !ALLOWED_ENTRY.test(entry))).toEqual([]);
        expect(entries).toContain('package/dist/config/index.js');
        expect(entries).toContain('package/dist/testing/index.d.ts');
        for (const forbidden of [
            /\/src\//,
            /\/test\//,
            /\.spec\./,
            /\.map$/,
            /tsconfig/,
            /eslint/,
            /vitest/,
        ]) {
            expect(
                entries.filter((entry) => forbidden.test(entry)),
                String(forbidden),
            ).toEqual([]);
        }
    });

    it('AC-1.1: dist рабочих подпутей не импортирует testing и shell-quote (зависимость только /testing)', () => {
        const files = ['config', 'internal']
            .flatMap((dir) => filesUnder(join(REPO_ROOT, 'dist', dir)))
            .filter((file) => file.endsWith('.js'));
        expect(files.length).toBeGreaterThan(0);

        const offending = files.flatMap((file) =>
            [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)]
                .map((match) => match[1] ?? '')
                .filter((specifier) => specifier.includes('testing') || specifier === 'shell-quote')
                .map((specifier) => `${relative(REPO_ROOT, file)}: ${specifier}`),
        );

        expect(offending).toEqual([]);
    });
});
