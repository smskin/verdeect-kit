// AC-7.1 (U, UC-10; prd.md §3.6): encrypt → decrypt возвращает исходный текст; значение v<N>:<iv>:<ct>:<tag> base64url.
// Перенос B session-cipher.spec.ts (roundtrip, разные IV) и O private-key-cipher.spec.ts (нет открытого текста).
import { describe, expect, it } from 'vitest';
import { cipherOf, secret } from './support.js';

const AAD = { aad: 'client-secret:cli_1' };

describe('UC-10: шифрование секретов', () => {
    it.each([
        ['ASCII', 'super-secret-value'],
        ['кириллица', 'секретное значение'],
        ['эмодзи', 'ключ 🔑 и 🚀'],
        ['пустая строка', ''],
    ])('AC-7.1: encrypt → decrypt возвращает исходный текст (%s)', (_name, plaintext) => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);

        expect(cipher.decrypt(cipher.encrypt(plaintext, AAD), AAD)).toBe(plaintext);
    });

    it('AC-7.1: значение — v<N>: и три части base64url', () => {
        const value = cipherOf([{ version: 1, secret: secret() }]).encrypt('text', AAD);
        const current = cipherOf([
            { version: 7, secret: secret() },
            { version: 1, secret: secret() },
        ]).encrypt('text', AAD);

        expect(value).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]*:[A-Za-z0-9_-]{22}$/);
        expect(current).toMatch(/^v7:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]*:[A-Za-z0-9_-]{22}$/);
    });

    it('AC-7.1: два шифрования одного текста различаются (IV)', () => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);
        const first = cipher.encrypt('same', AAD);
        const second = cipher.encrypt('same', AAD);

        expect(first).not.toBe(second);
        expect(first.split(':')[1]).not.toBe(second.split(':')[1]);
    });

    it('AC-7.1: значение не содержит открытого текста', () => {
        const plaintext = 'very-recognizable-plaintext';
        const value = cipherOf([{ version: 1, secret: secret() }]).encrypt(plaintext, AAD);

        expect(value).not.toContain(plaintext);
        expect(value).not.toContain(Buffer.from(plaintext).toString('base64url'));
    });
});
