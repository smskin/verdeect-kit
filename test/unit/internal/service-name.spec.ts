// Формат имени сервиса (prd.md §3.4, §3.5, §3.6; CE-3); src/internal/service-name.ts.
import { describe, expect, it } from 'vitest';
import { assertServiceName } from '../../../src/internal/service-name.js';

describe('§3.5: формат имени сервиса', () => {
    it('§3.5: формат имени сервиса — bff-app, files, ab проходят; A, 1ab, a, a_b, 33 символа → TypeError с where', () => {
        for (const name of ['bff-app', 'files', 'ab']) {
            expect(() => assertServiceName(name, 'test')).not.toThrow();
        }
        for (const name of ['A', '1ab', 'a', 'a_b', `a${'b'.repeat(32)}`]) {
            expect(() => assertServiceName(name, 'startTestStack')).toThrow(TypeError);
            expect(() => assertServiceName(name, 'startTestStack')).toThrow(/^startTestStack: /);
        }
    });
});
