// AC-7.3 (U; prd.md §3.6, KT-25 п. 2, D13): контрольный вектор — фиксированные секрет, service, purpose, IV и текст дают
// заранее вычисленное значение. IV фиксируется подменой randomBytes (свой файл: vi.mock('node:crypto')).
import type * as NodeCrypto from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createCipher } from '../../../src/crypto/index.js';

vi.mock('node:crypto', async (importOriginal) => {
    const original = await importOriginal<typeof NodeCrypto>();

    return { ...original, randomBytes: vi.fn(original.randomBytes) };
});

const SECRET = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64url');
const IV = Buffer.from(Array.from({ length: 12 }, (_, i) => i));
const PLAINTEXT = 'verdeect-test-vector';
const AAD = { aad: 'client-secret:cli_1' };
// Вектор посчитан node:crypto напрямую, не кодом пакета:
// node --input-type=module -e "import {hkdfSync,createCipheriv} from 'node:crypto'; const SECRET=Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString('base64url'); const IV=Buffer.from(Array.from({length:12},(_,i)=>i)); const key=Buffer.from(hkdfSync('sha256',Buffer.from(SECRET,'base64url'),Buffer.alloc(0),'verdeect-svc-a:client-secret',32)); const c=createCipheriv('aes-256-gcm',key,IV); c.setAAD(Buffer.from('client-secret:cli_1','utf8')); const ct=Buffer.concat([c.update('verdeect-test-vector','utf8'),c.final()]); console.log('v1:'+IV.toString('base64url')+':'+ct.toString('base64url')+':'+c.getAuthTag().toString('base64url'))"
const EXPECTED = 'v1:AAECAwQFBgcICQoL:lNr_kkKXMH3Vn5HwDnV2k8Ys-TY:2I9KFwfFD32OKCwJMfPtNg';

const cipher = () =>
    createCipher({
        service: 'svc-a',
        keys: [{ version: 1, secret: SECRET }],
        purpose: 'client-secret',
    });

describe('UC-10: контрольный вектор', () => {
    it('AC-7.3: контрольный вектор — фиксированные секрет, service, purpose, IV и текст дают заранее вычисленное значение', () => {
        const instance = cipher();
        vi.mocked(randomBytes as (size: number) => Buffer).mockReturnValueOnce(IV);

        expect(instance.encrypt(PLAINTEXT, AAD)).toBe(EXPECTED);
    });

    it('AC-7.3: контрольный вектор расшифровывается', () => {
        expect(cipher().decrypt(EXPECTED, AAD)).toBe(PLAINTEXT);
    });
});
