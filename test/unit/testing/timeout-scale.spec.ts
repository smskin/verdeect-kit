// TEST_TIMEOUT_SCALE (prd.md §3.8, E1); эталон — verdeect-platform-client test/support/timeout-scale.ts.
import { describe, expect, it } from 'vitest';
import { readTimeoutScale } from '../../../src/testing/timeout-scale.js';

describe('§3.8: TEST_TIMEOUT_SCALE', () => {
    it('§3.8: TEST_TIMEOUT_SCALE — пусто и пробелы → 1', () => {
        expect(readTimeoutScale({})).toBe(1);
        expect(readTimeoutScale({ TEST_TIMEOUT_SCALE: '  ' })).toBe(1);
    });

    it('§3.8: TEST_TIMEOUT_SCALE — 2.5 → 2.5', () => {
        expect(readTimeoutScale({ TEST_TIMEOUT_SCALE: '2.5' })).toBe(2.5);
    });

    it.each(['0', '-1', 'abc', 'Infinity'])(
        '§3.8: TEST_TIMEOUT_SCALE — %s → ошибка с текстом «нужно число > 0»',
        (value) => {
            expect(() => readTimeoutScale({ TEST_TIMEOUT_SCALE: value })).toThrow(
                'нужно число > 0',
            );
        },
    );
});
