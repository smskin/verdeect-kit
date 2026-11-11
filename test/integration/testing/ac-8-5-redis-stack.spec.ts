// AC-8.5 (UC-14): startTestStack({redis: true}) поднимает TEST_IMAGES.redis с aclfile сервиса (генератор CLI redis acl) и
// администратором теста, адреса — через provide (prd.md §3.8; D4 плана E8). startTestStack вызывается напрямую с подставным
// project; свой service — не пересекается со стеком globalSetup.
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';
import { runningImages } from '../../support/docker.js';

const SERVICE = 'kit-redis-stack';

function fakeProject(): {
    provided: Map<string, unknown>;
    provide: (k: string, v: unknown) => void;
} {
    const provided = new Map<string, unknown>();

    return { provided, provide: (key, value) => provided.set(key, value) };
}

const project = fakeProject();
let teardown: (() => Promise<void>) | null = null;

beforeAll(async () => {
    teardown = await startTestStack({ service: SERVICE, redis: true })(project as never);
});

afterAll(async () => {
    await teardown?.();
});

function provided(key: string): string {
    const value = project.provided.get(key);
    expect(typeof value, key).toBe('string');

    return value as string;
}

async function ping(url: string): Promise<string> {
    const redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
    });
    try {
        return await redis.ping();
    } finally {
        redis.disconnect();
    }
}

describe('UC-14: Redis тестового контура', () => {
    it('AC-8.5: startTestStack({redis: true}) поднимает TEST_IMAGES.redis', async () => {
        expect(await runningImages(SERVICE)).toEqual([TEST_IMAGES.redis]);
    });

    it('AC-8.5: адреса переданы через provide — kitRedisUrl, kitRedisAdminUrl, kitRedisService; PING → PONG', async () => {
        expect(provided('kitRedisUrl')).toMatch(new RegExp(`^redis://${SERVICE}:[0-9a-f]{32}@`));
        expect(provided('kitRedisAdminUrl')).toMatch(/^redis:\/\/kit-test-admin:[0-9a-f]{32}@/);
        expect(provided('kitRedisService')).toBe(SERVICE);
        expect(await ping(provided('kitRedisAdminUrl'))).toBe('PONG');
        expect(await ping(provided('kitRedisUrl'))).toBe('PONG');
    });

    it('AC-8.5: без redis: true контейнер Redis не стартует, kitRedisUrl не передан', async () => {
        const other = fakeProject();

        const stop = await startTestStack({ service: 'kit-no-redis' })(other as never);

        expect(await runningImages('kit-no-redis')).toEqual([]);
        expect(other.provided.has('kitRedisUrl')).toBe(false);
        expect(other.provided.has('kitRedisService')).toBe(false);
        await stop();
    });

    it('AC-8.5: после teardown контейнеров нет', async () => {
        await teardown?.();
        teardown = null;

        expect(await runningImages(SERVICE)).toEqual([]);
    });
});
