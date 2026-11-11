// Граф import исходников от точки входа подпути — общий помощник тестов AC-1.2 (prd.md NFR-3; KT-27 п. 2): http, database,
// crypto. Учитываются импорты значением (статические, побочные `import '…'` и `import()`); `import type` пропускается.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень репозитория. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const IMPORT_SPECIFIER =
    /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;

/** Файл исходника по спецификатору `./x.js`. */
function sourceOf(from: string, specifier: string): string {
    const path = resolve(dirname(from), specifier).replace(/\.js$/, '.ts');

    return existsSync(path) ? path : resolve(dirname(from), specifier);
}

/** Файлы графа (пути от корня) → пакеты, которые файл импортирует значением. */
export function importGraph(entry: string): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    const queue = [resolve(ROOT, entry)];
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
