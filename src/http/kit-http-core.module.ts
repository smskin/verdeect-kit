// KitHttpCoreModule — внутренний глобальный модуль ядра createHttpApp (prd.md §3.2, §3.5; KT-11, KT-15 п. 2): импортирует
// KitCoreModule({entry: 'http'}) (логгер, HealthRegistry, KitLifecycle, kitMetrics — v1.25), KitExceptionFilter, nestjs-pino
// и GET /ok. Эталоны — O
// get-ok.controller.ts (/ok, no-store), регистрация фильтра APP_FILTER (O/I/P app.module.ts), O observability.module.ts
// (LoggerModule на опциях createLoggerOptions). По PRD: окружение — из ConfigService модуля сервиса (KitConfigModule),
// его нет — Error при сборке.
import {
    Controller,
    Get,
    Header,
    Module,
    type DynamicModule,
    type ExceptionFilter,
    type Type,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { Logger } from 'pino';
import { KIT_LOGGER } from '../internal/tokens.js';
import {
    KIT_LOGGER_PARAMS,
    KitCoreModule,
    type KitCoreLoggerOptions,
} from '../observability/kit-core.module.js';
import type { KitLoggerParams } from '../observability/logger-options.js';
import type { KitRedaction } from '../observability/redaction.js';
import { KitExceptionFilter } from './kit-exception.filter.js';

/** Опции логгера по роли сервиса (§3.5). */
export type KitHttpLoggerOptions = KitCoreLoggerOptions;

/** Опции ядра HTTP. */
export interface KitHttpCoreOptions {
    /** Имя сервиса (уже проверено вызывающим). */
    readonly service: string;
    /** Опции логгера по роли сервиса. */
    readonly logger?: KitHttpLoggerOptions;
    /** Правила редактирования сервиса. */
    readonly redaction?: KitRedaction;
    /** Фильтр ошибок сервиса вместо `KitExceptionFilter` в `APP_FILTER`; `KitExceptionFilter` внедряется в него. */
    readonly exceptionFilter?: Type<ExceptionFilter>;
}

/** Проба живости процесса (эталон O get-ok.controller.ts); вне журнала доступа и OpenAPI. */
@Controller()
class KitOkController {
    /** `200 {status: 'ok'}`, `Cache-Control: no-store`. */
    @Get('ok')
    @Header('Cache-Control', 'no-store')
    ok(): { status: 'ok' } {
        return { status: 'ok' };
    }
}

/** Внутренний глобальный модуль HTTP-части ядра; подключает его `createHttpApp`. */
@Module({})
export class KitHttpCoreModule {
    /**
     * HTTP-часть одного экземпляра приложения поверх `KitCoreModule({entry: 'http'})` (KitLifecycle, HealthRegistry,
     * KIT_PACKAGE_METRICS, KIT_METRICS, KIT_LOGGER — из ядра); экспортирует KitExceptionFilter.
     */
    static forRoot(options: KitHttpCoreOptions): DynamicModule {
        return {
            module: KitHttpCoreModule,
            global: true,
            imports: [
                KitCoreModule.forRoot({
                    service: options.service,
                    entry: 'http',
                    ...(options.logger === undefined ? {} : { logger: options.logger }),
                    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
                }),
                // Ограничение: nestjs-pino 5.3 держит один pino-http на процесс (rootLogger.js) — журнал доступа второго
                // приложения в том же процессе (тесты) идёт с опциями первого; логгер ядра (KIT_LOGGER) — свой у каждого.
                // README, «Один журнал доступа на процесс».
                LoggerModule.forRootAsync({
                    useFactory: (params: KitLoggerParams, logger: Logger): Params => ({
                        pinoHttp: [{ ...params.pinoHttp[0], logger }, params.pinoHttp[1]],
                    }),
                    inject: [KIT_LOGGER_PARAMS, KIT_LOGGER],
                }),
            ],
            controllers: [KitOkController],
            providers: [
                // Провайдер всегда: фильтр сервиса внедряет его и делегирует необработанное (AC-3.14).
                KitExceptionFilter,
                {
                    provide: APP_FILTER,
                    useExisting: options.exceptionFilter ?? KitExceptionFilter,
                },
                ...(options.exceptionFilter === undefined ? [] : [options.exceptionFilter]),
            ],
            exports: [KitExceptionFilter],
        };
    }
}
