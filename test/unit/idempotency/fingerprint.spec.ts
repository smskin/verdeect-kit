// Отпечаток запроса и область ключа (prd.md §3.3а v1.14, AC-4.14, UC-7); src/idempotency/idempotency.interceptor.ts.
// Перенос O idempotency.interceptor.spec (canonicalJson, requestHash), обобщён на область по принципалу.
import type { AgentPrincipal, ServicePrincipal, UserPrincipal } from '@verdeect/auth';
import { describe, expect, it } from 'vitest';
import {
    canonicalJson,
    fingerprintOf,
    scopeOf,
} from '../../../src/idempotency/idempotency.interceptor.js';

const user: UserPrincipal = {
    kind: 'user',
    sub: 'u1',
    clientId: 'web',
    sid: 's1',
    scopes: [],
    tenant: 'acme',
    tenantId: 'org_1',
};
const agent = { kind: 'agent', sub: 'a1', tenant: 'acme', clientId: null } as AgentPrincipal;
const service: ServicePrincipal = { kind: 'service', sub: 'svc', clientId: 'svc', scopes: [] };

describe('UC-7: отпечаток и область', () => {
    it('AC-4.14: canonicalJson — порядок ключей не влияет, вложенные объекты сортируются, массивы по порядку', () => {
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
            canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
        );
        expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
        expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
        expect(canonicalJson(undefined)).toBe('null');
    });

    it('AC-4.14: отпечаток — метод + путь без query + SHA-256 тела', () => {
        const base = fingerprintOf('POST', '/echo', { a: 1 });

        expect(base).toMatch(/^[0-9a-f]{64}$/);
        expect(fingerprintOf('POST', '/echo?x=1', { a: 1 })).toBe(base);
        expect(fingerprintOf('PUT', '/echo', { a: 1 })).not.toBe(base);
        expect(fingerprintOf('POST', '/other', { a: 1 })).not.toBe(base);
        expect(fingerprintOf('POST', '/echo', { a: 2 })).not.toBe(base);
    });

    it('AC-4.14: scopeOf — user (tenant, user:sub), agent (tenant, agent:sub), service (null, service:client)', () => {
        expect(scopeOf(user, {}, {})).toEqual({ tenant: 'acme', subject: 'user:u1' });
        expect(scopeOf(agent, {}, {})).toEqual({ tenant: 'acme', subject: 'agent:a1' });
        expect(scopeOf(service, { tenant: 'acme' }, {})).toEqual({
            tenant: null,
            subject: 'service:svc',
        });
    });

    it("AC-4.14: service + tenantFromBody 'org.slug' — tenant из тела; поле пустое / нет / не строка — null без ошибки", () => {
        const options = { tenantFromBody: 'org.slug' };

        expect(scopeOf(service, { org: { slug: 'globex' } }, options).tenant).toBe('globex');
        expect(scopeOf(service, { org: { slug: '' } }, options).tenant).toBeNull();
        expect(scopeOf(service, { org: {} }, options).tenant).toBeNull();
        expect(scopeOf(service, { org: { slug: 7 } }, options).tenant).toBeNull();
        expect(scopeOf(service, null, options).tenant).toBeNull();
    });

    it('AC-4.14: user с подложным tenant в теле — область из токена', () => {
        expect(scopeOf(user, { tenant: 'globex' }, { tenantFromBody: 'tenant' })).toEqual({
            tenant: 'acme',
            subject: 'user:u1',
        });
        expect(scopeOf(agent, { tenant: 'globex' }, { tenantFromBody: 'tenant' }).tenant).toBe(
            'acme',
        );
    });
});
