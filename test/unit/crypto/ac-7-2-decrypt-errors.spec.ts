// AC-7.2 (U, UC-10; prd.md §3.6, NFR-4): отказы decrypt — 'format', 'unknown_version', 'auth' без открытого текста, aad
// и ключей. Перенос B session-cipher.spec.ts (чужой AAD, неизвестная версия) и O private-key-cipher.spec.ts (OR-102 п. 7:
// строгие длины IV и тега, тот же секрет под другой версией).
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DecryptError, type DecryptErrorReason } from '../../../src/crypto/index.js';
import { cipherOf, errorOf, flipByte, reasonOf, secret, type ValuePart } from './support.js';

const AAD = { aad: 'client-secret:cli_1' };
const B64 = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64url');

describe('UC-10: отказы расшифровки', () => {
    it('AC-7.2: подмена значения между записями (другой aad) → auth', () => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);
        const value = cipher.encrypt('text', AAD);

        expect(reasonOf(() => cipher.decrypt(value, { aad: 'client-secret:cli_2' }))).toBe('auth');
    });

    it.each<ValuePart>(['ct', 'iv', 'tag'])('AC-7.2: изменённый байт %s → auth', (part) => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);
        const value = cipher.encrypt('text', AAD);

        expect(reasonOf(() => cipher.decrypt(flipByte(value, part), AAD))).toBe('auth');
    });

    it('AC-7.2: неизвестная версия → unknown_version', () => {
        const key = secret();
        const value = cipherOf([{ version: 2, secret: secret() }]).encrypt('text', AAD);
        const sameSecret = cipherOf([{ version: 1, secret: key }]).encrypt('text', AAD);
        const reader = cipherOf([{ version: 1, secret: secret() }]);
        const otherVersion = cipherOf([{ version: 3, secret: key }]);

        expect(reasonOf(() => reader.decrypt(value, AAD))).toBe('unknown_version');
        // Тот же секрет под другой версией — тоже неизвестная версия: перебора ключей нет.
        expect(reasonOf(() => otherVersion.decrypt(sameSecret, AAD))).toBe('unknown_version');
    });

    it("AC-7.2: неизвестная версия с испорченным тегом → unknown_version, не 'auth'", () => {
        const value = cipherOf([{ version: 2, secret: secret() }]).encrypt('text', AAD);
        const reader = cipherOf([{ version: 1, secret: secret() }]);

        expect(reasonOf(() => reader.decrypt(flipByte(value, 'tag'), AAD))).toBe('unknown_version');
    });

    it.each([
        ['мусор', 'garbage'],
        ['3 части', `v1:${B64(12)}:${B64(4)}`],
        ['5 частей', `v1:${B64(12)}:${B64(4)}:${B64(16)}:x`],
        ['без v', `1:${B64(12)}:${B64(4)}:${B64(16)}`],
        ['v0', `v0:${B64(12)}:${B64(4)}:${B64(16)}`],
        ['v01', `v01:${B64(12)}:${B64(4)}:${B64(16)}`],
        ['символ +', `v1:${B64(12)}:ab+d:${B64(16)}`],
        ['символ /', `v1:${B64(12)}:ab/d:${B64(16)}`],
        ['символ =', `v1:${B64(12)}:abc=:${B64(16)}`],
        ['IV 16 байт', `v1:${B64(16)}:${B64(4)}:${B64(16)}`],
        ['тег 12 байт', `v1:${B64(12)}:${B64(4)}:${B64(12)}`],
        ['пустой IV', `v1::${B64(4)}:${B64(16)}`],
    ])('AC-7.2: неверный формат (%s) → format (decrypt и needsReencrypt)', (_name, value) => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);

        expect(reasonOf(() => cipher.decrypt(value, AAD))).toBe('format');
        expect(reasonOf(() => cipher.needsReencrypt(value))).toBe('format');
    });

    describe('AC-7.2: неканоничный base64url (KT-26 п. 2, KT-27 п. 1)', () => {
        const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
        // Младший бит последнего символа: у тега (16 байт) и ct 'text' (4 байта) он вне данных — байты те же.
        const withTrailingBits = (part: string): string =>
            `${part.slice(0, -1)}${ALPHABET[ALPHABET.indexOf(part.at(-1) ?? 'A') ^ 1] ?? ''}`;
        const cipher = cipherOf([{ version: 1, secret: secret() }]);
        const value = cipher.encrypt('text', AAD);
        const [prefix = '', iv = '', ct = '', tag = ''] = value.split(':');

        it.each([
            ['IV из 17 символов', [prefix, `${iv}A`, ct, tag].join(':')],
            [
                'тег с изменёнными хвостовыми битами',
                [prefix, iv, ct, withTrailingBits(tag)].join(':'),
            ],
            [
                'ct с изменёнными хвостовыми битами',
                [prefix, iv, withTrailingBits(ct), tag].join(':'),
            ],
        ])('AC-7.2: %s → format (decrypt и needsReencrypt)', (_name, altered) => {
            expect(altered).not.toBe(value);
            expect(reasonOf(() => cipher.decrypt(altered, AAD))).toBe('format');
            expect(reasonOf(() => cipher.needsReencrypt(altered))).toBe('format');
        });

        it('AC-7.2: исходное значение по-прежнему расшифровывается', () => {
            expect(cipher.decrypt(value, AAD)).toBe('text');
        });
    });

    it.each<DecryptErrorReason>(['format', 'unknown_version', 'auth'])(
        'AC-7.2: в тексте и полях ошибки нет открытого текста, aad, секрета и ключа (%s)',
        (reason) => {
            const plaintext = 'plain-secret-text';
            const aad = 'client-secret:cli_secret_record';
            const key = secret();
            const cipher = cipherOf([{ version: 1, secret: key }]);
            const value = cipher.encrypt(plaintext, { aad });
            const derived = Buffer.from(
                hkdfSync(
                    'sha256',
                    Buffer.from(key, 'base64url'),
                    Buffer.alloc(0),
                    'verdeect-svc-a:client-secret',
                    32,
                ),
            );
            const inputs: Record<DecryptErrorReason, () => unknown> = {
                format: () => cipher.decrypt(`${value}:x`, { aad }),
                unknown_version: () => cipher.decrypt(value.replace(/^v1:/, 'v9:'), { aad }),
                auth: () => cipher.decrypt(value, { aad: `${aad}-other` }),
            };
            const error = errorOf(inputs[reason]);

            expect(error).toBeInstanceOf(DecryptError);
            expect(error.reason).toBe(reason);
            expect(error.name).toBe('DecryptError');
            expect(error.cause).toBeUndefined();
            for (const text of [error.message, JSON.stringify(error), String(error)]) {
                for (const forbidden of [
                    plaintext,
                    aad,
                    key,
                    value,
                    derived.toString('base64url'),
                    derived.toString('hex'),
                ]) {
                    expect(text).not.toContain(forbidden);
                }
            }
        },
    );

    it('AC-7.2: пустой aad — TypeError в encrypt и decrypt', () => {
        const cipher = cipherOf([{ version: 1, secret: secret() }]);
        const value = cipher.encrypt('text', AAD);

        expect(() => cipher.encrypt('text', { aad: '' })).toThrow(TypeError);
        expect(() => cipher.decrypt(value, { aad: '' })).toThrow(TypeError);
    });
});
