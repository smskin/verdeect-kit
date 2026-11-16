// KitSubscriber (prd.md §3.4, UC-6, AC-5.6–AC-5.9, AC-5.11, AC-5.15, AC-5.17, AC-5.19, AC-9.5). Эталон — O
// rabbit-subscriber.ts (setupQueues, toDlq, остановка), inbox-guard; из P — очередь реплики (policy-changed.consumer),
// метрика *_events_consumed_total; из B — retryCount(headers, queue). По PRD: x-dlq-reason (П7), inbox в транзакции
// подписчика (П6), проверка data и признака tenant, dedupe 'none' без БД, отказ запуска при другом TTL .retry (П8).
// Тип — по envelope.type, не по routing key (после повтора ключ — имя очереди). Тело сообщения не логируется. Обработчик —
// по паре (type, version), неподписанная версия подписанного type — ack и verdeect_events_skipped_total (AC-5.22);
// v1.28 — опция unknownVersion у on: 'dlq' отправляет неподписанную версию в <svc>.dlq с x-dlq-reason: version.
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Db, DbTx } from '../database/db.js';
import { KIT_DELIVERY_LOG_FLAG } from '../internal/tokens.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError, captureThrottled } from '../observability/sentry.js';
import { eventKey, type KitEvent } from './define-event.js';
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

/** Итог `deliverForTest` (`deliverTestEvent`, §3.8 v1.31): результат и причина DLQ (`x-dlq-reason`). @internal */
export interface KitDeliveryOutcome {
    /** Итог доставки. */
    readonly result: DeliveryResult | 'skipped';
    /** Причина DLQ — только при `dlq`. */
    readonly reason?: string;
}

/** Решение по доставке без канала (`decide`): действие, тип для метрики, id; `invoked` — обработчик вызывался. */
type Decision =
    | { readonly action: 'skip'; readonly envelope: Envelope }
    | {
          readonly action: 'ack';
          readonly result: 'handled' | 'duplicate';
          readonly metricType: string;
          readonly id: string;
          readonly invoked: true;
      }
    | {
          readonly action: 'retry';
          readonly metricType: string;
          readonly id: string;
          readonly invoked: true;
      }
    | {
          readonly action: 'dlq';
          readonly reason: string;
          readonly metricType: string;
          readonly dlqType: string;
          readonly id: string | null;
          readonly options: DlqOptions;
          readonly invoked: boolean;
      };

/** Поведение при неподписанной версии подписанного `type` (§3.4 v1.28). */
type UnknownVersion = 'skip' | 'dlq';

/** Обработчик по паре конверта: найден, `type` подписан без этой версии или `type` не подписан. */
type Lookup =
    | { readonly kind: 'found'; readonly registered: Registered }
    | { readonly kind: 'version'; readonly unknownVersion: UnknownVersion }
    | { readonly kind: 'unsubscribed' };

const MAIN_CHANNEL = 'subscriber';
const REPLICA_CHANNEL = 'subscriber-replica';
const UNKNOWN_TYPE = 'unknown';

/** Причины разбора — событие GlitchTip с ограничением частоты (П7). */
const PARSE_REASONS = new Set([
    'not-json',
    'envelope',
    'unsubscribed',
    'tenant',
    'data',
    'version',
]);

interface Registered {
    readonly event: KitEvent;
    readonly handler: (event: Envelope, tx: DbTx | null) => Promise<void>;
    /** Защита от повторов обработчика: опция `on` или `dedupe` модуля. */
    readonly dedupe: 'inbox' | 'none';
    /** Неподписанная версия `type`: опция `on` (одна на `type`); у `onReplica` — всегда `'skip'`. */
    readonly unknownVersion: UnknownVersion;
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
    /** Соединение; `null` — режим CLI (`listen: false`): обработчики принимаются, подписчик не запускается. */
    readonly connection: RabbitConnection | null;
    /** TTL `.retry`, с (RABBITMQ_RETRY_SECONDS). */
    readonly retrySeconds: number;
    /** Срок ожидания первого подключения и настройки канала, с (RABBITMQ_RECONNECT_SECONDS). */
    readonly reconnectSeconds: number;
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
    /** Версия конверта — в `error`-лог причины `version` (AC-5.22). */
    readonly version?: number;
}

function is406TtlMismatch(error: unknown): boolean {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

    return code === 406 && typeof message === 'string' && message.includes('x-message-ttl');
}

/** Решение «в DLQ» без вызова обработчика. */
function dlqDecision(
    metricType: string,
    id: string | null,
    reason: string,
    dlqType: string,
    options: DlqOptions = {},
): Extract<Decision, { readonly action: 'dlq' }> {
    return { action: 'dlq', reason, metricType, dlqType, id, options, invoked: false };
}

