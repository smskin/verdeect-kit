// RabbitConnection, ManagedChannel (prd.md §3.4 «соединение — основа O», AC-5.4, AC-5.11, AC-5.19). Эталон — O
// rabbit-connection.ts (P — без cancelConsumers/stopped). Отличия: фабрика модуля вместо DI, amqp-connection-manager —
// loadPeer в start() (без top-level await, AC-1.2), срок остановки из SHUTDOWN_TIMEOUT_MS (П9), captureError пакета,
// фатальная ошибка настройки (MessagingStartupError, 406 TTL .retry) без повторов (AC-5.19, П8), topologyReady без
// каналов — true, первый исход подключения и настройки канала (firstAttempt, channelOutcome). Exchange
// verdeect.events — только checkExchange. В лог идёт только host:port: RABBITMQ_URL содержит пароль.
import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import type * as Acm from 'amqp-connection-manager';
import type {
    AmqpConnectionManager,
    ChannelWrapper,
    CreateChannelOpts,
    Options,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage, Message, Options as AmqpOptions } from 'amqplib';
import { loadPeer } from '../internal/peer.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { MessagingStartupError } from './errors.js';
import {
    CHANNEL_CLOSE_TIMEOUT_MS,
    CONNECTION_CLOSE_TIMEOUT_MS,
    EVENTS_EXCHANGE,
    HEARTBEAT_SECONDS,
} from './topology.js';

/** Опции канала. */
export interface ChannelOptions {
    /** Имя канала (уникально в соединении). */
    readonly name: string;
    /** Канал с подтверждениями брокера. */
    readonly confirm: boolean;
    /** Таймаут подтверждения публикации, мс. */
    readonly publishTimeout?: number;
    /**
     * Настройка канала после проверки exchange; вызывается при каждом (пере)подключении. `MessagingStartupError` —
     * фатальная ошибка: канал не повторяется.
     */
    readonly setup?: (channel: ConfirmChannel) => Promise<void>;
}

/** Логгер фоновых операций /messaging: pino экземпляра (`service`, `replica` в `base`) или адаптер логгера Nest. */
export interface MessagingLog {
    /** Уровень debug. */
    debug(fields: object, message: string): void;
    /** Уровень info. */
    info(fields: object, message: string): void;
    /** Уровень warn. */
    warn(fields: object, message: string): void;
    /** Уровень error. */
    error(fields: object, message: string): void;
}

/** Адаптер логгера Nest (приложение без KIT_LOGGER). */
export function nestLog(context: string): MessagingLog {
    const logger = new Logger(context);

    return {
        debug: (fields, message) => logger.debug(fields, message),
        info: (fields, message) => logger.log(fields, message),
        warn: (fields, message) => logger.warn(fields, message),
        error: (fields, message) => logger.error(fields, message),
    };
}

/** Опции соединения. */
export interface RabbitConnectionOptions {
    /** Логгер; по умолчанию — логгер Nest. */
    readonly log?: MessagingLog;
    /** RABBITMQ_URL. */
    readonly url: string;
    /** Пауза переподключения и повтора настройки канала, с (RABBITMQ_RETRY_SECONDS). */
    readonly retrySeconds: number;
    /** Общий срок обработчиков остановки, мс (handlersDeadlineMs). */
    readonly deadlineMs: number;
}

/** Первый исход настройки канала после createChannel. */
export type ChannelOutcome =
    | { readonly kind: 'ready' }
    | { readonly kind: 'fatal'; readonly error: Error }
    | { readonly kind: 'failed'; readonly error: Error };

/** host:port адреса брокера, без учётных данных и vhost. */
export function brokerEndpoint(url: string): string {
    try {
        const parsed = new URL(url);
        // URL не хранит порт по умолчанию: amqps — 5671, amqp — 5672.
        const port = parsed.port || (parsed.protocol === 'amqps:' ? '5671' : '5672');

        return `${parsed.hostname}:${port}`;
    } catch {
        return '(invalid url)';
    }
}

