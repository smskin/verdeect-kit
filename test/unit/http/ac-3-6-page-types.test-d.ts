// AC-3.6 (UC-4; prd.md §3.5 v1.35): типы PageQuery (выход PageQuerySchema) и CursorValue экспортируются из /http.
import { expectTypeOf, test } from 'vitest';
import type { z } from 'zod';
import type { CursorValue, PageQuery, PageQuerySchema } from '../../../src/http/index.js';

test('AC-3.6: PageQuery — {cursor?: string; limit: number}', () => {
    expectTypeOf<PageQuery>().toEqualTypeOf<z.output<typeof PageQuerySchema>>();
    expectTypeOf<PageQuery['limit']>().toEqualTypeOf<number>();
    expectTypeOf<PageQuery['cursor']>().toEqualTypeOf<string | undefined>();
});

test('AC-3.6: CursorValue — string | number | boolean | null', () => {
    expectTypeOf<CursorValue>().toEqualTypeOf<string | number | boolean | null>();
});