/**
 * Подписчик сервиса (§3.4): `on(Event, handler)` — очередь `<svc>` с inbox, повторами через `<svc>.retry` и DLQ
 * `<svc>.dlq`; `onReplica(Event, handler)` — очередь реплики `<svc>.replica.<REPLICA_ID>`. Сервис внедряет
 * `KitSubscriber` и регистрирует обработчики в `onModuleInit` своего провайдера.
 */
export class KitSubscriber {
    /** Журнал первых итогов доставки брокера по `id` (`waitForDelivery`, только при загруженном `/testing`). */
    private readonly outcomes = new Map<string, KitDeliveryOutcome>();
    /** Ожидающие итога `id`. */
    private readonly outcomeWaiters = new Map<string, Set<(outcome: KitDeliveryOutcome) => void>>();
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
     * Обработчик события из очереди `<svc>`. `dedupe` переопределяет `dedupe` модуля (§3.4 v1.25): `'none'` — без inbox
     * и без транзакции пакета, обработчик получает `(event, null)` и сам открывает короткие транзакции через `Db`;
     * `'inbox'` — inbox и транзакция `Db` с `DbContext` из конверта.
     *
     * `unknownVersion` (§3.4 v1.28, умолч. `'skip'`) — что делать с конвертом подписанного `type`, версия которого не
     * подписана: `'skip'` — ack без обработки, `verdeect_events_skipped_total`; `'dlq'` — сразу в `<svc>.dlq` с
     * `x-dlq-reason: version`, `error`-лог, `verdeect_events_consumed_total{result: 'dlq'}`, `captureThrottled`.
     * Значение относится к `type`: у всех `on` одного `type` оно одно. `'dlq'` — для учётных событий, которые нельзя
     * потерять: сообщения переигрываются из DLQ после того, как сервис научится новой версии. У `onReplica` опции нет.
     * @throws {TypeError} пара (`type`, `version`) уже зарегистрирована, приложение уже запущено, `dedupe` вне `'inbox' | 'none'`,
     * `unknownVersion` вне `'skip' | 'dlq'` или другое, чем у прежних `on` того же `type`, или `'inbox'` без таблицы
     * inbox у модуля (отказ запуска).
     */
    on<E extends KitEvent>(
        event: E,
        handler: KitEventHandler<E>,
        options: {
            readonly dedupe?: 'inbox' | 'none';
            readonly unknownVersion?: UnknownVersion;
        } = {},
    ): void {
        const dedupe = options.dedupe ?? this.deps.dedupe;
        if (dedupe !== 'inbox' && dedupe !== 'none') {
            throw new TypeError(`KitSubscriber.on: dedupe ${String(dedupe)} — 'inbox' или 'none'`);
        }
        const unknownVersion = options.unknownVersion ?? 'skip';
        if (unknownVersion !== 'skip' && unknownVersion !== 'dlq') {
            throw new TypeError(
                `KitSubscriber.on: unknownVersion ${String(unknownVersion)} — 'skip' или 'dlq'`,
            );
        }
        if (dedupe === 'inbox' && this.deps.inbox === undefined) {
            throw new TypeError(
                `KitSubscriber.on: обработчик ${event.type} с dedupe: 'inbox' — у KitMessagingModule нет таблицы inbox (subscriber.inbox: createInboxTable(schema))`,
            );
        }
        this.register(this.handlers, 'on', event, {
            event,
            handler: handler as Registered['handler'],
            dedupe,
            unknownVersion,
        });
    }

    /**
     * Обработчик события на каждой реплике: очередь `<svc>.replica.<REPLICA_ID>` (exclusive, auto-delete), без inbox,
     * повторов и DLQ. Неразобранное сообщение или ошибка обработчика — без повтора, сообщение не сохраняется: `error`-лог,
     * событие `captureThrottled`, метрика `result: 'dlq'` (П24).
     * @throws {TypeError} пара (`type`, `version`) уже зарегистрирована или приложение уже запущено.
     */
    onReplica<E extends KitEvent>(event: E, handler: KitReplicaHandler<E>): void {
        this.register(this.replicaHandlers, 'onReplica', event, {
            event,
            handler: (envelope) => (handler as KitReplicaHandler<KitEvent>)(envelope),
            dedupe: 'none',
            unknownVersion: 'skip',
        });
    }

