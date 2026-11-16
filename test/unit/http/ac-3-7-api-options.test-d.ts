// AC-3.7, AC-3.15 (UC-4, prd.md §3.5 v1.31): типы опций @Api — status: number | null, errors — код или {code, status}.
import { expectTypeOf, test } from 'vitest';
import type { KitApiOptions } from '../../../src/http/api/api.decorator.js';

test("AC-3.7: errors: [{code: 'X', status: 429}] и status: null компилируются", () => {
    const options: KitApiOptions = {
        summary: 's',
        status: null,
        errors: ['Y', { code: 'X', status: 429 }],
    };
    expectTypeOf(options.status).toEqualTypeOf<number | null | undefined>();
});

test("AC-3.7: status: '200' — ошибка компиляции", () => {
    // @ts-expect-error статус — число или null
    const options: KitApiOptions = { summary: 's', status: '200' };
    void options;
});
