// AC-5.13 (UC-14): assertOutboxCoverage — объединение файлов воркеров каталога прогона, список непокрытых событий
// (prd.md §3.8; GAP-2); src/testing/outbox-coverage.ts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../../../src/messaging/define-event.js';
import { assertOutboxCoverage, setCoverageDir } from '../../../src/testing/outbox-coverage.js';

const data = z.object({});
const A = defineEvent({ type: 'kit.a.created', version: 1, subject: 'a', data });
const B = defineEvent({ type: 'kit.b.created', version: 2, subject: 'b', data });
const C = defineEvent({ type: 'kit.c.created', version: 1, subject: 'c', data });

describe('UC-14: покрытие outbox', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'kit-coverage-'));
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        setCoverageDir(undefined);
        rmSync(dir, { recursive: true, force: true });
    });

    it('AC-5.13: assertOutboxCoverage объединяет файлы воркеров и падает со списком непокрытых', () => {
        writeFileSync(join(dir, 'w1.txt'), 'kit.a.created.v1\n');
        writeFileSync(join(dir, 'w2.txt'), 'kit.b.created.v1\n');
        setCoverageDir(dir);

        expect(() => assertOutboxCoverage([A, B, C, A])).toThrow(
            'assertOutboxCoverage: события без успешного expectOutbox: kit.b.created.v2, kit.c.created.v1',
        );
    });

    it('AC-5.13: все покрыты — без ошибки; без каталога — TypeError', () => {
        writeFileSync(join(dir, 'w1.txt'), 'kit.a.created.v1\nkit.b.created.v2\n');
        writeFileSync(join(dir, 'w2.txt'), 'kit.c.created.v1\n');
        setCoverageDir(dir);

        expect(() => assertOutboxCoverage([A, B, C])).not.toThrow();
        setCoverageDir(undefined);
        expect(() => assertOutboxCoverage([A])).toThrow(TypeError);
    });
});
