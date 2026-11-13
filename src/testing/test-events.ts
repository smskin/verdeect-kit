// publishTestEvent, waitForInbox, waitForBrokerReady (prd.md §3.8 E5 v1.25, UC-14, AC-5.13, AC-5.18; П17, П18). Эталон — O test/support/bus.ts
// (publishEvent, waitInbox). amqplib, pg, vitest — loadPeer при вызове: /testing импортируется без них; /messaging
// не импортируется (без peer.ts) — только envelope.ts и define-event.ts.
import type { INestApplicationContext } from '@nestjs/common';
import type * as Amqp from 'amqplib';
import type Pg from 'pg';
import type * as Vitest from 'vitest';
import type { z } from 'zod';
import { newId } from '../internal/ids.js';
import { loadPeer } from '../internal/peer.js';
import { EVENTS_EXCHANGE } from '../internal/rabbitmq-definitions.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import type { KitEvent } from '../messaging/define-event.js';
import { EnvelopeSchema, type Envelope } from '../messaging/envelope.js';
import { HealthRegistry } from '../observability/health-registry.js';
import { TEST_TIMEOUT_SCALE } from './timeout-scale.js';
import { workerScope } from './worker-scope.js';
import { INBOX_TABLE } from '../internal/outbox-policy.js';

/** Опции `publishTestEvent`. */
export interface KitPublishTestEventOptions {
    /** id события; по умолчанию `evt_` + ULID. */
    readonly id?: string;
    /** Тенант; по умолчанию `workerScope().tenant` для `'required'`, `null` для `'none'`; может нарушать признак. */
    readonly tenant?: string | null;
    /** id субъекта; по умолчанию `tst_` + ULID. */
    readonly subjectId?: string;
    /** Время события; по умолчанию — сейчас. */
    readonly occurredAt?: Date;
    /** Актор; по умолчанию `{channel: 'system'}`. */
    readonly actor?: Record<string, unknown> | null;
    /** traceId; по умолчанию `null`. */
    readonly traceId?: string | null;
}

let channel: Promise<Amqp.ConfirmChannel> | undefined;
let closed: Promise<void> | undefined;
let model: Amqp.ChannelModel | undefined;
let urlOverride: string | undefined;

/** @internal Адрес вместо `adminUrl` воркера (тест пакета: обрыв через tcpProxy); `undefined` — сброс. */
export function setTestEventsUrl(url: string | undefined): void {
    urlOverride = url;
    // Другой адрес — другое соединение: прежнее закрывается, следующий вызов откроет новое.
    channel = undefined;
    void model?.close().catch(() => undefined);
    model = undefined;
}

/** @internal Закрытие текущего соединения `publishTestEvent` (сигнал теста пакета); нет соединения — `undefined`. */
export function testEventsClosed(): Promise<void> | undefined {
    return closed;
}

async function adminUrl(): Promise<string> {
    if (urlOverride !== undefined) {
        return urlOverride;
    }
    const { inject } = await loadPeer<typeof Vitest>('vitest', 'testing');
    const pool = Number(process.env.VITEST_POOL_ID ?? '1');
    const worker = inject('kitRabbitmqWorkers')?.[pool - 1];
    if (worker === undefined) {
        throw new TypeError('publishTestEvent: startTestStack запущен без rabbitmq: true');
    }

    return worker.adminUrl;
}

async function openChannel(): Promise<Amqp.ConfirmChannel> {
    const amqp = await loadPeer<typeof Amqp>('amqplib', 'testing');
    const connection = await amqp.connect(await adminUrl());
    let created: Amqp.ConfirmChannel;
    try {
        created = await connection.createConfirmChannel();
    } catch (error) {
        // Канал не открылся — соединение закрывается: повторные вызовы не копят открытые соединения.
        await connection.close().catch(() => undefined);
        throw error;
    }
    model = connection;
    const current = channel;
    // Обрыв соединения или закрытие канала — следующий вызов открывает новое соединение.
    const forget = (): void => {
        if (channel === current) {
            channel = undefined;
        }
    };
    closed = new Promise((resolve) => {
        connection.once('close', () => {
            forget();
            resolve();
        });
    });
    connection.on('error', forget);
    created.on('error', forget);
    created.once('close', forget);

    return created;
}

/** Confirm-канал администратора vhost воркера, один на воркер; после обрыва пересоздаётся при следующем вызове. */
function workerChannel(): Promise<Amqp.ConfirmChannel> {
    if (channel === undefined) {
        const opening = openChannel();
        channel = opening;
        // Неудачное подключение не запоминается: следующий вызов пробует снова.
        opening.catch(() => {
            if (channel === opening) {
                channel = undefined;
            }
        });
    }

    return channel;
}

/**
 * Публикует конверт `01` §7.1 в `verdeect.events` от имени администратора vhost воркера — как relay другого сервиса;
 * ждёт подтверждения брокера.
 * @returns опубликованный конверт.
 * @throws {ZodError} `data` не по схеме события.
 */
