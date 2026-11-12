// AC-1.14 (UC-14, prd.md §3.8 v1.23; К1 Orchestrator): startTestStack со всеми флагами-адресами на уже поднятых сервисах.
// Сервисы поднимает сам тест (как service-контейнеры CI) и передаёт адреса; startTestStack не вызывает Testcontainers,
// отдаёт те же ключи provide, vhost воркеров изолированы, пользователь Redis — ACL SETUSER (AC-8.5 под ACL), teardown
// удаляет только объекты своего прогона.
import { randomBytes } from 'node:crypto';
import amqp from 'amqplib';
import { Redis } from 'ioredis';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KitRabbitWorker } from '../../../src/testing/rabbitmq-admin.js';
import { RabbitAdmin } from '../../../src/testing/rabbitmq-admin.js';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';

const SERVICE = 'kitext';
const RABBIT_PASSWORD = randomBytes(8).toString('hex');
const PG_PASSWORD = randomBytes(8).toString('hex');
const MINIO_PASSWORD = randomBytes(8).toString('hex');
/** vhost чужого прогона того же сервиса: teardown его не трогает. */
const FOREIGN = `${SERVICE}-test-other-w1`;

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
        users: [],
        permissions: [],
        topic_permissions: [],
        exchanges: [],
        queues: [],
        bindings: [],
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

    it('AC-1.14: AC-8.5 под ACL через ACL SETUSER — ключи <svc>:* доступны, чужие — NOPERM', async () => {
        const redis = new Redis(text('kitRedisUrl'), {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
        redis.on('error', () => undefined);
        try {
            await redis.connect();
            expect(await redis.set(`${SERVICE}:k`, '1')).toBe('OK');
            await expect(redis.set('other:k', '1')).rejects.toThrow(/NOPERM/);
        } finally {
            redis.disconnect();
        }
    });

    it('AC-1.14: teardown удаляет только объекты своего прогона — vhost воркеров, пользователя ACL, базу-шаблон; чужой vhost остаётся', async () => {
        const own = workers().map((worker) => worker.vhost);
        await teardown();

        const vhosts = await rabbitAdmin.listVhosts();
        expect(vhosts).toContain(FOREIGN);
        for (const vhost of own) {
            expect(vhosts).not.toContain(vhost);
        }
        const admin = new Redis(redisAdminUrl, { lazyConnect: true });
        admin.on('error', () => undefined);
        try {
            await admin.connect();
            expect(await admin.call('ACL', 'GETUSER', SERVICE)).toBeNull();
        } finally {
            admin.disconnect();
        }
        const client = new pg.Client({ connectionString: postgresAdminUrl });
        await client.connect();
        try {
            const { rowCount } = await client.query(
                'select 1 from pg_database where datname = $1',
                [`${SERVICE}_template`],
            );
            expect(rowCount).toBe(0);
        } finally {
            await client.end();
        }
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
