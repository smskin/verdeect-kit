// IdempotencyInterceptor и хранилище (prd.md §3.3а v1.14, AC-4.14, UC-7). Эталон — O idempotency.interceptor.ts +
// idempotency.store.ts (KEY_FORMAT, canonicalJson, отпечаток, begin с FOR UPDATE, брошенная in_progress через 5 мин,
// mismatch до in_progress, release при ошибке, один повтор complete). По PRD: область user/agent → (tenant, sub),
// service → client_id или (client_id, поле tenantFromBody); Location в ответе; без принципала — 500; коды — DomainError
// словаря /http; сравнение области — IS NOT DISTINCT FROM (tenant nullable); redact — копия тела в хранилище (v1.26);
// повтор — в той же сериализации и с тем же Content-Type, что первый ответ (колонка content_type, v1.28).
import { createHash, randomUUID } from 'node:crypto';
import {
    Inject,
    Injectable,
    Logger,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { Principal } from '@verdeect/auth';
import { principalOf } from '@verdeect/auth/nest';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { Db } from '../database/db.js';
import type { DbContext } from '../database/tenant.js';
import { DomainError } from '../http/errors.js';
import { IDEMPOTENT_METADATA, type KitIdempotentOptions } from '../internal/metadata.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import type { KitIdempotencyTable } from './table.js';

/** Токен таблицы идемпотентности сервиса (провайдер `KitIdempotencyModule`). */
export const KIT_IDEMPOTENCY_TABLE = Symbol('KIT_IDEMPOTENCY_TABLE');

/** Печатные ASCII, ≤ 200 знаков (эталон O). */
export const KEY_FORMAT = /^[\x21-\x7E]{1,200}$/;

/** Брошенная `in_progress` (запрос упал без release) переиспользуется через 5 минут (эталон O). */
const ABANDONED_AFTER_MINUTES = 5;

/** Срок хранения ответа. */
const EXPIRES_AFTER_HOURS = 24;

/** Заголовок ответа повтора. */
const REPLAYED_HEADER = 'Idempotent-Replayed';

/** Типы, которые Fastify выбирает по умолчанию для строки и для прочего тела. */
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Область ключа: тенант (или `null`) и субъект. */
export interface IdempotencyScope {
    /** Тенант записи или `null` (служба без `tenantFromBody`). */
    readonly tenant: string | null;
    /** `user:<sub>`, `agent:<sub>`, `service:<client_id>`. */
    readonly subject: string;
}

type BeginResult =
    | { readonly state: 'new'; readonly attempt: string }
    | {
          readonly state: 'replay';
          readonly status: number;
          readonly body: unknown;
          /** Сырой текст `response_body` (без повторного `JSON.parse` drizzle). */
          readonly bodyText: string | null;
          readonly location: string | null;
          /** `Content-Type` первого ответа; `''` — пустой ответ; `null` — запись до колонки. */
          readonly contentType: string | null;
      }
    | { readonly state: 'mismatch' }
    | { readonly state: 'in_progress' };

/** JSON с рекурсивно отсортированными ключами: одинаковое тело — одинаковый отпечаток (эталон O). */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);

        return `{${entries.join(',')}}`;
    }

    return JSON.stringify(value ?? null);
}

/** SHA-256 hex метода, пути без query и канонического тела. */
export function fingerprintOf(method: string, path: string, body: unknown): string {
    const bare = path.split('?')[0] ?? '';

    return createHash('sha256')
        .update(`${method} ${bare}\n${canonicalJson(body ?? null)}`)
        .digest('hex');
}

/** Значение поля тела по пути через точку. */
function fieldOf(body: unknown, path: string): unknown {
    let current = body;
    for (const segment of path.split('.')) {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }

    return current;
}

/**
 * Область ключа (§3.3а): пользователь и агент — тенант токена (поле тела игнорируется); служба — `client_id` и тенант
 * из поля `tenantFromBody`, если это непустая строка, иначе `null`.
 */
export function scopeOf(
    principal: Principal,
    body: unknown,
    options: KitIdempotentOptions,
): IdempotencyScope {
    if (principal.kind === 'user') {
        return { tenant: principal.tenant, subject: `user:${principal.sub}` };
    }
    if (principal.kind === 'agent') {
        return { tenant: principal.tenant, subject: `agent:${principal.sub}` };
    }
    const value =
        options.tenantFromBody === undefined ? undefined : fieldOf(body, options.tenantFromBody);

    return {
        tenant: typeof value === 'string' && value !== '' ? value : null,
        subject: `service:${principal.clientId}`,
    };
}