/** true — операция завершилась (успехом или ошибкой) не позже срока. */
async function settlesWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
    return Promise.race([
        operation.then(
            () => true,
            () => true,
        ),
        sleep(timeoutMs, false, { ref: false }),
    ]);
}

/** Канал закрыт разрывом соединения: менеджер переподключится и повторит setup сам. */
function isConnectionLoss(error: unknown): boolean {
    return error instanceof Error && error.name === 'IllegalOperationError';
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/** ready — обработчики готовности канала (onChannelReady). */
type SetupStage = 'exchange' | 'setup' | 'ready';

interface Consumer {
    readonly queue: string;
    readonly onMessage: (msg: ConsumeMessage) => void;
    readonly options: AmqpOptions.Consume | undefined;
}

/**
 * Канал relay и подписчика: ссылка не меняется, когда RabbitConnection заменяет ChannelWrapper после сбоя настройки;
 * потребители переносятся. Delivery tag действует только в канале amqplib, выдавшем доставку: каждое открытие —
 * новое поколение; ack/nack прошлого поколения не отправляются (чужой tag дал бы 406 и закрыл новый канал).
 */
export class ManagedChannel {
    private readonly consumers: Consumer[] = [];
    private readonly deliveries = new WeakMap<Message, number>();
    private generation = 0;
    private closed = false;
    /** Ошибка брокера, закрывшего текущий канал amqplib (код и текст ответа); сброс при открытии нового. */
    private brokerError: Error | null = null;

    constructor(
        readonly name: string,
        private current: ChannelWrapper,
        private readonly onClose: () => void,
        private readonly logger: MessagingLog = nestLog('ManagedChannel'),
    ) {}

    /** Открыт новый канал amqplib (в начале setup, до переподписки потребителей). */
    markOpened(): void {
        this.generation += 1;
        this.brokerError = null;
    }

    /** Брокер закрыл канал с ошибкой: событие 'error' amqplib приходит до отказа неподтверждённых публикаций. */
    markBrokerError(error: Error): void {
        this.brokerError = error;
    }

    /** Доставка пришла через текущий канал amqplib (или не отслеживается). */
    isCurrent(message: Message): boolean {
        const generation = this.deliveries.get(message);

        return generation === undefined || generation === this.generation;
    }

    /**
     * Публикация (на confirm-канале — Promise подтверждения). Отказ из-за закрытия канала брокером несёт его причину
     * (`ACCESS_REFUSED - …`), а не «channel closed».
     */
    publish(
        exchange: string,
        routingKey: string,
        content: Buffer,
        options?: Options.Publish,
    ): Promise<boolean> {
        return this.current
            .publish(exchange, routingKey, content, options)
            .catch((error: unknown) => {
                // Только отказ закрытием канала amqplib; таймаут и прочие отказы — как есть.
                const closed = error instanceof Error && error.message === 'channel closed';
                throw closed && this.brokerError !== null ? this.brokerError : error;
            });
    }

    /** Публикация в очередь. */
    sendToQueue(queue: string, content: Buffer, options?: Options.Publish): Promise<boolean> {
        return this.current.sendToQueue(queue, content, options);
    }

    /** Потребитель; переносится на следующий wrapper. */
    consume(
        queue: string,
        onMessage: (msg: ConsumeMessage) => void,
        options?: AmqpOptions.Consume,
    ): Promise<unknown> {
        const tracked = (msg: ConsumeMessage): void => {
            this.deliveries.set(msg, this.generation);
            onMessage(msg);
        };
        this.consumers.push({ queue, onMessage: tracked, options });

        return this.current.consume(queue, tracked, options);
    }

    /** ack; устаревшая доставка пропускается. */
    ack(message: Message): void {
        if (this.isStale(message, 'ack')) {
            return;
        }
        this.current.ack(message);
    }

    /** nack; устаревшая доставка пропускается. */
    nack(message: Message, allUpTo?: boolean, requeue?: boolean): void {
        if (this.isStale(message, 'nack')) {
            return;
        }
        this.current.nack(message, allUpTo, requeue);
    }

    /** Снять всех потребителей (basic.cancel): канал открыт — ack/nack доставок в работе ещё уходят. */
    async cancelConsumers(): Promise<void> {
        this.consumers.length = 0;
        await this.current.cancelAll().catch(() => undefined);
    }

    /** Не дольше CHANNEL_CLOSE_TIMEOUT_MS: брокер молчит — канал бросается, его закроет закрытие соединения. */
    async close(): Promise<void> {
        this.closed = true;
        this.onClose();
        if (!(await settlesWithin(this.current.close(), CHANNEL_CLOSE_TIMEOUT_MS))) {
            this.logger.warn(
                { channel: this.name, timeoutMs: CHANNEL_CLOSE_TIMEOUT_MS },
                'rabbitmq: брокер не ответил на закрытие канала, канал брошен',
            );
        }
    }

    /** Новый wrapper вместо старого; false — канал уже закрыт владельцем. */
    async replace(next: ChannelWrapper): Promise<boolean> {
        if (this.closed) {
            await next.close();

            return false;
        }
        const previous = this.current;
        this.current = next;
        await previous.close().catch(() => undefined);
        for (const consumer of this.consumers) {
            // Без соединения consume только регистрирует потребителя: он подключится при connect.
            void next
                .consume(consumer.queue, consumer.onMessage, consumer.options)
                .catch(() => undefined);
        }

        return true;
    }

    private isStale(message: Message, action: 'ack' | 'nack'): boolean {
        if (this.isCurrent(message)) {
            return false;
        }
        this.logger.debug(
            { channel: this.name, action, generation: this.deliveries.get(message) },
            'rabbitmq: подтверждение устаревшей доставки пропущено',
        );

        return true;
    }
}

interface ChannelState {
    readonly options: ChannelOptions;
    readonly channel: ManagedChannel;
    ready: boolean;
    /** Фатальная ошибка настройки: повторов нет (AC-5.19). */
    fatal: boolean;
    /** Настроенный канал amqplib; null — заменяется или ещё не настроен. */
    raw: ConfirmChannel | null;
    /** Последняя ошибка, с которой брокер закрыл канал. */
    lastBrokerError: Error | null;
    readonly outcome: Promise<ChannelOutcome>;
    settle: (outcome: ChannelOutcome) => void;
}

/** Соединение сервиса с брокером: одно на relay и подписчика, ленивое (`start`), переподключение и heartbeat. */
export class RabbitConnection {
    private readonly logger: MessagingLog;
    private manager: AmqpConnectionManager | null = null;
    private starting: Promise<void> | null = null;
    private first: Promise<'connected' | 'failed'> | null = null;
    private readonly endpoint: string;
    private readonly channels = new Map<string, ChannelState>();
    private readonly readyListeners = new Map<string, Set<() => void>>();
    /** Ошибка exchange уже отправлена (сбрасывается, когда все каналы настроены). */
    private exchangeMissingReported = false;
    /** Каналы, чьё исключение обработчика готовности уже отправлено. */
    private readonly readyFailureReported = new Set<string>();
    private retryTimer: NodeJS.Timeout | undefined;
    /** Остановка началась: таймер повтора больше не взводится. */
    private stopped = false;
    private stopDeadline: Promise<false> | null = null;

    constructor(private readonly options: RabbitConnectionOptions) {
        this.endpoint = brokerEndpoint(options.url);
        this.logger = options.log ?? nestLog('RabbitConnection');
    }

    /** Загружает amqp-connection-manager и запускает соединение в фоне (без ожидания подключения); идемпотентный. */
    start(): Promise<void> {
        this.starting ??= this.open();

        return this.starting;
    }

    /** Первый исход подключения после `start`: `connected` или `failed`. */
    firstAttempt(): Promise<'connected' | 'failed'> {
        if (this.first === null) {
            throw new Error('RabbitConnection: start() не вызван');
        }

        return this.first;
    }

    /** Соединение установлено. */
    isConnected(): boolean {
        return this.manager?.isConnected() ?? false;
    }

    /** Все созданные каналы настроены; без каналов — `true` (проба отражает только соединение). */
    topologyReady(): boolean {
        return [...this.channels.values()].every((state) => state.ready);
    }

    /** Канал с этим именем настроен. */
    isChannelReady(name: string): boolean {
        return this.channels.get(name)?.ready ?? false;
    }

    /** Подписка на каждую успешную настройку канала; возвращает отписку. */
    onChannelReady(name: string, listener: () => void): () => void {
        let listeners = this.readyListeners.get(name);
        if (listeners === undefined) {
            listeners = new Set();
            this.readyListeners.set(name, listeners);
        }
        listeners.add(listener);

        return () => {
            this.readyListeners.get(name)?.delete(listener);
        };
    }

    /**
     * Общий срок остановки обмена с брокером: отсчёт — с первого вызова в beforeApplicationShutdown (relay,
     * подписчик), resolve(false) через `deadlineMs`. Nest вызывает хуки по очереди — у каждого свой срок сложился бы.
     */
    shutdownDeadline(): Promise<false> {
        this.stopDeadline ??= sleep(this.options.deadlineMs, false, { ref: false });

        return this.stopDeadline;
    }

    /** Первый исход настройки канала: готов, фатальная ошибка `setup` или прочая ошибка стадии. */
    channelOutcome(name: string): Promise<ChannelOutcome> {
        const state = this.channels.get(name);
        if (state === undefined) {
            throw new Error(`RabbitConnection: канала ${name} нет`);
        }

        return state.outcome;
    }

    /** Канал; `start()` должен быть завершён. */
    createChannel(options: ChannelOptions): ManagedChannel {
        const name = options.name;
        let settle: (outcome: ChannelOutcome) => void = () => undefined;
        const outcome = new Promise<ChannelOutcome>((resolve) => {
            settle = resolve;
        });
        const state: ChannelState = {
            options,
            channel: undefined as unknown as ManagedChannel,
            ready: false,
            fatal: false,
            raw: null,
            lastBrokerError: null,
            outcome,
            settle: (value) => {
                settle(value);
                state.settle = () => undefined;
            },
        };
        this.channels.set(name, state);
        const channel = new ManagedChannel(
            name,
            this.openWrapper(options),
            () => {
                this.channels.delete(name);
            },
            this.logger,
        );
        (state as { channel: ManagedChannel }).channel = channel;

        return channel;
    }

    /** Шаг 4 остановки: закрытие соединения не дольше CONNECTION_CLOSE_TIMEOUT_MS. */
    async onApplicationShutdown(): Promise<void> {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.readyListeners.clear();
        this.readyFailureReported.clear();
        await this.starting?.catch(() => undefined);
        const manager = this.manager;
        if (manager === null) {
            return;
        }
        this.manager = null;
        this.channels.clear();
        if (!(await settlesWithin(manager.close(), CONNECTION_CLOSE_TIMEOUT_MS))) {
            this.logger.warn(
                { broker: this.endpoint, timeoutMs: CONNECTION_CLOSE_TIMEOUT_MS },
                'rabbitmq: брокер не ответил на закрытие соединения, соединение брошено',
            );

            return;
        }
        this.logger.info({ broker: this.endpoint }, 'rabbitmq: соединение закрыто');
    }

    private async open(): Promise<void> {
        const acm = await loadPeer<typeof Acm>('amqp-connection-manager', 'messaging');
        if (this.stopped) {
            return;
        }
        const manager = acm.connect([this.options.url], {
            heartbeatIntervalInSeconds: HEARTBEAT_SECONDS,
            reconnectTimeInSeconds: this.options.retrySeconds,
        });
        this.first = new Promise((resolve) => {
            manager.once('connect', () => resolve('connected'));
            manager.once('connectFailed', () => resolve('failed'));
        });
        manager.on('connect', () => {
            this.logger.info({ broker: this.endpoint }, 'rabbitmq: соединение установлено');
        });
        manager.on('disconnect', ({ err }) => {
            this.markAllNotReady();
            this.logger.warn(
                { broker: this.endpoint, err: sanitizeError(err) },
                'rabbitmq: соединение потеряно',
            );
        });
        manager.on('connectFailed', ({ err }) => {
            this.logger.debug(
                { broker: this.endpoint, error: err.message },
                'rabbitmq: попытка подключения не удалась',
            );
        });
        // Без обработчика 'error' EventEmitter бросил бы исключение процессу.
        manager.on('error', (err) => {
            this.logger.warn(
                { broker: this.endpoint, err: sanitizeError(err) },
                'rabbitmq: ошибка соединения',
            );
        });
        this.manager = manager;
    }

    private openWrapper(options: ChannelOptions): ChannelWrapper {
        if (this.manager === null) {
            throw new Error('RabbitConnection: createChannel до завершения start()');
        }
        const name = options.name;
        const channelOptions: CreateChannelOpts = {
            name,
            confirm: options.confirm,
            json: false,
            setup: async (channel: ConfirmChannel) => {
                this.channels.get(name)?.channel.markOpened();
                // Брокер закрывает канал так: 'error' (код канала), затем 'close'. Разрыв соединения, замена канала и
                // остановка дают только 'close'.
                let closedByBroker = false;
                channel.on('error', (err: Error) => {
                    closedByBroker = true;
                    const state = this.channels.get(name);
                    if (state !== undefined) {
                        state.lastBrokerError = err;
                        state.channel.markBrokerError(err);
                    }
                    this.logger.debug(
                        { channel: name, error: err.message },
                        'rabbitmq: канал закрыт с ошибкой',
                    );
                });
                channel.on('close', () => {
                    if (closedByBroker) {
                        this.onClosedByBroker(name, channel);
                    }
                });
                await this.runStage(name, channel, 'exchange', () =>
                    channel.checkExchange(EVENTS_EXCHANGE),
                );
                await this.runStage(name, channel, 'setup', () =>
                    options.setup ? options.setup(channel) : Promise.resolve(),
                );
                await this.runStage(name, channel, 'ready', () => {
                    this.onSetupDone(name, channel);

                    return Promise.resolve();
                });
            },
        };
        if (options.publishTimeout !== undefined) {
            channelOptions.publishTimeout = options.publishTimeout;
        }
        const wrapper = this.manager.createChannel(channelOptions);
        wrapper.on('error', (err, info) => {
            this.logger.debug(
                { channel: info.name, error: err instanceof Error ? err.message : String(err) },
                'rabbitmq: ошибка канала',
            );
        });

        return wrapper;
    }

    private async runStage(
        name: string,
        channel: ConfirmChannel,
        stage: SetupStage,
        work: () => Promise<unknown>,
    ): Promise<void> {
        try {
            await work();
        } catch (error) {
            this.onSetupFailed(name, stage, error);
            // Ошибка брокера уже закрыла канал; ошибка кода — нет: закрываем, чтобы повтор открыл новый.
            await channel.close().catch(() => undefined);
            throw error;
        }
    }

    private markAllNotReady(): void {
        for (const state of this.channels.values()) {
            state.ready = false;
            state.raw = null;
        }
    }

    private onSetupDone(name: string, channel: ConfirmChannel): void {
        const state = this.channels.get(name);
        if (state !== undefined) {
            state.ready = true;
            state.raw = channel;
        }
        try {
            // Синхронно: до отката готовности при исключении никто не увидит канал готовым.
            for (const listener of this.readyListeners.get(name) ?? []) {
                listener();
            }
        } catch (error) {
            if (state !== undefined) {
                state.ready = false;
                state.raw = null;
            }
            throw error;
        }
        state?.settle({ kind: 'ready' });
        this.readyFailureReported.delete(name);
        this.logger.info({ channel: name }, 'rabbitmq: канал готов');
        if (!this.topologyReady()) {
            return;
        }
        this.exchangeMissingReported = false;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
    }

    /** Брокер закрыл настроенный канал: ChannelWrapper сам его не пересоздаст — заменяем, как после сбоя настройки. */
    private onClosedByBroker(name: string, channel: ConfirmChannel): void {
        const state = this.channels.get(name);
        if (state === undefined || state.raw !== channel || this.manager === null) {
            return;
        }
        state.raw = null;
        state.ready = false;
        this.logger.warn({ channel: name }, 'rabbitmq: канал закрыт брокером');
        this.scheduleRetry();
    }

    private onSetupFailed(name: string, stage: SetupStage, error: unknown): void {
        const state = this.channels.get(name);
        if (state !== undefined) {
            state.ready = false;
        }
        if (isConnectionLoss(error)) {
            this.logger.debug({ channel: name }, 'rabbitmq: канал закрыт разрывом соединения');

            return;
        }
        const safeError = sanitizeError(error);
        if (error instanceof MessagingStartupError) {
            // Фатально (406 TTL .retry): повтор не изменит объявление очереди брокера (AC-5.19, П8).
            if (state !== undefined) {
                state.fatal = true;
                state.settle({ kind: 'fatal', error });
            }
            this.logger.error(
                { channel: name, code: error.startupCode, err: safeError },
                'rabbitmq: фатальная ошибка настройки канала, повторов не будет',
            );
            captureError(error);

            return;
        }
        state?.settle({ kind: 'failed', error: state.lastBrokerError ?? asError(error) });
        this.reportStageFailure(name, stage, safeError);
        this.scheduleRetry();
    }

    private reportStageFailure(name: string, stage: SetupStage, safeError: unknown): void {
        if (stage !== 'exchange') {
            this.logger.warn(
                { channel: name, stage, err: safeError },
                'rabbitmq: сбой настройки канала',
            );
            if (stage === 'ready' && !this.readyFailureReported.has(name)) {
                // Ошибка кода, не брокера: одно событие GlitchTip на серию повторов канала.
                captureError(safeError);
                this.readyFailureReported.add(name);
            }

            return;
        }
        if (this.exchangeMissingReported) {
            this.logger.warn(
                { channel: name, exchange: EVENTS_EXCHANGE },
                'rabbitmq: exchange verdeect.events всё ещё отсутствует',
            );

            return;
        }
        // Exchange объявляет definitions.json инфраструктуры до запуска сервиса (§3.4).
        this.logger.error(
            { channel: name, exchange: EVENTS_EXCHANGE, err: safeError },
            'rabbitmq: exchange verdeect.events отсутствует',
        );
        captureError(safeError);
        this.exchangeMissingReported = true;
    }

    /** Один таймер на соединение; повтор заменяет только каналы в ошибке (кроме фатальных). */
    private scheduleRetry(): void {
        if (this.stopped || this.retryTimer !== undefined) {
            return;
        }
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.retryFailedChannels();
        }, this.options.retrySeconds * 1000);
        this.retryTimer.unref();
    }

    private async retryFailedChannels(): Promise<void> {
        if (this.stopped || this.manager === null || !this.manager.isConnected()) {
            // Нет соединения: после переподключения менеджер сам повторит setup всех каналов.
            return;
        }
        for (const [name, state] of this.channels) {
            if (state.ready || state.fatal) {
                continue;
            }
            this.logger.debug({ channel: name }, 'rabbitmq: канал открывается заново');
            try {
                await state.channel.replace(this.openWrapper(state.options));
            } catch (error) {
                this.logger.warn(
                    { channel: name, err: sanitizeError(error) },
                    'rabbitmq: открыть канал заново не удалось',
                );
            }
        }
    }
}
