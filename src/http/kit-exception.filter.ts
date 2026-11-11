// KitExceptionFilter (prd.md §3.5, AC-3.1–AC-3.4; KT-15 п. 7–8): единый ответ {error: {code, message, details}}.
// Эталон — O app-exception-filter.ts: порядок веток, libraryBody, send() с Content-Type: application/json; charset=utf-8,
// reportUnexpected. Из B: ответ после отправленных заголовков — только warn. По PRD: коды HttpException без тела — таблица
// HTTP_CODES (прочие статусы → 500 INTERNAL_ERROR), DomainError с незарегистрированным кодом → 500, срок пула —
// isPoolTimeout по форме, 503 без метрики и события: метрику и событие срока пула пишет пул /database (AC-4.5, KT-19
// п. 3); codeOf с путями O, maskSecretPath и instance-shutdown не
// переносятся, путь в лог не пишется (он уже есть в строке доступа).
import {
    Catch,
    HttpException,
    Injectable,
    Logger,
    type ArgumentsHost,
    type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isPoolTimeout } from '../internal/pg-errors.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { DomainError, errorMessage, errorStatus } from './errors.js';

/** Код ответа HttpException без своего тела (Nest FastifyAdapter.mapException: FastifyError → HttpException). */
const HTTP_CODES: Readonly<Record<number, string>> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'ROUTE_NOT_FOUND',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    429: 'RATE_LIMITED',
};

/** Коды библиотек при 5xx — ожидаемая недоступность зависимости (эталон O). */
const EXPECTED_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['PLATFORM_UNAVAILABLE']);

/** `Retry-After` при сроке пула БД (эталон O POOL_RETRY_AFTER). */
const POOL_RETRY_AFTER = '1';

interface WireBody {
    readonly error: { readonly code: string; readonly message: string; readonly details: object };
}

function bodyOf(code: string): WireBody {
    return { error: { code, message: errorMessage(code), details: {} } };
}

/** Тело HttpException уже в формате §3.5 (guard'ы @verdeect/auth, @verdeect/platform-client). */
function libraryBody(response: unknown): WireBody | null {
    if (typeof response !== 'object' || response === null || !('error' in response)) {
        return null;
    }
    const error: unknown = response.error;
    if (typeof error !== 'object' || error === null) {
        return null;
    }
    const { code, message, details } = error as Record<string, unknown>;
    if (typeof code !== 'string' || typeof message !== 'string') {
        return null;
    }
    if (typeof details !== 'object' || details === null) {
        return null;
    }

    return { error: { code, message, details } };
}

/**
 * Фильтр ошибок HTTP сервиса (§3.5). `DomainError` — статус словаря, `warn`, без GlitchTip; тело `{error}` guard'ов —
 * без изменений; срок пула БД (в том числе в `cause`) — 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1` (метрику и событие
 * пишет пул /database, AC-4.5); `HttpException` без тела 400/401/403/404/413/415/429 — код по статусу, `warn`; прочее —
 * 500 `INTERNAL_ERROR`, `error`, GlitchTip ровно раз. Текст исходной ошибки, стек и SQL в ответ не попадают.
 * `createHttpApp` регистрирует фильтр сам; BFF собирает свой фильтр на `DomainError` и словаре (различие по роли).
 */
@Catch()
@Injectable()
export class KitExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(KitExceptionFilter.name);

    /** Отвечает на исключение запроса по правилам §3.5. */
    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const reply = http.getResponse<FastifyReply>();
        const request = http.getRequest<FastifyRequest>();

        if (reply.raw.headersSent) {
            this.logger.warn(
                { method: request.method, traceId: request.id, err: sanitizeError(exception) },
                'ошибка после отправки заголовков ответа',
            );

            return;
        }

        // Срок пула — первой веткой: он может быть в cause DomainError (эталон O).
        if (isPoolTimeout(exception)) {
            // Метрику и событие ставит пул /database (KT-19 п. 3); срок своего пула сервиса — 503 без метрики.
            this.warn('SERVICE_UNAVAILABLE', 503, request);
            void reply.header('Retry-After', POOL_RETRY_AFTER);
            this.send(reply, 503, bodyOf('SERVICE_UNAVAILABLE'));

            return;
        }

        if (exception instanceof DomainError && errorStatus(exception.code) !== undefined) {
            this.warn(exception.code, exception.status, request);
            this.send(reply, exception.status, exception.toBody());

            return;
        }

        if (exception instanceof HttpException) {
            this.handleHttpException(exception, reply, request);

            return;
        }

        this.reportUnexpected(exception, request);
        this.send(reply, 500, bodyOf('INTERNAL_ERROR'));
    }

    private handleHttpException(
        exception: HttpException,
        reply: FastifyReply,
        request: FastifyRequest,
    ): void {
        const status = exception.getStatus();
        const library = libraryBody(exception.getResponse());
        if (library !== null) {
            if (status < 500 || EXPECTED_UNAVAILABLE_CODES.has(library.error.code)) {
                this.warn(library.error.code, status, request);
            } else {
                this.reportUnexpected(exception, request);
            }
            this.send(reply, status, library);

            return;
        }
        const code = HTTP_CODES[status];
        if (code === undefined) {
            // Прочие 4xx и ≥ 500 без тела — ошибка разработчика: доменные 4xx — только DomainError (KT-15 п. 8).
            this.reportUnexpected(exception, request);
            this.send(reply, 500, bodyOf('INTERNAL_ERROR'));

            return;
        }
        this.warn(code, status, request);
        this.send(reply, status, bodyOf(code));
    }

    private warn(code: string, status: number, request: FastifyRequest): void {
        this.logger.warn(
            { code, status, method: request.method, traceId: request.id },
            'ожидаемая ошибка запроса',
        );
    }

    private reportUnexpected(exception: unknown, request: FastifyRequest): void {
        captureError(exception, { tags: { code: 'INTERNAL_ERROR' } });
        // Тело запроса, заголовки и путь не логируются.
        this.logger.error(
            { err: sanitizeError(exception), method: request.method, traceId: request.id },
            'неожиданная ошибка запроса',
        );
    }

    private send(reply: FastifyReply, status: number, payload: WireBody): void {
        void reply
            .status(status)
            .header('Content-Type', 'application/json; charset=utf-8')
            .send(payload);
    }
}
