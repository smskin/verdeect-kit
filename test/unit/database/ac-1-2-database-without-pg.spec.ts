// AC-1.2 (UC-16): /database импортирует pg и драйвер Drizzle только через src/database/pg.ts — requirePeer синхронно при
// импорте, сам peer ленивым import() (prd.md §3.3, NFR-3; П15). Граф import по исходникам — test/support/import-graph.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importGraph as graph, ROOT } from '../../support/import-graph.js';

const DRIVER = /^(pg|pg\/.*|drizzle-orm\/node-postgres(\/.*)?)$/;

describe('UC-16: /database без pg', () => {
    it('AC-1.2: /database импортирует pg и drizzle-orm/node-postgres только через src/database/pg.ts (requirePeer и ленивый import())', () => {
        const files = graph('src/database/index.ts');
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
