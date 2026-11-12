// AC-1.14 (UC-14, prd.md §3.8 v1.23; К1 Orchestrator): startTestStack со всеми флагами-адресами на уже поднятых сервисах.
// Сервисы поднимает сам тест (как service-контейнеры CI) и передаёт адреса; startTestStack не вызывает Testcontainers,
// отдаёт те же ключи provide, vhost воркеров изолированы, пользователь Redis — ACL SETUSER (AC-8.5 под ACL: ключи, каналы,
// префикс воркера; reset снимает права оставшегося пользователя), teardown удаляет только объекты своего прогона — чужие
// БД, vhost, пользователи RabbitMQ и Redis, ключи Redis остаются (KT-62).
import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { Redis } from 'ioredis';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KitRabbitWorker } from '../../../src/testing/rabbitmq-admin.js';
import { hashRabbitPassword } from '../../../src/internal/rabbitmq-definitions.js';
import { RabbitAdmin } from '../../../src/testing/rabbitmq-admin.js';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';

const SERVICE = 'kitext';
const RABBIT_PASSWORD = randomBytes(8).toString('hex');
const PG_PASSWORD = randomBytes(8).toString('hex');
const MINIO_PASSWORD = randomBytes(8).toString('hex');
/** vhost чужого прогона того же сервиса: teardown его не трогает. */
const FOREIGN = `${SERVICE}-test-other-w1`;
/** Пользователи RabbitMQ чужого прогона и без runId: teardown их не трогает. */
const FOREIGN_RABBIT_USERS = [FOREIGN, SERVICE];
/** Чужие БД: с префиксом сервиса и без него. */
const FOREIGN_DATABASES = [`${SERVICE}_other`, 'other_db'];
/** Чужой пользователь Redis и чужие ключи (свой префикс другого сервиса и без префикса). */
const FOREIGN_REDIS_USER = 'othersvc';
const FOREIGN_REDIS_KEYS = ['othersvc:k', 'plain-k'];

const containers: StartedTestContainer[] = [];
const provided = new Map<string, unknown>();
const project = {
    config: { maxWorkers: 2 },
    vitest: { projects: [] },
    provide: (key: string, value: unknown) => void provided.set(key, value),
};
let rabbitAdmin: RabbitAdmin;
let redisAdminUrl: string;
let postgresAdminUrl: string;
let teardown: () => Promise<void>;
let containerStarts: ReturnType<typeof vi.spyOn>;

async function start(container: GenericContainer): Promise<StartedTestContainer> {
    const started = await container.withStartupTimeout(120_000).start();
    containers.push(started);

    return started;
}

function address(container: StartedTestContainer, port: number): string {
    return `${container.getHost()}:${container.getMappedPort(port)}`;
}

