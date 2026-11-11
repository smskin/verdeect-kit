// OutboxRelay (prd.md §3.4 relay, UC-5, AC-5.3–AC-5.5, AC-5.11, AC-5.16, AC-9.5). Эталон — O outbox-relay.ts; из P —
// гонка publish с остановкой (STOPPED) и beforeApplicationShutdown против shutdownDeadline; по PRD — опрос 1000 мс
// (O — 200), метрики verdeect_outbox_* раз в RELAY_POLL_MS независимо от канала (П10), строка неизвестного типа —
// subject.kind 'unknown' (П23). Пачка ≤ 100 по seq под FOR UPDATE SKIP LOCKED, публикация последовательно с
// подтверждением; первая неудача прерывает пачку — порядок сохраняется. Без соединения или канала БД не опрашивается.
// Остановка во время неподтверждённой публикации оставляет строку без attempts + 1: повтор после рестарта —
// «не больше одного раза по смыслу» через inbox получателя (UC-6).
import { setTimeout as sleepFor } from 'node:timers/promises';
import type { Db } from '../database/db.js';
import { ulid } from '../internal/ids.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError, captureThrottled } from '../observability/sentry.js';
import type { KitEvent } from './define-event.js';
import { buildEnvelope } from './envelope.js';
import type { OutboxClaimedRow, OutboxStore } from './outbox-store.js';
import {
    nestLog,
    type ManagedChannel,
    type MessagingLog,
    type RabbitConnection,
} from './rabbit-connection.js';
import {
    EVENTS_EXCHANGE,
    PUBLISH_CONFIRM_TIMEOUT_MS,
    RELAY_ALERT_ATTEMPTS,
    RELAY_BACKOFF_MAX_MS,
    RELAY_BACKOFF_MIN_MS,
    RELAY_BATCH_DEADLINE_MS,
    RELAY_BATCH_SIZE,
    RELAY_POLL_MS,
} from './topology.js';

const CHANNEL_NAME = 'outbox-relay';
const CONFIRM_DEADLINE_ERROR = 'confirm deadline';
const STOPPED = Symbol('stopped');

/** Часы relay (внутренние): подмена в тесте AC-5.16 — без реальных пауз. */
export interface RelayTimers {
    /** Текущее время, мс. */
    now(): number;
    /** Пауза `ms` (`Infinity` — до прерывания); прерывание `signal` — resolve. */
    sleep(ms: number, signal: AbortSignal, kind: 'pause' | 'confirm' | 'stats'): Promise<void>;
}

const realTimers: RelayTimers = {
    now: () => Date.now(),
    sleep: async (ms, signal) => {
        if (signal.aborted) {
            return;
        }
        // Infinity — ждать прерывания: setTimeout не принимает бесконечность.
        const wait = Number.isFinite(ms) ? ms : 2_147_483_647;
        await sleepFor(wait, undefined, { signal, ref: false }).catch(() => undefined);
    },
};

/** Зависимости relay (внутренние). */
export interface OutboxRelayDeps {
    /** `Db` сервиса. */
    readonly db: Db;
    /** Запросы outbox. */
    readonly store: OutboxStore;
    /** Соединение. */
    readonly connection: Pick<
        RabbitConnection,
        'isConnected' | 'isChannelReady' | 'createChannel' | 'onChannelReady' | 'shutdownDeadline'
    >;
    /** События модуля по type. */
    readonly events: ReadonlyMap<string, KitEvent>;
    /** Метрики экземпляра. */
    readonly metrics?: KitMetrics;
    /** Логгер. */
    readonly log?: MessagingLog;
    /** Часы. */
    readonly timers?: RelayTimers;
}

interface DrainResult {
    readonly claimed: number;
    readonly failed: boolean;
}

/** Публикатор outbox: фоновый цикл, хуки Nest вызывает модуль (внутренний класс). */
export class OutboxRelay {
    private readonly log: MessagingLog;
    private readonly timers: RelayTimers;
    private channel: ManagedChannel | null = null;
    private unsubscribe: (() => void) | null = null;
    private loop: Promise<void> | null = null;
    private stats: Promise<void> | null = null;
    private running = false;
    private backoffMs = 0;
    private wakeRequested = false;
    private sleepAbort = new AbortController();
    private readonly statsAbort = new AbortController();
    private requestStop: () => void = () => undefined;
    private readonly stopRequested = new Promise<typeof STOPPED>((resolve) => {
        this.requestStop = () => resolve(STOPPED);
    });
    private statsFailing = false;
    private readonly unknownTypes = new Set<string>();

