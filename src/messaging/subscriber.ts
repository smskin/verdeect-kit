// KitSubscriber (prd.md §3.4, UC-6, AC-5.6–AC-5.9, AC-5.11, AC-5.15, AC-5.17, AC-5.19, AC-9.5). Эталон — O
// rabbit-subscriber.ts (setupQueues, toDlq, остановка), inbox-guard; из P — очередь реплики (policy-changed.consumer),
// метрика *_events_consumed_total; из B — retryCount(headers, queue). По PRD: x-dlq-reason (П7), inbox в транзакции
// подписчика (П6), проверка data и признака tenant, dedupe 'none' без БД, отказ запуска при другом TTL .retry (П8).
// Тип — по envelope.type, не по routing key (после повтора ключ — имя очереди). Тело сообщения не логируется.
import { setTimeout as sleep } from 'node:timers/promises';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Db, DbTx } from '../database/db.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError, captureThrottled } from '../observability/sentry.js';
import type { KitEvent } from './define-event.js';
import { parseEnvelope, tenantViolation, type Envelope } from './envelope.js';
import { ExpectedMessageError, InvalidMessageError, MessagingStartupError } from './errors.js';
import { claimInbox } from './inbox.js';
import {
    nestLog,
    type ManagedChannel,
    type MessagingLog,
    type RabbitConnection,
} from './rabbit-connection.js';
import { decideRedelivery, retryCount } from './redelivery.js';
import type { KitInboxTable } from './tables.js';
import {
    CONSUMER_PREFETCH,
    DLQ_REASON_HEADER,
    EVENTS_EXCHANGE,
    queuesOf,
    replicaQueueOf,
    type KitQueues,
} from './topology.js';

/**
 * Обработчик события. `tx` — транзакция `Db` с `DbContext` события (`tenant` конверта, `traceId` конверта или `id`,
 * `actor: {channel: 'system'}`); inbox уже занят в ней — изменения обработчика и отметка inbox фиксируются одним
 * `COMMIT`. При `dedupe: 'none'` `tx = null`: БД нет (роль BFF), обработчик сам идемпотентен. Порядок по `occurredAt` —
 * `ifNewer` из `/database`. Исключение: `InvalidMessageError` — DLQ, `ExpectedMessageError` — повтор, прочее — повтор,
 * после 5 повторов DLQ.
 */
export type KitEventHandler<E extends KitEvent> = (
    event: Envelope<E>,
    tx: DbTx | null,
) => Promise<void>;

/** Обработчик события на каждой реплике (`onReplica`): без inbox, повторов и DLQ. */
export type KitReplicaHandler<E extends KitEvent> = (event: Envelope<E>) => Promise<void>;

/** Итог доставки — значение метки `result` метрики `verdeect_events_consumed_total`. */
type DeliveryResult = 'handled' | 'duplicate' | 'retry' | 'dlq';

const MAIN_CHANNEL = 'subscriber';
const REPLICA_CHANNEL = 'subscriber-replica';
const UNKNOWN_TYPE = 'unknown';

/** Причины разбора — событие GlitchTip с ограничением частоты (П7). */
const PARSE_REASONS = new Set(['not-json', 'envelope', 'unsubscribed', 'tenant', 'data']);

interface Registered {
    readonly event: KitEvent;
    readonly handler: (event: Envelope, tx: DbTx | null) => Promise<void>;
}

/** Зависимости подписчика (внутренние). */
export interface KitSubscriberDeps {
    /** Имя экземпляра. */
    readonly service: string;
    /** REPLICA_ID. */
    readonly replica: string;
    /** Защита от повторов. */
    readonly dedupe: 'inbox' | 'none';
    /** Таблица inbox при `dedupe: 'inbox'`. */
    readonly inbox?: KitInboxTable;
    /** `Db` при `dedupe: 'inbox'`. */
    readonly db?: Db;
    /** Соединение. */
    readonly connection: RabbitConnection;
    /** TTL `.retry` и пауза повтора, с. */
    readonly retrySeconds: number;
    /** Метрики. */
    readonly metrics?: KitMetrics;
    /** Логгер. */
    readonly log?: MessagingLog;
}

interface DlqOptions {
    readonly report?: boolean;
    /** Отказ обработчика `InvalidMessageError`: `error`-лог без события GlitchTip (§3.4 v1.15). */
    readonly invalid?: boolean;
    readonly fields?: readonly string[];
    readonly error?: unknown;
}

function is406TtlMismatch(error: unknown): boolean {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

    return code === 406 && typeof message === 'string' && message.includes('x-message-ttl');
}

