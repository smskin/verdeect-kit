// createHttpApp (prd.md §3.5, AC-3.4, AC-3.5, AC-3.12; §3.2 шаги 2–3; KT-11, KT-15 п. 1). Эталоны: O/P main.ts (NestFactory,
// FastifyAdapter({genReqId}), bufferLogs, useLogger), P/O configure-http-server.ts + security-headers.ts (onRequest на
// reply.raw: nosniff, no-referrer), регистрация фильтра — KitHttpCoreModule. По PRD: участники KitLifecycle вместо
// enableShutdownHooks/InstanceShutdown — шаг 2 `http` (server.close Fastify), шаг 3 `nest` (исходный app.close Nest);
// app.close() экземпляра = lifecycle.close(); своих парсеров тела нет (общий лимит — bodyLimit адаптера, лимит маршрута — onRoute в configureFastify).
// v1.21 (BFF-58): securityHeaders 'api' | {referrerPolicy} | false (AC-3.5), exceptionFilter (AC-3.14), configureFastify
// до app.init() (AC-3.12).
import { Module, type DynamicModule, type ExceptionFilter, type Type } from '@nestjs/common';
import { NestApplication, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger as NestPinoLogger } from 'nestjs-pino';
import type { FastifyInstance } from 'fastify';
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
    /**
     * Заголовки безопасности: `'api'` (умолч.) — `nosniff`, `Referrer-Policy: no-referrer`; `{referrerPolicy}` — те же
     * с указанной политикой (неверная — `TypeError` до открытия порта); `false` — пакет их не ставит, ставит сервис.
     */
    readonly securityHeaders?: KitSecurityHeaders;
    /**
     * Фильтр ошибок сервиса: задан — `APP_FILTER` получает его вместо `KitExceptionFilter`. `KitExceptionFilter` остаётся
     * провайдером и внедряется; фильтр сервиса делегирует необработанное в `kit.catch(exception, host)`. Через фильтр
     * идут ошибки маршрутов Nest, 404 `ROUTE_NOT_FOUND` и ошибки хуков Fastify. Фильтр — провайдер глобального модуля
     * ядра: внедряются `KitExceptionFilter` и провайдеры глобальных модулей, провайдеры обычных модулей сервиса — нет.
     */
    readonly exceptionFilter?: Type<ExceptionFilter>;
    /**
     * Настройка Fastify один раз после создания адаптера и до регистрации маршрутов Nest (`app.init()`): хуки
     * `onRoute` (`routeOptions.bodyLimit` маршрута), парсеры, ранние плагины. Ошибка — отказ сборки (`failStartup` в
     * `bootstrapService`). Заголовки безопасности, `traceId`, `/ok` и фильтр ставит пакет.
     */
    readonly configureFastify?: (fastify: FastifyInstance) => void | Promise<void>;
}

/**
 * Опции HTTP по роли сервиса (§3.5, §3.8): один объект для `bootstrapService({http})` в `main.ts` и
 * `createTestApp({http})` в тестах.
 */
export type KitHttpOptions = Pick<
    KitHttpAppOptions,
    'bodyLimit' | 'securityHeaders' | 'exceptionFilter' | 'configureFastify'
>;

/** Заголовки безопасности `createHttpApp` (§3.5). */
export type KitSecurityHeaders = 'api' | { readonly referrerPolicy: KitReferrerPolicy } | false;

/** Стандартные значения `Referrer-Policy`. */
export type KitReferrerPolicy =
    | 'no-referrer'
    | 'no-referrer-when-downgrade'
    | 'origin'
    | 'origin-when-cross-origin'
    | 'same-origin'
    | 'strict-origin'
    | 'strict-origin-when-cross-origin'
    | 'unsafe-url';

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

const REFERRER_POLICIES: ReadonlySet<string> = new Set<KitReferrerPolicy>([
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
]);

/**
 * Заголовки безопасности API (P/O security-headers.ts): есть и на ошибках, `/ok` и 404; `false` — пусто.
 * @throws {TypeError} опция вне `'api' | {referrerPolicy} | false` или неверная политика.
 */
function securityHeadersOf(
    option: KitSecurityHeaders | undefined,
): readonly (readonly [string, string])[] {
    if (option === false) {
        return [];
    }
    let policy: string = 'no-referrer';
    if (option !== undefined && option !== 'api') {
        // boundary: опция приходит из JS сервиса, тип не гарантирован.
        const raw: unknown = (option as { referrerPolicy?: unknown } | null)?.referrerPolicy;
        if (typeof raw !== 'string' || !REFERRER_POLICIES.has(raw)) {
            throw new TypeError(
                `createHttpApp: securityHeaders.referrerPolicy «${String(raw)}» — не значение Referrer-Policy`,
            );
        }
        policy = raw;
    }

    return [
        ['X-Content-Type-Options', 'nosniff'],
        ['Referrer-Policy', policy],
    ];
}

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
function installServerHooks(
    app: NestFastifyApplication,
    headers: readonly (readonly [string, string])[],
): () => Promise<void> {
    const fastify = app.getHttpAdapter().getInstance();
    let closing = false;

    // Все хуки — до init: addHook после listen() бросает FST_ERR_INSTANCE_ALREADY_LISTENING.
    if (headers.length > 0) {
        fastify.addHook('onRequest', (_request, reply, done) => {
            for (const [name, value] of headers) {
                reply.raw.setHeader(name, value);
            }
            done();
        });
    }
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
    const headers = securityHeadersOf(options.securityHeaders);
    const root: DynamicModule = {
        module: KitHttpRootModule,
        imports: [
            options.module,
            KitHttpCoreModule.forRoot({
                service: options.service,
                logger: options.logger,
                redaction: options.redaction,
                exceptionFilter: options.exceptionFilter,
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

    const closeServer = installServerHooks(app, headers);
    installLifecycle(app, closeServer, logger);
    // После хуков пакета (заголовки на ответах хуков сервиса) и до регистрации маршрутов Nest (onRoute видит их все).
    if (options.configureFastify !== undefined) {
        await options.configureFastify(app.getHttpAdapter().getInstance());
        logger.debug('http: configureFastify выполнен');
    }

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    logger.debug(
        {
            service: options.service,
            bodyLimit: options.bodyLimit ?? null,
            securityHeaders: headers.length > 0,
            exceptionFilter: options.exceptionFilter?.name ?? 'KitExceptionFilter',
        },
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