    constructor(private readonly deps: OutboxRelayDeps) {
        this.log = deps.log ?? nestLog('OutboxRelay');
        this.timers = deps.timers ?? realTimers;
    }

    /** Запуск цикла после старта приложения. */
    onApplicationBootstrap(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.channel = this.deps.connection.createChannel({
            name: CHANNEL_NAME,
            confirm: true,
            publishTimeout: PUBLISH_CONFIRM_TIMEOUT_MS,
        });
        // Канал настроен (после подключения или повтора): пауза сбрасывается, разгрузка — сразу.
        this.unsubscribe = this.deps.connection.onChannelReady(CHANNEL_NAME, () => {
            this.backoffMs = 0;
            this.wake();
        });
        this.loop = this.run();
        this.stats = this.statsLoop();
        this.log.debug({}, 'outbox: relay запущен');
    }

    /** Будит цикл (после COMMIT `OutboxStore.add`, готовности канала, остановки). */
    wake(): void {
        this.wakeRequested = true;
        this.sleepAbort.abort();
    }

    /** Шаг 3 остановки: пачка дорабатывает в общем сроке, неподтверждённая публикация бросается. */
    async beforeApplicationShutdown(): Promise<void> {
        if (!this.running) {
            return;
        }
        this.running = false;
        this.requestStop();
        this.wake();
        this.statsAbort.abort();
        const loop = this.loop ?? Promise.resolve();
        const stopped = await Promise.race([
            loop.then(() => true),
            this.deps.connection.shutdownDeadline(),
        ]);
        if (!stopped) {
            this.log.warn({}, 'outbox: срок остановки relay вышел, идём дальше');
        }
        await this.stats;
        this.unsubscribe?.();
        this.unsubscribe = null;
        await this.channel?.close();
        this.channel = null;
        this.log.debug({}, 'outbox: relay остановлен');
    }

    private async run(): Promise<void> {
        while (this.running) {
            const pause = await this.iterate();
            if (!this.running) {
                return;
            }
            await this.pause(pause);
        }
    }

    private async iterate(): Promise<number> {
        const { connection } = this.deps;
        if (!connection.isConnected() || !connection.isChannelReady(CHANNEL_NAME)) {
            // Без соединения или канала БД не опрашивается: строки копятся, lag растёт; ждём готовности канала.
            return Infinity;
        }
        try {
            const result = await this.drain();
            if (result.failed) {
                return this.nextBackoff();
            }
            this.backoffMs = 0;

            return result.claimed === RELAY_BATCH_SIZE ? 0 : RELAY_POLL_MS;
        } catch (error) {
            this.log.error({ err: sanitizeError(error) }, 'outbox: ошибка БД relay');
            captureThrottled('outbox-relay:db', error);

            return this.nextBackoff();
        }
    }

    private async drain(): Promise<DrainResult> {
        const ctx = { tenant: null, traceId: ulid(), actor: { channel: 'system' } };

        return this.deps.db.transaction(ctx, async (tx) => {
            const rows = await this.deps.store.claimBatch(tx, RELAY_BATCH_SIZE);
            const deadline = this.timers.now() + RELAY_BATCH_DEADLINE_MS;
            const published: string[] = [];
            let failed = false;
            for (const row of rows) {
                if (!this.running) {
                    break;
                }
                const remaining = deadline - this.timers.now();
                if (remaining <= 0) {
                    this.log.warn(
                        { published: published.length, left: rows.length - published.length },
                        'outbox: срок пачки вышел',
                    );
                    break;
                }
                const outcome = await this.publish(row, remaining);
                if (outcome === STOPPED) {
                    break;
                }
                if (outcome === null) {
                    published.push(row.id);
                    continue;
                }
                failed = true;
                const attempts = await this.deps.store.markFailed(tx, row.id, outcome);
                this.reportFailure(row, attempts, outcome);
                break;
            }
            await this.deps.store.markPublished(tx, published);
            if (published.length > 0) {
                this.log.debug(
                    { published: published.length, claimed: rows.length },
                    'outbox: пачка опубликована',
                );
            }

            return { claimed: rows.length, failed };
        });
    }

