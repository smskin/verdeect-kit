// Стенд /messaging уровня I/T (prd.md §3.4, §3.8): приложение с KitConfigModule (envBase + envDatabase + envMessaging),
// KitDatabaseModule фикстуры (если нужна БД) и KitMessagingModule сервиса kit на vhost воркера (AC-5.18). Образец —
// createDbApp (test/support/database.ts). Ожидание условия — опрос с шагом без фиксированных пауз.
import { Writable } from 'node:stream';
import type { DynamicModule, Provider, Type } from '@nestjs/common';
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { pino, type Logger } from 'pino';
import { z } from 'zod';
import { defineEnv } from '../../src/config/define-env.js';
import { envBase, envDatabase, envMessaging } from '../../src/config/fragments.js';
import { KitConfigModule } from '../../src/config/kit-config.module.js';
import { KitDatabaseModule } from '../../src/database/kit-database.module.js';
import { defineEvent, type KitEvent } from '../../src/messaging/define-event.js';
import type { Envelope } from '../../src/messaging/envelope.js';
import { ExpectedMessageError, InvalidMessageError } from '../../src/messaging/errors.js';
import { KitSubscriber } from '../../src/messaging/subscriber.js';
import { MessagingCleanup } from '../../src/messaging/cleanup.js';
import { KIT_RABBIT_CONNECTION } from '../../src/messaging/config.js';
import type { RabbitConnection } from '../../src/messaging/rabbit-connection.js';
import type { DbTx } from '../../src/database/db.js';
import {
    KitMessagingModule,
    type KitMessagingModuleOptions,
} from '../../src/messaging/kit-messaging.module.js';
import type { KitTestOverride } from '../../src/testing/create-test-app.js';
import { KIT_PACKAGE_METRICS } from '../../src/internal/tokens.js';
import type { KitMetrics } from '../../src/observability/metrics.js';
import { TEST_TIMEOUT_SCALE } from '../../src/testing/timeout-scale.js';
import { workerScope } from '../../src/testing/worker-scope.js';
import * as fixtureSchema from '../fixtures/database/schema.js';
import { BrokerClient } from './broker.js';
import { adminQuery, appUrl, createDbApp } from './database.js';

/** Схема окружения стенда. */
export const messagingEnvSchema = defineEnv({ ...envBase, ...envDatabase, ...envMessaging });

/** Окружение стенда: vhost воркера, RABBITMQ_RETRY_SECONDS = 1 (AC-5.7 «в тесте 1»), реплика kit-1. */
export function messagingEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        LOG_LEVEL: 'silent',
        DATABASE_URL: appUrl(),
        RABBITMQ_URL: workerScope().rabbitmq.url,
        RABBITMQ_RETRY_SECONDS: '1',
        SHUTDOWN_TIMEOUT_MS: '10000',
        REPLICA_ID: 'kit-1',
        ...overrides,
    };
}

/** Приложение сервиса kit с KitMessagingModule; `init()` вызывает тест. */
export async function createMessagingApp(options: {
    readonly options: Omit<KitMessagingModuleOptions, 'service'>;
    readonly env?: Record<string, string>;
    readonly imports?: readonly (Type | DynamicModule)[];
    readonly providers?: readonly Provider[];
    readonly overrides?: readonly KitTestOverride[];
}): Promise<NestFastifyApplication> {
    const needsDb =
        options.options.outbox !== undefined ||
        (options.options.subscriber !== undefined &&
            (options.options.subscriber.dedupe ?? 'inbox') === 'inbox');
    const messaging = await KitMessagingModule.forRoot({ service: 'kit', ...options.options });

    @Module({
        imports: [
            KitConfigModule.forRoot({ schema: messagingEnvSchema }),
            ...(needsDb ? [KitDatabaseModule.forRoot({ schema: fixtureSchema })] : []),
            messaging,
            ...(options.imports ?? []),
        ],
        providers: [...(options.providers ?? [])],
    })
    class MessagingAppModule {}

    return createDbApp({
        module: MessagingAppModule,
        schema: messagingEnvSchema,
        env: messagingEnv(options.env),
        overrides: options.overrides,
    });
}

