// Идентификаторы newId и ulid (prd.md §3.3, AC-4.9, UC-5); src/internal/ids.ts.
// Перенос O ids.spec.ts (формат msg_, порядок по времени, уникальность), обобщён на проверку префикса по PRD.
import { describe, expect, it } from 'vitest';
import { newId, ulid } from '../../../src/internal/ids.js';

describe('UC-5: идентификаторы', () => {
    it("AC-4.9: newId('fil') — fil_ + 26 знаков Crockford", () => {
        expect(newId('fil')).toMatch(/^fil_[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it.each(['f', 'files1', 'Fil', 'fi-l', '', 'abcdef'])(
        'AC-4.9: префикс вне ^[a-z]{2,5}$ → TypeError («%s»)',
        (prefix) => {
            expect(() => newId(prefix)).toThrow(TypeError);
        },
    );

    it('AC-4.9: формат совпадает с O ids (msg_) и I newUlid (26 знаков)', () => {
        expect(newId('msg')).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);
        expect(ulid()).toHaveLength(26);
    });

    it('AC-4.9: ulid(1000) < ulid(2000) по первым 10 знакам', () => {
        expect(ulid(1000).slice(0, 10) < ulid(2000).slice(0, 10)).toBe(true);
    });

    it('AC-4.9: 100 значений newId уникальны', () => {
        const ids = new Set(Array.from({ length: 100 }, () => newId('msg')));
        expect(ids.size).toBe(100);
    });

    it('AC-4.9: ulid(-1) и ulid(2^48) → RangeError', () => {
        expect(() => ulid(-1)).toThrow(RangeError);
        expect(() => ulid(2 ** 48)).toThrow(RangeError);
        expect(() => ulid(1.5)).toThrow(RangeError);
    });
});
