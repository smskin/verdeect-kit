// createLoggerOptions — опции nestjs-pino (prd.md §3.2, AC-2.1, AC-2.2, AC-2.12, NFR-4, NFR-8). Эталон — O
// observability.module.ts (requestId, serializeRequest, pinoOptions, accessLogLevel, httpLoggerOptions, stdout/stderr);
// trustTraceparent: false и trace-id 32 hex — B observability.module.ts (randomBytes(16)); quietRoutes — P accessLogLevel
// (QUIET_ACCESS_PREFIX). Окружение передаёт вызывающий (KitBaseEnv §3.1), своего process.env здесь нет.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { DestinationStream, LevelWithSilent } from 'pino';
import type { KitBaseEnv } from '../config/fragments.js';
import { assertServiceName } from '../internal/service-name.js';
import { maskPathOf, redactPaths, type KitRedaction } from './redaction.js';
import { sanitizeLogObject, serializeError } from './sanitize-error.js';

/** Опции `createLoggerOptions` (§3.2). */
export interface KitLoggerOptions {
    /** Имя сервиса (`^[a-z][a-z0-9-]{1,31}$`) — поле `service` каждой строки. */
    readonly service: string;
    /** Точка входа: `http` — stdout и журнал доступа, `cli` — stderr без журнала доступа. */
    readonly entry: 'http' | 'cli';
    /** Разобранные ключи окружения: уровень лога и имя реплики (§3.1). */
    readonly env: Pick<KitBaseEnv, 'REPLICA_ID' | 'LOG_LEVEL'>;
    /** `false` — входящий `traceparent` игнорируется, trace-id всегда новый (роль BFF); по умолчанию — доверять. */
    readonly trustTraceparent?: boolean;
    /** Префиксы пути: успешный ответ пишется на `debug`, ошибка и статус ≥ 400 — как обычно. */
    readonly quietRoutes?: readonly string[];
    /** Дополнительные поля `base`. */
    readonly extraBase?: Readonly<Record<string, unknown>>;
    /** Правила редактирования сервиса (общие с `initSentry`). */
    readonly redaction?: KitRedaction;
}

type PinoHttpOptions = Extract<NonNullable<Params['pinoHttp']>, readonly unknown[]>[0];

/**
 * Генератор trace-id: читает только заголовки, поэтому подходит и pino-http (`(req, res) => ReqId`), и адаптеру
 * Fastify (`(req: IncomingMessage | Http2ServerRequest) => string`).
 */
type TraceIdGenerator = (req: Pick<IncomingMessage, 'headers'>) => string;

/**
 * Результат `createLoggerOptions`: `Params` nestjs-pino с кортежем `[options, stream]`. Логгер вне Nest —
 * `pino(...params.pinoHttp)`; генератор trace-id для адаптера — `params.pinoHttp[0].genReqId`.
 */
export type KitLoggerParams = Omit<Params, 'pinoHttp'> & {
    /** Опции pino-http и поток: `process.stdout` (http) или `process.stderr` (cli). */
    readonly pinoHttp: [
        Omit<PinoHttpOptions, 'genReqId'> & { genReqId: TraceIdGenerator },
        DestinationStream,
    ];
};

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;
const HEALTHCHECK_PATH = '/ok';

/** Путь без query. */
function pathOf(url: unknown): string {
    return typeof url === 'string' ? (url.split('?', 1)[0] ?? '') : '';
}

/**
 * Путь запроса в middleware: на Fastify middie на время middleware заменяет `req.url` путём относительно точки
 * монтирования, исходный — в `originalUrl`.
 */
function requestPath(req: IncomingMessage & { originalUrl?: unknown }): string {
    return pathOf(req.originalUrl ?? req.url);
}

/** Новый trace-id W3C: 32 hex. */
function newTraceId(): string {
    return randomBytes(16).toString('hex');
}

/** trace-id из `traceparent` (если доверяем) или новый. */
function traceIdGenerator(trust: boolean): TraceIdGenerator {
    return (req) => {
        if (!trust) {
            return newTraceId();
        }
        const header = req.headers.traceparent;
        const match = typeof header === 'string' ? TRACEPARENT.exec(header.trim()) : null;

        return match?.[1] ?? newTraceId();
    };
}

/** Уровень строки доступа: ошибка или статус ≥ 400 → info; успешный ответ «тихого» маршрута → debug. */
function accessLogLevel(
    quietRoutes: readonly string[],
): (req: IncomingMessage, res: ServerResponse, err?: Error) => LevelWithSilent {
    return (req, res, err) => {
        if (err !== undefined || res.statusCode >= 400) {
            return 'info';
        }
        const path = requestPath(req);

        return quietRoutes.some((prefix) => path.startsWith(prefix)) ? 'debug' : 'info';
    };
}

/**
 * Опции nestjs-pino сервиса (§3.2): `base: {service, entry, replica}`, редактирование `SENSITIVE_KEYS` ∪
 * `redaction.sensitiveKeys` на уровнях 0–2, `err` через `sanitizeError`, путь запроса без query и через `maskPath`,
 * `traceId` в каждой строке запроса, `/ok` вне журнала доступа, `quietRoutes` — на `debug`.
 *
 * На Fastify `genReqId` из `pinoHttp` не вызывается: Fastify ставит свой `request.id`, а pino-http оставляет уже
 * заданный (`req.id = req.id || genReqId(…)`). Поэтому HTTP-адаптер получает тот же генератор:
 * `new FastifyAdapter({genReqId: params.pinoHttp[0].genReqId})` (в E3 это сделает `createHttpApp`).
 */
export function createLoggerOptions(options: KitLoggerOptions): KitLoggerParams {
    assertServiceName(options.service, 'createLoggerOptions');
    const maskPath = maskPathOf(options.redaction);
    const http = options.entry === 'http';

    return {
        pinoHttp: [
            {
                level: options.env.LOG_LEVEL,
                base: {
                    service: options.service,
                    entry: options.entry,
                    replica: options.env.REPLICA_ID,
                    ...options.extraBase,
                },
                redact: { paths: redactPaths(options.redaction), censor: '[Filtered]' },
                // formatters.log видит исходный err (с cause), сериализатор — уже сериализованный pino-http.
                formatters: { log: sanitizeLogObject },
                serializers: {
                    err: serializeError,
                    req: (req: { id?: unknown; method?: unknown; url?: unknown }) => ({
                        id: req.id,
                        method: req.method,
                        url: maskPath(pathOf(req.url)),
                    }),
                },
                genReqId: traceIdGenerator(options.trustTraceparent !== false),
                customProps: (req: IncomingMessage & { id?: unknown }) => ({ traceId: req.id }),
                customLogLevel: accessLogLevel(options.quietRoutes ?? []),
                autoLogging: http
                    ? { ignore: (req: IncomingMessage) => requestPath(req) === HEALTHCHECK_PATH }
                    : false,
            },
            http ? process.stdout : process.stderr,
        ],
    };
}