/**
 * Подписчик сервиса (§3.4): `on(Event, handler)` — очередь `<svc>` с inbox, повторами через `<svc>.retry` и DLQ
 * `<svc>.dlq`; `onReplica(Event, handler)` — очередь реплики `<svc>.replica.<REPLICA_ID>`. Сервис внедряет
 * `KitSubscriber` и регистрирует обработчики в `onModuleInit` своего провайдера.
 */
export class KitSubscriber {
    private readonly log: MessagingLog;
    private readonly queues: KitQueues;
    private readonly handlers = new Map<string, Registered>();
    private readonly replicaHandlers = new Map<string, Registered>();
    private readonly inFlight = new Set<Promise<void>>();
    private main: ManagedChannel | null = null;
    private replica: ManagedChannel | null = null;
    private started = false;
    private stopping = false;

    /** @internal Создаёт KitMessagingModule. */
    constructor(private readonly deps: KitSubscriberDeps) {
        this.log = deps.log ?? nestLog('KitSubscriber');
        this.queues = queuesOf(deps.service);
    }

    /**
     * Обработчик события из очереди `<svc>`.
     * @throws {TypeError} тип уже зарегистрирован или приложение уже запущено.
     */
    on<E extends KitEvent>(event: E, handler: KitEventHandler<E>): void {
        this.register(this.handlers, 'on', event, handler as Registered['handler']);
    }

    /**
     * Обработчик события на каждой реплике: очередь `<svc>.replica.<REPLICA_ID>` (exclusive, auto-delete), без inbox,
     * повторов и DLQ. Неразобранное сообщение или ошибка обработчика — без повтора, сообщение не сохраняется: `error`-лог,
     * событие `captureThrottled`, метрика `result: 'dlq'` (П24).
     * @throws {TypeError} тип уже зарегистрирован или приложение уже запущено.
     */
    onReplica<E extends KitEvent>(event: E, handler: KitReplicaHandler<E>): void {
        this.register(this.replicaHandlers, 'onReplica', event, (envelope) =>
            (handler as KitReplicaHandler<KitEvent>)(envelope),
        );
    }

    /** Топология, потребители и проверка TTL `.retry` до прослушивания порта (AC-5.19). */
    async onApplicationBootstrap(): Promise<void> {
        this.started = true;
        const { connection } = this.deps;
        const types = [...this.handlers.keys()];
        this.main = connection.createChannel({
            name: MAIN_CHANNEL,
            confirm: true,
            setup: (channel) => this.setupQueues(channel, types),
        });
        if (types.length > 0) {
            // Без соединения consume только регистрирует потребителя: он подключится при connect.
            this.main
                .consume(this.queues.main, (msg) => this.track(msg))
                .catch((error: unknown) => {
                    this.log.warn({ err: sanitizeError(error) }, 'messaging: consume не удался');
                });
        }
        if (this.replicaHandlers.size > 0) {
            this.openReplica();
        }
        await this.awaitStartupOutcome();
    }

    /** Шаг 3 остановки: снять потребителей → дождаться доставок → закрыть каналы, в общем сроке. */
    async beforeApplicationShutdown(): Promise<void> {
        this.stopping = true;
        const { main, replica } = this;
        if (main === null && replica === null) {
            return;
        }
        let stage: 'cancel' | 'handlers' | 'close' = 'cancel';
        const steps = (async (): Promise<true> => {
            await main?.cancelConsumers();
            await replica?.cancelConsumers();
            this.log.warn({ inFlight: this.inFlight.size }, 'messaging: потребители сняты');
            stage = 'handlers';
            await Promise.allSettled([...this.inFlight]);
            this.log.warn({}, 'messaging: доставки завершены');
            stage = 'close';
            this.main = null;
            this.replica = null;
            await main?.close();
            await replica?.close();

            return true;
        })().catch((error: unknown) => {
            this.log.warn(
                { stage, err: sanitizeError(error) },
                'messaging: шаг остановки не удался',
            );

            return true as const;
        });
        const done = await Promise.race([steps, this.deps.connection.shutdownDeadline()]);
        if (!done) {
            this.main = null;
            this.replica = null;
            this.log.warn(
                { stage, inFlight: this.inFlight.size },
                'messaging: срок остановки подписчика вышел, идём дальше',
            );
        }
    }

