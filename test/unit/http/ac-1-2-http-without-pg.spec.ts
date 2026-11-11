// AC-1.2 (UC-16): /http загружается без опционального pg (prd.md §3.5, NFR-3; ARCHITECTURE.md «Правила зависимостей»).
// Граф import из src/http/index.ts по исходникам — test/support/import-graph.ts.
import { describe, expect, it } from 'vitest';
import { importGraph } from '../../support/import-graph.js';

describe('UC-16: /http без опциональных peer', () => {
    it('AC-1.2: /http не импортирует pg статически', () => {
        const imports = importGraph('src/http/index.ts');
        const files = [...imports.keys()];
        const packages = [...imports.values()].flat();

        expect(files.length).toBeGreaterThan(5);
        expect(packages.filter((name) => name === 'pg' || name.startsWith('pg/'))).toEqual([]);
        expect(files.filter((file) => /^src\/(database|testing)\//.test(file))).toEqual([]);
    });
});
