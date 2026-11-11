// AC-7.3 (U, UC-10; prd.md §3.6): ключ — HKDF-SHA256 от декодированного секрета, соль пустая, info verdeect-<svc>:<purpose>;
// разные purpose и service — разные ключи. Перенос O private-key-cipher.spec.ts (HKDF), обобщён на service/purpose;
// ключ из UTF-8 строки секрета (способ O) не принимается (D1).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher } from '../../../src/crypto/index.js';
import { cipherOf, reasonOf, secret } from './support.js';

const AAD = 'client-secret:cli_1';
const INFO = 'verdeect-svc-a:client-secret';

function hkdf(input: Buffer): Buffer {
    return Buffer.from(hkdfSync('sha256', input, Buffer.alloc(0), INFO, 32));
}

describe('UC-10: разделение ключей', () => {
    it("AC-7.3: один секрет, разные purpose — значение одного не расшифровывается другим ('auth')", () => {
        const keys = [{ version: 1, secret: secret() }];
        const value = cipherOf(keys, { purpose: 'client-secret' }).encrypt('text', { aad: AAD });
        const other = cipherOf(keys, { purpose: 'session' });

        expect(reasonOf(() => other.decrypt(value, { aad: AAD }))).toBe('auth');
    });

    it("AC-7.3: один секрет и purpose, разные service — не расшифровывается ('auth')", () => {
        const keys = [{ version: 1, secret: secret() }];
        const value = cipherOf(keys, { service: 'svc-a' }).encrypt('text', { aad: AAD });
        const other = cipherOf(keys, { service: 'svc-b' });

        expect(reasonOf(() => other.decrypt(value, { aad: AAD }))).toBe('auth');
    });

    it('AC-7.3: ключ — HKDF-SHA256 от декодированного секрета, info verdeect-<svc>:<purpose>', () => {
        const key = secret();
        const value = cipherOf([{ version: 1, secret: key }]).encrypt('text', { aad: AAD });
        const [, iv = '', ct = '', tag = ''] = value.split(':');
        const decipher = createDecipheriv(
            'aes-256-gcm',
            hkdf(Buffer.from(key, 'base64url')),
            Buffer.from(iv, 'base64url'),
        );
        decipher.setAAD(Buffer.from(AAD, 'utf8'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(ct, 'base64url')),
            decipher.final(),
        ]).toString('utf8');

        expect(plaintext).toBe('text');
    });

    it("AC-7.3: значение, зашифрованное ключом из UTF-8 строки того же секрета, не расшифровывается ('auth')", () => {
        const key = secret();
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', hkdf(Buffer.from(key, 'utf8')), iv);
        cipher.setAAD(Buffer.from(AAD, 'utf8'));
        const ct = Buffer.concat([cipher.update('text', 'utf8'), cipher.final()]);
        const value = `v1:${iv.toString('base64url')}:${ct.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;

        expect(
            reasonOf(() => cipherOf([{ version: 1, secret: key }]).decrypt(value, { aad: AAD })),
        ).toBe('auth');
    });

    it.each([
        ['service', 'Bad'],
        ['service', 'a'],
        ['service', '1svc'],
        ['service', `s${'a'.repeat(32)}`],
        ['purpose', 'Purpose'],
        ['purpose', 'p'],
        ['purpose', 'a_b'],
        ['purpose', `p${'a'.repeat(32)}`],
    ])('AC-7.3: %s «%s» вне формата — TypeError при создании', (field, value) => {
        const options = {
            service: 'svc-a',
            purpose: 'client-secret',
            keys: [{ version: 1, secret: secret() }],
            [field]: value,
        };

        expect(() => createCipher(options)).toThrow(TypeError);
    });

    it.each([
        ['пустой массив', [], 'keys'],
        [
            'секрет 31 байт',
            [{ version: 1, secret: randomBytes(31).toString('base64url') }],
            'keys.0.secret',
        ],
        [
            'повтор версии',
            [
                { version: 1, secret: secret() },
                { version: 1, secret: secret() },
            ],
            'keys',
        ],
    ])('§3.6: keys вне формата (%s) — TypeError с путём, без значений', (_name, keys, path) => {
        let message = '';
        try {
            createCipher({ service: 'svc-a', purpose: 'client-secret', keys });
        } catch (error) {
            expect(error).toBeInstanceOf(TypeError);
            message = (error as TypeError).message;
        }

        expect(message).toContain(path);
        for (const { secret: value } of keys) {
            expect(message).not.toContain(value);
        }
    });
});
