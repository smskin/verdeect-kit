// AC-1.2 (UC-1), AC-5.10: /messaging без pg — первым импортом ./peer.js (requirePeer amqplib, amqp-connection-manager
// синхронно), peer и значения database статически не импортируются, top-level await нет, exchange — только
// checkExchange (prd.md §3.4, NFR-3; П15).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { missingPeerMessage, requirePeerWith } from '../../../src/internal/peer.js';

const DIR = new URL('../../../src/messaging/', import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, DIR), 'utf8');
const FILES = readdirSync(DIR).filter((file) => file.endsWith('.ts'));

describe('UC-1: /messaging без опциональных peer', () => {
    it("AC-1.2: index.ts первым импортирует ./peer.js; peer.ts вызывает requirePeer('amqplib') и requirePeer('amqp-connection-manager')", () => {
        const first = source('index.ts')
            .split('\n')
            .find((line) => /^(import|export) /.test(line));

        expect(first).toBe("import './peer.js';");
        expect(source('peer.ts')).toMatch(
            /^requirePeer\('amqplib', 'messaging'\);\nrequirePeer\('amqp-connection-manager', 'messaging'\);$/m,
        );
    });

    it.each(FILES)(
        'AC-1.2: %s без статического импорта значений pg, amqplib, amqp-connection-manager, драйвера Drizzle, ../database/* и без top-level await',
        (file) => {
            const text = source(file);

            expect(text).not.toMatch(
                /^import (?!type )[^;]*from '(pg|amqplib|amqp-connection-manager|drizzle-orm\/node-postgres[^']*|\.\.\/database\/[^']*)';/m,
            );
            expect(text).not.toMatch(/^(export )?(const .* = )?await /m);
        },
    );

    it('AC-1.2: без amqplib — «@verdeect/kit/messaging требует amqplib — добавьте в зависимости сервиса»', () => {
        const resolver = (): string => {
            throw Object.assign(new Error("Cannot find module 'amqplib'"), {
                code: 'MODULE_NOT_FOUND',
            });
        };

        expect(() => requirePeerWith(resolver, 'amqplib', 'messaging')).toThrow(
            missingPeerMessage('amqplib', 'messaging'),
        );
        expect(missingPeerMessage('amqplib', 'messaging')).toBe(
            '@verdeect/kit/messaging требует amqplib — добавьте в зависимости сервиса',
        );
    });

    it('AC-5.10: в src/messaging нет assertExchange — exchange только checkExchange', () => {
        expect(FILES.filter((file) => /\bassertExchange\b/.test(source(file)))).toEqual([]);
        expect(source('rabbit-connection.ts')).toContain('checkExchange(EVENTS_EXCHANGE)');
    });
});
