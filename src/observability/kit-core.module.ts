// KitCoreModule — ядро пакета вне HTTP (prd.md §3.2 v1.25, AC-2.15): окружение ядра из KitConfigModule, логгер pino
// экземпляра (entry 'cli' — stderr), HealthRegistry, KitLifecycle, kitMetrics и KIT_METRICS. KitHttpCoreModule
// импортирует его сам (createHttpApp, bootstrapService не меняются); контекст CLI сервиса подключает его явно. Сервер
// метрик и /health поднимает только bootstrapService — в режиме 'cli' их нет по построению.
// Без импорта @nestjs/* во время выполнения (§3.2: /observability грузится в instrument.ts до приложения): класс модуля
// без декоратора (метаданные — в DynamicModule), окружение — провайдер разобранного окружения KitConfigModule.
import type { DynamicModule } from '@nestjs/common';
import { pino, type Logger } from 'pino';
import { KIT_PARSED_ENV } from '../internal/preparsed-env.js';
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

function coreEnv(
    env: Readonly<Record<string, unknown>> | null | undefined,
    entry: string,
): CoreEnv {
    if (env === null || env === undefined) {
        throw new Error(
            `${entry === 'http' ? 'createHttpApp' : 'KitCoreModule'}: модуль сервиса не импортирует KitConfigModule.forRoot({schema})`,
        );
    }

    const value = <K extends keyof CoreEnv>(key: K): CoreEnv[K] => {
        if (env[key] === undefined) {
            throw new Error(
                `${entry === 'http' ? 'createHttpApp' : 'KitCoreModule'}: в схеме окружения нет ${key} (envBase)`,
            );
        }

        return env[key] as CoreEnv[K];
    };

    return {
        LOG_LEVEL: value('LOG_LEVEL'),
        REPLICA_ID: value('REPLICA_ID'),
        SHUTDOWN_TIMEOUT_MS: value('SHUTDOWN_TIMEOUT_MS'),
        SHUTDOWN_DRAIN_MS: value('SHUTDOWN_DRAIN_MS'),
    };
}

/**
 * Глобальный модуль ядра пакета: `KitLifecycle`, `HealthRegistry`, `KIT_METRICS`, логгер. Модули пакета (`/database`,
 * `/messaging`, `/redis`, `/idempotency`, лимитер) требуют его — без ядра ошибка при сборке контекста. Требует
 * `KitConfigModule`.
 */
export class KitCoreModule {
    /** Ядро одного экземпляра (приложения или команды CLI). */
    static forRoot(options: KitCoreModuleOptions): DynamicModule {
        return {
            module: KitCoreModule,
            global: true,
            providers: [
                {
                    provide: CORE_ENV,
                    useFactory: (env?: Readonly<Record<string, unknown>>) =>
                        coreEnv(env, options.entry),
                    inject: [{ token: KIT_PARSED_ENV, optional: true }],
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
