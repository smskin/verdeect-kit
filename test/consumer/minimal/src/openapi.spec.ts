// AC-3.8 (UC-14): снимок contracts/openapi.json совпадает с документом из кода (prd.md §3.5). CLI verdeect-kit openapi
// пишет документ собранного сервиса (dist/service, globalSetup) во временный файл; сравнение — с закоммиченным снимком.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'node_modules', '.bin', 'verdeect-kit');

describe('UC-14: контракт OpenAPI', () => {
    it('AC-3.8: снимок contracts/openapi.json совпадает с документом из кода', () => {
        const dir = mkdtempSync(join(tmpdir(), 'consumer-openapi-'));
        try {
            const out = join(dir, 'openapi.json');
            const stdout = execFileSync(
                CLI,
                ['openapi', '--out', out, '--module', 'dist/service/app.module.js#AppModule'],
                { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'silent' } },
            );

            expect(JSON.parse(stdout)).toEqual({ written: out, operations: 2 });
            expect(readFileSync(out, 'utf8')).toBe(
                readFileSync(join(ROOT, 'contracts', 'openapi.json'), 'utf8'),
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
