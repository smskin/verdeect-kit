// KitCoreModule — ядро пакета вне HTTP (prd.md §3.2 v1.25, AC-2.15): окружение ядра из KitConfigModule, логгер pino
// экземпляра (entry 'cli' — stderr), HealthRegistry, KitLifecycle, kitMetrics и KIT_METRICS. KitHttpCoreModule
// импортирует его сам (createHttpApp, bootstrapService не меняются); контекст CLI сервиса подключает его явно. Сервер
// метрик и /health поднимает только bootstrapService — в режиме 'cli' их нет по построению.
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pino, type Logger } from 'pino';
import type { KitBaseEnv } from '../config/fragments.js';
import { KIT_LOGGER, KIT_METRICS, KIT_PACKAGE_METRICS } from '../internal/tokens.js';
import { HealthRegistry } from './health-registry.js';
import { KitLifecycle } from './lifecycle.js';
import {
    createLoggerOptions,
    type KitLoggerOptions,
    type KitLoggerParams,
} from './logger-options.js';
import { kitMetrics, type KitMetrics } from './metrics.js';
import type { KitRedaction } from './redaction.js';

/** Опции логгера по роли сервиса (§3.5): общие у `bootstrapService`, `createTestApp` и `KitCoreModule`. */
export type KitCoreLoggerOptions = Pick<
    KitLoggerOptions,
    'trustTraceparent' | 'quietRoutes' | 'extraBase'
>;

/** Опции ядра пакета. */
export interface KitCoreModuleOptions {
    /** Имя сервиса (экземпляра) — метка `service` метрик и поле `service` лога. */
    readonly service: string;
    /** Точка входа: `http` — приложение (`createHttpApp`), `cli` — команда сервиса (лог в stderr). */
    readonly entry: 'http' | 'cli';
    /** Опции логгера по роли сервиса. */
    readonly logger?: KitCoreLoggerOptions;
    /** Правила редактирования сервиса (общие с `initSentry`). */
    readonly redaction?: KitRedaction;
}

/** Ключи окружения, которые читает ядро. */
type CoreEnv = Pick<
    KitBaseEnv,
    'LOG_LEVEL' | 'REPLICA_ID' | 'SHUTDOWN_TIMEOUT_MS' | 'SHUTDOWN_DRAIN_MS'
>;

const CORE_ENV = Symbol('KIT_CORE_ENV');

/** @internal Параметры логгера ядра: журнал доступа `KitHttpCoreModule` строится на них. */
export const KIT_LOGGER_PARAMS = Symbol('KIT_LOGGER_PARAMS');

function coreEnv(config: ConfigService | null | undefined, entry: string): CoreEnv {
    if (config === null || config === undefined) {
        throw new Error(
            `${entry === 'http' ? 'createHttpApp' : 'KitCoreModule'}: модуль сервиса не импортирует KitConfigModule.forRoot({schema})`,
        );
    }

    return {
        LOG_LEVEL: config.getOrThrow('LOG_LEVEL'),
        REPLICA_ID: config.getOrThrow('REPLICA_ID'),
        SHUTDOWN_TIMEOUT_MS: config.getOrThrow('SHUTDOWN_TIMEOUT_MS'),
        SHUTDOWN_DRAIN_MS: config.getOrThrow('SHUTDOWN_DRAIN_MS'),
    };
}

/**
 * Глобальный модуль ядра пакета: `KitLifecycle`, `HealthRegistry`, `KIT_METRICS`, логгер. Модули пакета (`/database`,
 * `/messaging`, `/redis`, `/idempotency`, лимитер) требуют его — без ядра ошибка при сборке контекста. Требует
 * `KitConfigModule`.
 */
@Module({})
export class KitCoreModule {
    /** Ядро одного экземпляра (приложения или команды CLI). */
    static forRoot(options: KitCoreModuleOptions): DynamicModule {
        return {
            module: KitCoreModule,
            global: true,
            providers: [
                {
                    provide: CORE_ENV,
                    useFactory: (config?: ConfigService) => coreEnv(config, options.entry),
                    inject: [{ token: ConfigService, optional: true }],
                },
                {
                    provide: KIT_LOGGER_PARAMS,
                    useFactory: (env: CoreEnv): KitLoggerParams =>
                        createLoggerOptions({
                            ...options.logger,
                            service: options.service,
                            entry: options.entry,
                            env,
                            redaction: options.redaction,
                        }),
                    inject: [CORE_ENV],
                },
                {
                    provide: KIT_LOGGER,
                    useFactory: (params: KitLoggerParams): Logger => pino(...params.pinoHttp),
                    inject: [KIT_LOGGER_PARAMS],
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
                    useFactory: (): KitMetrics => kitMetrics({ service: options.service }),
                },
                {
                    provide: KIT_METRICS,
                    useFactory: (metrics: KitMetrics) => metrics.registry,
                    inject: [KIT_PACKAGE_METRICS],
                },
            ],
            exports: [
                KitLifecycle,
                HealthRegistry,
                KIT_PACKAGE_METRICS,
                KIT_METRICS,
                KIT_LOGGER,
                KIT_LOGGER_PARAMS,
            ],
        };
    }
}
