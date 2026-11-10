// bootstrapService — точка входа main.ts сервиса (prd.md §3.5, AC-3.10–AC-3.13, UC-3, UC-8; KT-11, KT-14, KT-15 п. 1–2).
// Эталон — O main.ts: failStartup с запасным логгером, listen(port, '0.0.0.0'), лог «слушает». По PRD: порядок шагов
// §3.5 (окружение до создания приложения, логгер, SENTRY_NOT_PRELOADED, createHttpApp, участники KitLifecycle,
// прослушивание PORT), сервер метрик — участник шага 5, сигналы ОС — только KitLifecycle.listen() (enableShutdownHooks
// не вызывается).
import type { DynamicModule, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as Sentry from '@sentry/nestjs';
import { pino, type Logger } from 'pino';
import { z } from 'zod';
import { envSentry, type KitBaseEnv } from '../config/fragments.js';
import { parseEnv } from '../config/parse-env.js';
import { setPreparsedEnv } from '../internal/preparsed-env.js';
import { assertServiceName } from '../internal/service-name.js';
import { KIT_METRICS } from '../internal/tokens.js';
import { failStartup } from '../observability/fail-startup.js';
import { HealthRegistry } from '../observability/health-registry.js';
import { KitLifecycle } from '../observability/lifecycle.js';
import { createLoggerOptions } from '../observability/logger-options.js';
import { MetricsServer } from '../observability/metrics-server.js';
import type { KitMetrics } from '../observability/metrics.js';
import { redactPaths, type KitRedaction } from '../observability/redaction.js';
import { isValidDsn } from '../observability/sentry.js';
import { buildHttpApp } from './create-http-app.js';
import type { KitHttpLoggerOptions } from './kit-http-core.module.js';

/** Схема окружения сервиса: результат содержит ключи `envBase`. */
type ServiceEnvSchema = z.ZodType<KitBaseEnv & Record<string, unknown>>;

/** Опции `bootstrapService` (§3.5). */
export interface KitBootstrapOptions<S extends ServiceEnvSchema = ServiceEnvSchema> {
    /** Корневой модуль сервиса; импортирует `KitConfigModule.forRoot({schema: env})` с той же схемой. */
    readonly module: Type | DynamicModule;
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$`; вне формата — отказ запуска. */
    readonly service: string;
    /** Схема окружения (`defineEnv`): разбирается до создания приложения. */
    readonly env: S;
    /** Опции логгера по роли: BFF — `trustTraceparent: false`; P, O — `quietRoutes`. */
    readonly logger?: KitHttpLoggerOptions;
    /** Опции HTTP: `bodyLimit` — лимит тела, байт (по умолчанию — лимит Fastify). */
    readonly http?: { readonly bodyLimit?: number };
    /** Правила редактирования сервиса (общие с `initSentry` в `instrument.ts`). */
    readonly redaction?: KitRedaction;
}

/** Sentry не подключён через `--import instrument`, хотя конфигурация верна и он должен был включиться (§3.5, AC-3.11). */
function sentryNotPreloaded(): boolean {
    // Окружение Sentry — как в initSentry: схема сервиса может не содержать envSentry.
    const parsed = z.object(envSentry).safeParse(process.env);

    return (
        parsed.success &&
        parsed.data.SENTRY_DSN !== null &&
        // Неверный DSN initSentry выключает намеренно (AC-2.4): предупреждать не о чем.
        isValidDsn(parsed.data.SENTRY_DSN) &&
        parsed.data.NODE_ENV === 'production' &&
        Sentry.getClient() === undefined
    );
}

/** Фактический порт HTTP-сервера приложения (в тестах PORT=0). */
function httpPort(app: NestFastifyApplication): number | null {
    const address: unknown = app.getHttpServer().address();
    if (typeof address !== 'object' || address === null || !('port' in address)) {
        return null;
    }

    return typeof address.port === 'number' ? address.port : null;
}

/**
 * Точка входа `main.ts` сервиса (§3.5): `parseEnv(env, process.env)` до создания приложения → логгер →
 * предупреждение `SENTRY_NOT_PRELOADED` → `createHttpApp` → сервер метрик (`METRICS_PORT`, шаг 5) →
 * `KitLifecycle.listen()` (SIGTERM, SIGINT) → прослушивание `PORT` на `0.0.0.0`. Отказ на любом шаге — `failStartup`
 * (`fatal`, GlitchTip, `exit(1)`): при неверном окружении приложение не создаётся и порт не открывается.
 */
export async function bootstrapService<S extends ServiceEnvSchema>(
    options: KitBootstrapOptions<S>,
): Promise<NestFastifyApplication> {
    // 1. Запасной логгер: отказ до разбора окружения тоже пишется JSON в stdout.
    let logger: Logger = pino(
        {
            level: 'info',
            base: { service: options.service, entry: 'http' },
            redact: { paths: redactPaths(options.redaction), censor: '[Filtered]' },
        },
        process.stdout,
    );
    let env: KitBaseEnv & Record<string, unknown>;
    try {
        // 2. Имя сервиса.
        assertServiceName(options.service, 'bootstrapService');
        // 3. Окружение до создания приложения (AC-3.13).
        env = parseEnv(options.env, process.env);
        // 4. KitConfigModule того же процесса берёт разобранное окружение без повторного разбора.
        setPreparsedEnv(options.env, env);
        // 5. Логгер сервиса.
        logger = pino(
            ...createLoggerOptions({
                ...options.logger,
                service: options.service,
                entry: 'http',
                env,
                redaction: options.redaction,
            }).pinoHttp,
        );
    } catch (error) {
        return failStartup(error, logger);
    }
    logger.debug('bootstrap: окружение разобрано');

    // 6. Sentry инициализируется в instrument.ts до загрузки приложения (AC-3.11).
    if (sentryNotPreloaded()) {
        logger.warn(
            { code: 'SENTRY_NOT_PRELOADED' },
            'Sentry не подключён: запустите сервис с node --import ./dist/instrument.js',
        );
    }

    try {
        // 7. Приложение: участники шагов 2 (http) и 3 (nest) KitLifecycle регистрирует buildHttpApp.
        const app = await buildHttpApp({
            module: options.module,
            service: options.service,
            bodyLimit: options.http?.bodyLimit,
            logger: options.logger,
            redaction: options.redaction,
            caller: 'bootstrapService',
        });
        logger.debug('bootstrap: приложение собрано');

        // 8. Сервер метрик — участник шага 5.
        const lifecycle = app.get(KitLifecycle);
        const metricsServer = new MetricsServer({
            port: env.METRICS_PORT,
            registry: app.get<KitMetrics>(KIT_METRICS).registry,
            health: app.get(HealthRegistry),
            logger,
        });
        await metricsServer.listen();
        lifecycle.register({ name: 'metrics', stop: () => metricsServer.close() }, { step: 5 });
        logger.debug('bootstrap: метрики слушают');

        // 9. Сигналы ОС — только KitLifecycle: сторож срока и exit.
        lifecycle.listen();

        // 10. Прослушивание PORT.
        await app.listen(env.PORT, '0.0.0.0');

        // 11. Фактические порты: в тестах PORT=0 и METRICS_PORT=0.
        logger.info(
            { port: httpPort(app), metricsPort: metricsServer.address() },
            'сервис слушает',
        );

        return app;
    } catch (error) {
        return failStartup(error, logger);
    }
}