    private register(
        registry: Map<string, Registered>,
        method: 'on' | 'onReplica',
        event: KitEvent,
        handler: Registered['handler'],
    ): void {
        if (this.started) {
            throw new TypeError(
                `KitSubscriber.${method}: регистрация — до запуска приложения (onModuleInit)`,
            );
        }
        if (registry.has(event.type)) {
            throw new TypeError(
                `KitSubscriber.${method}: обработчик ${event.type} уже зарегистрирован`,
            );
        }
        registry.set(event.type, { event, handler });
    }

    /**
     * Первый исход подключения и настройки канала, не дольше RABBITMQ_RETRY_SECONDS (П8): другой TTL `.retry` —
     * отказ запуска; брокер недоступен или другая ошибка стадии — запуск продолжается (`/health` rabbitmq down).
     */
    private async awaitStartupOutcome(): Promise<void> {
        const { connection, retrySeconds } = this.deps;
        const limit = (): Promise<'timeout'> =>
            sleep(retrySeconds * 1000, 'timeout' as const, { ref: false });
        const attempt = await Promise.race([connection.firstAttempt(), limit()]);
        if (attempt !== 'connected') {
            return;
        }
        const outcome = await Promise.race([connection.channelOutcome(MAIN_CHANNEL), limit()]);
        if (outcome !== 'timeout' && outcome.kind === 'fatal') {
            throw outcome.error;
        }
    }

    private async setupQueues(channel: ConfirmChannel, types: readonly string[]): Promise<void> {
        const q = this.queues;
        await channel.assertQueue(q.main, {
            durable: true,
            deadLetterExchange: '',
            deadLetterRoutingKey: q.retry,
        });
        try {
            await channel.assertQueue(q.retry, {
                durable: true,
                messageTtl: this.deps.retrySeconds * 1000,
                deadLetterExchange: '',
                deadLetterRoutingKey: q.main,
            });
        } catch (error) {
            if (is406TtlMismatch(error)) {
                throw new MessagingStartupError(
                    'MESSAGING_RETRY_TTL_MISMATCH',
                    `очередь ${q.retry} объявлена с другим TTL — пересоздайте очередь`,
                    { queue: q.retry },
                );
            }
            throw error;
        }
        await channel.assertQueue(q.dlq, { durable: true });
        // prefetch — с ожиданием: опция consume amqp-connection-manager 5.0.1 вызывает prefetch без await (O).
        await channel.prefetch(CONSUMER_PREFETCH, false);
        for (const type of types) {
            await channel.bindQueue(q.main, EVENTS_EXCHANGE, type);
        }
        this.log.info({ queue: q.main, bindings: types }, 'messaging: очереди подписчика готовы');
    }

    private openReplica(): void {
        const queue = replicaQueueOf(this.deps.service, this.deps.replica);
        const types = [...this.replicaHandlers.keys()];
        this.replica = this.deps.connection.createChannel({
            name: REPLICA_CHANNEL,
            confirm: false,
            setup: async (channel) => {
                await channel.assertQueue(queue, {
                    exclusive: true,
                    autoDelete: true,
                    durable: false,
                });
                for (const type of types) {
                    await channel.bindQueue(queue, EVENTS_EXCHANGE, type);
                }
            },
        });
        this.replica
            .consume(queue, (msg) => void this.handleReplica(msg), { noAck: true })
            .catch((error: unknown) => {
                this.log.warn(
                    { err: sanitizeError(error) },
                    'messaging: consume реплики не удался',
                );
            });
    }

    /** Доставка после начала остановки не обрабатывается: без ack брокер вернёт её при закрытии канала. */
    private track(msg: ConsumeMessage | null): void {
        if (msg === null) {
            return;
        }
        if (this.stopping) {
            this.log.debug(
                { id: String(msg.properties.messageId ?? '') },
                'messaging: остановка, доставка остаётся брокеру',
            );

            return;
        }
        const handling = this.handle(msg);
        this.inFlight.add(handling);
        void handling.finally(() => this.inFlight.delete(handling));
    }

