// Помощники тестов логов /observability (prd.md §3.2, AC-2.1, AC-2.2, AC-2.12): сборщик строк pino, стенд Nest + Fastify
// (генератор trace-id — в адаптере, как в main.ts O, P, B) и стенд pino-http на Fastify без Nest.
// nestjs-pino держит один pino-http на процесс (rootLogger.js: первая конфигурация выигрывает), поэтому Nest-стенд
// поднимается один раз на файл; случаи с другой конфигурацией идут через стенд pino-http — тот же middleware, что
// монтирует nestjs-pino. Запросы — inject Fastify, без порта.
import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    Module,
    Post,
    Query,
    Redirect,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { pinoHttp } from 'pino-http';
import type { KitLoggerParams } from '../../../src/observability/index.js';

/** Окружение логгера тестов. */
export const LOGGER_ENV = { REPLICA_ID: 'replica-test', LOG_LEVEL: 'trace' } as const;

/** Сборщик строк pino. */
export interface Collector {
    readonly stream: DestinationStream;
    /** Весь вывод одной строкой. */
    text(): string;
    /** Разобранные строки JSON. */
    records(): Record<string, unknown>[];
    /** Очищает собранное. */
    clear(): void;
}

export function collector(): Collector {
    const lines: string[] = [];

    return {
        stream: { write: (line: string) => void lines.push(line) },
        text: () => lines.join(''),
        records: () =>
            lines
                .join('')
                .split('\n')
                .filter((line) => line.trim() !== '')
                .map((line) => JSON.parse(line) as Record<string, unknown>),
        clear: () => void lines.splice(0),
    };
}

/** Тот же кортеж с подменённым потоком. */
export function withStream(params: KitLoggerParams, stream: DestinationStream): KitLoggerParams {
    return { ...params, pinoHttp: [params.pinoHttp[0], stream] };
}

/** Строки журнала доступа pino-http (у них есть res). */
export function accessLines(
    records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
    return records.filter((record) => 'res' in record && 'req' in record);
}

class ServiceError extends Error {
    readonly code = 'SERVICE_FAILED';
}

@Controller()
class ProbeController {
    constructor(private readonly logger: PinoLogger) {}

    @Post('echo')
    @HttpCode(200)
    echo(@Body() body: unknown, @Headers() headers: Record<string, unknown>): { ok: true } {
        this.logger.info(body as object, 'тело запроса');
        this.logger.info({ headers }, 'заголовки запроса');

        return { ok: true };
    }

    @Get('ok')
    ok(): { status: 'ok' } {
        return { status: 'ok' };
    }

    @Get('items')
    items(@Query() _query: unknown): { items: [] } {
        return { items: [] };
    }

    @Get('fail')
    fail(): never {
        throw new ServiceError('отказ сервиса');
    }

    /** Редирект с секретами в Location (AC-2.1, BFF-60): в журнал доступа — только statusCode. */
    @Get('redirect')
    @Redirect('/cb?state=s3cr3t&id_token_hint=MARK_HINT', 302)
    redirect(): void {
        return undefined;
    }

    @Get('trace')
    trace(): { traceId: unknown } {
        return { traceId: this.logger.logger.bindings().traceId };
    }
}

/** Nest-приложение на Fastify: генератор trace-id — в адаптере, логгер — LoggerModule.forRoot(params). */
export async function startNestApp(params: KitLoggerParams): Promise<NestFastifyApplication> {
    @Module({ imports: [LoggerModule.forRoot(params)], controllers: [ProbeController] })
    class ProbeModule {}

    const app = await NestFactory.create<NestFastifyApplication>(
        ProbeModule,
        new FastifyAdapter({ genReqId: params.pinoHttp[0].genReqId }),
        { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return app;
}

/**
 * Fastify без Nest с middleware pino-http из params — так nestjs-pino монтирует его на Fastify. Путь с `/fail`
 * отвечает 500, с `/bad` — 400, остальные — 200.
 */
export async function startPinoHttpApp(params: KitLoggerParams): Promise<FastifyInstance> {
    const middleware = pinoHttp(...params.pinoHttp);
    const app = Fastify({ genReqId: params.pinoHttp[0].genReqId });
    app.addHook('onRequest', (request, reply, done) => {
        middleware(request.raw, reply.raw);
        done();
    });
    app.all('/*', async (request, reply) => {
        if (request.url.includes('/fail')) {
            return reply.code(500).send({ error: 'fail' });
        }
        if (request.url.includes('/bad')) {
            return reply.code(400).send({ error: 'bad' });
        }

        return { ok: true };
    });
    await app.ready();

    return app;
}
