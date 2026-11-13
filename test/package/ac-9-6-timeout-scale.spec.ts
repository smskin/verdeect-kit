// AC-9.6 (R; prd.md §3.8 v1.26): подпуть @verdeect/kit/testing/timeout-scale — условия types и default (без development),
// граф dist/testing/timeout-scale.js — только node:*; проект-потребитель (без testcontainers) импортирует подпуть без
// условия development. Запуск — pnpm pack:check после pnpm build.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createConsumerProject,
    removeConsumerProject,
    runInConsumer,
} from './support/consumer-project.js';
import { packTarball, removeTarball, REPO_ROOT } from './support/pack.js';

const IMPORT_SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

let tarball: string | undefined;
let consumer: string | undefined;

beforeAll(async () => {
    tarball = await packTarball();
    consumer = await createConsumerProject('no-testcontainers', tarball);
});

afterAll(async () => {
    await removeConsumerProject(consumer);
    await removeTarball(tarball);
});

/** Все спецификаторы (статические и динамические) графа загрузки файла dist. */
function specifiersOf(entry: string): string[] {
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

    return specifiers;
}

describe('UC-14: подпуть testing/timeout-scale', () => {
    it('AC-9.6: exports содержит ./testing/timeout-scale с условиями types и default', () => {
        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
            exports: Record<string, unknown>;
        };

        expect(manifest.exports['./testing/timeout-scale']).toEqual({
            types: './dist/testing/timeout-scale.d.ts',
            default: './dist/testing/timeout-scale.js',
        });
    });

    it('AC-9.6: граф импортов dist/testing/timeout-scale.js — только node:*', () => {
        const specifiers = specifiersOf(join(REPO_ROOT, 'dist', 'testing', 'timeout-scale.js'));

        expect(specifiers.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    });

    it('AC-9.6: проект-потребитель импортирует подпуть без условия development', async () => {
        if (consumer === undefined) {
            return expect.fail('проект-потребитель не создан');
        }
        const result = await runInConsumer(
            consumer,
            'node',
            [
                '--input-type=module',
                '-e',
                "const m = await import('@verdeect/kit/testing/timeout-scale'); console.log(m.TEST_TIMEOUT_SCALE, m.readTimeoutScale({ TEST_TIMEOUT_SCALE: '2' }))",
            ],
            { TEST_TIMEOUT_SCALE: '' },
        );

        expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(result.stdout.trim()).toBe('1 2');
    });
});
