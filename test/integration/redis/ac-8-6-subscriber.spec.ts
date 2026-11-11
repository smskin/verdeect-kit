// AC-8.6 (UC-11): подписочное соединение по subscriber: true — сообщения канала <svc>:x, сроки команд 5 с и 500 мс, без
// subscriber второго соединения нет, отписка последнего обработчика — UNSUBSCRIBE, ошибка обработчика не мешает другим
// (prd.md §3.7; D9, D10 плана E8). Механика Set обработчиков — O RedisBus.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_REDIS_SUBSCRIBER } from '../../../src/internal/tokens.js';
import { KitRedisChannels } from '../../../src/redis/channels.js';
import { KIT_REDIS } from '../../../src/redis/client.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { adminRedis, clientNames, createRedisApp } from '../../support/redis.js';

let admin: Redis;

beforeAll(() => {
    admin = adminRedis();
});

afterAll(async () => {
    await admin.quit();
});

function deferred(): { promise: Promise<string>; resolve: (value: string) => void } {
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

function withDeadline<T>(promise: Promise<T>, what: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(what)), 1000 * TEST_TIMEOUT_SCALE),
        ),
    ]);
}

async function numsub(channel: string): Promise<number> {
    const [, count] = (await admin.pubsub('NUMSUB', channel)) as [string, number];

    return count;
}

describe('UC-11: подписочное соединение', () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
        app = await createRedisApp({ options: { subscriber: true } });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('AC-8.6: subscriber: true — publish в канал x приходит подписчику канала kit:x, строка без префикса', async () => {
        const channels = app.get(KitRedisChannels);
        const messages: string[] = [];
        const second = deferred();
        const unsubscribe = await channels.subscribe('ac86-x', (message) => {
            messages.push(message);
            if (messages.length === 2) {
                second.resolve(message);
            }
        });

        await channels.publish('ac86-x', 'from-module');
        await admin.publish('kit:ac86-x', 'from-admin');
        await withDeadline(second.promise, 'нет двух сообщений');

        expect(messages).toEqual(['from-module', 'from-admin']);
        await unsubscribe();
    });

    it('AC-8.6: срок команд подписочного соединения 5 с, основного — 500 мс', () => {
        expect(app.get<Redis>(KIT_REDIS_SUBSCRIBER).options.commandTimeout).toBe(5000);
        expect(app.get<Redis>(KIT_REDIS).options.commandTimeout).toBe(500);
    });

    it('AC-8.6: отписка последнего обработчика — UNSUBSCRIBE; ошибка обработчика не мешает другим', async () => {
        const channels = app.get(KitRedisChannels);
        const got = deferred();
        const offFailing = await channels.subscribe('ac86-y', () => {
            throw new Error('handler failed');
        });
        const offRejecting = await channels.subscribe('ac86-y', () =>
            Promise.reject(new Error('handler rejected')),
        );
        const offOk = await channels.subscribe('ac86-y', (message) => {
            got.resolve(message);
        });
        expect(await numsub('kit:ac86-y')).toBe(1);

        await channels.publish('ac86-y', 'm');
        expect(await withDeadline(got.promise, 'обработчик не получил сообщение')).toBe('m');

        await offFailing();
        await offRejecting();
        expect(await numsub('kit:ac86-y')).toBe(1);
        await offOk();
        expect(await numsub('kit:ac86-y')).toBe(0);
    });
});

describe('UC-11: без subscriber', () => {
    it('AC-8.6: без subscriber второго соединения нет, subscribe — Error; с subscriber: true — оба соединения', async () => {
        const plain = await createRedisApp();
        await plain.init();
        try {
            await plain.get<Redis>(KIT_REDIS).ping();
            const names = await clientNames(admin);

            expect(names).toContain('kit');
            // Файлы идут последовательно (fileParallelism: false), подписочные соединения прошлых тестов закрыты.
            expect(names).not.toContain('kit-subscriber');
            expect(() => plain.get(KIT_REDIS_SUBSCRIBER, { strict: false })).toThrow();
            await expect(
                plain.get(KitRedisChannels).subscribe('x', () => undefined),
            ).rejects.toThrow(/subscriber: true/);
        } finally {
            await plain.close();
        }

        const full = await createRedisApp({ options: { subscriber: true } });
        await full.init();
        try {
            await full.get<Redis>(KIT_REDIS).ping();
            const unsubscribe = await full
                .get(KitRedisChannels)
                .subscribe('ac86-z', () => undefined);
            const names = await clientNames(admin);

            expect(names).toContain('kit');
            expect(names).toContain('kit-subscriber');
            await unsubscribe();
        } finally {
            await full.close();
        }
    });
});