    /** null — подтверждено; STOPPED — остановка прервала ожидание; иначе текст ошибки. */
    private async publish(
        row: OutboxClaimedRow,
        timeoutMs: number,
    ): Promise<string | null | typeof STOPPED> {
        const channel = this.channel;
        if (channel === null) {
            return 'channel closed';
        }
        const envelope = buildEnvelope({ ...row, subjectKind: this.subjectKind(row.type) });
        const confirmAbort = new AbortController();
        const confirmed = channel
            .publish(EVENTS_EXCHANGE, row.type, Buffer.from(JSON.stringify(envelope)), {
                persistent: true,
                messageId: row.id,
                type: row.type,
                contentType: 'application/json',
                // AMQP timestamp — секунды.
                timestamp: Math.floor(row.occurredAt.getTime() / 1000),
            })
            .then(
                () => null,
                (error: unknown) => (error instanceof Error ? error.message : String(error)),
            );
        const deadline = this.timers
            .sleep(timeoutMs, confirmAbort.signal, 'confirm')
            .then(() => (confirmAbort.signal.aborted ? null : CONFIRM_DEADLINE_ERROR));
        try {
            // Опоздавшее подтверждение даст дубль при повторе: доставка at-least-once.
            return await Promise.race([
                confirmed,
                deadline.then((value) => value ?? new Promise<never>(() => undefined)),
                this.stopRequested,
            ]);
        } finally {
            confirmAbort.abort();
        }
    }

    private subjectKind(type: string): string {
        const event = this.deps.events.get(type);
        if (event !== undefined) {
            return event.subject;
        }
        if (!this.unknownTypes.has(type)) {
            this.unknownTypes.add(type);
            this.log.warn({ type }, 'outbox: тип события вне outbox.events — subject.kind unknown');
        }

        return 'unknown';
    }

    private reportFailure(row: OutboxClaimedRow, attempts: number, error: string): void {
        this.log.warn(
            { id: row.id, type: row.type, attempts, error },
            'outbox: публикация не удалась',
        );
        if (attempts !== RELAY_ALERT_ATTEMPTS) {
            return;
        }
        // Ровно раз на строку: attempts растёт монотонно. Без data (AC-5.16).
        this.log.error(
            { id: row.id, type: row.type, attempts },
            'outbox: строка не опубликована 5 раз',
        );
        captureError(new Error('outbox: строка не опубликована 5 раз'), {
            tags: { code: 'OUTBOX_PUBLISH_FAILED' },
            extra: { id: row.id, type: row.type, attempts },
        });
    }

    private nextBackoff(): number {
        this.backoffMs =
            this.backoffMs === 0
                ? RELAY_BACKOFF_MIN_MS
                : Math.min(this.backoffMs * 2, RELAY_BACKOFF_MAX_MS);

        return this.backoffMs;
    }

    /** Пробуждение во время drain не теряется: флаг проверяется до сна. */
    private async pause(ms: number): Promise<void> {
        if (ms === 0 || this.wakeRequested) {
            this.wakeRequested = false;

            return;
        }
        this.sleepAbort = new AbortController();
        await this.timers.sleep(ms, this.sleepAbort.signal, 'pause');
        this.wakeRequested = false;
    }

    /** Метрики outbox раз в RELAY_POLL_MS, независимо от канала (П10). */
    private async statsLoop(): Promise<void> {
        const ctx = { tenant: null, traceId: ulid(), actor: { channel: 'system' } };
        while (!this.statsAbort.signal.aborted) {
            try {
                const { pending, lag } = await this.deps.db.transaction(ctx, (tx) =>
                    this.deps.store.stats(tx),
                );
                this.deps.metrics?.outboxPending.set(pending);
                this.deps.metrics?.outboxLagSeconds.set(lag);
                this.statsFailing = false;
            } catch (error) {
                if (!this.statsFailing) {
                    this.statsFailing = true;
                    this.log.warn({ err: sanitizeError(error) }, 'outbox: метрики не обновлены');
                }
            }
            await this.timers.sleep(RELAY_POLL_MS, this.statsAbort.signal, 'stats');
        }
    }
}
