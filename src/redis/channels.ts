// KitRedisChannels (prd.md §3.7 «префикс к каналам ставит обёртка», AC-8.1, AC-8.6): keyPrefix ioredis не действует на
// каналы. Механика Set обработчиков — O RedisBus, без JSON и повторов SUBSCRIBE (повторная подписка после
// переподключения — autoResubscribe ioredis). KT-31: одно обещание SUBSCRIBE на канал — одновременные subscribe ждут его,
// отказ SUBSCRIBE снимает запись канала (повторный subscribe шлёт SUBSCRIBE заново).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { KIT_REDIS_LOG, KIT_REDIS_PREFIX, KIT_REDIS_SUBSCRIBER } from '../internal/tokens.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { KIT_REDIS, type RedisLog } from './client.js';

/** Обработчик сообщения канала: строка сообщения (JSON — забота сервиса). */
type ChannelHandler = (message: string) => void | Promise<void>;

/** Подписка канала: обработчики и подтверждение SUBSCRIBE (одно на канал). */
interface ChannelState {
    readonly handlers: Set<ChannelHandler>;
    ready: Promise<void>;
}

/**
 * Каналы Redis сервиса с префиксом `<svc>:` (§3.7): `publish('x')` публикует в `<svc>:x`, `subscribe('x')` слушает
 * `<svc>:x` и отдаёт обработчику сообщение. Подписки требуют `KitRedisModule.forRoot({subscriber: true})`.
 */
@Injectable()
export class KitRedisChannels {
    private readonly channels = new Map<string, ChannelState>();

    constructor(
        @Inject(KIT_REDIS) private readonly redis: Redis,
        @Inject(KIT_REDIS_PREFIX) private readonly prefix: string,
        @Inject(KIT_REDIS_LOG) private readonly log: RedisLog,
        @Optional() @Inject(KIT_REDIS_SUBSCRIBER) private readonly subscriber?: Redis,
    ) {
        this.subscriber?.on('message', (channel: string, message: string) => {
            this.dispatch(channel, message);
        });
    }

    /**
     * Публикует сообщение в канал `<svc>:<channel>` основным соединением; число получателей. Ошибка Redis — исключение
     * вызывающему.
     */
    publish(channel: string, message: string): Promise<number> {
        return this.redis.publish(`${this.prefix}${channel}`, message);
    }

    /**
     * Подписывает обработчик на канал `<svc>:<channel>`; одна подписка Redis на канал. Разрешается после подтверждения
     * `SUBSCRIBE` (одновременные вызовы ждут одного подтверждения); отказ `SUBSCRIBE` отклоняет все ожидающие вызовы, и
     * следующий `subscribe` шлёт `SUBSCRIBE` заново. Возвращает функцию отписки: уход последнего обработчика —
     * `UNSUBSCRIBE`. Ошибка обработчика — `error` + GlitchTip, остальные обработчики получают сообщение. Без
     * `subscriber: true` — `Error`.
     */
    async subscribe(channel: string, handler: ChannelHandler): Promise<() => Promise<void>> {
        const subscriber = this.subscriber;
        if (subscriber === undefined) {
            throw new Error(
                'KitRedisChannels.subscribe: подписки требуют KitRedisModule.forRoot({subscriber: true})',
            );
        }
        const full = `${this.prefix}${channel}`;
        const state = this.channels.get(full) ?? this.open(subscriber, channel, full);
        state.handlers.add(handler);
        try {
            await state.ready;
        } catch (error) {
            state.handlers.delete(handler);
            throw error;
        }
        let active = true;

        return async () => {
            if (!active) {
                return;
            }
            active = false;
            await this.release(subscriber, channel, full, state, handler);
        };
    }

    /** Новая запись канала и SUBSCRIBE; отказ снимает запись, если её ещё не заменили. */
    private open(subscriber: Redis, channel: string, full: string): ChannelState {
        const state: ChannelState = { handlers: new Set(), ready: Promise.resolve() };
        state.ready = subscriber.subscribe(full).then(
            () => {
                this.log.debug({ channel }, 'redis: подписка на канал');
            },
            (error: unknown) => {
                if (this.channels.get(full) === state) {
                    this.channels.delete(full);
                }
                this.log.debug(
                    { channel, err: sanitizeError(error) },
                    'redis: подписка на канал не удалась',
                );
                throw error;
            },
        );
        this.channels.set(full, state);

        return state;
    }

    private async release(
        subscriber: Redis,
        channel: string,
        full: string,
        state: ChannelState,
        handler: ChannelHandler,
    ): Promise<void> {
        state.handlers.delete(handler);
        if (state.handlers.size > 0 || this.channels.get(full) !== state) {
            return;
        }
        this.channels.delete(full);
        await subscriber.unsubscribe(full);
        this.log.debug({ channel }, 'redis: отписка от канала');
    }

    private dispatch(full: string, message: string): void {
        const state = this.channels.get(full);
        if (state === undefined || !full.startsWith(this.prefix)) {
            return;
        }
        const channel = full.slice(this.prefix.length);
        for (const handler of state.handlers) {
            void Promise.resolve()
                .then(() => handler(message))
                .catch((error: unknown) => {
                    this.log.error(
                        { channel, err: sanitizeError(error) },
                        'redis: ошибка обработчика сообщения канала',
                    );
                    captureError(error);
                });
        }
    }
}
