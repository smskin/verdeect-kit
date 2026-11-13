// AC-7.6 (U; prd.md §3.6, UC-10): deriveKeys — ключи HMAC по версиям ENCRYPTION_KEYS в порядке списка, HKDF-SHA256
// с info = verdeect-<svc>:<purpose>:mac, отличие от ключа шифра createCipher, проверки как у createCipher.
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher, deriveKeys } from '../../../src/crypto/index.js';
import { secret } from './support.js';

const VECTOR_SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString(
    'base64url',
);
// Вектор посчитан node:crypto напрямую, не кодом пакета:
// node --input-type=module -e "import {hkdfSync} from 'node:crypto'; const S=Buffer.from(Array.from({length:32},(_,i)=>i+1)); console.log(Buffer.from(hkdfSync('sha256',S,Buffer.alloc(0),'verdeect-svc-a:session-mac:mac',32)).toString('hex'))"
const EXPECTED_HEX = '0c18c1e10fdb18aaf11e2d847845152be482379b42dc3b073e63f7969007b695';

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        if (error instanceof Error) {
            return error;
        }
    }
    throw new Error('ожидалась ошибка');
}

describe('UC-10: deriveKeys', () => {
    it('AC-7.6: две версии ENCRYPTION_KEYS — два ключа в порядке списка с их version, по 32 байта', () => {
        const keys = deriveKeys({
            service: 'svc-a',
            keys: [
                { version: 2, secret: secret() },
                { version: 1, secret: secret() },
            ],
            purpose: 'session-mac',
        });

        expect(keys.map(({ version }) => version)).toEqual([2, 1]);
        for (const { key } of keys) {
            expect(Buffer.isBuffer(key)).toBe(true);
            expect(key.length).toBe(32);
        }
        expect(keys[0]?.key.equals(keys[1]?.key ?? Buffer.alloc(0))).toBe(false);
    });

    it('AC-7.6: ключ совпадает с контрольным вектором HKDF (info = verdeect-<svc>:<purpose>:mac)', () => {
        const [derived] = deriveKeys({
            service: 'svc-a',
            keys: [{ version: 1, secret: VECTOR_SECRET }],
            purpose: 'session-mac',
        });

        expect(derived?.version).toBe(1);
        expect(derived?.key.toString('hex')).toBe(EXPECTED_HEX);
    });

    it('AC-7.6: ключ не равен ключу шифра createCipher того же service и purpose', () => {
        const ikm = Buffer.from(VECTOR_SECRET, 'base64url');
        const cipherKey = Buffer.from(
            hkdfSync('sha256', ikm, Buffer.alloc(0), 'verdeect-svc-a:session-mac', 32),
        );
        const [derived] = deriveKeys({
            service: 'svc-a',
            keys: [{ version: 1, secret: VECTOR_SECRET }],
            purpose: 'session-mac',
        });

        expect(derived?.key.equals(cipherKey)).toBe(false);
        expect('verdeect-svc-a:session-mac:mac').not.toBe('verdeect-svc-a:session-mac');
    });

    it('AC-7.6: неверный purpose — TypeError deriveKeys:', () => {
        const error = errorOf(() =>
            deriveKeys({
                service: 'svc-a',
                keys: [{ version: 1, secret: secret() }],
                purpose: 'Bad',
            }),
        );

        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/^deriveKeys:/);
    });

    it('AC-7.6: неверный service — TypeError deriveKeys: с тем же текстом, что у createCipher, без значения секрета', () => {
        const value = secret();
        const options = { service: 'Svc', keys: [{ version: 1, secret: value }], purpose: 'mac' };
        const error = errorOf(() => deriveKeys(options));
        const cipherError = errorOf(() => createCipher(options));

        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toBe(
            'deriveKeys: имя сервиса «Svc» вне формата ^[a-z][a-z0-9-]{1,31}$',
        );
        expect(error.message.replace(/^deriveKeys:/, 'createCipher:')).toBe(cipherError.message);
        expect(error.message).not.toContain(value);
    });

    it('AC-7.6: нет секрета — TypeError с путём keys.0.secret', () => {
        const error = errorOf(() =>
            deriveKeys({
                service: 'svc-a',
                keys: [{ version: 1 } as unknown as { version: number; secret: string }],
                purpose: 'session-mac',
            }),
        );

        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/^deriveKeys:/);
        expect(error.message).toContain('keys.0.secret');
    });

    it('AC-7.6: дубликат версии — TypeError без значения секрета', () => {
        const value = secret();
        const error = errorOf(() =>
            deriveKeys({
                service: 'svc-a',
                keys: [
                    { version: 1, secret: value },
                    { version: 1, secret: value },
                ],
                purpose: 'session-mac',
            }),
        );

        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/^deriveKeys: неверные keys/);
        expect(error.message).not.toContain(value);
    });
});
