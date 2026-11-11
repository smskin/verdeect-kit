// AC-7.5 (U, UC-10 А3; prd.md §3.1 envCrypto, §3.6): ENCRYPTION_KEYS — секрет base64url без '=' ≥ 32 байт, версия —
// целое ≥ 1 без повторов; ошибки без значений; секрет generateSecret принимается envCrypto и createCipher.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defineEnv, envCrypto, parseEnv } from '../../../src/config/index.js';
import { createCipher, generateSecret } from '../../../src/crypto/index.js';
import { errorOf, expectKeysOnly } from '../config/support.js';

const schema = defineEnv({ ...envCrypto });
const parse = (keys: unknown) => parseEnv(schema, { ENCRYPTION_KEYS: JSON.stringify(keys) });

describe('UC-10: секреты ENCRYPTION_KEYS', () => {
    it('AC-7.5: секрет < 32 байт → InvalidEnvironmentError с путём ENCRYPTION_KEYS.0.secret, без значения', () => {
        const short = randomBytes(31).toString('base64url');

        expectKeysOnly(
            errorOf(() => parse([{ version: 1, secret: short }])),
            'ENCRYPTION_KEYS.0.secret',
            [short],
        );
    });

    it('AC-7.5: повтор версии → путь ENCRYPTION_KEYS, без значений', () => {
        const first = generateSecret();
        const second = generateSecret();

        expectKeysOnly(
            errorOf(() =>
                parse([
                    { version: 1, secret: first },
                    { version: 1, secret: second },
                ]),
            ),
            'ENCRYPTION_KEYS',
            [first, second],
        );
    });

    it.each([0, -1, 1.5])(
        'AC-7.5: version %s → путь ENCRYPTION_KEYS.0.version, без значений',
        (version) => {
            const value = generateSecret();

            expectKeysOnly(
                errorOf(() => parse([{ version, secret: value }])),
                'ENCRYPTION_KEYS.0.version',
                [value],
            );
        },
    );

    it('AC-7.5: createCipher с version 0 → TypeError с путём keys.0.version, без секрета', () => {
        const value = generateSecret();
        let message = '';
        try {
            createCipher({
                service: 'svc-a',
                keys: [{ version: 0, secret: value }],
                purpose: 'client-secret',
            });
        } catch (error) {
            expect(error).toBeInstanceOf(TypeError);
            message = (error as TypeError).message;
        }

        expect(message).toContain('keys.0.version');
        expect(message).not.toContain(value);
    });

    it.each(['+', '/', '='])(
        "AC-7.5: секрет в base64 с '%s' → путь ENCRYPTION_KEYS.0.secret",
        (char) => {
            const value = `${generateSecret(48).slice(0, 60)}${char}${char === '=' ? '' : 'A'}`;

            expectKeysOnly(
                errorOf(() => parse([{ version: 1, secret: value }])),
                'ENCRYPTION_KEYS.0.secret',
                [value],
            );
        },
    );

    it('AC-7.5: секрет из generateSecret() принимается envCrypto и createCipher', () => {
        const env = parse([{ version: 1, secret: generateSecret() }]);
        const cipher = createCipher({
            service: 'svc-a',
            keys: env.ENCRYPTION_KEYS,
            purpose: 'client-secret',
        });
        const aad = { aad: 'client-secret:cli_1' };

        expect(cipher.decrypt(cipher.encrypt('text', aad), aad)).toBe('text');
    });

    it("AC-7.5: generateSecret(48) — 48 байт base64url без '='; generateSecret(16), (31), (0) и (32.5) — RangeError", () => {
        const value = generateSecret(48);

        expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Buffer.from(value, 'base64url')).toHaveLength(48);
        expect(Buffer.from(generateSecret(), 'base64url')).toHaveLength(32);
        for (const bytes of [16, 31, 0, 32.5]) {
            expect(() => generateSecret(bytes)).toThrow(RangeError);
        }
    });
});
