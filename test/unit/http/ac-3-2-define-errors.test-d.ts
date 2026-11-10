// AC-3.2 (UC-4): код пакета с другим статусом в словаре сервиса — ошибка компиляции (prd.md §3.5).
import { expectTypeOf, test } from 'vitest';
import { defineErrors, kitErrors } from '../../../src/http/errors.js';

test('AC-3.2: свой код и kitErrors как есть компилируются', () => {
    const errors = defineErrors({
        ...kitErrors,
        ITEM_NOT_FOUND: { status: 404, message: 'Запись не найдена' },
    });
    expectTypeOf(errors.ITEM_NOT_FOUND.status).toEqualTypeOf<404>();
});

test('AC-3.2: код пакета с другим статусом — ошибка компиляции', () => {
    // @ts-expect-error FORBIDDEN пакета — 403, переопределение статуса запрещено
    defineErrors({ ...kitErrors, FORBIDDEN: { status: 401, message: 'x' } });
});
