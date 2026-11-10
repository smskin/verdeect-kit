// Помощники схем окружения (prd.md §3.1); эталон — O env.schema.spec.ts, B (port, httpUrl).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    booleanFlag,
    httpUrl,
    jsonValue,
    optionalText,
    port,
    uniqueBy,
} from '../../../src/config/index.js';

describe('§3.1: помощники', () => {
    it('§3.1: port — 0–65535, 65536 и -1 → ошибка, без умолчания ключ обязателен', () => {
        expect(port().parse('8080')).toBe(8080);
        expect(port().safeParse('65536').success).toBe(false);
        expect(port().safeParse('-1').success).toBe(false);
        expect(port().safeParse(undefined).success).toBe(false);
        expect(port(3000).parse(undefined)).toBe(3000);
    });

    it("§3.1: booleanFlag(true) — 'false' → false, '1' → ошибка, пусто → умолчание", () => {
        expect(booleanFlag(true).parse('false')).toBe(false);
        expect(booleanFlag(true).parse(undefined)).toBe(true);
        expect(booleanFlag(true).safeParse('1').success).toBe(false);
        expect(booleanFlag().safeParse(undefined).success).toBe(false);
    });

    it('§3.1: jsonValue — разбор, fallback, неверный JSON → ошибка', () => {
        const schema = jsonValue(z.object({ count: z.number() }), '{"count":3}');

        expect(schema.parse(undefined)).toEqual({ count: 3 });
        expect(schema.parse('{"count":5}')).toEqual({ count: 5 });
        expect(schema.safeParse('{count').success).toBe(false);
    });

    it('§3.1: uniqueBy — повтор → ошибка', () => {
        const schema = z.array(z.object({ id: z.string() })).superRefine(uniqueBy('id'));

        expect(schema.safeParse([{ id: 'a' }, { id: 'b' }]).success).toBe(true);
        const result = schema.safeParse([{ id: 'a' }, { id: 'a' }]);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.message).toBe('повтор id');
    });

    it('§3.1: optionalText — пусто → null, значение обрезается', () => {
        expect(optionalText().parse(undefined)).toBeNull();
        expect(optionalText().parse('   ')).toBeNull();
        expect(optionalText().parse('  x ')).toBe('x');
    });

    it('§3.1: httpUrl — http/https, ftp:// → ошибка', () => {
        expect(httpUrl().safeParse('https://a.local').success).toBe(true);
        expect(httpUrl().safeParse('http://a:1').success).toBe(true);
        expect(httpUrl().safeParse('ftp://a.local').success).toBe(false);
    });
});
