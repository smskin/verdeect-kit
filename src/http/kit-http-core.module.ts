// KitHttpCoreModule — внутренний глобальный модуль ядра createHttpApp (prd.md §3.2, §3.5; KT-11, KT-15 п. 2): логгер pino
// экземпляра, HealthRegistry, KitLifecycle, kitMetrics, KitExceptionFilter, nestjs-pino и GET /ok. Эталоны — O
// get-ok.controller.ts (/ok, no-store), регистрация фильтра APP_FILTER (O/I/P app.module.ts), O observability.module.ts
// (LoggerModule на опциях createLoggerOptions). По PRD: окружение — из ConfigService модуля сервиса (KitConfigModule),
// его нет — Error при сборке.
import { Controller, Get, Header, Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule, type Params } from 'nestjs-pino';
import { pino, type Logger } from 'pino';
import type { KitBaseEnv } from '../config/fragments.js';
import { KIT_LOGGER, KIT_METRICS, KIT_PACKAGE_METRICS } from '../internal/tokens.js';
import { HealthRegistry } from '../observability/health-registry.js';
import { KitLifecycle } from '../observability/lifecycle.js';
import {
    createLoggerOptions,
    type KitLoggerOptions,
    type KitLoggerParams,
} from '../observability/logger-options.js';
import { kitMetrics, type KitMetrics } from '../observability/metrics.js';
import type { KitRedaction } from '../observability/redaction.js';
import { KitExceptionFilter } from './kit-exception.filter.js';

/** Опции логгера по роли сервиса (§3.5). */
export type KitHttpLoggerOptions = Pick<
    KitLoggerOptions,
    'trustTraceparent' | 'quietRoutes' | 'extraBase'
>;

/** Опции ядра HTTP. */
export interface KitHttpCoreOptions {
    /** Имя сервиса (уже проверено вызывающим). */
    readonly service: string;
    /** Опции логгера по роли сервиса. */
    readonly logger?: KitHttpLoggerOptions;
    /** Правила редактирования сервиса. */
    readonly redaction?: KitRedaction;
}

/** Ключи окружения, которые читает ядро. */
type CoreEnv = Pick<
    KitBaseEnv,
    'LOG_LEVEL' | 'REPLICA_ID' | 'SHUTDOWN_TIMEOUT_MS' | 'SHUTDOWN_DRAIN_MS'
>;

const CORE_ENV = Symbol('KIT_HTTP_CORE_ENV');
const LOGGER_PARAMS = Symbol('KIT_HTTP_LOGGER_PARAMS');

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

function coreEnv(config: ConfigService | null | undefined): CoreEnv {
    if (config === null || config === undefined) {
        throw new Error(
            'createHttpApp: модуль сервиса не импортирует KitConfigModule.forRoot({schema})',
        );
    }

    return {
        LOG_LEVEL: config.getOrThrow('LOG_LEVEL'),
        REPLICA_ID: config.getOrThrow('REPLICA_ID'),
        SHUTDOWN_TIMEOUT_MS: config.getOrThrow('SHUTDOWN_TIMEOUT_MS'),
        SHUTDOWN_DRAIN_MS: config.getOrThrow('SHUTDOWN_DRAIN_MS'),
    };
}

/** Внутренний глобальный модуль ядра; подключает его `createHttpApp`. */
@Module({})
export class KitHttpCoreModule {
    /** Ядро одного экземпляра приложения; экспортирует KitLifecycle, HealthRegistry, KIT_PACKAGE_METRICS, KIT_METRICS, KIT_LOGGER. */
    static forRoot(options: KitHttpCoreOptions): DynamicModule {
        const loggerParams = {
            provide: LOGGER_PARAMS,
            useFactory: (env: CoreEnv): KitLoggerParams =>
                createLoggerOptions({
                    ...options.logger,
                    service: options.service,
                    entry: 'http',
                    env,
                    redaction: options.redaction,
                }),
            inject: [CORE_ENV],
        };

        return {
            module: KitHttpCoreModule,
            global: true,
            imports: [
                // Ограничение: nestjs-pino 5.3 держит один pino-http на процесс (rootLogger.js) — журнал доступа второго
                // приложения в том же процессе (тесты) идёт с опциями первого; логгер ядра (KIT_LOGGER) — свой у каждого.
                // README, «Один журнал доступа на процесс».
                LoggerModule.forRootAsync({
                    useFactory: (params: KitLoggerParams, logger: Logger): Params => ({
                        pinoHttp: [{ ...params.pinoHttp[0], logger }, params.pinoHttp[1]],
                    }),
                    inject: [LOGGER_PARAMS, KIT_LOGGER],
                }),
            ],
            controllers: [KitOkController],
            providers: [
                {
                    provide: CORE_ENV,
                    useFactory: coreEnv,
                    inject: [{ token: ConfigService, optional: true }],
                },
                loggerParams,
                {
                    provide: KIT_LOGGER,
                    useFactory: (params: KitLoggerParams): Logger => pino(...params.pinoHttp),
                    inject: [LOGGER_PARAMS],
                },
                {
                    provide: HealthRegistry,
                    useFactory: (logger: Logger) => new HealthRegistry({ logger }),
                    inject: [KIT_LOGGER],
                },
                {
                    provide: KitLifecycle,
                    useFactory: (logger: Logger, health: HealthRegistry, env: CoreEnv) =>
                        new KitLifecycle({ logger, health, env }),
                    inject: [KIT_LOGGER, HealthRegistry, CORE_ENV],
                },
                {
                    provide: KIT_PACKAGE_METRICS,
                    useFactory: () => kitMetrics({ service: options.service }),
                },
                {
                    provide: KIT_METRICS,
                    useFactory: (metrics: KitMetrics) => metrics.registry,
                    inject: [KIT_PACKAGE_METRICS],
                },
                { provide: APP_FILTER, useClass: KitExceptionFilter },
            ],
            exports: [
                KitLifecycle,
                HealthRegistry,
                KIT_PACKAGE_METRICS,
                KIT_METRICS,
                KIT_LOGGER,
                LOGGER_PARAMS,
            ],
        };
    }
}
