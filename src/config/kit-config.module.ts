// KitConfigModule — обёртка над ConfigModule из @nestjs/config (prd.md §3.1 v1.7, NFR-3, AC-1.7);
// эталон — O app-config.module.ts. Передача уже разобранного окружения из bootstrapService — E3 (§3.1).
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { z } from 'zod';
import { parseEnv } from './parse-env.js';

/** Схема окружения: результат — объект ключей (его ожидает validate у ConfigModule). */
type EnvSchema = z.ZodType<Record<string, unknown>>;

/** Параметры KitConfigModule.forRoot. */
export interface KitConfigModuleOptions<S extends EnvSchema> {
    /** Схема окружения сервиса (обычно результат defineEnv). */
    readonly schema: S;
}

/** Глобальный модуль окружения; перечитывает process.env при каждой сборке контекста Nest (AC-1.7). */
export class KitConfigModule {
    /**
     * Разбирает process.env схемой через parseEnv; ошибка — InvalidEnvironmentError, промис отклоняется.
     * Файл .env не читается, кэша нет (кэш сломал бы AC-1.7). Сервис внедряет ConfigService.
     *
     * Поведение @nestjs/config 12.0.1: с `validate` модуль дописывает в process.env каждый разобранный
     * ключ-строку, число или логическое значение, которого там ещё нет (умолчания METRICS_PORT,
     * REPLICA_ID, SHUTDOWN_*). ConfigService.get читает сначала разобранное значение. Поведение
     * совпадает с эталоном O и не отключается.
     */
    static forRoot<S extends EnvSchema>(
        options: KitConfigModuleOptions<S>,
    ): Promise<DynamicModule> {
        return ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            validate: (raw: Record<string, unknown>) => parseEnv(options.schema, raw),
        });
    }
}
