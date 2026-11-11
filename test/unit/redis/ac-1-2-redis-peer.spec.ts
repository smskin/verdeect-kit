// AC-1.2 (UC-1): /redis — первым импортом ./peer.js (requirePeer ioredis синхронно), ioredis статически не импортируется,
// top-level await нет; граф импортов без pg, amqplib, testcontainers, vitest, database, messaging, testing (prd.md §3.7,
// NFR-3; D12, D13 плана E8; П15).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { missingPeerMessage, requirePeerWith } from '../../../src/internal/peer.js';
import { importGraph } from '../../support/import-graph.js';

const DIR = new URL('../../../src/redis/', import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, DIR), 'utf8');
const FILES = readdirSync(DIR).filter((file) => file.endsWith('.ts'));

describe('UC-1: /redis без опциональных peer', () => {
    it("AC-1.2: index.ts первым импортирует ./peer.js; peer.ts вызывает requirePeer('ioredis', 'redis')", () => {
        const first = source('index.ts')
            .split('\n')
            .find((line) => /^(import|export) /.test(line));

        expect(first).toBe("import './peer.js';");
        expect(source('peer.ts')).toMatch(/^requirePeer\('ioredis', 'redis'\);$/m);
    });

    it.each(FILES)(
        'AC-1.2: %s без статического импорта значения ioredis и без top-level await',
        (file) => {
            const text = source(file);

            expect(text).not.toMatch(/^import (?!type )[^;]*from 'ioredis';/m);
            expect(text).not.toMatch(/^(export )?(const .* = )?await /m);
        },
    );

    it('AC-1.2: граф /redis — без pg, amqplib, amqp-connection-manager, testcontainers, vitest и файлов database, messaging, testing', () => {
        const imports = importGraph('src/redis/index.ts');
        const files = [...imports.keys()];
        const packages = [...imports.values()].flat();

        expect(files.length).toBeGreaterThan(5);
        expect(
            packages.filter((name) =>
                /^(pg|amqplib|amqp-connection-manager|testcontainers|vitest)(\/|$)/.test(name),
            ),
        ).toEqual([]);
        expect(files.filter((file) => /^src\/(database|messaging|testing)\//.test(file))).toEqual(
            [],
        );
    });

    it('AC-1.2: без ioredis — «@verdeect/kit/redis требует ioredis — добавьте в зависимости сервиса»', () => {
        const resolver = (): string => {
            throw Object.assign(new Error("Cannot find module 'ioredis'"), {
                code: 'MODULE_NOT_FOUND',
            });
        };

        expect(() => requirePeerWith(resolver, 'ioredis', 'redis')).toThrow(
            '@verdeect/kit/redis требует ioredis — добавьте в зависимости сервиса',
        );
        expect(missingPeerMessage('ioredis', 'redis')).toBe(
            '@verdeect/kit/redis требует ioredis — добавьте в зависимости сервиса',
        );
    });
});
