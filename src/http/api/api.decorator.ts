// @Api — описание маршрута для OpenAPI 3.1 (prd.md §3.5, AC-3.7). Эталон — I open-api.decorator.ts (SetMetadata, envelope).
// По PRD: errors — коды словаря defineErrors (статусы берутся из реестра), extra — то, что генерация не выражает.
// v1.31 (r26): status — успешный статус или null (только ошибки); элемент errors — код или {code, status}.
import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';

/** Ключ метаданных `@Api`. */
export const API_METADATA = 'verdeect-kit:api';

/** Опции `@Api` (§3.5). */
export interface KitApiOptions {
    /** Краткое описание операции. */
    readonly summary: string;
    /** Схема тела успешного ответа; нет — ответ без тела. */
    readonly response?: z.ZodType;
    /** Конверт ответа: `page` — `{items, nextCursor}`, `items` — `{items}`, `array` — массив; нет — объект как есть. */
    readonly envelope?: 'page' | 'items' | 'array';
    /**
     * Успешный статус операции; приоритет — `status` → `@HttpCode` → `@Redirect` (ответ без тела) → 201 у POST, 200 у
     * остальных. `null` — успешного ответа в документе нет (маршрут отвечает только ошибками).
     */
    readonly status?: number | null;
    /**
     * Ошибки маршрута из словаря `defineErrors` дополнительно к стандартным 400/401/403/422/429: код — все его
     * объявленные статусы; `{code, status}` — только этот статус (статус не объявлен для кода — ошибка генерации).
     */
    readonly errors?: readonly (string | { readonly code: string; readonly status: number })[];
    /** Поля операции OpenAPI, которые генерация не выражает (SSE, сырой прокси); сливаются глубоко. */
    readonly extra?: Readonly<Record<string, unknown>>;
}

/** Включает маршрут в документ OpenAPI `verdeect-kit openapi`; маршрут без `@Api` в документ не попадает. */
export function Api(options: KitApiOptions): MethodDecorator {
    return SetMetadata(API_METADATA, options);
}
