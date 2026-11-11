// AC-1.2 (UC-1): /idempotency без pg — первым импортом ./peer.js (requirePeer синхронно), pg статически не
// импортируется, top-level await нет (prd.md §3.3а, NFR-3; П15).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string =>
    readFileSync(new URL(`../../../src/idempotency/${path}`, import.meta.url), 'utf8');

const FILES = [
    'index.ts',
    'peer.ts',
    'table.ts',
    'idempotent.decorator.ts',
    'idempotency.interceptor.ts',
    'kit-idempotency.module.ts',
];

describe('UC-1: /idempotency без pg', () => {
    it('AC-1.2: первый импорт src/idempotency/index.ts — ./peer.js', () => {
        const first = source('index.ts')
            .split('\n')
            .find((line) => /^(import|export) /.test(line));

        expect(first).toBe("import './peer.js';");
        expect(source('peer.ts')).toMatch(/^requirePeer\('pg', 'idempotency'\);$/m);
    });

    it.each(FILES)(
        'AC-1.2: %s не импортирует pg и драйвер Drizzle значением, без top-level await',
        (file) => {
            const text = source(file);

            expect(text).not.toMatch(
                /^import (?!type )[^;]*from '(pg|drizzle-orm\/node-postgres[^']*)';/m,
            );
            expect(text).not.toMatch(/import\('pg'\)/);
            expect(text).not.toMatch(/^(export )?(const .* = )?await /m);
        },
    );
});
