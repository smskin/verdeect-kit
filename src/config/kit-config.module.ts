// KitConfigModule — обёртка над ConfigModule из @nestjs/config (prd.md §3.1 v1.7, NFR-3, AC-1.7);
// эталон — O app-config.module.ts. По PRD v1.13 (AC-1.7, AC-3.13): разбор — в фабрике `load` при сборке контекста, а не в
// `validate` при импорте AppModule; окружение из bootstrapService (takePreparsedEnv) не разбирается повторно;
// skipProcessEnv — ConfigService не читает process.env, в process.env ничего не пишется.
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { z } from 'zod';
import { KIT_ENV_SCHEMA, KIT_PARSED_ENV, takePreparsedEnv } from '../internal/preparsed-env.js';
import { parseEnv } from './parse-env.js';

/** Схема окружения: результат — объект ключей (его ожидает validate у ConfigModule). */
type EnvSchema = z.ZodType<Record<string, unknown>>;

/** Параметры KitConfigModule.forRoot. */
export interface KitConfigModuleOptions<S extends EnvSchema> {
    /** Схема окружения сервиса (обычно результат defineEnv). */
    readonly schema: S;
}

/** Глобальный модуль окружения; разбирает окружение при каждой сборке контекста Nest (AC-1.7). */
export class KitConfigModule {
    /**
     * Глобальный ConfigService с разобранным окружением. При запуске через `bootstrapService` окружение не
     * разбирается повторно; иначе — `parseEnv(schema, process.env)` при сборке контекста, ошибка —
     * `InvalidEnvironmentError`, сборка контекста отклоняется (сам `forRoot` не отклоняется). Файл `.env` не
     * читается, в `process.env` ничего не пишется, ConfigService читает только разобранные значения.
     */
    static async forRoot<S extends EnvSchema>(
        options: KitConfigModuleOptions<S>,
    ): Promise<DynamicModule> {
        const { schema } = options;
        // Постоянный токен провайдера разобранного окружения (по умолчанию @nestjs/config даёт случайный): createTestApp
        // подменяет его разбором объекта env той же схемой — фабрика с process.env не вызывается (§3.8 v1.25).
        // Пространство имён задаёт registerAs, не KEY: значения остаются в корне ConfigService.
        const load = Object.assign(
            () => takePreparsedEnv(schema) ?? parseEnv(schema, process.env),
            { KEY: KIT_PARSED_ENV },
        );
        const module = await ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            // Без validate @nestjs/config копирует process.env сам в себя; false — копии нет совсем.
            validatePredefined: false,
            skipProcessEnv: true,
            load: [load],
        });

        return {
            ...module,
            providers: [...(module.providers ?? []), { provide: KIT_ENV_SCHEMA, useValue: schema }],
            exports: [...(module.exports ?? []), KIT_ENV_SCHEMA],
        };
    }
}
