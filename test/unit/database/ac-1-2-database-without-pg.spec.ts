// AC-1.2 (UC-16): /database импортирует pg и драйвер Drizzle только через src/database/pg.ts — requirePeer синхронно при
// импорте, сам peer ленивым import() (prd.md §3.3, NFR-3; П15). Граф import по исходникам — как ac-1-2-http-without-pg.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const IMPORT_SPECIFIER =
    /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
const DRIVER = /^(pg|pg\/.*|drizzle-orm\/node-postgres(\/.*)?)$/;

function sourceOf(from: string, specifier: string): string {
    const path = resolve(dirname(from), specifier).replace(/\.js$/, '.ts');

    return existsSync(path) ? path : resolve(dirname(from), specifier);
}

/** Файлы графа и пакеты, которые каждый файл импортирует значением (статически или import()). */
function graph(entry: string): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    const queue = [entry];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (imports.has(file)) {
            continue;
        }
        const packages: string[] = [];
        imports.set(file, packages);
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
            const specifier = match[1] ?? match[2] ?? match[3] ?? '';
            if (specifier.startsWith('.')) {
                queue.push(sourceOf(file, specifier));
            } else {
                packages.push(specifier);
            }
        }
    }

    return new Map([...imports].map(([file, packages]) => [relative(ROOT, file), packages]));
}

describe('UC-16: /database без pg', () => {
    it('AC-1.2: /database импортирует pg и drizzle-orm/node-postgres только через src/database/pg.ts (requirePeer и ленивый import())', () => {
        const files = graph(resolve(ROOT, 'src/database/index.ts'));
        const drivers = [...files].filter(([, packages]) =>
            packages.some((name) => DRIVER.test(name)),
        );

        expect(files.size).toBeGreaterThan(8);
        expect(drivers.map(([file]) => file)).toEqual(['src/database/pg.ts']);
        const pgSource = readFileSync(resolve(ROOT, 'src/database/pg.ts'), 'utf8');
        expect(pgSource).toMatch(/^requirePeer\('pg', 'database'\);$/m);
        expect(pgSource).not.toMatch(/^import [^t].*from '(pg|drizzle-orm\/node-postgres)/m);
        for (const file of files.keys()) {
            expect(readFileSync(resolve(ROOT, file), 'utf8')).not.toMatch(
                /^(export )?(const .* = )?await /m,
            );
        }
    });

    it('AC-1.2: первый импорт src/database/index.ts — ./pg.js', () => {
        const source = readFileSync(resolve(ROOT, 'src/database/index.ts'), 'utf8');
        const first = source.split('\n').find((line) => /^(import|export) /.test(line));

        expect(first).toBe("import './pg.js';");
    });
});