    /** Соединение режима прослушивания; в режиме CLI сюда не доходит (подписчик не запускается). */
    private connectionOf(): RabbitConnection {
        const { connection } = this.deps;
        if (connection === null) {
            throw new Error('KitSubscriber: listen: false — соединения с брокером нет');
        }

        return connection;
    }

    /** Топология, потребители и проверка TTL `.retry` до прослушивания порта (AC-5.19). */
    async onApplicationBootstrap(): Promise<void> {
        this.started = true;
        const { connection } = this.deps;
        if (connection === null) {
            this.log.debug(
                { handlers: this.handlers.size },
                'messaging: listen: false — подписчик не запускается',
            );

            return;
        }
        const types = typesOf(this.handlers);
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
        const done = await Promise.race([steps, this.connectionOf().shutdownDeadline()]);
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
        registered: Registered,
    ): void {
        if (this.started) {
            throw new TypeError(
                `KitSubscriber.${method}: регистрация — до запуска приложения (onModuleInit)`,
            );
        }
        const key = eventKey(event);
        if (registry.has(key)) {
            throw new TypeError(
                `KitSubscriber.${method}: обработчик ${event.type} v${event.version} уже зарегистрирован`,
            );
        }
        const other = [...registry.values()].find((item) => item.event.type === event.type);
        if (other !== undefined && other.unknownVersion !== registered.unknownVersion) {
            throw new TypeError(
                `KitSubscriber.${method}: у обработчиков ${event.type} разные unknownVersion — значение одно на type`,
            );
        }
        registry.set(key, registered);
    }

