// @Api — описание маршрута для OpenAPI 3.1 (prd.md §3.5, AC-3.7). Эталон — I open-api.decorator.ts (SetMetadata, envelope).
// По PRD: errors — коды словаря defineErrors (статусы берутся из реестра), extra — то, что генерация не выражает.
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
    /** Коды ошибок маршрута из словаря `defineErrors` дополнительно к стандартным 400/401/403/422/429. */
    readonly errors?: readonly string[];
    /** Поля операции OpenAPI, которые генерация не выражает (SSE, сырой прокси); сливаются глубоко. */
    readonly extra?: Readonly<Record<string, unknown>>;
}

/** Включает маршрут в документ OpenAPI `verdeect-kit openapi`; маршрут без `@Api` в документ не попадает. */
export function Api(options: KitApiOptions): MethodDecorator {
    return SetMetadata(API_METADATA, options);
}
