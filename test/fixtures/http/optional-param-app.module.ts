// Фикстура AC-3.7 (prd.md §3.5 v1.31): маршрут с необязательным параметром Fastify `:id?` — генерация OpenAPI
// отказывает с именем маршрута (CLI openapi → OPENAPI_FAILED, выход 1). Приложение не создаётся.
import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { z } from 'zod';
import { Api } from '../../../src/http/index.js';

@Controller('things')
export class OptionalParamController {
    @Get(':id?')
    @Api({ summary: 'Запись или список', response: z.object({ id: z.string() }) })
    find(): { id: string } {
        return { id: 'x' };
    }
}

@Module({ controllers: [OptionalParamController] })
export class OptionalParamAppModule {}
