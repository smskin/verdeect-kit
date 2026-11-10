// createHttpApp (prd.md §3.5, AC-3.4, AC-3.5, AC-3.12; §3.2 шаги 2–3; KT-11, KT-15 п. 1). Эталоны: O/P main.ts (NestFactory,
// FastifyAdapter({genReqId}), bufferLogs, useLogger), P/O configure-http-server.ts + security-headers.ts (onRequest на
// reply.raw: nosniff, no-referrer), регистрация фильтра — KitHttpCoreModule. По PRD: участники KitLifecycle вместо
// enableShutdownHooks/InstanceShutdown — шаг 2 `http` (server.close Fastify), шаг 3 `nest` (исходный app.close Nest);
// app.close() экземпляра = lifecycle.close(); своих парсеров тела нет (лимит — bodyLimit адаптера и route.bodyLimit).
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { NestApplication, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger as NestPinoLogger } from 'nestjs-pino';
import type { Logger } from 'pino';
import { assertServiceName } from '../internal/service-name.js';
import { KIT_LOGGER } from '../internal/tokens.js';
import { KitLifecycle } from '../observability/lifecycle.js';
import { traceIdGenerator } from '../observability/logger-options.js';
import type { KitRedaction } from '../observability/redaction.js';
import { KitHttpCoreModule, type KitHttpLoggerOptions } from './kit-http-core.module.js';

/** Опции `createHttpApp` (§3.5). */
export interface KitHttpAppOptions {
    /** Корневой модуль сервиса; обязан импортировать `KitConfigModule.forRoot({schema})`. */
    readonly module: Type | DynamicModule;
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$`: поле `service` логов и метка метрик. */
    readonly service: string;
    /** Лимит тела запроса, байт; по умолчанию — лимит Fastify (1 MiB). Больше — 413 `PAYLOAD_TOO_LARGE`. */
    readonly bodyLimit?: number;
    /** Набор заголовков безопасности; единственный — `api` (`nosniff`, `Referrer-Policy: no-referrer`). */
    readonly securityHeaders?: 'api';
}

/** Сборка Nest-приложения на адаптере (createTestApp — через Test.createTestingModule). */
type Compile = (root: DynamicModule, adapter: FastifyAdapter) => Promise<NestFastifyApplication>;

/** Внутренние опции сборки: общие для createHttpApp, bootstrapService и createTestApp. */
export interface BuildHttpAppOptions extends KitHttpAppOptions {
    /** Опции логгера по роли сервиса. */
    readonly logger?: KitHttpLoggerOptions;
    /** Правила редактирования сервиса. */
    readonly redaction?: KitRedaction;
    /** Своя сборка приложения на корневом модуле и адаптере. */
    readonly compile?: Compile;
    /** Имя вызывающего для текста ошибки формата имени. */
    readonly caller?: string;
}

/** Заголовки безопасности API (P/O security-headers.ts): есть и на ошибках, `/ok` и 404. */
const API_SECURITY_HEADERS: readonly (readonly [string, string])[] = [
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
];

/** Корень приложения: модуль сервиса и ядро. */
@Module({})
class KitHttpRootModule {}

const defaultCompile: Compile = (root, adapter) =>
    NestFactory.create<NestFastifyApplication>(root, adapter, {
        bufferLogs: true,
        // С умолчанием true Nest при ошибке DI сам вызывает process.exit(1), минуя failStartup.
        abortOnError: false,
    });

/** Хуки Fastify и участник шага 2: заголовки, Connection: close и закрытие простаивающих соединений при остановке. */
function installServerHooks(app: NestFastifyApplication): () => Promise<void> {
    const fastify = app.getHttpAdapter().getInstance();
    let closing = false;

    // Все хуки — до init: addHook после listen() бросает FST_ERR_INSTANCE_ALREADY_LISTENING.
    fastify.addHook('onRequest', (_request, reply, done) => {
        for (const [name, value] of API_SECURITY_HEADERS) {
            reply.raw.setHeader(name, value);
        }
        done();
    });
    fastify.addHook('onSend', (_request, reply, _payload, done) => {
        if (closing) {
            void reply.header('Connection', 'close');
        }
        done();
    });
    fastify.addHook('onResponse', (_request, _reply, done) => {
        if (closing) {
            // keep-alive соединение, ответ на котором закончился после начала close(), иначе живёт до keepAliveTimeout.
            fastify.server.closeIdleConnections();
        }
        done();
    });

    return async () => {
        const server = fastify.server;
        if (!server.listening) {
            return;
        }
        closing = true;
        const closed = new Promise<void>((resolve, reject) => {
            server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        server.closeIdleConnections();
        await closed;
    };
}

/** Регистрирует участников шагов 2–3 и подменяет app.close() на lifecycle.close(). */
function installLifecycle(
    app: NestFastifyApplication,
    closeServer: () => Promise<void>,
    logger: Logger,
): void {
    const lifecycle = app.get(KitLifecycle);
    lifecycle.register(
        {
            name: 'http',
            stop: async () => {
                const startedAt = performance.now();
                await closeServer();
                logger.debug(
                    { durationMs: Math.round(performance.now() - startedAt) },
                    'http: приём соединений остановлен',
                );
            },
        },
        { step: 2 },
    );
    logger.debug({ participant: 'http' }, 'http: участник шага 2 зарегистрирован');
    lifecycle.register(
        {
            name: 'nest',
            // Исходный close — с прототипа: app.close уже подменён и ждал бы сам себя.
            stop: async () => {
                await NestApplication.prototype.close.call(app);
                logger.debug('http: хуки Nest завершены');
            },
        },
        { step: 3 },
    );
    // Присваивание не работает: set-ловушка прокси NestFactory не сохраняет значение; defineProperty уходит в цель.
    Object.defineProperty(app, 'close', {
        value: () => lifecycle.close(),
        configurable: true,
        writable: true,
    });
}

/** Внутренняя сборка приложения: «тот же createHttpApp» для bootstrapService и createTestApp (§3.8). */
export async function buildHttpApp(options: BuildHttpAppOptions): Promise<NestFastifyApplication> {
    assertServiceName(options.service, options.caller ?? 'createHttpApp');
    const root: DynamicModule = {
        module: KitHttpRootModule,
        imports: [
            options.module,
            KitHttpCoreModule.forRoot({
                service: options.service,
                logger: options.logger,
                redaction: options.redaction,
            }),
        ],
    };
    const adapter = new FastifyAdapter({
        genReqId: traceIdGenerator(options.logger?.trustTraceparent !== false),
        ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
    });
    const app = await (options.compile ?? defaultCompile)(root, adapter);
    app.useLogger(app.get(NestPinoLogger));
    const logger = app.get<Logger>(KIT_LOGGER);

    const closeServer = installServerHooks(app);
    installLifecycle(app, closeServer, logger);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    logger.debug(
        { service: options.service, bodyLimit: options.bodyLimit ?? null },
        'http: приложение собрано',
    );

    return app;
}

/**
 * Fastify-приложение Nest сервиса (§3.5): заголовки безопасности API, trace-id из `traceparent`, `GET /ok`, фильтр
 * `KitExceptionFilter`, 404 `ROUTE_NOT_FOUND`, логгер nestjs-pino, `KitLifecycle` и `HealthRegistry` для модулей сервиса.
 * `app.close()` — программная остановка по шагам 1–5 (§3.2) без сторожа и `exit`. Процесс сервиса запускает
 * `bootstrapService`; `createHttpApp` — для своих точек входа и тестов.
 */
export function createHttpApp(options: KitHttpAppOptions): Promise<NestFastifyApplication> {
    return buildHttpApp(options);
}
