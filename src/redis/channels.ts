// KitRedisChannels (prd.md §3.7 «префикс к каналам ставит обёртка», AC-8.1, AC-8.6): keyPrefix ioredis не действует на
// каналы. Механика Set обработчиков — O RedisBus, без JSON и повторов SUBSCRIBE (повторная подписка после
// переподключения — autoResubscribe ioredis).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { KIT_REDIS_LOG, KIT_REDIS_PREFIX, KIT_REDIS_SUBSCRIBER } from '../internal/tokens.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { captureError } from '../observability/sentry.js';
import { KIT_REDIS, type RedisLog } from './client.js';

/** Обработчик сообщения канала: строка сообщения (JSON — забота сервиса). */
type ChannelHandler = (message: string) => void | Promise<void>;

/**
 * Каналы Redis сервиса с префиксом `<svc>:` (§3.7): `publish('x')` публикует в `<svc>:x`, `subscribe('x')` слушает
 * `<svc>:x` и отдаёт обработчику сообщение. Подписки требуют `KitRedisModule.forRoot({subscriber: true})`.
 */
@Injectable()
export class KitRedisChannels {
    private readonly handlers = new Map<string, Set<ChannelHandler>>();

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
     * Подписывает обработчик на канал `<svc>:<channel>`; одна подписка Redis на канал. Возвращает функцию отписки: уход
     * последнего обработчика — `UNSUBSCRIBE`. Ошибка обработчика — `error` + GlitchTip, остальные обработчики получают
     * сообщение. Без `subscriber: true` — `Error`.
     */
    async subscribe(channel: string, handler: ChannelHandler): Promise<() => Promise<void>> {
        const subscriber = this.subscriber;
        if (subscriber === undefined) {
            throw new Error(
                'KitRedisChannels.subscribe: подписки требуют KitRedisModule.forRoot({subscriber: true})',
            );
        }
        const full = `${this.prefix}${channel}`;
        let set = this.handlers.get(full);
        if (set === undefined) {
            set = new Set();
            this.handlers.set(full, set);
            set.add(handler);
            await subscriber.subscribe(full);
            this.log.debug({ channel }, 'redis: подписка на канал');
        } else {
            set.add(handler);
        }
        let active = true;

        return async () => {
            if (!active) {
                return;
            }
            active = false;
            await this.release(subscriber, channel, full, handler);
        };
    }

    private async release(
        subscriber: Redis,
        channel: string,
        full: string,
        handler: ChannelHandler,
    ): Promise<void> {
        const set = this.handlers.get(full);
        if (set === undefined) {
            return;
        }
        set.delete(handler);
        if (set.size > 0) {
            return;
        }
        this.handlers.delete(full);
        await subscriber.unsubscribe(full);
        this.log.debug({ channel }, 'redis: отписка от канала');
    }

    private dispatch(full: string, message: string): void {
        const set = this.handlers.get(full);
        if (set === undefined || !full.startsWith(this.prefix)) {
            return;
        }
        const channel = full.slice(this.prefix.length);
        for (const handler of set) {
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