beforeAll(async () => {
    const [postgres, rabbitmq, redis, minio, mailpit] = await Promise.all([
        start(
            new GenericContainer(TEST_IMAGES.postgres)
                .withEnvironment({ POSTGRES_PASSWORD: PG_PASSWORD })
                .withExposedPorts(5432)
                .withWaitStrategy(
                    Wait.forLogMessage(/database system is ready to accept connections/, 2),
                ),
        ),
        start(
            new GenericContainer(TEST_IMAGES.rabbitmq)
                .withEnvironment({
                    RABBITMQ_DEFAULT_USER: 'ci-admin',
                    RABBITMQ_DEFAULT_PASS: RABBIT_PASSWORD,
                })
                .withExposedPorts(5672, 15672)
                .withWaitStrategy(Wait.forLogMessage(/Server startup complete/)),
        ),
        start(
            new GenericContainer(TEST_IMAGES.redis)
                .withExposedPorts(6379)
                .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)),
        ),
        start(
            new GenericContainer(TEST_IMAGES.minio)
                .withEnvironment({
                    MINIO_ROOT_USER: 'ci-minio',
                    MINIO_ROOT_PASSWORD: MINIO_PASSWORD,
                    MINIO_KMS_SECRET_KEY: `ci:${randomBytes(32).toString('base64')}`,
                })
                .withExposedPorts(9000)
                .withCommand(['server', '/data'])
                .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000)),
        ),
        start(
            new GenericContainer(TEST_IMAGES.mailpit)
                .withExposedPorts(1025, 8025)
                .withWaitStrategy(Wait.forHttp('/livez', 8025).forStatusCode(200)),
        ),
    ]);
    postgresAdminUrl = `postgres://postgres:${PG_PASSWORD}@${address(postgres, 5432)}/postgres`;
    redisAdminUrl = `redis://${address(redis, 6379)}`;
    const amqpUrl = `amqp://ci-admin:${RABBIT_PASSWORD}@${address(rabbitmq, 5672)}`;
    const managementUrl = `http://${address(rabbitmq, 15672)}/`;
    rabbitAdmin = new RabbitAdmin(managementUrl, 'ci-admin', RABBIT_PASSWORD);
    await rabbitAdmin.waitReady();
    await rabbitAdmin.loadDefinitions({
        rabbit_version: '4.3.6',
        vhosts: [{ name: FOREIGN }],
        users: FOREIGN_RABBIT_USERS.map((name) => ({
            name,
            password_hash: hashRabbitPassword('x'),
            hashing_algorithm: 'rabbit_password_hashing_sha256',
            tags: [],
        })),
        permissions: [],
        topic_permissions: [],
        exchanges: [],
        queues: [],
        bindings: [],
    });
    for (const name of FOREIGN_DATABASES) {
        await adminSql(`CREATE DATABASE ${name}`);
    }
    await withRedisAdmin(async (admin) => {
        await admin.call(
            'ACL',
            'SETUSER',
            FOREIGN_REDIS_USER,
            'on',
            'nopass',
            '~othersvc:*',
            '+@all',
        );
        // Пользователь сервиса, оставшийся от прерванного прогона, с лишними правами: SETUSER … reset их снимает.
        await admin.call(
            'ACL',
            'SETUSER',
            SERVICE,
            'on',
            '>stale-password',
            '~other:*',
            '&other:*',
            '+@all',
        );
        for (const key of FOREIGN_REDIS_KEYS) {
            await admin.set(key, 'foreign');
        }
    });

    containerStarts = vi.spyOn(GenericContainer.prototype, 'start');
    teardown = await startTestStack({
        service: SERVICE,
        postgres: { adminUrl: postgresAdminUrl },
        rabbitmq: { amqpUrl, managementUrl },
        redis: { adminUrl: redisAdminUrl },
        minio: {
            endpoint: `http://${address(minio, 9000)}`,
            accessKey: 'ci-minio',
            secretKey: MINIO_PASSWORD,
        },
        mailpit: {
            smtpUrl: `smtp://${address(mailpit, 1025)}`,
            httpUrl: `http://${address(mailpit, 8025)}`,
        },
    })(project as never);
});

afterAll(async () => {
    containerStarts?.mockRestore();
    await Promise.allSettled(containers.map((container) => container.stop()));
});

async function adminSql<T extends object = object>(sql: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: postgresAdminUrl });
    await client.connect();
    try {
        return (await client.query<T>(sql)).rows;
    } finally {
        await client.end();
    }
}

async function withRedisAdmin<T>(work: (admin: Redis) => Promise<T>): Promise<T> {
    const admin = new Redis(redisAdminUrl, { lazyConnect: true });
    admin.on('error', () => undefined);
    try {
        await admin.connect();

        return await work(admin);
    } finally {
        admin.disconnect();
    }
}

function text(key: string): string {
    const value = provided.get(key);
    expect(typeof value, key).toBe('string');

    return value as string;
}

function workers(): readonly KitRabbitWorker[] {
    return provided.get('kitRabbitmqWorkers') as readonly KitRabbitWorker[];
}

async function amqpOpens(url: string): Promise<string> {
    try {
        const connection = await amqp.connect(url);
        await connection.close();

        return 'ok';
    } catch (error) {
        return String((error as Error).message);
    }
}

