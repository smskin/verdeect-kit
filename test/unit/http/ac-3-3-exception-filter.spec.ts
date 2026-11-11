// AC-3.3, AC-3.2, AC-3.1, AC-3.4 (UC-4): KitExceptionFilter — единый ответ {error}, GlitchTip только для неожиданных
// (prd.md §3.5; KT-15 п. 7–8). Перенос O app-exception-filter.spec.ts и I app-exception-filter.spec.ts (обобщены: без
// codeOf и RateLimitedError; событие — captureError пакета; срок пула учитывает пул /database — AC-4.5).
import { HttpException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../../src/http/errors.js';
import { KitExceptionFilter } from '../../../src/http/kit-exception.filter.js';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

const POOL_TIMEOUT = 'timeout exceeded when trying to connect';

function host(options: { headersSent?: boolean } = {}) {
    const reply = {
        raw: { headersSent: options.headersSent ?? false },
        status: vi.fn(),
        header: vi.fn(),
        send: vi.fn(),
    };
    reply.status.mockReturnValue(reply);
    reply.header.mockReturnValue(reply);
    reply.send.mockReturnValue(reply);
    const argumentsHost = {
        switchToHttp: () => ({
            getResponse: () => reply,
            getRequest: () => ({ method: 'GET', url: '/x?q=1', id: 't1' }),
        }),
    } as unknown as ArgumentsHost;

    return { reply, argumentsHost };
}

function setup() {
    const filter = new KitExceptionFilter();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    return { filter, warn, error };
}

function respond(filter: KitExceptionFilter, exception: unknown) {
    const { reply, argumentsHost } = host();
    filter.catch(exception, argumentsHost);

    return {
        reply,
        status: reply.status.mock.calls[0]?.[0] as number,
        body: reply.send.mock.calls[0]?.[0] as {
            error: { code: string; message: string; details: object };
        },
    };
}

function guardError(status: number, code: string, message: string, details: object = {}) {
    return new HttpException({ error: { code, message, details } }, status);
}

beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear();
});

