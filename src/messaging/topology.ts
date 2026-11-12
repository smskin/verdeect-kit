// Топология RabbitMQ и числа relay, подписчика и очистки (prd.md §3.4, AC-5.3, AC-5.7, AC-5.11, AC-5.12, AC-5.16, AC-5.17).
// Эталон — O topology.ts; имена очередей — от имени экземпляра, заголовок x-dlq-reason (PRD) вместо x-<svc>-dlq-reason,
// общий срок обработчиков остановки от SHUTDOWN_TIMEOUT_MS (П9) вместо константы O 8000.
export { EVENTS_EXCHANGE } from '../internal/rabbitmq-definitions.js';

/** Заголовок причины у копии в DLQ (§3.4). */
export const DLQ_REASON_HEADER = 'x-dlq-reason';
/** Неподтверждённых сообщений на потребителя (§3.4, AC-5.17). */
export const CONSUMER_PREFETCH = 10;
/** Повторов по `x-death`, затем DLQ (§3.4). */
export const MAX_RETRIES = 5;
/** Heartbeat, с; пауза переподключения — RABBITMQ_RECONNECT_SECONDS. */
export const HEARTBEAT_SECONDS = 10;
/** Ожидание ответа брокера на закрытие канала, мс. */
export const CHANNEL_CLOSE_TIMEOUT_MS = 2_000;
/** Ожидание ответа брокера на закрытие соединения, мс. */
export const CONNECTION_CLOSE_TIMEOUT_MS = 1_000;

/** Пачка relay (§3.4). */
export const RELAY_BATCH_SIZE = 100;
/** Общий срок подтверждений одной пачки, мс (§3.4). */
export const RELAY_BATCH_DEADLINE_MS = 5_000;
/** Опрос outbox, мс (§3.4, AC-5.3). */
export const RELAY_POLL_MS = 1_000;
/** Пауза строки после неудачи: 1 с → 5 мин, удвоение (§3.4, AC-5.16). */
export const RELAY_BACKOFF_MIN_MS = 1_000;
/** Предел паузы строки, мс. */
export const RELAY_BACKOFF_MAX_MS = 300_000;
/** Неудач строки до error-лога и GlitchTip (AC-5.16). */
export const RELAY_ALERT_ATTEMPTS = 5;
/** Таймаут подтверждения публикации, мс. */
export const PUBLISH_CONFIRM_TIMEOUT_MS = 10_000;

/** Хранение опубликованного outbox и inbox, дни (§3.4, AC-5.12). */
export const RETENTION_DAYS = 7;
/** Интервал очистки, мс. */
export const CLEANUP_INTERVAL_MS = 3_600_000;
/** Пачка очистки. */
export const CLEANUP_BATCH_SIZE = 1_000;
/** Пачек за проход. */
export const CLEANUP_MAX_BATCHES = 100;

/** Очереди сервиса. */
export interface KitQueues {
    /** Основная очередь. */
    readonly main: string;
    /** Очередь отложенного повтора (TTL → основная). */
    readonly retry: string;
    /** Неразбираемые и исчерпавшие повторы. */
    readonly dlq: string;
}

/** Очереди экземпляра: `<svc>`, `<svc>.retry`, `<svc>.dlq`. */
export function queuesOf(service: string): KitQueues {
    return { main: service, retry: `${service}.retry`, dlq: `${service}.dlq` };
}

/** Очередь реплики `<svc>.replica.<REPLICA_ID>` (AC-5.9). */
export function replicaQueueOf(service: string, replica: string): string {
    return `${service}.replica.${replica}`;
}

/**
 * Общий срок обработчиков остановки (relay, подписчик), мс: остаток SHUTDOWN_TIMEOUT_MS после паузы SHUTDOWN_DRAIN_MS и
 * закрытия канала и соединения, не меньше 1 с (П9).
 */
export function handlersDeadlineMs(env: {
    readonly SHUTDOWN_TIMEOUT_MS: number;
    readonly SHUTDOWN_DRAIN_MS: number;
}): number {
    return Math.max(
        1_000,
        env.SHUTDOWN_TIMEOUT_MS -
            env.SHUTDOWN_DRAIN_MS -
            CHANNEL_CLOSE_TIMEOUT_MS -
            CONNECTION_CLOSE_TIMEOUT_MS,
    );
}
