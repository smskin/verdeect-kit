// AC-8.6 (UC-12; KT-31): KitRedisChannels.subscribe — отказ SUBSCRIBE (NOPERM под ACL сервиса, обрыв tcpProxy) отклоняет
// subscribe и не оставляет подписку: повторный subscribe снова шлёт SUBSCRIBE и после восстановления получает сообщения;
// одновременные subscribe на канал ждут одного подтверждения (SUBSCRIBE — один, счёт через MONITOR администратора) и
// вместе отклоняются при его ошибке (prd.md §3.7). Без пауз: сигналы MONITOR и обработчиков, waitUntil.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_REDIS_PREFIX } from '../../../src/internal/tokens.js';
import { KitRedisChannels } from '../../../src/redis/channels.js';
import { tcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { waitUntil } from '../../support/messaging.js';
import { adminRedis, createRedisApp, redisUrl } from '../../support/redis.js';

let admin: Redis;

beforeAll(() => {
    admin = adminRedis();
});

afterAll(async () => {
    await admin.quit();
});

function nextMessage(): { promise: Promise<string>; handler: (message: string) => void } {
    let handler: (message: string) => void = () => undefined;
    const promise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('обработчик не получил сообщение')),
            2000 * TEST_TIMEOUT_SCALE,
        );
        handler = (message) => {
            clearTimeout(timer);
            resolve(message);
        };
    });

    return { promise, handler };
}

async function numsub(channel: string): Promise<number> {
    const [, count] = (await admin.pubsub('NUMSUB', channel)) as [string, number];

    return count;
}

describe('UC-12: отказ SUBSCRIBE', () => {
    it('AC-8.6: NOPERM — оба одновременных subscribe отклонены, повторный subscribe снова шлёт SUBSCRIBE (снова NOPERM)', async () => {
        // Префикс вне прав ACL сервиса kit (~kit:* &kit:*): SUBSCRIBE other:x → NOPERM.
        const app = await createRedisApp({
            options: { subscriber: true },
            overrides: [{ provide: KIT_REDIS_PREFIX, useValue: 'other:' }],
        });
        await app.init();
        try {
            const channels = app.get(KitRedisChannels);

            const results = await Promise.allSettled([
                channels.subscribe('x', () => undefined),
                channels.subscribe('x', () => undefined),
            ]);
            expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
            for (const result of results) {
                expect(result.status === 'rejected' && String(result.reason)).toMatch(/NOPERM/);
            }

            // Без снятия записи канала третий вызов разрешился бы без SUBSCRIBE.
            await expect(channels.subscribe('x', () => undefined)).rejects.toThrow(/NOPERM/);
        } finally {
            await app.close();
        }
    });

    it('AC-8.6: обрыв соединения — subscribe отклонён; после восстановления повторный subscribe получает сообщения', async () => {
        const proxy = await tcpProxy(redisUrl());
        let app: NestFastifyApplication | undefined;
        try {
            app = await createRedisApp({
                options: { subscriber: true },
                env: { REDIS_URL: proxy.url },
            });
            await app.init();
            const channels = app.get(KitRedisChannels);
            await proxy.break();

            await expect(channels.subscribe('ac86-r', () => undefined)).rejects.toThrow();

            await proxy.restore();
            const received = nextMessage();
            const unsubscribe = await channels.subscribe('ac86-r', received.handler);
            await waitUntil(async () => (await numsub('kit:ac86-r')) === 1, 'подписка kit:ac86-r');
            await admin.publish('kit:ac86-r', 'after-restore');

            expect(await received.promise).toBe('after-restore');
            await unsubscribe();
        } finally {
            await app?.close();
            await proxy.close();
        }
    });
});

describe('UC-12: одновременные subscribe', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
        app = await createRedisApp({ options: { subscriber: true } });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('AC-8.6: два одновременных subscribe разрешаются после одного подтверждения — SUBSCRIBE отправлен один раз, оба получают сообщение', async () => {
        const monitor = await adminRedis().monitor();
        const seen: string[][] = [];
        monitor.on('monitor', (_time: string, args: string[]) => {
            seen.push(args.map((arg) => arg.toLowerCase()));
        });
        try {
            const channels = app.get(KitRedisChannels);
            const first = nextMessage();
            const second = nextMessage();

            // Порядок разрешения: второй вызов не разрешается раньше подтверждения SUBSCRIBE первого.
            const order: string[] = [];
            const [offFirst, offSecond] = await Promise.all([
                channels.subscribe('ac86-c', first.handler).then((off) => {
                    order.push('first');

                    return off;
                }),
                channels.subscribe('ac86-c', second.handler).then((off) => {
                    order.push('second');

                    return off;
                }),
            ]);
            expect(order).toEqual(['first', 'second']);
            // Метка в MONITOR после подписки: команды до неё уже видны.
            await admin.get('kit:ac86-sentinel');
            await waitUntil(
                () => seen.some((args) => args[0] === 'get' && args[1] === 'kit:ac86-sentinel'),
                'метка в MONITOR',
            );

            expect(
                seen.filter((args) => args[0] === 'subscribe' && args[1] === 'kit:ac86-c'),
            ).toHaveLength(1);
            expect(await numsub('kit:ac86-c')).toBe(1);
            await admin.publish('kit:ac86-c', 'both');
            expect(await Promise.all([first.promise, second.promise])).toEqual(['both', 'both']);

            await offFirst();
            expect(await numsub('kit:ac86-c')).toBe(1);
            await offSecond();
            expect(await numsub('kit:ac86-c')).toBe(0);
        } finally {
            monitor.disconnect();
        }
    });
});