/** Ключ из заголовка: нет — `null`; не строка или не по формату — 422 `VALIDATION_FAILED`. */
function readKey(request: FastifyRequest): string | null {
    const header = request.headers['idempotency-key'];
    if (header === undefined) {
        return null;
    }
    if (typeof header !== 'string' || !KEY_FORMAT.test(header)) {
        throw new DomainError('VALIDATION_FAILED', {
            issues: [{ path: 'Idempotency-Key', code: 'invalid' }],
        });
    }

    return header;
}

/**
 * Интерсептор `@Idempotent` (§3.3а): регистрирует `KitIdempotencyModule` через `APP_INTERCEPTOR`. Повтор — сохранённый
 * ответ (статус, тело в той же сериализации, `Content-Type` и `Location` первого ответа; запись без `content_type` — тело
 * и статус без `Content-Type`) и `Idempotent-Replayed: true`; другое тело — 422 `IDEMPOTENCY_KEY_REUSED`; запрос ещё идёт — 409
 * `IDEMPOTENCY_IN_PROGRESS`. Сохраняются только успешные ответы.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    private readonly logger = new Logger('IdempotencyInterceptor');

    constructor(
        private readonly reflector: Reflector,
        private readonly db: Db,
        @Inject(KIT_IDEMPOTENCY_TABLE) private readonly table: KitIdempotencyTable,
    ) {}

    /** Оборачивает обработчик маршрута с `@Idempotent`. */
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const options = this.reflector.get<KitIdempotentOptions | undefined>(
            IDEMPOTENT_METADATA,
            context.getHandler(),
        );
        if (options === undefined) {
            return next.handle();
        }
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        // Принципал — до ключа: без guard'а 500 при любом ключе и без него (PRD v1.14).
        const principal = principalOf(request as FastifyRequest & { principal?: Principal });
        if (principal === null) {
            throw new Error(
                '@Idempotent: нет проверенного принципала — нужен VerdeectAuthGuard на маршруте',
            );
        }
        const key = readKey(request);
        if (key === null) {
            if (options.required === true) {
                throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
            }

            return next.handle();
        }

        return from(this.run(context, next, request, principal, options, key));
    }

    private async run(
        context: ExecutionContext,
        next: CallHandler,
        request: FastifyRequest,
        principal: Principal,
        options: KitIdempotentOptions,
        key: string,
    ): Promise<unknown> {
        const scope = scopeOf(principal, request.body, options);
        const ctx: DbContext = {
            tenant: scope.tenant,
            traceId: String(request.id),
            actor: {
                ...(principal.clientId === null ? {} : { clientId: principal.clientId }),
                channel: 'http',
            },
        };
        const fields = {
            subjectKind: principal.kind,
            keyPrefix: key.slice(0, 8),
            traceId: ctx.traceId,
        };
        const path = request.originalUrl ?? request.url;
        const begin = await this.begin(
            ctx,
            scope,
            key,
            fingerprintOf(request.method, path, request.body),
        );
        this.logger.debug(
            {
                ...fields,
                state: begin.state,
                ...(begin.state === 'replay' ? { contentType: begin.contentType } : {}),
            },
            'идемпотентность: begin',
        );
        if (begin.state === 'mismatch') {
            this.logger.warn(fields, 'идемпотентность: ключ с другим телом');
            throw new DomainError('IDEMPOTENCY_KEY_REUSED');
        }
        if (begin.state === 'in_progress') {
            this.logger.warn(fields, 'идемпотентность: запрос с ключом ещё выполняется');
            throw new DomainError('IDEMPOTENCY_IN_PROGRESS');
        }
        const reply = context.switchToHttp().getResponse<FastifyReply>();
        if (begin.state === 'replay') {
            void reply.status(begin.status).header(REPLAYED_HEADER, 'true');
            if (begin.location !== null) {
                void reply.header('Location', begin.location);
            }

            return replayBody(reply, begin);
        }

        let body: unknown;
        try {
            body = await lastValueFrom(next.handle(), { defaultValue: undefined });
        } catch (error) {
            await this.release(ctx, scope, key, begin.attempt, fields);
            throw error;
        }
        const status =
            this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
            (request.method === 'POST' ? 201 : 200);
        const header = reply.getHeader('location');
        const location = typeof header === 'string' ? header : null;
        await this.completeWithRetry(
            ctx,
            scope,
            key,
            begin.attempt,
            {
                status,
                body: this.redacted(body ?? null, options.redact, fields),
                location,
                contentType: contentTypeOf(reply, body),
            },
            fields,
        );

        return body;
    }

    /**
     * Копия тела для хранилища: поля `redact` простого объекта → `null`. Не простой объект (`Date`, `Buffer`, экземпляр
     * класса, в том числе с `toJSON`), массив и не объект — как есть (KT-79).
     */
    private redacted(
        body: unknown,
        redact: readonly string[] | undefined,
        fields: Record<string, unknown>,
    ): unknown {
        if (redact === undefined || !isPlainObject(body)) {
            return body;
        }
        const copy: Record<string, unknown> = { ...body };
        const hidden = redact.filter((name) => Object.hasOwn(copy, name));
        for (const name of hidden) {
            copy[name] = null;
        }
        this.logger.debug(
            { ...fields, fields: hidden.length },
            'idempotency: поля ответа скрыты в хранилище',
        );

        return copy;
    }

    private where(scope: IdempotencyScope, key: string): SQL | undefined {
        const t = this.table;

        return and(
            sql`${t.tenant} IS NOT DISTINCT FROM ${scope.tenant}`,
            eq(t.subject, scope.subject),
            eq(t.key, key),
        );
    }

    private begin(
        ctx: DbContext,
        scope: IdempotencyScope,
        key: string,
        fingerprint: string,
    ): Promise<BeginResult> {
        const t = this.table;
        // Метка попытки: ответ пишет только та попытка, что захватила строку (KT-22 п. 3).
        const attempt = randomUUID();

        return this.db.transaction(ctx, async (tx): Promise<BeginResult> => {
            // ON CONFLICT DO NOTHING без ON CONSTRAINT работает, пока idempotency_key_scope_key (tenant, subject, key) —
            // единственное уникальное ограничение таблицы; новое уникальное ограничение — переписать на
            // ON CONFLICT ON CONSTRAINT idempotency_key_scope_key (KT-21 п. 3).
            const inserted = await tx
                .insert(t)
                .values({ tenant: scope.tenant, subject: scope.subject, key, fingerprint, attempt })
                .onConflictDoNothing()
                .returning({ key: t.key });
            if (inserted.length > 0) {
                return { state: 'new', attempt };
            }
            const [row] = await tx
                .select({
                    fingerprint: t.fingerprint,
                    state: t.state,
                    status: t.responseStatus,
                    body: t.responseBody,
                    bodyText: sql<string | null>`${t.responseBody}::text`,
                    location: t.responseLocation,
                    contentType: t.contentType,
                    expired: sql<boolean>`${t.createdAt} < now() - make_interval(hours => ${EXPIRES_AFTER_HOURS})`,
                    abandoned: sql<boolean>`${t.state} = 'in_progress' AND ${t.createdAt} < now() - make_interval(mins => ${ABANDONED_AFTER_MINUTES})`,
                })
                .from(t)
                .where(this.where(scope, key))
                .for('update');
            if (row === undefined) {
                throw new Error('idempotency: строка области не найдена после конфликта');
            }
            if (row.expired || row.abandoned) {
                if (row.abandoned && !row.expired) {
                    this.logger.warn(
                        { keyPrefix: key.slice(0, 8), traceId: ctx.traceId },
                        'идемпотентность: брошенная in_progress переиспользована',
                    );
                }
                await tx
                    .update(t)
                    .set({
                        fingerprint,
                        attempt,
                        state: 'in_progress',
                        responseStatus: null,
                        responseBody: null,
                        responseLocation: null,
                        contentType: null,
                        createdAt: sql`now()`,
                    })
                    .where(this.where(scope, key));

                return { state: 'new', attempt };
            }
            if (row.fingerprint !== fingerprint) {
                return { state: 'mismatch' };
            }
            if (row.state === 'in_progress') {
                return { state: 'in_progress' };
            }

            return {
                state: 'replay',
                status: row.status ?? 200,
                body: row.body,
                bodyText: row.bodyText,
                location: row.location,
                contentType: row.contentType,
            };
        });
    }

    /**
     * Обработчик упал: строка своей попытки удаляется — повтор выполнит запрос заново; перехваченную строку другой
     * попытки не трогает; сбой release не подменяет ответ.
     */
    private async release(
        ctx: DbContext,
        scope: IdempotencyScope,
        key: string,
        attempt: string,
        fields: Record<string, unknown>,
    ): Promise<void> {
        try {
            await this.db.transaction(ctx, (tx) =>
                tx
                    .delete(this.table)
                    .where(
                        and(
                            this.where(scope, key),
                            eq(this.table.state, 'in_progress'),
                            eq(this.table.attempt, attempt),
                        ),
                    ),
            );
        } catch (error) {
            this.logger.error(
                { ...fields, err: sanitizeError(error) },
                'идемпотентность: release не удался',
            );
            captureError(error);
        }
    }

    /**
     * Один повтор `complete` сразу после сбоя (эталон O). После двух сбоев ответ клиенту не меняется: строка остаётся
     * `in_progress` и через 5 минут переиспользуется. Ответ пишется только своей попытки: строку перехватил повторный
     * запрос (обработчик дольше 5 минут) — ответ не сохраняется, `warn` без ключа и тела (KT-22 п. 3).
     */
    private async completeWithRetry(
        ctx: DbContext,
        scope: IdempotencyScope,
        key: string,
        attempt: string,
        response: {
            readonly status: number;
            readonly body: unknown;
            readonly location: string | null;
            readonly contentType: string;
        },
        fields: Record<string, unknown>,
    ): Promise<void> {
        const complete = () =>
            this.db.transaction(ctx, (tx) =>
                tx
                    .update(this.table)
                    .set({
                        state: 'done',
                        responseStatus: response.status,
                        responseBody: response.body,
                        responseLocation: response.location,
                        contentType: response.contentType,
                    })
                    .where(and(this.where(scope, key), eq(this.table.attempt, attempt))),
            );
        // Перехват строки другой попыткой — warn без ключа (даже без префикса) и тела (KT-22 п. 3).
        const taken = (rowCount: number | null): boolean => {
            if ((rowCount ?? 0) > 0) {
                return false;
            }
            this.logger.warn(
                { subjectKind: fields.subjectKind, traceId: fields.traceId },
                'идемпотентность: строку перехватила другая попытка — ответ не сохранён',
            );

            return true;
        };
        try {
            const result = await complete();
            if (!taken(result.rowCount)) {
                this.logger.debug({ ...fields, state: 'done' }, 'идемпотентность: complete');
            }

            return;
        } catch (error) {
            this.logger.warn(
                { ...fields, err: sanitizeError(error) },
                'идемпотентность: complete не удался, повтор',
            );
        }
        try {
            taken((await complete()).rowCount);
        } catch (error) {
            this.logger.error(
                { ...fields, err: sanitizeError(error) },
                'идемпотентность: complete не удался',
            );
            captureError(error);
        }
    }
}

/** Простой объект: прототип `Object.prototype` или `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
}

/**
 * `Content-Type` первого ответа для хранилища: заданный заголовок (`@Header`, `reply.type()`), иначе по телу — как
 * выбирает Fastify: пусто → `''`, строка → `text/plain`, прочее → `application/json`.
 */
function contentTypeOf(reply: FastifyReply, body: unknown): string {
    const header = reply.getHeader('content-type');
    if (typeof header === 'string') {
        return header;
    }
    if (body === undefined) {
        return '';
    }

    return typeof body === 'string' ? TEXT_CONTENT_TYPE : JSON_CONTENT_TYPE;
}

/** Тело повтора: запись до колонки — как rc.7; пустой ответ — без тела; иначе сохранённый текст и `Content-Type`. */
function replayBody(
    reply: FastifyReply,
    replay: {
        readonly body: unknown;
        readonly bodyText: string | null;
        readonly contentType: string | null;
    },
): unknown {
    if (replay.contentType === null) {
        return replay.body;
    }
    if (replay.contentType === '') {
        return undefined;
    }
    void reply.header('Content-Type', replay.contentType);

    return replay.bodyText === null ? null : (JSON.parse(replay.bodyText) as unknown);
}
