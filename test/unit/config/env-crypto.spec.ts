// envCrypto: ENCRYPTION_KEYS — JSON [{version, secret}], секрет base64url ≥ 32 байт (prd.md §3.1, §3.6, CE-2, NFR-4).
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defineEnv, envCrypto, parseEnv } from '../../../src/config/index.js';
import { errorOf, expectKeysOnly } from './support.js';

const schema = defineEnv({ ...envCrypto });

function keys(items: readonly { version: number; secret: string }[]): { ENCRYPTION_KEYS: string } {
    return { ENCRYPTION_KEYS: JSON.stringify(items) };
}

describe('§3.6 (envCrypto): ключи шифра', () => {
    it('§3.6 (envCrypto): секрет 32 байта base64url — ок; 31 байт → путь ENCRYPTION_KEYS.0.secret', () => {
        const secret = randomBytes(32).toString('base64url');
        expect(parseEnv(schema, keys([{ version: 1, secret }])).ENCRYPTION_KEYS).toEqual([
            { version: 1, secret },
        ]);

        const short = randomBytes(31).toString('base64url');
        expectKeysOnly(
            errorOf(() => parseEnv(schema, keys([{ version: 1, secret: short }]))),
            'ENCRYPTION_KEYS.0.secret',
            [short],
        );
    });

    it("§3.6 (envCrypto): секрет с '=' → ошибка", () => {
        const padded = randomBytes(32).toString('base64');
        const secret = padded.endsWith('=') ? padded : `${padded}=`;

        expect(errorOf(() => parseEnv(schema, keys([{ version: 1, secret }]))).keys).toEqual([
            'ENCRYPTION_KEYS.0.secret',
        ]);
    });

    it('§3.6 (envCrypto): повтор version → ENCRYPTION_KEYS', () => {
        const a = randomBytes(32).toString('base64url');
        const b = randomBytes(32).toString('base64url');

        const error = errorOf(() =>
            parseEnv(
                schema,
                keys([
                    { version: 1, secret: a },
                    { version: 1, secret: b },
                ]),
            ),
        );

        expectKeysOnly(error, 'ENCRYPTION_KEYS', [a, b]);
    });

    it('§3.6 (envCrypto): пустой массив → ошибка', () => {
        expect(errorOf(() => parseEnv(schema, keys([]))).keys).toEqual(['ENCRYPTION_KEYS']);
    });

    it('§3.6 (envCrypto): секрет не в тексте ошибки', () => {
        const secret = randomBytes(32).toString('base64url');

        const error = errorOf(() => parseEnv(schema, keys([{ version: 0, secret }])));

        expectKeysOnly(error, 'ENCRYPTION_KEYS.0.version', [secret]);
    });
});
