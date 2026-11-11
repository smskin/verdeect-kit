// AC-7.4 (U, UC-10 шаги 2–5; prd.md §3.6): смена ключа — старая версия читается, needsReencrypt отмечает значения
// старой версии, после удаления версии — 'unknown_version'. Перенос B session-cipher.spec.ts (запись старого ключа
// читается после ротации).
import { describe, expect, it } from 'vitest';
import { cipherOf, reasonOf, secret } from './support.js';

const AAD = { aad: 'client-secret:cli_1' };

describe('UC-10: смена ключа', () => {
    const v1 = { version: 1, secret: secret() };
    const v2 = { version: 2, secret: secret() };

    it('AC-7.4: значение версии 1 читается после добавления версии 2 первой', () => {
        const old = cipherOf([v1]).encrypt('text', AAD);

        expect(cipherOf([v2, v1]).decrypt(old, AAD)).toBe('text');
    });

    it('AC-7.4: needsReencrypt — true для v1 при текущей v2, после перешифровки — false', () => {
        const old = cipherOf([v1]).encrypt('text', AAD);
        const rotated = cipherOf([v2, v1]);

        expect(rotated.needsReencrypt(old)).toBe(true);
        const fresh = rotated.encrypt(rotated.decrypt(old, AAD), AAD);
        expect(fresh.startsWith('v2:')).toBe(true);
        expect(rotated.needsReencrypt(fresh)).toBe(false);
    });

    it("AC-7.4: после удаления версии 1 из keys перешифрованное значение читается, старое — 'unknown_version'", () => {
        const old = cipherOf([v1]).encrypt('text', AAD);
        const rotated = cipherOf([v2, v1]);
        const fresh = rotated.encrypt(rotated.decrypt(old, AAD), AAD);
        const final = cipherOf([v2]);

        expect(final.decrypt(fresh, AAD)).toBe('text');
        expect(reasonOf(() => final.decrypt(old, AAD))).toBe('unknown_version');
    });

    it("§3.6: needsReencrypt вне формата — DecryptError('format')", () => {
        expect(reasonOf(() => cipherOf([v1]).needsReencrypt('garbage'))).toBe('format');
    });
});
