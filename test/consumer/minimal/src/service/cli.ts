// CLI сервиса-потребителя (AC-2.15; prd.md §3.2 стр. 86 v1.31) — эталон примера README «CLI сервиса»: контекст без HTTP с
// ядром KitCoreModule({entry: 'cli'}), отказ запуска (неверное окружение, недоступная БД) — failStartup: JSON-строка fatal
// в stderr и выход 1. logger: false — статический логгер Nest не пишет ни ошибку зоны исключений, ни записи Nest Logger
// модулей (решение плана rc.10, R17 (а)); abortOnError: false — ошибка сборки приходит в catch, а не в process.exit Nest.
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KitConfigModule } from '@verdeect/kit/config';
import { KitDatabaseModule } from '@verdeect/kit/database';
import { KitMessagingModule } from '@verdeect/kit/messaging';
import { failStartup, KitCoreModule } from '@verdeect/kit/observability';
import { pino } from 'pino';
import { serviceEnvSchema } from './env.js';
import { messagingOptions } from './messaging-options.js';
import * as schema from './schema.js';

@Module({
    imports: [
        KitConfigModule.forRoot({ schema: serviceEnvSchema }),
        KitCoreModule.forRoot({ service: 'consumer', entry: 'cli' }),
        KitDatabaseModule.forRoot({ schema }),
        KitMessagingModule.forRoot({ ...messagingOptions, listen: false }),
    ],
})
class CliModule {}

try {
    const ctx = await NestFactory.createApplicationContext(CliModule, {
        logger: false,
        abortOnError: false,
    });
    await ctx.init();
    // Работа команды — здесь; затем остановка контекста.
    await ctx.close();
} catch (error) {
    await failStartup(error, pino({ level: 'info' }, pino.destination(2)));
}