    private async handle(msg: ConsumeMessage): Promise<void> {
        const headers = msg.properties.headers;
        // UC-6 шаг 1: номер доставки по x-death.
        const delivery = retryCount(headers, this.queues.main) + 1;
        // Шаг 2: разбор конверта, тип, признак tenant, data.
        const parsed = parseEnvelope(msg.content);
        if (!parsed.ok) {
            await this.finish(UNKNOWN_TYPE, null, delivery, () =>
                this.toDlq(msg, parsed.reason, null, UNKNOWN_TYPE, delivery, {
                    fields: parsed.fields,
                }),
            );

            return;
        }
        const { envelope } = parsed;
        const registered = this.handlers.get(envelope.type);
        if (registered === undefined) {
            await this.finish(UNKNOWN_TYPE, envelope.id, delivery, () =>
                this.toDlq(msg, 'unsubscribed', envelope.id, envelope.type, delivery),
            );

            return;
        }
        const typed = this.typedEnvelope(registered.event, envelope);
        if (!typed.ok) {
            await this.finish(envelope.type, envelope.id, delivery, () =>
                this.toDlq(msg, typed.reason, envelope.id, envelope.type, delivery, {
                    fields: typed.fields,
                }),
            );

            return;
        }
        // Шаг 3: inbox и обработчик в одной транзакции (dedupe 'inbox') или без БД (dedupe 'none').
        let outcome:
            | { readonly ok: true; readonly duplicate: boolean }
            | { readonly ok: false; readonly error: unknown };
        try {
            outcome = { ok: true, duplicate: await this.invoke(registered, typed.envelope) };
        } catch (error) {
            outcome = { ok: false, error };
        }
        // Канал мог смениться, пока шёл обработчик: по доставке прошлого канала итога нет (брокер вернёт её).
        if (!this.isCurrent(msg)) {
            this.log.debug({ id: envelope.id }, 'messaging: устаревшая доставка, итог пропущен');

            return;
        }
        // Шаг 4: подтверждение, повтор или DLQ.
        await this.finish(envelope.type, envelope.id, delivery, async () => {
            if (outcome.ok) {
                this.main?.ack(msg);

                return outcome.duplicate ? 'duplicate' : 'handled';
            }

            return this.onHandlerError(msg, envelope, delivery, outcome.error);
        });
    }

    /** true — повтор `id` (inbox занят), обработчик не вызван. */
    private async invoke(registered: Registered, envelope: Envelope): Promise<boolean> {
        const { db, inbox } = this.deps;
        if (this.deps.dedupe === 'none' || db === undefined || inbox === undefined) {
            await registered.handler(envelope, null);

            return false;
        }
        const ctx = {
            tenant: envelope.tenant,
            traceId: envelope.traceId ?? envelope.id,
            actor: { channel: 'system' },
        };

        return db.transaction(ctx, async (tx) => {
            if (!(await claimInbox(tx, inbox, envelope.id, envelope.type))) {
                return true;
            }
            await registered.handler(envelope, tx);

            return false;
        });
    }

    private typedEnvelope(
        event: KitEvent,
        envelope: Envelope,
    ):
        | { readonly ok: true; readonly envelope: Envelope }
        | {
              readonly ok: false;
              readonly reason: 'tenant' | 'data';
              readonly fields: readonly string[];
          } {
        if (tenantViolation(event, envelope)) {
            return { ok: false, reason: 'tenant', fields: [] };
        }
        const data = event.data.safeParse(envelope.data);
        if (!data.success) {
            const fields = [
                ...new Set(data.error.issues.map((issue) => issue.path.join('.') || '(root)')),
            ];

            return { ok: false, reason: 'data', fields };
        }

        return { ok: true, envelope: { ...envelope, data: data.data as Record<string, unknown> } };
    }

    private async onHandlerError(
        msg: ConsumeMessage,
        envelope: Envelope,
        delivery: number,
        error: unknown,
    ): Promise<DeliveryResult | null> {
        const headers = msg.properties.headers;
        if (error instanceof InvalidMessageError) {
            return this.toDlq(msg, error.reason, envelope.id, envelope.type, delivery, {
                invalid: true,
            });
        }
        const exhausted = decideRedelivery(headers, this.queues.main) === 'dlq';
        if (error instanceof ExpectedMessageError) {
            if (exhausted) {
                return this.toDlq(msg, error.code, envelope.id, envelope.type, delivery, {
                    report: false,
                });
            }
            this.log.warn(
                { id: envelope.id, type: envelope.type, code: error.code, delivery },
                'messaging: ожидаемый отказ, повтор',
            );

            return this.toRetry(msg);
        }
        if (exhausted) {
            return this.toDlq(msg, 'retries-exhausted', envelope.id, envelope.type, delivery, {
                error,
            });
        }
        this.log.warn(
            { id: envelope.id, type: envelope.type, delivery, err: sanitizeError(error) },
            'messaging: ошибка обработчика, повтор',
        );

        return this.toRetry(msg);
    }

    /** Итог доставки: метрика и debug-строка; null — доставка прошлого канала (итога нет). */
    private async finish(
        type: string,
        id: string | null,
        delivery: number,
        decide: () => Promise<DeliveryResult | null>,
    ): Promise<void> {
        const result = await decide();
        if (result === null) {
            return;
        }
        this.deps.metrics?.eventsConsumed.inc({ type, result });
        this.log.debug({ id, type, delivery, result }, 'messaging: доставка');
    }

