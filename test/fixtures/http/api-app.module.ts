// Фикстура AC-3.7 (prd.md §3.5): модуль сервиса с @Api — список с keyset (envelope page, query PageQuerySchema),
// создание (тело, errors VERSION_CONFLICT), карточка по :id; класс под @UseGuards(VerdeectAuthGuard) +
// @RequireScope('items:read'); незащищённый маршрут; маршрут без @Api; @RequireTenant() (409 TENANT_REQUIRED, KT-17);
// наследование @Api от абстрактного базового контроллера и переопределение метода (KT-17); v1.24 — маршрут с
// errors: ['RATE_LIMITED'] (стандартные ошибки по факту). Приложение не создаётся.
import 'reflect-metadata';
import { Body, Controller, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequireScope, RequireTenant, VerdeectAuthGuard } from '@verdeect/auth/nest';
import { z } from 'zod';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import {
    Api,
    pageOf,
    PageQuerySchema,
    ZodValidationPipe,
    type Page,
} from '../../../src/http/index.js';

export const Item = z.object({ id: z.string(), title: z.string() });
export const CreateItem = z.strictObject({ title: z.string().min(1) });
export const ItemId = z.string().regex(/^item-\d+$/);

type ItemDto = z.output<typeof Item>;

const ITEMS: ItemDto[] = [
    { id: 'item-1', title: 'Первый' },
    { id: 'item-2', title: 'Второй' },
];

@Controller('items')
@UseGuards(VerdeectAuthGuard)
@RequireScope('items:read')
export class ItemsController {
    @Get()
    @Api({ summary: 'Список записей', response: Item, envelope: 'page' })
    list(
        @Query(new ZodValidationPipe(PageQuerySchema)) query: z.output<typeof PageQuerySchema>,
    ): Page<ItemDto> {
        return pageOf(ITEMS, query.limit, (item) => [item.id]);
    }

    @Post()
    @Api({ summary: 'Создать запись', response: Item, errors: ['VERSION_CONFLICT'] })
    create(@Body(new ZodValidationPipe(CreateItem)) body: z.output<typeof CreateItem>): ItemDto {
        return { id: 'item-3', title: body.title };
    }

    @Get(':id')
    @Api({ summary: 'Запись', response: Item })
    get(@Param('id', new ZodValidationPipe(ItemId)) id: string): ItemDto {
        return { id, title: 'Запись' };
    }
}

@Controller('public')
export class PublicController {
    @Get('info')
    @Api({ summary: 'Открытые сведения', response: z.object({ name: z.string() }) })
    info(): { name: string } {
        return { name: 'api-app' };
    }

    /** Лимитер у маршрута: 429 — только из errors (AC-3.7 v1.24). */
    @Get('limited')
    @Api({
        summary: 'Под лимитером',
        response: z.object({ ok: z.boolean() }),
        errors: ['RATE_LIMITED'],
    })
    limited(): { ok: true } {
        return { ok: true };
    }

    @Get('hidden')
    hidden(): { ok: true } {
        return { ok: true };
    }
}

@Controller('tenant')
@UseGuards(VerdeectAuthGuard)
export class TenantController {
    @Get('settings')
    @RequireTenant()
    @Api({ summary: 'Настройки компании', response: z.object({ tenant: z.string() }) })
    settings(): { tenant: string } {
        return { tenant: 'acme' };
    }
}

/** Базовый контроллер без @Controller: маршруты получают путь наследника (как у Nest). */
export abstract class BaseCatalogController {
    @Get('list')
    @Api({ summary: 'Каталог: список', response: Item, envelope: 'items' })
    list(): { items: ItemDto[] } {
        return { items: ITEMS };
    }

    @Get('count')
    @Api({ summary: 'Каталог: число записей (базовый)', response: z.object({ count: z.number() }) })
    count(): { count: number } {
        return { count: ITEMS.length };
    }
}

@Controller('catalog')
export class CatalogController extends BaseCatalogController {
    @Get('count')
    @Api({ summary: 'Каталог: число записей', response: z.object({ count: z.number() }) })
    override count(): { count: number } {
        return { count: ITEMS.length };
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: defineEnv({ ...envBase }) })],
    controllers: [ItemsController, PublicController, TenantController, CatalogController],
})
export class ApiAppModule {}
