// AC-1.2 (UC-10; prd.md §3.6, NFR-3; ARCHITECTURE.md «Правила зависимостей»): /crypto грузится без опциональных peer
// и Nest — только node:*, zod, config/fragments и internal. Граф import по исходникам —
// test/support/import-graph.ts.
import { describe, expect, it } from 'vitest';
import { importGraph } from '../../support/import-graph.js';

describe('UC-10: /crypto без опциональных peer', () => {
    const imports = importGraph('src/crypto/index.ts');
    const files = [...imports.keys()];
    const packages = [...imports.values()].flat();

    it('AC-1.2: /crypto не импортирует pg, ioredis, amqplib, amqp-connection-manager, testcontainers, vitest, @nestjs/*', () => {
        expect(packages).toContain('node:crypto');
        expect(packages.filter((name) => !name.startsWith('node:') && name !== 'zod')).toEqual([]);
    });

    it('AC-1.2: /crypto не загружает config/index, observability, http, database, idempotency, messaging, testing', () => {
        expect(files).toContain('src/crypto/cipher.ts');
        expect(
            files.filter(
                (file) =>
                    file === 'src/config/index.ts' ||
                    /^src\/(observability|http|database|idempotency|messaging|redis|testing|cli)\//.test(
                        file,
                    ),
            ),
        ).toEqual([]);
    });
});
