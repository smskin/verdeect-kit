// §3.2 (O1, O3, GAP-6, GAP-8; NFR-4): SENSITIVE_KEYS — ровно список PRD, развёртка имён на уровни 0–2 и скобки для имён
// вне [A-Za-z0-9_], sensitiveKeys дополняют базовый список. Эталон — REDACT_PATHS O observability.module.ts.
import { describe, expect, it } from 'vitest';
import { SENSITIVE_KEYS } from '../../../src/observability/index.js';
import { maskPathOf, redactPaths, sensitiveNames } from '../../../src/observability/redaction.js';

describe('§3.2: SENSITIVE_KEYS и KitRedaction', () => {
    it('§3.2: SENSITIVE_KEYS — ровно список PRD, неизменяемый', () => {
        expect(SENSITIVE_KEYS).toEqual([
            'authorization',
            'cookie',
            'set-cookie',
            'idempotency-key',
            'password',
            'newPassword',
            'currentPassword',
            'secret',
            'clientSecret',
            'token',
            'access_token',
            'refresh_token',
            'id_token',
            'logout_token',
            'accessToken',
            'code_verifier',
            'nonce',
            'email',
            'givenName',
            'familyName',
            'middleName',
            'body.code',
            'body.state',
        ]);
        expect(Object.isFrozen(SENSITIVE_KEYS)).toBe(true);
    });

    it('§3.2: имя разворачивается на уровни 0–2', () => {
        const paths = redactPaths();

        expect(paths).toEqual(expect.arrayContaining(['email', '*.email', '*.*.email']));
        expect(paths).toEqual(
            expect.arrayContaining(['body.code', '*.body.code', '*.*.body.code']),
        );
        expect(paths).not.toContain('code');
    });

    it('§3.2: имя вне [A-Za-z0-9_] — в скобках', () => {
        expect(redactPaths()).toEqual(
            expect.arrayContaining(['["set-cookie"]', '*["set-cookie"]', '*.*["set-cookie"]']),
        );
    });

    it('§3.2: sensitiveKeys дополняют базовый список без дублей; пустой массив его не отключает', () => {
        expect(sensitiveNames({ sensitiveKeys: [] })).toEqual(SENSITIVE_KEYS);
        const names = sensitiveNames({ sensitiveKeys: ['inn', 'email'] });
        expect(names).toEqual([...SENSITIVE_KEYS, 'inn']);
    });

    it('§3.2: maskPath по умолчанию — путь без изменений', () => {
        expect(maskPathOf()('/a/b')).toBe('/a/b');
        expect(maskPathOf({ maskPath: () => '/x' })('/a/b')).toBe('/x');
    });
});