/** Опрос условия с шагом 20 мс до `timeoutMs × TEST_TIMEOUT_SCALE`; срок вышел — ошибка с `what`. */
export async function waitUntil(
    condition: () => boolean | Promise<boolean>,
    what: string,
    timeoutMs = 5_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs * TEST_TIMEOUT_SCALE;
    while (!(await condition())) {
        if (Date.now() > deadline) {
            throw new Error(`waitUntil: не дождались — ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

/** Событие фикстуры с компанией. */
export const TestNoteCreated = defineEvent({
    type: 'kit.note.created',
    version: 1,
    subject: 'note',
    data: z.object({ noteId: z.string(), title: z.string().min(1) }),
});

/** Событие фикстуры без компании. */
export const TestAccountTouched = defineEvent({
    type: 'kit.account.touched',
    version: 1,
    subject: 'account',
    tenant: 'none',
    data: z.object({ accountId: z.string() }),
});

/** Стенд с outbox фикстуры (`kit.outbox`, `tenantNullable: true`). */
export function createOutboxApp(
    options: {
        readonly env?: Record<string, string>;
        readonly events?: readonly KitEvent[];
        readonly subscriber?: KitMessagingModuleOptions['subscriber'];
        readonly providers?: readonly Provider[];
        readonly overrides?: readonly KitTestOverride[];
    } = {},
): Promise<NestFastifyApplication> {
    return createMessagingApp({
        options: {
            outbox: {
                table: fixtureSchema.outbox,
                events: options.events ?? [TestNoteCreated, TestAccountTouched],
            },
            ...(options.subscriber === undefined ? {} : { subscriber: options.subscriber }),
        },
        env: options.env,
        providers: options.providers,
        overrides: options.overrides,
    });
}

/** Строка `kit.outbox` (суперпользователь). */
export interface OutboxRowView {
    readonly id: string;
    readonly seq: number;
    readonly tenant: string | null;
    readonly type: string;
    readonly subject_id: string;
    readonly actor: Record<string, unknown>;
    readonly trace_id: string;
    readonly data: Record<string, unknown>;
    readonly published_at: Date | null;
    readonly attempts: number;
    readonly last_error: string | null;
}

/** Строки `kit.outbox` по `seq`. */
export function outboxRows(): Promise<OutboxRowView[]> {
    return adminQuery<OutboxRowView>(
        `select id, seq::int as seq, tenant, type, subject_id, actor, trace_id, data, published_at, attempts,
                last_error from kit.outbox order by seq`,
    );
}

/**
 * Удаляет очереди `kit`, `kit.retry`, `kit.dlq` vhost воркера (с привязками и сообщениями): vhost живёт весь прогон,
 * очереди durable. Вызывать до создания стенда с подписчиком.
 */
export async function resetQueues(): Promise<void> {
    const broker = await BrokerClient.connect();
    try {
        for (const queue of ['kit', 'kit.retry', 'kit.dlq']) {
            await broker.deleteQueue(queue).catch(() => undefined);
        }
    } finally {
        await broker.close();
    }
}

/** Ожидаемый отказ фикстуры. */
export class TestDependencyDown extends ExpectedMessageError {
    constructor() {
        super('TEST_DEPENDENCY_DOWN', 'зависимость фикстуры недоступна');
    }
}

/** Управляемый барьер: обработчик `block` ждёт `release()`. */
export interface Barrier {
    readonly wait: Promise<void>;
    readonly release: () => void;
}

/** Новый барьер. */
export function barrier(): Barrier {
    let release = (): void => undefined;
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });

    return { wait, release };
}

/**
 * Обработчики фикстуры (`on`): режим — `data.title` (`ok`, `invalid`, `expected`, `fail`, `block`, `rls` — счёт строк
 * `kit.note`, видимых в `tx`); счётчик вызовов по
 * типу, последний `tx`, барьер для `block`, сигнал входа в обработчик.
 */
@Injectable()
export class TestConsumer implements OnModuleInit {
    /** Вызовы по типу. */
    readonly calls = new Map<string, number>();
    /** Конверты по порядку. */
    readonly received: Envelope[] = [];
    /** `tx` последнего вызова. */
    lastTx: DbTx | null | undefined;
    /** Строк `kit.note`, видимых обработчику `rls` в его транзакции. */
    visibleNotes: number | undefined;
    /** Барьер `block`. */
    gate: Barrier = barrier();
    private entered: Barrier = barrier();

    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(TestNoteCreated, (event, tx) =>
            this.handle(event, tx, event.data.title),
        );
        this.subscriber.on(TestAccountTouched, (event, tx) => this.handle(event, tx, 'ok'));
    }

    /** Число вызовов типа. */
    count(type: string = TestNoteCreated.type): number {
        return this.calls.get(type) ?? 0;
    }

    /** Сигнал: обработчик начат (сбрасывается при каждом вызове `nextEntry`). */
    nextEntry(): Promise<void> {
        this.entered = barrier();

        return this.entered.wait;
    }

    private async handle(event: Envelope, tx: DbTx | null, mode: unknown): Promise<void> {
        this.calls.set(event.type, (this.calls.get(event.type) ?? 0) + 1);
        this.received.push(event);
        this.lastTx = tx;
        this.entered.release();
        switch (mode) {
            case 'invalid':
                throw new InvalidMessageError('test-invalid');
            case 'expected':
                throw new TestDependencyDown();
            case 'fail':
                throw new Error('сбой обработчика фикстуры');
            case 'block':
                await this.gate.wait;
                return;
            case 'rls': {
                const result = await tx?.execute<{ n: number }>(
                    sql`select count(*)::int as n from kit.note`,
                );
                this.visibleNotes = result?.rows[0]?.n;
                return;
            }
            default:
                return;
        }
    }
}

/** Обработчик фикстуры на реплике (`onReplica`): режим `data.title` — `ok`, `fail`; счётчик вызовов. */
@Injectable()
export class ReplicaConsumer implements OnModuleInit {
    /** Число вызовов. */
    calls = 0;

    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.onReplica(TestNoteCreated, async (event) => {
            this.calls += 1;
            if (event.data.title === 'fail') {
                throw new Error('сбой обработчика реплики');
            }
            await Promise.resolve();
        });
    }
}

/** Конверт события фикстуры (тело сообщения). */
export function testEnvelope(
    overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
    return {
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: TestNoteCreated.type,
        version: 1,
        occurredAt: new Date().toISOString(),
        tenant: 'acme',
        actor: { channel: 'system' },
        subject: { kind: 'note', id: 'n1' },
        data: { noteId: 'n1', title: 'ok' },
        traceId: 'trace-test',
        ...overrides,
    };
}

/** Стенд подписчика с inbox фикстуры и `TestConsumer`. */
export function createSubscriberApp(
    options: {
        readonly env?: Record<string, string>;
        readonly overrides?: readonly KitTestOverride[];
    } = {},
): Promise<NestFastifyApplication> {
    return createMessagingApp({
        options: { subscriber: { inbox: fixtureSchema.inbox } },
        providers: [TestConsumer],
        env: options.env,
        overrides: options.overrides,
    });
}

/** Сумма метрики `verdeect_events_consumed_total{type, result}`. */
export async function consumed(
    app: NestFastifyApplication,
    result: string,
    type: string = TestNoteCreated.type,
): Promise<number> {
    const metric = await app.get<KitMetrics>(KIT_PACKAGE_METRICS).eventsConsumed.get();

    return metric.values
        .filter((item) => {
            const labels = item.labels as Record<string, unknown>;

            return labels['result'] === result && labels['type'] === type;
        })
        .reduce((sum, item) => sum + item.value, 0);
}

/** `init()` и ожидание готовности канала (по умолчанию — подписчика). */
export async function initReady(
    app: NestFastifyApplication,
    channel = 'subscriber',
): Promise<void> {
    await app.init();
    const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
    await waitUntil(() => connection.isChannelReady(channel), `канал ${channel}`);
}

/** Публикация конверта в verdeect.events (routing key = type). */
export function publishEnvelope(
    broker: BrokerClient,
    envelope: Record<string, unknown>,
    headers?: Record<string, unknown>,
): void {
    broker.publishRaw(String(envelope['type']), Buffer.from(JSON.stringify(envelope)), {
        messageId: String(envelope['id']),
        type: String(envelope['type']),
        ...(headers === undefined ? {} : { headers }),
    });
}

/** Логгер pino в память (подмена `KIT_LOGGER`): строки JSON с `level` (число), `msg` и полями. */
export function memoryLogger(level = 'debug'): {
    readonly logger: Logger;
    readonly lines: Record<string, unknown>[];
} {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
        write(chunk: Buffer, _encoding, done) {
            for (const line of chunk.toString('utf8').split('\n')) {
                if (line !== '') {
                    lines.push(JSON.parse(line) as Record<string, unknown>);
                }
            }
            done();
        },
    });

    return { logger: pino({ level, base: { service: 'kit', replica: 'kit-1' } }, stream), lines };
}

/** Значение `verdeect_cleanup_runs_total{table, result}`. */
export async function messagingCleanupRuns(
    app: NestFastifyApplication,
    table: 'outbox' | 'inbox',
    result: string,
): Promise<number> {
    const metric = await app.get<KitMetrics>(KIT_PACKAGE_METRICS).cleanupRuns.get();

    return metric.values
        .filter((item) => {
            const labels = item.labels as Record<string, unknown>;

            return labels['table'] === table && labels['result'] === result;
        })
        .reduce((sum, item) => sum + item.value, 0);
}

/** Стенд очистки: outbox + subscriber {inbox}; возвращается после первого прохода (`idle`). */
export async function createCleanupStand(
    options: {
        readonly env?: Record<string, string>;
        readonly overrides?: readonly KitTestOverride[];
    } = {},
): Promise<{ readonly app: NestFastifyApplication; readonly cleanup: MessagingCleanup }> {
    await resetQueues();
    const app = await createOutboxApp({
        subscriber: { inbox: fixtureSchema.inbox },
        env: options.env,
        overrides: options.overrides,
    });
    const cleanup = app.get(MessagingCleanup);
    await cleanup.idle();

    return { app, cleanup };
}
