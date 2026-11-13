// Стенд уровня I для /idempotency (prd.md §3.3а v1.14, AC-4.14, AC-9.5): приложение kit с KitConfigModule,
// VerdeectAuthModule (издатель createTestSigner), KitDatabaseModule и KitIdempotencyModule на фикстуре БД; маршруты
// /echo (пользователь), /strict (required), /service и /service-plain (служба), /open (без guard'а), /secret и
// /secret-list, /secret-stamp (redact, AC-4.14 v1.26).
import {
    Body,
    Controller,
    HttpCode,
    Module,
    Post,
    Res,
    UseGuards,
    type DynamicModule,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RequireService, VerdeectAuthGuard, VerdeectAuthModule } from '@verdeect/auth/nest';
import { createTestSigner, TEST_RESOURCE, type TestSigner } from '@verdeect/auth/testing';
import type { FastifyReply } from 'fastify';
import { defineEnv } from '../../../src/config/define-env.js';
import { envBase, envDatabase } from '../../../src/config/fragments.js';
import { KitConfigModule } from '../../../src/config/kit-config.module.js';
import { KitDatabaseModule } from '../../../src/database/kit-database.module.js';
import { DomainError } from '../../../src/http/errors.js';
import { Idempotent } from '../../../src/idempotency/idempotent.decorator.js';
import {
    IdempotencyCleanup,
    KitIdempotencyModule,
} from '../../../src/idempotency/kit-idempotency.module.js';
import { KIT_PACKAGE_METRICS } from '../../../src/internal/tokens.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import type { KitTestOverride } from '../../../src/testing/create-test-app.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { adminQuery, appUrl, createDbApp } from '../../support/database.js';

/** Схема окружения стенда. */
export const standEnv = defineEnv({ ...envBase, ...envDatabase });

/** Вторая компания тестов. */
export const OTHER_TENANT = 'globex';

/** Состояние обработчиков: вызовы, «шлагбаум», режим отказа. */
export const handlers = {
    calls: 0,
    gate: null as Promise<void> | null,
    fail: null as 'error' | 'domain' | null,
};

/** Ожидающие входа в обработчик (сигнал вместо опроса). */
let entryWaiters: ((call: number) => void)[] = [];

/** Промис следующего входа в обработчик: номер вызова. */
export function nextEntry(): Promise<number> {
    return new Promise((resolve) => {
        entryWaiters.push(resolve);
    });
}

/** Шлагбаум обработчиков: возвращает функцию открытия. */
export function closeGate(): () => void {
    let open = (): void => undefined;
    handlers.gate = new Promise<void>((resolve) => {
        open = resolve;
    });

    return open;
}

/** Сброс состояния обработчиков. */
export function resetHandlers(): void {
    handlers.calls = 0;
    handlers.gate = null;
    handlers.fail = null;
    entryWaiters = [];
}

async function handle(body: unknown, reply: FastifyReply): Promise<unknown> {
    handlers.calls += 1;
    const n = handlers.calls;
    const gate = handlers.gate;
    for (const notify of entryWaiters.splice(0)) {
        notify(n);
    }
    if (gate !== null) {
        await gate;
    }
    if (handlers.fail === 'error') {
        throw new Error('обработчик упал');
    }
    if (handlers.fail === 'domain') {
        throw new DomainError('VALIDATION_FAILED');
    }
    void reply.header('Location', `/echo/${n}`);

    return { n, body };
}

/** Экземпляр класса с `toJSON`: клиент получает результат `toJSON`, а не свои поля (KT-79). */
class Stamp {
    constructor(readonly n: number) {}

    toJSON(): { at: string; secret: string } {
        return {
            at: new Date(Date.UTC(2026, 10, 13, 12, 0, 0, this.n)).toISOString(),
            secret: 'stamp',
        };
    }
}

@Controller()
@UseGuards(VerdeectAuthGuard)
class EchoController {
    // tenantFromBody у маршрута пользователя игнорируется: область — из токена (подложный tenant в теле).
    @Post('echo')
    @Idempotent({ tenantFromBody: 'tenant' })
    echo(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
        return handle(body, reply);
    }

