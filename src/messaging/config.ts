// Внутренние токены и нормализованные опции KitMessagingModule (prd.md §3.4). Отдельно от модуля: типы /database (pg)
// не попадают в публичный .d.ts /messaging, который грузится без pg (AC-1.2).
import type * as Database from '../database/index.js';
import type { KitEvent } from './define-event.js';
import type { KitInboxTable, KitOutboxTable } from './tables.js';

/** Нормализованные опции модуля (внутренние). */
export interface KitMessagingConfig {
    /** Имя экземпляра. */
    readonly service: string;
    /** Схема таблиц outbox и inbox. */
    readonly schema: string | undefined;
    /** Защита от повторов подписчика. */
    readonly dedupe: 'inbox' | 'none';
    /** Подписчик задан. */
    readonly subscriber: boolean;
    /** События outbox по type. */
    readonly events: ReadonlyMap<string, KitEvent>;
    /** Таблица outbox. */
    readonly outbox: KitOutboxTable | undefined;
    /** Таблица inbox. */
    readonly inbox: KitInboxTable | undefined;
    /** Значения /database — только при outbox или inbox. */
    readonly database: typeof Database | undefined;
}

/** Окружение модуля (внутреннее). */
export interface KitMessagingRuntimeEnv {
    /** Адрес брокера. */
    readonly RABBITMQ_URL: string;
    /** TTL .retry, с. */
    readonly RABBITMQ_RETRY_SECONDS: number;
    /** Пауза переподключения и повтора настройки канала, срок ожидания первого подключения, с. */
    readonly RABBITMQ_RECONNECT_SECONDS: number;
    /** Реплика. */
    readonly REPLICA_ID: string;
    /** Общий срок остановки, мс. */
    readonly SHUTDOWN_TIMEOUT_MS: number;
    /** Пауза перед остановкой, мс. */
    readonly SHUTDOWN_DRAIN_MS: number;
}

/** Нормализованные опции (внутренний токен; тесты пакета). */
export const KIT_MESSAGING_OPTIONS = Symbol('KIT_MESSAGING_OPTIONS');

/** Окружение модуля (внутренний токен). */
export const KIT_MESSAGING_ENV = Symbol('KIT_MESSAGING_ENV');

/** Соединение RabbitConnection (внутренний токен; тесты пакета). */
export const KIT_RABBIT_CONNECTION = Symbol('KIT_RABBIT_CONNECTION');

/** Логгер фоновых операций (внутренний токен). */
export const KIT_MESSAGING_LOG = Symbol('KIT_MESSAGING_LOG');