export async function publishTestEvent<E extends KitEvent>(
    event: E,
    data: z.input<E['data']>,
    opts: KitPublishTestEventOptions = {},
): Promise<Envelope<E>> {
    const parsed = event.data.parse(data) as Record<string, unknown>;
    const tenant =
        opts.tenant !== undefined
            ? opts.tenant
            : event.tenant === 'required'
              ? workerScope().tenant
              : null;
    const occurredAt = opts.occurredAt ?? new Date();
    const envelope = EnvelopeSchema.parse({
        id: opts.id ?? newId('evt'),
        type: event.type,
        version: event.version,
        occurredAt: occurredAt.toISOString(),
        tenant,
        actor: opts.actor === undefined ? { channel: 'system' } : opts.actor,
        subject: { kind: event.subject, id: opts.subjectId ?? newId('tst') },
        data: parsed,
        traceId: opts.traceId ?? null,
    });
    const confirm = await workerChannel();
    confirm.publish(EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        messageId: envelope.id,
        type: event.type,
        contentType: 'application/json',
        timestamp: Math.floor(occurredAt.getTime() / 1000),
    });
    await confirm.waitForConfirms();

    return envelope as Envelope<E>;
}

/**
 * Ждёт строку `id` в `<svc>.inbox` (обработка подписчиком с `dedupe: 'inbox'`) с шагом 20 мс до
 * `timeoutMs × TEST_TIMEOUT_SCALE` — без `sleep` в тесте. Для `dedupe: 'none'` ждать побочный эффект обработчика.
 * @throws {Error} срок вышел — «waitForInbox: событие <id> не обработано за <timeoutMs> мс».
 */
export async function waitForInbox(
    id: string,
    options: { readonly timeoutMs: number },
): Promise<void> {
    const { inject } = await loadPeer<typeof Vitest>('vitest', 'testing');
    const schema = inject('kitDatabaseService');
    const url = inject('kitDatabaseUrl');
    if (schema === undefined || url === undefined) {
        throw new TypeError('waitForInbox: startTestStack запущен без postgres');
    }
    const pg = (await loadPeer<{ default: typeof Pg }>('pg', 'testing')).default;
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => undefined);
    await client.connect();
    const text = `select 1 from ${quoteIdentifier(schema)}.${quoteIdentifier(INBOX_TABLE)} where id = $1`;
    const deadline = Date.now() + options.timeoutMs * TEST_TIMEOUT_SCALE;
    try {
        for (;;) {
            if ((await client.query(text, [id])).rowCount !== 0) {
                return;
            }
            if (Date.now() > deadline) {
                throw new Error(
                    `waitForInbox: событие ${id} не обработано за ${options.timeoutMs} мс (нет строки в ${schema}.${INBOX_TABLE})`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    } finally {
        await client.end();
    }
}

/** Шаг опроса `waitForBrokerReady`, мс. */
const BROKER_READY_POLL_MS = 20;

/** Срок `waitForBrokerReady` по умолчанию, мс (× `TEST_TIMEOUT_SCALE`). */
const BROKER_READY_TIMEOUT_MS = 10_000;

/**
 * Ждёт пробу `/health` `rabbitmq: up` приложения (соединение и канал): после рестарта брокера или обрыва в тесте
 * сервиса. Опрос с шагом 20 мс до `timeoutMs × TEST_TIMEOUT_SCALE` (умолч. 10 с) — ожидание результата, не пауза.
 * Короткие сроки переподключения в тестах — `RABBITMQ_RECONNECT_SECONDS`.
 * @throws {Error} у приложения нет пробы `rabbitmq` (не подключён `KitMessagingModule` с `listen: true`) или срок вышел.
 */
export async function waitForBrokerReady(
    app: Pick<INestApplicationContext, 'get'>,
    options: { readonly timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = options.timeoutMs ?? BROKER_READY_TIMEOUT_MS;
    const health = app.get(HealthRegistry);
    const deadline = Date.now() + timeoutMs * TEST_TIMEOUT_SCALE;
    for (;;) {
        const { status, checks } = await health.evaluate();
        if (checks['rabbitmq'] === 'up') {
            return;
        }
        // Во время остановки проб нет (unavailable, checks {}) — это не «нет пробы».
        if (checks['rabbitmq'] === undefined && status !== 'unavailable') {
            throw new Error(
                'waitForBrokerReady: у приложения нет пробы rabbitmq (KitMessagingModule с listen: true)',
            );
        }
        if (Date.now() > deadline) {
            throw new Error(`waitForBrokerReady: брокер не готов за ${String(timeoutMs)} мс`);
        }
        await new Promise((resolve) => setTimeout(resolve, BROKER_READY_POLL_MS));
    }
}