    @Post('strict')
    @HttpCode(200)
    @Idempotent({ required: true })
    strict(
        @Body() body: unknown,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<unknown> {
        return handle(body, reply);
    }

    @Post('service')
    @RequireService()
    @Idempotent({ tenantFromBody: 'tenant' })
    service(
        @Body() body: unknown,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<unknown> {
        return handle(body, reply);
    }

    @Post('secret')
    @Idempotent({ redact: ['secret'] })
    secret(@Res({ passthrough: true }) reply: FastifyReply): { id: number; secret: string } {
        handlers.calls += 1;
        void reply.header('Location', `/secret/${handlers.calls}`);

        return { id: handlers.calls, secret: `sk_${randomBytes(16).toString('hex')}` };
    }

    @Post('secret-stamp')
    @Idempotent({ redact: ['secret'] })
    secretStamp(): Stamp {
        handlers.calls += 1;

        return new Stamp(handlers.calls);
    }

    @Post('secret-list')
    @Idempotent({ redact: ['secret'] })
    secretList(): { secret: string }[] {
        handlers.calls += 1;

        return [{ secret: `sk_${randomBytes(16).toString('hex')}` }];
    }

    @Post('service-plain')
    @RequireService()
    @Idempotent()
    servicePlain(
        @Body() body: unknown,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<unknown> {
        return handle(body, reply);
    }
}

@Controller()
class OpenController {
    @Post('open')
    @Idempotent()
    open(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
        return handle(body, reply);
    }
}

/** Модуль стенда с издателем токенов `signer`. */
export function standModule(signer: TestSigner): DynamicModule {
    @Module({
        imports: [
            KitConfigModule.forRoot({ schema: standEnv }),
            VerdeectAuthModule.forRoot({ issuers: [signer.issuer], resource: TEST_RESOURCE }),
            KitDatabaseModule.forRoot({ schema: fixtureSchema }),
            KitIdempotencyModule.forRoot({ table: fixtureSchema.idempotency }),
        ],
        controllers: [EchoController, OpenController],
    })
    class StandModule {}

    return { module: StandModule };
}

/** Стенд: приложение, подписант токенов, очистка и метрики приложения. */
export interface IdempotencyStand {
    readonly app: NestFastifyApplication;
    readonly signer: TestSigner;
    readonly cleanup: IdempotencyCleanup;
    readonly metrics: KitMetrics;
    readonly close: () => Promise<void>;
}

/** Собирает стенд; первый проход очистки после старта завершён до возврата. */
export async function createStand(
    options: {
        readonly url?: string;
        readonly env?: Readonly<Record<string, string>>;
        readonly overrides?: readonly KitTestOverride[];
    } = {},
): Promise<IdempotencyStand> {
    const signer = await createTestSigner();
    const app = await createDbApp({
        module: standModule(signer),
        schema: standEnv,
        env: { DATABASE_URL: options.url ?? appUrl(), LOG_LEVEL: 'silent', ...options.env },
        overrides: options.overrides,
    });
    const cleanup = app.get(IdempotencyCleanup);
    await cleanup.idle();

    return {
        app,
        signer,
        cleanup,
        metrics: app.get<KitMetrics>(KIT_PACKAGE_METRICS),
        close: async () => {
            await app.close();
            await signer.close();
        },
    };
}

/** Токен пользователя компании (по умолчанию — компания воркера). */
export function userToken(
    stand: IdempotencyStand,
    options: { readonly sub?: string; readonly tenant?: string } = {},
): Promise<string> {
    const tenant = options.tenant ?? workerScope().tenant;

    return stand.signer.userToken({
        sub: options.sub ?? 'user-a',
        tenant,
        tenant_id: `org_${tenant}`,
    });
}

/** Токен службы. */
export function serviceToken(stand: IdempotencyStand, clientId = 'svc-a'): Promise<string> {
    return stand.signer.serviceToken({ client_id: clientId, sub: clientId });
}

/** POST с токеном и ключом. */
export function post(
    stand: IdempotencyStand,
    url: string,
    options: { readonly token?: string; readonly key?: string; readonly body?: unknown },
) {
    return stand.app.inject({
        method: 'POST',
        url,
        headers: {
            ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
            ...(options.key === undefined ? {} : { 'idempotency-key': options.key }),
        },
        payload: (options.body ?? {}) as Record<string, unknown>,
    });
}

/** Очищает таблицу идемпотентности фикстуры. */
export async function truncateIdempotency(): Promise<void> {
    await adminQuery('TRUNCATE kit.idempotency_key');
}

/** Значение счётчика `verdeect_cleanup_runs_total` по итогу. */
export async function cleanupRuns(
    metrics: KitMetrics,
    result: 'ok' | 'partial' | 'interrupted' | 'error',
): Promise<number> {
    const { values } = await metrics.cleanupRuns.get();

    return (values as { labels: Record<string, string | number>; value: number }[])
        .filter(
            (value) => value.labels.result === result && value.labels.table === 'idempotency_key',
        )
        .reduce((sum, value) => sum + value.value, 0);
}
