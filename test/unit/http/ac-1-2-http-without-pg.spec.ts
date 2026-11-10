// AC-1.2 (UC-16): /http загружается без опционального pg (prd.md §3.5, NFR-3; ARCHITECTURE.md «Правила зависимостей»).
// Граф import из src/http/index.ts по исходникам — как test/package/ac-1-1-package.spec.ts для dist/observability.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const IMPORT_SPECIFIER =
    /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;

/** Файл исходника по спецификатору `./x.js`. */
function sourceOf(from: string, specifier: string): string {
    const path = resolve(dirname(from), specifier).replace(/\.js$/, '.ts');

    return existsSync(path) ? path : resolve(dirname(from), specifier);
}

function graph(entry: string): { files: string[]; packages: string[] } {
    const seen = new Set<string>();
    const packages = new Set<string>();
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
            const specifier = match[1] ?? match[2] ?? '';
            if (specifier.startsWith('.')) {
                queue.push(sourceOf(file, specifier));
            } else {
                packages.add(specifier);
            }
        }
    }

    return { files: [...seen].map((file) => relative(ROOT, file)), packages: [...packages] };
}

describe('UC-16: /http без опциональных peer', () => {
    it('AC-1.2: /http не импортирует pg статически', () => {
        const { files, packages } = graph(resolve(ROOT, 'src/http/index.ts'));

        expect(files.length).toBeGreaterThan(5);
        expect(packages.filter((name) => name === 'pg' || name.startsWith('pg/'))).toEqual([]);
        expect(files.filter((file) => /^src\/(database|testing)\//.test(file))).toEqual([]);
    });
});
