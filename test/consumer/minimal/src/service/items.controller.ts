// Маршрут потребителя с @Api (AC-3.8, AC-9.1): keyset pageOf по массиву в памяти; снимок — contracts/openapi.json.
import { Controller, Get, Query } from '@nestjs/common';
import {
    Api,
    decodeCursor,
    pageOf,
    PageQuerySchema,
    ZodValidationPipe,
    type Page,
} from '@verdeect/kit/http';
import { z } from 'zod';

export const Item = z.object({ id: z.string(), title: z.string() });
type ItemDto = z.output<typeof Item>;

const ITEMS: ItemDto[] = [
    { id: 'item-1', title: 'Первая' },
    { id: 'item-2', title: 'Вторая' },
    { id: 'item-3', title: 'Третья' },
];

@Controller('items')
export class ItemsController {
    @Get()
    @Api({ summary: 'Список записей', response: Item, envelope: 'page' })
    list(
        @Query(new ZodValidationPipe(PageQuerySchema)) query: z.output<typeof PageQuerySchema>,
    ): Page<ItemDto> {
        const keys = decodeCursor(query.cursor, 1);
        const start = keys === null ? 0 : ITEMS.findIndex((item) => item.id === keys[0]) + 1;

        return pageOf(ITEMS.slice(start, start + query.limit + 1), query.limit, (item) => [
            item.id,
        ]);
    }
}
