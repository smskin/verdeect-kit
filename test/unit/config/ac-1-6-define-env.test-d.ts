// AC-1.6 (UC-1): несовместимое переопределение ключа пакета — ошибка компиляции (prd.md §3.1).
import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
    booleanFlag,
    defineEnv,
    envBase,
    envDatabase,
    parseEnv,
    port,
} from '../../../src/config/index.js';

test('AC-1.6: переопределение PORT своим port(4000) компилируется', () => {
    const schema = defineEnv({ ...envBase, PORT: port(4000) });
    expectTypeOf(parseEnv(schema, {}).PORT).toEqualTypeOf<number>();
});

test('AC-1.6: PORT как z.string() — ошибка компиляции', () => {
    // @ts-expect-error PORT пакета — число, строка несовместима
    defineEnv({ ...envBase, PORT: z.string() });
});

test('AC-1.6: DATABASE_URL как z.number() — ошибка компиляции', () => {
    // @ts-expect-error DATABASE_URL пакета — строка, число несовместимо
    defineEnv({ ...envDatabase, DATABASE_URL: z.number() });
});

test('AC-1.6: свой ключ сервиса — любой тип', () => {
    const schema = defineEnv({ ...envBase, FEATURE_X: booleanFlag(false) });
    expectTypeOf(parseEnv(schema, {}).FEATURE_X).toEqualTypeOf<boolean>();
});

test('AC-1.6: вывод типа', () => {
    expectTypeOf(parseEnv(defineEnv({ ...envBase }), {}).PORT).toEqualTypeOf<number>();
});
