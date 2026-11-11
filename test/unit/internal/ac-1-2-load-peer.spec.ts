// AC-1.2 (U): загрузка опционального peer через loadPeer и проверка requirePeer (prd.md §3, NFR-3; П15);
// src/internal/peer.ts.
import { describe, expect, it } from 'vitest';
import {
    loadPeer,
    loadPeerWith,
    requirePeer,
    requirePeerWith,
} from '../../../src/internal/peer.js';

function moduleNotFound(message: string): Error {
    return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('AC-1.2: loadPeer', () => {
    it('AC-1.2: отсутствующий peer → «@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса»', async () => {
        const original = moduleNotFound("Cannot find package 'testcontainers' imported from /x");
        const importer = (): Promise<unknown> => Promise.reject(original);

        const error: unknown = await loadPeerWith(importer, 'testcontainers', 'testing').catch(
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
            '@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса',
        );
        expect((error as Error).cause).toBe(original);
    });

    it('AC-1.2: отсутствует вложенная зависимость peer → исходная ошибка без замены', async () => {
        const original = moduleNotFound(
            "Cannot find package 'ssh2' imported from /node_modules/testcontainers/x.js",
        );
        const importer = (): Promise<unknown> => Promise.reject(original);

        await expect(loadPeerWith(importer, 'testcontainers', 'testing')).rejects.toBe(original);
    });

    it('AC-1.2: ошибка выполнения модуля peer → исходная ошибка', async () => {
        const original = new Error('сбой при выполнении модуля');
        const importer = (): Promise<unknown> => Promise.reject(original);

        await expect(loadPeerWith(importer, 'testcontainers', 'testing')).rejects.toBe(original);
    });

    it('AC-1.2: установленный peer загружается', async () => {
        const yaml = await loadPeer<{ parse: unknown }>('yaml', 'testing');

        expect(typeof yaml.parse).toBe('function');
    });
});

describe('AC-1.2: requirePeer', () => {
    it('AC-1.2: requirePeer — отсутствующий пакет → текст AC-1.2; установленный — без ошибки', () => {
        const original = Object.assign(new Error("Cannot find module 'pg'\nRequire stack:\n- /x"), {
            code: 'MODULE_NOT_FOUND',
        });
        const resolver = (): string => {
            throw original;
        };

        let caught: unknown;
        try {
            requirePeerWith(resolver, 'pg', 'database');
        } catch (error) {
            caught = error;
        }
        expect((caught as Error).message).toBe(
            '@verdeect/kit/database требует pg — добавьте в зависимости сервиса',
        );
        expect((caught as Error).cause).toBe(original);
        expect(() => requirePeer('pg', 'database')).not.toThrow();
        expect(() => requirePeer('нет-такого-пакета', 'database')).toThrow(
            '@verdeect/kit/database требует нет-такого-пакета — добавьте в зависимости сервиса',
        );
    });
});
