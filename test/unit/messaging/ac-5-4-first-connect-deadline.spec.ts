// AC-5.4 (U; prd.md §3.4 v1.26 стр. 129, KT-76 п. 2): первое подключение и настройка канала подписчика укладываются в
// один срок RABBITMQ_RECONNECT_SECONDS — не два срока подряд. Без брокера: заглушка RabbitConnection, фейковые таймеры.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEvent } from '../../../src/messaging/define-event.js';
import type { MessagingLog, RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { MessagingStartupError } from '../../../src/messaging/errors.js';
import { KitSubscriber } from '../../../src/messaging/subscriber.js';
import { z } from 'zod';

const NoteCreated = defineEvent({
    type: 'kit.note.created',
    version: 1,
    subject: 'note',
    data: z.object({ noteId: z.string() }),
});

const silentLog: MessagingLog = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** Соединение: подключается через 4500 мс, настройка канала не завершается никогда. */
function slowConnection(): RabbitConnection {
    const channel = { consume: () => Promise.resolve() };

    return {
        createChannel: () => channel,
        firstAttempt: () =>
            new Promise<'connected'>((resolve) => {
                setTimeout(() => resolve('connected'), 4_500);
            }),
        channelOutcome: () => new Promise(() => undefined),
    } as unknown as RabbitConnection;
}

/** Соединение: подключается через 1000 мс, настройка канала — фатальная ошибка TTL через `fatalAfterMs`. */
function fatalConnection(fatalAfterMs: number): RabbitConnection {
    const channel = { consume: () => Promise.resolve() };
    const error = new MessagingStartupError(
        'MESSAGING_RETRY_TTL_MISMATCH',
        'очередь kit.retry объявлена с другим TTL — пересоздайте очередь',
        { queue: 'kit.retry' },
    );

    return {
        createChannel: () => channel,
        firstAttempt: () =>
            new Promise<'connected'>((resolve) => {
                setTimeout(() => resolve('connected'), 1_000);
            }),
        channelOutcome: () =>
            new Promise((resolve) => {
                setTimeout(() => resolve({ kind: 'fatal', error }), fatalAfterMs);
            }),
    } as unknown as RabbitConnection;
}

function subscriberOn(connection: RabbitConnection): KitSubscriber {
    const subscriber = new KitSubscriber({
        service: 'kit',
        replica: 'kit-1',
        dedupe: 'none',
        connection,
        retrySeconds: 1,
        reconnectSeconds: 5,
        log: silentLog,
    });
    subscriber.on(NoteCreated, () => Promise.resolve());

    return subscriber;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('UC-6: первое подключение подписчика', () => {
    it('AC-5.4: первое подключение и настройка канала укладываются в один RABBITMQ_RECONNECT_SECONDS', async () => {
        const subscriber = new KitSubscriber({
            service: 'kit',
            replica: 'kit-1',
            dedupe: 'none',
            connection: slowConnection(),
            retrySeconds: 1,
            reconnectSeconds: 5,
            log: silentLog,
        });
        subscriber.on(NoteCreated, () => Promise.resolve());
        let done = false;
        const bootstrap = subscriber.onApplicationBootstrap().then(() => {
            done = true;
        });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
        await bootstrap;
    });

    it('AC-5.19, AC-5.4: MESSAGING_RETRY_TTL_MISMATCH внутри общего срока — запуск отклонён', async () => {
        const bootstrap = subscriberOn(fatalConnection(3_000)).onApplicationBootstrap();
        const outcome = bootstrap.then(
            () => 'resolved',
            (error: unknown) => error,
        );

        // Подключение через 1000 мс, исход настройки — ещё через 3000: 4000 < 5000.
        await vi.advanceTimersByTimeAsync(4_000);
        expect(await outcome).toBeInstanceOf(MessagingStartupError);
    });

    it('AC-5.19, AC-5.4: MESSAGING_RETRY_TTL_MISMATCH после общего срока RABBITMQ_RECONNECT_SECONDS — запуск продолжается (путь «после запуска»)', async () => {
        let settled: unknown = 'pending';
        void subscriberOn(fatalConnection(5_500))
            .onApplicationBootstrap()
            .then(
                () => {
                    settled = 'resolved';
                },
                (error: unknown) => {
                    settled = error;
                },
            );

        await vi.advanceTimersByTimeAsync(5_000);
        expect(settled).toBe('resolved');
        // Поздний исход настройки канала не отклоняет уже завершённый запуск.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(settled).toBe('resolved');
    });
});
