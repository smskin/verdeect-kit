// AC-3.12 (UC-3; prd.md §3.5 v1.26): configureFastify — свой парсер тела (application/octet-stream) и предел тела маршрута
// через onRoute; превышение предела маршрута — код сервиса со статусом 413 через exceptionFilter по
// request.routeOptions.url; превышение общего bodyLimit — PAYLOAD_TOO_LARGE пакета; повторная регистрация
// application/json в configureFastify роняет запуск FST_ERR_CTP_ALREADY_PRESENT. Кода пакета не меняет.
// Проект isolated: vi.stubEnv — окружение createHttpApp; defineErrors — реестр кодов на процесс.
import 'reflect-metadata';
import {
    Body,
    Catch,
    Controller,
    HttpCode,
    HttpException,
    Injectable,
    Module,
    Post,
    type ArgumentsHost,
    type ExceptionFilter,
} from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import {
    createHttpApp,
    defineErrors,
    DomainError,
    KitExceptionFilter,
    kitErrors,
    type KitHttpOptions,
} from '../../../src/http/index.js';
import { expectProblem } from '../../../src/testing/index.js';

defineErrors({
    ...kitErrors,
    UPLOAD_TOO_LARGE: { status: 413, message: 'Файл больше допустимого' },
});

const UPLOAD_LIMIT = 16;

@Catch()
@Injectable()
class UploadFilter implements ExceptionFilter {
    constructor(private readonly kit: KitExceptionFilter) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const request = host.switchToHttp().getRequest<FastifyRequest>();
        if (
            exception instanceof HttpException &&
            exception.getStatus() === 413 &&
            request.routeOptions.url === '/upload'
        ) {
            this.kit.catch(new DomainError('UPLOAD_TOO_LARGE'), host);

            return;
        }
        this.kit.catch(exception, host);
    }
}

@Controller()
class UploadController {
    @Post('upload')
    @HttpCode(200)
    upload(@Body() body: Buffer): { length: number } {
        return { length: body.length };
    }

    @Post('echo')
    @HttpCode(200)
    echo(@Body() body: unknown): unknown {
        return body;
    }
}

const env = defineEnv({ ...envBase });

@Module({ imports: [KitConfigModule.forRoot({ schema: env })], controllers: [UploadController] })
class UploadModule {}

const http: KitHttpOptions = {
    bodyLimit: 64,
    exceptionFilter: UploadFilter,
    configureFastify: (fastify) => {
        fastify.addContentTypeParser(
            'application/octet-stream',
            { parseAs: 'buffer' },
            (_request, body, done) => {
                done(null, body);
            },
        );
        fastify.addHook('onRoute', (route) => {
            if (route.url === '/upload') {
                route.bodyLimit = UPLOAD_LIMIT;
            }
        });
    },
};

describe('UC-3: configureFastify — парсер тела и предел маршрута', () => {
    let app: NestFastifyApplication | undefined;

    beforeEach(() => {
        vi.stubEnv('LOG_LEVEL', 'silent');
        vi.stubEnv('SHUTDOWN_DRAIN_MS', '0');
    });

    afterEach(async () => {
        await app?.close();
        app = undefined;
        vi.unstubAllEnvs();
    });

    it("AC-3.12: addContentTypeParser('application/octet-stream') в configureFastify работает", async () => {
        app = await createHttpApp({ module: UploadModule, service: 'probe', ...http });
        const res = await app.inject({
            method: 'POST',
            url: '/upload',
            headers: { 'content-type': 'application/octet-stream' },
            payload: Buffer.alloc(10),
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ length: 10 });
    });

    it('AC-3.12: тело больше предела /upload — код сервиса со статусом 413', async () => {
        app = await createHttpApp({ module: UploadModule, service: 'probe', ...http });
        const res = await app.inject({
            method: 'POST',
            url: '/upload',
            headers: { 'content-type': 'application/octet-stream' },
            payload: Buffer.alloc(UPLOAD_LIMIT + 1),
        });

        expectProblem(res, { status: 413, code: 'UPLOAD_TOO_LARGE' });
    });

    it('AC-3.12: тело больше общего bodyLimit на другом маршруте — PAYLOAD_TOO_LARGE пакета', async () => {
        app = await createHttpApp({ module: UploadModule, service: 'probe', ...http });
        const res = await app.inject({
            method: 'POST',
            url: '/echo',
            payload: { title: 'x'.repeat(256) },
        });

        expectProblem(res, { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    it('AC-3.12: повторная регистрация application/json в configureFastify роняет запуск FST_ERR_CTP_ALREADY_PRESENT', async () => {
        const started = createHttpApp({
            module: UploadModule,
            service: 'probe',
            configureFastify: (fastify) => {
                fastify.addContentTypeParser('application/json', (_request, _payload, done) => {
                    done(null, {});
                });
            },
        });

        await expect(started).rejects.toMatchObject({ code: 'FST_ERR_CTP_ALREADY_PRESENT' });
    });
});