describe('UC-4: KitExceptionFilter', () => {
    it('AC-3.3: срок пула → 503 SERVICE_UNAVAILABLE + Retry-After: 1; метрику пишет пул /database (AC-4.5)', () => {
        const { filter } = setup();
        const errors = [
            new Error(POOL_TIMEOUT),
            new Error('Failed query', { cause: new Error(POOL_TIMEOUT) }),
            new DomainError('FORBIDDEN', {}, { cause: new Error(POOL_TIMEOUT) }),
        ];
        for (const error of errors) {
            const { reply, status, body } = respond(filter, error);
            expect(status).toBe(503);
            expect(reply.header).toHaveBeenCalledWith('Retry-After', '1');
            expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
        }

        // Метрику, метку и событие ставит пул /database при ошибке получения соединения (KT-19 п. 3).
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('AC-3.3: DomainError 403 → тело словаря, warn, без события', () => {
        const { filter, warn } = setup();
        const { status, body } = respond(filter, new DomainError('FORBIDDEN', { reason: 'x' }));

        expect(status).toBe(403);
        expect(body).toEqual({
            error: { code: 'FORBIDDEN', message: 'Доступ запрещён', details: { reason: 'x' } },
        });
        expect(warn).toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('AC-3.3: тело guard’а @verdeect/auth (401, 403 SCOPE_REQUIRED, 409 TENANT_REQUIRED) — без изменений, warn', () => {
        const { filter, warn } = setup();
        const cases = [
            guardError(401, 'UNAUTHENTICATED', 'Требуется вход'),
            guardError(403, 'SCOPE_REQUIRED', 'Нужна область доступа', {
                required: ['items:read'],
            }),
            guardError(409, 'TENANT_REQUIRED', 'Не выбрана компания'),
        ];
        for (const exception of cases) {
            const { status, body } = respond(filter, exception);
            expect(status).toBe(exception.getStatus());
            expect(body).toEqual(exception.getResponse());
        }

        expect(warn).toHaveBeenCalledTimes(3);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('AC-3.3: 503 PLATFORM_UNAVAILABLE с телом {error} — без изменений, warn, без события', () => {
        const { filter, warn } = setup();
        const exception = guardError(
            503,
            'PLATFORM_UNAVAILABLE',
            'Сервис прав временно недоступен. Повторите позже',
        );
        const { status, body } = respond(filter, exception);

        expect(status).toBe(503);
        expect(body).toEqual(exception.getResponse());
        expect(warn).toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('AC-3.3: прочая ошибка → 500 INTERNAL_ERROR, одно событие, в теле нет текста, SQL и стека', () => {
        const { filter, error } = setup();
        const { status, body } = respond(filter, new Error('MARK_SECRET select * from x'));
        const text = JSON.stringify(body);

        expect(status).toBe(500);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(text).not.toContain('MARK_SECRET');
        expect(text).not.toContain('select');
        expect(text).not.toContain('at ');
        expect(error).toHaveBeenCalledTimes(1);
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('AC-3.2: DomainError с незарегистрированным кодом → 500 INTERNAL_ERROR, error-лог, GlitchTip ровно раз (повторная обработка той же ошибки события не добавляет)', () => {
        const { filter, error } = setup();
        const exception = new DomainError('FILTER_NOT_REGISTERED');
        const first = respond(filter, exception);
        respond(filter, exception);

        expect(first.status).toBe(500);
        expect(first.body.error.code).toBe('INTERNAL_ERROR');
        expect(error).toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it.each([
        [413, 'PAYLOAD_TOO_LARGE'],
        [415, 'UNSUPPORTED_MEDIA_TYPE'],
        [400, 'BAD_REQUEST'],
    ])('AC-3.1: HttpException %i строкой → %s', (statusCode, code) => {
        const { filter } = setup();
        const { status, body } = respond(filter, new HttpException('fastify', statusCode));

        expect(status).toBe(statusCode);
        expect(body.error.code).toBe(code);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('AC-3.4: NotFoundException → 404 ROUTE_NOT_FOUND «Адрес не найден»', () => {
        const { filter } = setup();
        const { status, body } = respond(filter, new NotFoundException('Cannot GET /nope'));

        expect(status).toBe(404);
        expect(body).toEqual({
            error: { code: 'ROUTE_NOT_FOUND', message: 'Адрес не найден', details: {} },
        });
    });

    it('§3.5: ответ уже отправлен (headersSent) → только warn, без ответа и события', () => {
        const { filter, warn } = setup();
        const { reply, argumentsHost } = host({ headersSent: true });
        filter.catch(new Error('поздно'), argumentsHost);

        expect(reply.send).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it.each([
        [400, 'BAD_REQUEST'],
        [401, 'UNAUTHENTICATED'],
        [403, 'FORBIDDEN'],
        [404, 'ROUTE_NOT_FOUND'],
        [413, 'PAYLOAD_TOO_LARGE'],
        [415, 'UNSUPPORTED_MEDIA_TYPE'],
        [429, 'RATE_LIMITED'],
    ])(
        '§3.5: HttpException без тела, статус %i → %s, статус исходный, warn, без события',
        (statusCode, code) => {
            const { filter, warn } = setup();
            const { status, body } = respond(filter, new HttpException('x', statusCode));

            expect(status).toBe(statusCode);
            expect(body.error.code).toBe(code);
            expect(warn).toHaveBeenCalled();
            expect(Sentry.captureException).not.toHaveBeenCalled();
        },
    );

    it.each([405, 409, 410, 500, 502, 503])(
        '§3.5: HttpException без тела, статус %i → 500 INTERNAL_ERROR, error, одно событие',
        (statusCode) => {
            const { filter, error } = setup();
            const { status, body } = respond(filter, new HttpException('x', statusCode));

            expect(status).toBe(500);
            expect(body.error.code).toBe('INTERNAL_ERROR');
            expect(error).toHaveBeenCalledTimes(1);
            expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        },
    );
});