    /**
     * Первый исход подключения и настройки канала, не дольше RABBITMQ_RECONNECT_SECONDS (П8, v1.25): другой TTL `.retry` —
     * отказ запуска; брокер недоступен или другая ошибка стадии — запуск продолжается (`/health` rabbitmq down).
     */
    private async awaitStartupOutcome(): Promise<void> {
        const { reconnectSeconds } = this.deps;
        const connection = this.connectionOf();
        // Один срок на подключение и исход настройки канала (§3.4 v1.26): не два срока подряд.
        let timer: NodeJS.Timeout | undefined;
        const limit = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), reconnectSeconds * 1000);
            timer.unref();
        });
        const outcome = await Promise.race([
            connection
                .firstAttempt()
                .then((attempt) =>
                    attempt === 'connected' ? connection.channelOutcome(MAIN_CHANNEL) : null,
                ),
            limit,
        ]);
        clearTimeout(timer);
        if (outcome === 'timeout') {
            this.log.debug(
                { reconnectSeconds },
                'messaging: первое подключение — срок вышел, запуск продолжается',
            );

            return;
        }
        if (outcome !== null && outcome.kind === 'fatal') {
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
        const types = typesOf(this.replicaHandlers);
        this.replica = this.connectionOf().createChannel({
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
        // Шаги 2–3: разбор, выбор обработчика, data, inbox и обработчик — общий путь с deliverForTest.
        const decision = await this.decide(msg.content, delivery, headers);
        if (decision.action === 'skip') {
            // UC-6 А8: версия не подписана — ack без inbox, проверки data и обработчика.
            if (this.isCurrent(msg)) {
                this.main?.ack(msg);
                this.skip(decision.envelope);
                this.recordOutcome(decision.envelope.id, { result: 'skipped' });
            }

            return;
        }
        // Канал мог смениться, пока шёл обработчик: по доставке прошлого канала итога нет (брокер вернёт её).
        if (decision.invoked && !this.isCurrent(msg)) {
            this.log.debug({ id: decision.id }, 'messaging: устаревшая доставка, итог пропущен');

            return;
        }
        // Шаг 4: подтверждение, повтор или DLQ.
        const result = await this.finish(decision.metricType, decision.id, delivery, () =>
            this.act(msg, decision, delivery),
        );
        // Причина — только при итоговом dlq (сбой копии в DLQ даёт retry без причины); duplicate в журнал не пишется.
        if (decision.id !== null && result !== null && result !== 'duplicate') {
            this.recordOutcome(
                decision.id,
                result === 'dlq' && decision.action === 'dlq'
                    ? { result, reason: decision.reason }
                    : { result },
            );
        }
    }

    /** Первый итог `id` в журнал и ожидающим — только если `/testing` загружен (флаг `globalThis`). */
    private recordOutcome(id: string, outcome: KitDeliveryOutcome): void {
        if ((globalThis as Record<symbol, unknown>)[KIT_DELIVERY_LOG_FLAG] !== true) {
            return;
        }
        if (this.outcomes.has(id)) {
            return;
        }
        this.outcomes.set(id, outcome);
        for (const notify of this.outcomeWaiters.get(id) ?? []) {
            notify(outcome);
        }
        this.outcomeWaiters.delete(id);
    }

    /**
     * @internal Первый итог доставки брокера `id` в этом экземпляре (`waitForDelivery`): сразу, если записан, иначе
     * ожидание до `timeoutMs`; по сроку — `Error` с `id`.
     */
    awaitOutcome(id: string, timeoutMs: number): Promise<KitDeliveryOutcome> {
        const known = this.outcomes.get(id);
        if (known !== undefined) {
            return Promise.resolve(known);
        }

        return new Promise((resolve, reject) => {
            const waiters = this.outcomeWaiters.get(id) ?? new Set();
            this.outcomeWaiters.set(id, waiters);
            const notify = (outcome: KitDeliveryOutcome): void => {
                clearTimeout(timer);
                resolve(outcome);
            };
            const timer = setTimeout(() => {
                waiters.delete(notify);
                reject(
                    new Error(`waitForDelivery: доставка ${id} не завершилась за ${timeoutMs} мс`),
                );
            }, timeoutMs);
            timer.unref();
            waiters.add(notify);
        });
    }

    /** Выполняет решение `decide` на канале: ack, повтор или копия в DLQ. */
    private async act(
        msg: ConsumeMessage,
        decision: Exclude<Decision, { readonly action: 'skip' }>,
        delivery: number,
    ): Promise<DeliveryResult | null> {
        switch (decision.action) {
            case 'ack':
                this.main?.ack(msg);

                return decision.result;
            case 'retry':
                return this.toRetry(msg);
            case 'dlq':
                return this.toDlq(
                    msg,
                    decision.reason,
                    decision.id,
                    decision.dlqType,
                    delivery,
                    decision.options,
                );
        }
    }

    /**
     * Классификация доставки без канала (§3.4, UC-6 шаги 2–3): разбор конверта, выбор по (`type`, `version`), проверка
     * `data`, inbox и обработчик в транзакции `Db`, классификация ошибки обработчика. Общая для `handle()` и
     * `deliverForTest()`; `headers` — для числа повторов (нет — первая доставка).
     */
    private async decide(
        content: Buffer,
        delivery: number,
        headers: Record<string, unknown> | undefined,
    ): Promise<Decision> {
        const parsed = parseEnvelope(content);
        if (!parsed.ok) {
            return dlqDecision(UNKNOWN_TYPE, null, parsed.reason, UNKNOWN_TYPE, {
                fields: parsed.fields,
            });
        }
        const { envelope } = parsed;
        const lookup = lookupHandler(this.handlers, envelope);
        if (lookup.kind === 'unsubscribed') {
            return dlqDecision(UNKNOWN_TYPE, envelope.id, 'unsubscribed', envelope.type);
        }
        if (lookup.kind === 'version' && lookup.unknownVersion === 'dlq') {
            // UC-6 А8, unknownVersion: 'dlq' (v1.28): сразу в DLQ без inbox, проверки data и обработчика.
            return dlqDecision(envelope.type, envelope.id, 'version', envelope.type, {
                version: envelope.version,
            });
        }
        if (lookup.kind === 'version') {
            return { action: 'skip', envelope };
        }
        const { registered } = lookup;
        const typed = this.typedEnvelope(registered.event, envelope);
        if (!typed.ok) {
            return dlqDecision(envelope.type, envelope.id, typed.reason, envelope.type, {
                fields: typed.fields,
            });
        }
        // Шаг 3: inbox и обработчик в одной транзакции (dedupe 'inbox') или без БД (dedupe 'none').
        try {
            const duplicate = await this.invoke(registered, typed.envelope);

            return {
                action: 'ack',
                result: duplicate ? 'duplicate' : 'handled',
                metricType: envelope.type,
                id: envelope.id,
                invoked: true,
            };
        } catch (error) {
            return this.onHandlerError(envelope, delivery, headers, error);
        }
    }

    /**
     * @internal Доставка конверта для тестов (`deliverTestEvent`, §3.8 v1.31): тот же путь, что `handle()`, без канала —
     * без ack/nack и копии в DLQ; номер доставки 1. Метрика `verdeect_events_consumed_total` и `debug`-лог — как у
     * доставки; итог — `handled | duplicate | skipped | retry | dlq` (`reason` — значение `x-dlq-reason`).
     */
    async deliverForTest(content: Buffer): Promise<KitDeliveryOutcome> {
        const decision = await this.decide(content, 1, undefined);
        if (decision.action === 'skip') {
            this.skip(decision.envelope);
            this.log.debug(
                { id: decision.envelope.id, type: decision.envelope.type, result: 'skipped' },
                'messaging: доставка (deliverTestEvent)',
            );

            return { result: 'skipped' };
        }
        const result = decision.action === 'ack' ? decision.result : decision.action;
        this.deps.metrics?.eventsConsumed.inc({ type: decision.metricType, result });
        this.log.debug(
            { id: decision.id, type: decision.metricType, result },
            'messaging: доставка (deliverTestEvent)',
        );

        return decision.action === 'dlq' ? { result, reason: decision.reason } : { result };
    }

    /** true — повтор `id` (inbox занят), обработчик не вызван. */
    private async invoke(registered: Registered, envelope: Envelope): Promise<boolean> {
        const { db, inbox } = this.deps;
        if (registered.dedupe === 'none' || db === undefined || inbox === undefined) {
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

    private onHandlerError(
        envelope: Envelope,
        delivery: number,
        headers: Record<string, unknown> | undefined,
        error: unknown,
    ): Decision {
        const base = { metricType: envelope.type, id: envelope.id, invoked: true } as const;
        if (error instanceof InvalidMessageError) {
            return {
                ...dlqDecision(envelope.type, envelope.id, error.reason, envelope.type, {
                    invalid: true,
                }),
                invoked: true,
            };
        }
        const exhausted = decideRedelivery(headers, this.queues.main) === 'dlq';
        if (error instanceof ExpectedMessageError) {
            if (exhausted) {
                return {
                    ...dlqDecision(envelope.type, envelope.id, error.code, envelope.type, {
                        report: false,
                    }),
                    invoked: true,
                };
            }
            this.log.warn(
                { id: envelope.id, type: envelope.type, code: error.code, delivery },
                'messaging: ожидаемый отказ, повтор',
            );

            return { action: 'retry', ...base };
        }
        if (exhausted) {
            return {
                ...dlqDecision(envelope.type, envelope.id, 'retries-exhausted', envelope.type, {
                    error,
                }),
                invoked: true,
            };
        }
        this.log.warn(
            { id: envelope.id, type: envelope.type, delivery, err: sanitizeError(error) },
            'messaging: ошибка обработчика, повтор',
        );

        return { action: 'retry', ...base };
    }

    /** Итог доставки: метрика и debug-строка; null — доставка прошлого канала (итога нет). */
    private async finish(
        type: string,
        id: string | null,
        delivery: number,
        decide: () => Promise<DeliveryResult | null>,
    ): Promise<DeliveryResult | null> {
        const result = await decide();
        if (result === null) {
            return null;
        }
        this.deps.metrics?.eventsConsumed.inc({ type, result });
        this.log.debug({ id, type, delivery, result }, 'messaging: доставка');

        return result;
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
        this.log.error(
            {
                id,
                type,
                reason,
                fields,
                delivery,
                ...(options.version === undefined ? {} : { version: options.version }),
            },
            'messaging: сообщение в DLQ',
        );
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
        const lookup = lookupHandler(this.replicaHandlers, parsed.envelope);
        if (lookup.kind === 'unsubscribed') {
            this.dropReplica(UNKNOWN_TYPE, 'unsubscribed');

            return;
        }
        if (lookup.kind === 'version') {
            this.skip(parsed.envelope);

            return;
        }
        const { registered } = lookup;
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

    /** Неподписанная версия подписанного `type`: метрика `skipped` и debug-строка (AC-5.22). */
    private skip(envelope: Envelope): void {
        this.deps.metrics?.eventsSkipped.inc({
            type: envelope.type,
            version: String(envelope.version),
        });
        this.log.debug(
            { id: envelope.id, type: envelope.type, version: envelope.version },
            'messaging: версия события не подписана — подтверждено без обработки',
        );
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

/** Уникальные `type` реестра — привязки очереди. */
function typesOf(registry: ReadonlyMap<string, Registered>): string[] {
    return [...new Set([...registry.values()].map(({ event }) => event.type))];
}

function lookupHandler(
    registry: ReadonlyMap<string, Registered>,
    envelope: Pick<Envelope, 'type' | 'version'>,
): Lookup {
    const registered = registry.get(eventKey(envelope));
    if (registered !== undefined) {
        return { kind: 'found', registered };
    }
    // Значение unknownVersion одинаково у всех записей type (проверяет register).
    const sameType = [...registry.values()].find(({ event }) => event.type === envelope.type);

    return sameType === undefined
        ? { kind: 'unsubscribed' }
        : { kind: 'version', unknownVersion: sameType.unknownVersion };
}
