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
/** Только статические импорты: `import … from`, `export … from`, `import '…'` (без `import(`). */
const STATIC_SPECIFIER = /(?:from\s*|^import\s+)['"]([^'"]+)['"]/gm;

/** Статический граф загрузки модуля dist: файлы и спецификаторы статических импортов. */
function staticGraph(entry: string): { seen: Set<string>; specifiers: string[] } {
    const seen = new Set<string>();
    const specifiers: string[] = [];
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(STATIC_SPECIFIER)) {
            const specifier = match[1] ?? '';
            specifiers.push(specifier);
            if (specifier.startsWith('.')) {
                queue.push(resolve(dirname(file), specifier));
            }
        }
    }

    return { seen, specifiers };
}

const DATABASE_ENTRIES = ['database', 'idempotency'].map((dir) =>
    join(REPO_ROOT, 'dist', dir, 'index.js'),
);

const MESSAGING_ENTRIES = [join(REPO_ROOT, 'dist', 'messaging', 'index.js')];

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
        expect(entries).toContain('package/dist/database/index.js');
        expect(entries).toContain('package/dist/idempotency/index.js');
        expect(entries).toContain('package/dist/messaging/index.js');
        expect(entries).toContain('package/dist/cli/commands/rabbitmq.js');
        expect(entries).toContain('package/dist/internal/rabbitmq-definitions.js');
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
        const files = [
            'config',
            'internal',
            'observability',
            'http',
            'cli',
            'database',
            'idempotency',
            'messaging',
        ]
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

    it('AC-1.1: dist/http не загружает pg, dist/testing, dist/database, dist/idempotency', () => {
        const { seen, specifiers } = importGraph(join(REPO_ROOT, 'dist', 'http', 'index.js'));
        const files = [...seen].map((file) => relative(join(REPO_ROOT, 'dist'), file));

        expect(seen.size).toBeGreaterThan(5);
        expect(
            specifiers.filter((specifier) => specifier === 'pg' || specifier.startsWith('pg/')),
        ).toEqual([]);
        expect(files.filter((file) => /^(testing|database|idempotency)\//.test(file))).toEqual([]);
    });

    it('AC-1.2: dist/database и dist/idempotency не импортируют pg и drizzle-orm/node-postgres статически', () => {
        for (const entry of DATABASE_ENTRIES) {
            const { seen, specifiers } = staticGraph(entry);

            expect(seen.size, entry).toBeGreaterThan(3);
            expect(
                specifiers.filter((specifier) =>
                    /^(pg|pg\/.*|drizzle-orm\/node-postgres(\/.*)?)$/.test(specifier),
                ),
                entry,
            ).toEqual([]);
        }
    });

    it('AC-1.2: в статическом графе dist/database/index.js и dist/idempotency/index.js нет top-level await', () => {
        for (const entry of DATABASE_ENTRIES) {
            const offending = [...staticGraph(entry).seen].filter((file) =>
                /^(export )?(const [^=]+= )?await /m.test(readFileSync(file, 'utf8')),
            );

            expect(offending.map((file) => relative(REPO_ROOT, file))).toEqual([]);
        }
    });

    it('AC-1.2: dist/messaging статически не импортирует pg, amqplib, amqp-connection-manager, драйвер Drizzle и dist/database', () => {
        for (const entry of MESSAGING_ENTRIES) {
            const { seen, specifiers } = staticGraph(entry);
            const files = [...seen].map((file) => relative(join(REPO_ROOT, 'dist'), file));

            expect(seen.size, entry).toBeGreaterThan(3);
            expect(
                specifiers.filter((specifier) =>
                    /^(pg|pg\/.*|amqplib(\/.*)?|amqp-connection-manager(\/.*)?|drizzle-orm\/node-postgres(\/.*)?)$/.test(
                        specifier,
                    ),
                ),
                entry,
            ).toEqual([]);
            expect(files.filter((file) => file.startsWith('database/'))).toEqual([]);
        }
    });

    it('AC-1.2: dist/messaging/index.js — первый импорт ./peer.js', () => {
        const text = readFileSync(join(REPO_ROOT, 'dist', 'messaging', 'index.js'), 'utf8');
        const first = text.split('\n').find((line) => /^(import|export) /.test(line));

        expect(first).toBe("import './peer.js';");
    });

    it('AC-1.1: dist/testing не импортирует amqplib и messaging/index статически', () => {
        const { seen, specifiers } = staticGraph(join(REPO_ROOT, 'dist', 'testing', 'index.js'));
        const files = [...seen].map((file) => relative(join(REPO_ROOT, 'dist'), file));

        expect(specifiers.filter((specifier) => /^amqplib(\/.*)?$/.test(specifier))).toEqual([]);
        expect(files).not.toContain(join('messaging', 'index.js'));
        expect(files).not.toContain(join('messaging', 'peer.js'));
    });

    it('AC-1.2: в статическом графе dist/messaging/index.js нет top-level await', () => {
        for (const entry of MESSAGING_ENTRIES) {
            const offending = [...staticGraph(entry).seen].filter((file) =>
                /^(export )?(const [^=]+= )?await /m.test(readFileSync(file, 'utf8')),
            );

            expect(offending.map((file) => relative(REPO_ROOT, file))).toEqual([]);
        }
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