    /** Отказ без возврата: dead-letter → `.retry` → через TTL снова в `<svc>`. */
    private toRetry(msg: ConsumeMessage): DeliveryResult {
        this.main?.nack(msg, false, false);

        return 'retry';
    }

    /** Копия в `<svc>.dlq` с `x-dlq-reason` и ack исходного после подтверждения копии; сбой копии — повтор. */
    private async toDlq(
        msg: ConsumeMessage,
        reason: string,
        id: string | null,
        type: string,
        delivery: number,
        options: DlqOptions = {},
    ): Promise<DeliveryResult | null> {
        const channel = this.main;
        if (channel === null || !channel.isCurrent(msg)) {
            this.log.debug({ id }, 'messaging: устаревшая доставка, копия в DLQ при повторе');

            return null;
        }
        this.reportDlq(reason, id, type, delivery, options);
        try {
            await channel.sendToQueue(this.queues.dlq, msg.content, {
                persistent: true,
                messageId: msg.properties.messageId as string | undefined,
                type: msg.properties.type as string | undefined,
                contentType: msg.properties.contentType as string | undefined,
                headers: { ...msg.properties.headers, [DLQ_REASON_HEADER]: reason },
            });
            channel.ack(msg);

            return 'dlq';
        } catch (error) {
            this.log.warn({ id, err: sanitizeError(error) }, 'messaging: копия в DLQ не удалась');
            channel.nack(msg, false, false);

            return 'retry';
        }
    }

    private reportDlq(
        reason: string,
        id: string | null,
        type: string,
        delivery: number,
        options: DlqOptions,
    ): void {
        const fields = options.fields ?? [];
        if (options.report === false) {
            this.log.warn({ id, type, reason, delivery }, 'messaging: сообщение в DLQ');

            return;
        }
        this.log.error({ id, type, reason, fields, delivery }, 'messaging: сообщение в DLQ');
        if (reason === 'retries-exhausted') {
            captureError(options.error, {
                tags: { code: 'MESSAGE_DEAD_LETTERED' },
                extra: { id, type, reason },
            });

            return;
        }
        // InvalidMessageError — решение обработчика, не сбой: в GlitchTip не отправляется (§3.4 v1.15, П7).
        if (options.invalid === true || !PARSE_REASONS.has(reason)) {
            return;
        }
        captureThrottled(
            `messaging-dlq:${type}:${reason}`,
            new Error(`messaging: сообщение в DLQ (${reason})`),
        );
    }

    private isCurrent(msg: ConsumeMessage): boolean {
        return this.main !== null && this.main.isCurrent(msg);
    }

    /** Реплика (noAck): разбор, признак tenant, data, обработчик; неудача — без повторов и DLQ (П24). */
    private async handleReplica(msg: ConsumeMessage | null): Promise<void> {
        if (msg === null || this.stopping) {
            return;
        }
        const parsed = parseEnvelope(msg.content);
        if (!parsed.ok) {
            this.dropReplica(UNKNOWN_TYPE, parsed.reason);

            return;
        }
        const registered = this.replicaHandlers.get(parsed.envelope.type);
        if (registered === undefined) {
            this.dropReplica(UNKNOWN_TYPE, 'unsubscribed');

            return;
        }
        const { type } = registered.event;
        const typed = this.typedEnvelope(registered.event, parsed.envelope);
        if (!typed.ok) {
            this.dropReplica(type, typed.reason);

            return;
        }
        try {
            await registered.handler(typed.envelope, null);
            this.deps.metrics?.eventsConsumed.inc({ type, result: 'handled' });
        } catch (error) {
            this.dropReplica(type, 'handler', typed.envelope.id, error);
        }
    }

    /**
     * Реплика без повтора и DLQ — сообщение не сохраняется (§3.4 v1.15, П24): `error`-лог, событие `captureThrottled`,
     * метрика `result: 'dlq'`.
     */
    private dropReplica(
        type: string,
        reason: string,
        id: string | null = null,
        error?: unknown,
    ): void {
        this.log.error(
            { id, type, reason, ...(error === undefined ? {} : { err: sanitizeError(error) }) },
            'messaging: сообщение реплики не обработано',
        );
        captureThrottled(
            `messaging-replica:${type}:${reason}`,
            error ?? new Error(`messaging: сообщение реплики отброшено (${reason})`),
        );
        this.deps.metrics?.eventsConsumed.inc({ type, result: 'dlq' });
    }
}