describe('UC-14: startTestStack на внешних сервисах', () => {
    it('AC-1.14: без вызова Testcontainers; ключи provide те же, что у контейнеров', () => {
        expect(containerStarts).not.toHaveBeenCalled();
        expect([...provided.keys()].sort()).toEqual(
            [
                'kitPostgresUrl',
                'kitDatabaseUrl',
                'kitDatabaseOwnerUrl',
                'kitDatabaseAdminUrl',
                'kitDatabaseService',
                'kitDatabaseTemplate',
                'kitSmtpUrl',
                'kitMailpitUrl',
                'kitS3Endpoint',
                'kitS3AccessKey',
                'kitS3SecretKey',
                'kitRabbitmqUrl',
                'kitRabbitmqManagementUrl',
                'kitRabbitmqWorkers',
                'kitRedisUrl',
                'kitRedisAdminUrl',
                'kitRedisService',
            ].sort(),
        );
        expect(text('kitPostgresUrl')).toBe(postgresAdminUrl);
        expect(text('kitRedisAdminUrl')).toBe(redisAdminUrl);
    });

    it('AC-1.14: БД подготовлена — роль <svc>_app входит в <svc>', async () => {
        const client = new pg.Client({ connectionString: text('kitDatabaseUrl') });
        await client.connect();
        try {
            const { rows } = await client.query<{ user: string }>('select current_user as user');
            expect(rows[0]?.user).toBe(`${SERVICE}_app`);
        } finally {
            await client.end();
        }
    });

    it('AC-1.14: workerScope изолирован — vhost на воркер своего прогона, пользователь воркера не входит в чужой vhost', async () => {
        const [first, second] = workers();
        expect(workers()).toHaveLength(2);
        expect(first?.vhost).toMatch(new RegExp(`^${SERVICE}-test-[0-9a-f]{8}-w1$`));
        expect(second?.vhost).toBe(first?.vhost.replace(/-w1$/, '-w2'));
        expect(await amqpOpens(first?.url ?? '')).toBe('ok');

        const foreign = new URL(first?.url ?? '');
        foreign.pathname = `/${encodeURIComponent(second?.vhost ?? '')}`;
        expect(await amqpOpens(foreign.toString())).toMatch(/ACCESS_REFUSED|403|ConnectionClose/);
    });

    it('AC-1.14: AC-8.5 под ACL через ACL SETUSER — ключи и каналы <svc>:*, префикс воркера доступны, чужие — NOPERM; права оставшегося пользователя сняты (reset)', async () => {
        const redis = new Redis(text('kitRedisUrl'), {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
        redis.on('error', () => undefined);
        try {
            await redis.connect();
            expect(await redis.set(`${SERVICE}:k`, '1')).toBe('OK');
            expect(await redis.set(`${SERVICE}:w1:k`, '1')).toBe('OK');
            await expect(redis.set('other:k', '1')).rejects.toThrow(/NOPERM/);
            expect(await redis.publish(`${SERVICE}:events`, 'x')).toBe(0);
            await expect(redis.publish('other:events', 'x')).rejects.toThrow(/NOPERM/);
        } finally {
            redis.disconnect();
        }
        // Пароль оставшегося пользователя снят: AUTH им — WRONGPASS.
        await expect(
            withRedisAdmin((admin) => admin.call('AUTH', SERVICE, 'stale-password')),
        ).rejects.toThrow(/WRONGPASS/);
    });

    it('AC-1.14: teardown удаляет только объекты своего прогона — vhost воркеров, пользователя ACL, базу-шаблон; чужой vhost остаётся', async () => {
        const own = workers().map((worker) => worker.vhost);
        await teardown();

        const vhosts = await rabbitAdmin.listVhosts();
        expect(vhosts).toContain(FOREIGN);
        for (const vhost of own) {
            expect(vhosts).not.toContain(vhost);
        }
        const users = await rabbitAdmin.listUsers();
        expect(users).toEqual(expect.arrayContaining(FOREIGN_RABBIT_USERS));
        for (const user of own) {
            expect(users).not.toContain(user);
        }
        await withRedisAdmin(async (admin) => {
            expect(await admin.call('ACL', 'GETUSER', SERVICE)).toBeNull();
            expect(await admin.call('ACL', 'GETUSER', FOREIGN_REDIS_USER)).not.toBeNull();
            for (const key of FOREIGN_REDIS_KEYS) {
                expect(await admin.get(key), key).toBe('foreign');
            }
        });
        const databases = (
            await adminSql<{ datname: string }>('select datname from pg_database')
        ).map((row) => row.datname);
        expect(databases).not.toContain(`${SERVICE}_template`);
        expect(databases).toEqual(expect.arrayContaining(FOREIGN_DATABASES));
    });

    it('AC-1.14 (контроль шпиона): флаг true — startTestStack вызывает GenericContainer.prototype.start того же экземпляра testcontainers', async () => {
        const before = containerStarts.mock.calls.length;
        const control = {
            config: { maxWorkers: 1 },
            vitest: { projects: [] },
            provide: () => undefined,
        };
        const stop = await startTestStack({ service: `${SERVICE}-ctl`, mailpit: true })(
            control as never,
        );
        try {
            expect(containerStarts.mock.calls.length).toBeGreaterThanOrEqual(before + 1);
        } finally {
            await stop();
        }
    });
});
