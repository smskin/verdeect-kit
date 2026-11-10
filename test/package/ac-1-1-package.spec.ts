// AC-1.1 (UC-16): архив пакета — publint --strict, attw esm-only, состав архива (dist, bin CLI и шаблон алертов §3.2), dist
// рабочих подпутей без testing, dist/observability без @nestjs/* и config/index.js (ранний instrument.ts, LE-5), dist/http без
// pg, testing и database, ajv — только из dist/testing (prd.md G1, NFR-3, NFR-4; KT-15 п. 4). Запуск — pnpm pack:check после
// pnpm build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

/** Граф загрузки модуля dist: файлы и все спецификаторы (относительные — обходятся). */
function importGraph(entry: string): { seen: Set<string>; specifiers: string[] } {
    const seen = new Set<string>();
    const specifiers: string[] = [];
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
            const specifier = match[1] ?? '';
            specifiers.push(specifier);
            if (specifier.startsWith('.')) {
                queue.push(resolve(dirname(file), specifier));
            }
        }
    }

    return { seen, specifiers };
}

const ALLOWED_ENTRY =
    /^package\/(package\.json|README\.md|CHANGELOG\.md|alerts\/verdeect-kit\.rules\.yml|dist\/.+\.(js|d\.ts))$/;
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
        expect(entries).toContain('package/dist/observability/index.js');
        expect(entries).toContain('package/dist/http/index.js');
        expect(entries).toContain('package/dist/cli/main.js');
        expect(entries).toContain('package/alerts/verdeect-kit.rules.yml');
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
        const files = ['config', 'internal', 'observability', 'http', 'cli']
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

    it('§3.2: dist/observability не загружает @nestjs/* и config/index.js', () => {
        const { seen, specifiers } = importGraph(
            join(REPO_ROOT, 'dist', 'observability', 'index.js'),
        );

        expect(seen.size).toBeGreaterThan(1);
        expect(specifiers.filter((specifier) => specifier.startsWith('@nestjs/'))).toEqual([]);
        expect(
            [...seen].filter(
                (file) => relative(REPO_ROOT, file) === join('dist', 'config', 'index.js'),
            ),
        ).toEqual([]);
    });

    it('AC-1.1: dist/cli/main.js начинается с #!/usr/bin/env node', () => {
        const text = readFileSync(join(REPO_ROOT, 'dist', 'cli', 'main.js'), 'utf8');

        expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('AC-1.1: dist/http не загружает pg, dist/testing, dist/database', () => {
        const { seen, specifiers } = importGraph(join(REPO_ROOT, 'dist', 'http', 'index.js'));
        const files = [...seen].map((file) => relative(join(REPO_ROOT, 'dist'), file));

        expect(seen.size).toBeGreaterThan(5);
        expect(
            specifiers.filter((specifier) => specifier === 'pg' || specifier.startsWith('pg/')),
        ).toEqual([]);
        expect(files.filter((file) => /^(testing|database)\//.test(file))).toEqual([]);
    });

    it('NFR-3: ajv загружается только из dist/testing', () => {
        const offending = filesUnder(join(REPO_ROOT, 'dist'))
            .filter((file) => file.endsWith('.js'))
            .filter((file) => !relative(join(REPO_ROOT, 'dist'), file).startsWith('testing'))
            .flatMap((file) =>
                [...readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)]
                    .map((match) => match[1] ?? '')
                    .filter((specifier) => specifier === 'ajv' || specifier.startsWith('ajv/'))
                    .map((specifier) => `${relative(REPO_ROOT, file)}: ${specifier}`),
            );

        expect(offending).toEqual([]);
    });
});
