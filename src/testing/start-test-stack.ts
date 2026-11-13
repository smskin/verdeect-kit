// startTestStack — globalSetup Vitest: контейнеры TEST_IMAGES раз на прогон, адреса через provide (prd.md §3.8, E1;
// AC-1.12, AC-1.13). Эталоны — O test/support/global-setup.ts (minio, provide, teardown), I global-setup.ts (mailpit),
// O setup-error.ts (текст ошибки в stderr до throw: Vite теряет текст ошибок globalSetup).
// E4: при postgres — prepareDatabase и шаблон <svc>_template; migrations — runMigrations до копии. v1.26 (AC-1.14): метка
// баз COMMENT ON DATABASE, пересоздание и удаление только с меткой.
// Код БД — динамический import() (без pg /testing импортируется).
// E5: rabbitmq — definitions.json (internal/rabbitmq-definitions, как CLI), vhost и пользователь на воркер (эталон B
// test/support/broker.ts), удаление по префиксу <svc>-test-.
// E8: redis — aclfile из internal/redis-acl (как CLI redis acl) + администратор теста; пользователей на воркер нет.
// v1.23 (К1, AC-1.14): флаг — true (контейнер) или адреса уже поднятого сервиса; testcontainers — лениво; на внешнем Redis —
// ACL SETUSER/DELUSER вместо aclfile; на внешнем брокере — очистка только своего прогона <svc>-test-<runId>-*. К2: MinIO с KMS.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type Pg from 'pg';
import type * as Testcontainers from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { loadPeer, requirePeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { PUBLISH_PREFIX_PATTERN } from '../internal/rabbitmq-definitions.js';
import type * as IORedis from 'ioredis';
import { buildRedisAclFile, redisPasswordHash, redisUserRules } from '../internal/redis-acl.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import type { KitEvent } from '../messaging/define-event.js';
import { TEST_IMAGES } from './images.js';
import { assertOutboxCoverage, setCoverageDir } from './outbox-coverage.js';
import {
    deleteTestVhosts,
    prepareWorkerVhosts,
    rabbitAdminFromProvided,
    RabbitAdmin,
    type KitRabbitWorker,
} from './rabbitmq-admin.js';

// Наличие testcontainers — синхронно при импорте (AC-1.2, как pg в /database); загрузка — лениво, только при флаге `true`.
requirePeer('testcontainers', 'testing');

/** testcontainers — только при флаге `true` (внешние сервисы без Docker, AC-1.14). */
let testcontainers: Promise<typeof Testcontainers> | undefined;
function containers(): Promise<typeof Testcontainers> {
    testcontainers ??= loadPeer<typeof Testcontainers>('testcontainers', 'testing');

    return testcontainers;
}

const MINIO_USER = 'kit-test';
const RABBIT_ADMIN = 'kit-admin';
const REDIS_ADMIN = 'kit-test-admin';
const REDIS_ACL_PATH = '/usr/local/etc/redis/users.acl';

/** Уже поднятый PostgreSQL: суперпользователь (§3.8, AC-1.14). */
export interface KitExternalPostgres {
    /** postgres://<суперпользователь>:<пароль>@<host>:<port>/<БД> */
    readonly adminUrl: string;
}

/** Уже поднятый RabbitMQ с management plugin: пользователь с тегом `administrator`. */
export interface KitExternalRabbitmq {
    /** amqp://<администратор>:<пароль>@<host>:<port> */
    readonly amqpUrl: string;
    /** http://<host>:<port 15672>/ — management API. */
    readonly managementUrl: string;
}

/** Уже поднятый Redis: пользователь с правом `+acl`. */
export interface KitExternalRedis {
    /** redis://[<пользователь>:<пароль>@]<host>:<port> */
    readonly adminUrl: string;
}

/** Уже поднятый MinIO (с KMS — для SSE-S3). */
export interface KitExternalMinio {
    /** http://<host>:<port> — S3 API. */
    readonly endpoint: string;
    /** Пользователь (access key). */
    readonly accessKey: string;
    /** Пароль (secret key). */
    readonly secretKey: string;
}

/** Уже поднятый mailpit. */
export interface KitExternalMailpit {
    /** smtp://<host>:<port> */
    readonly smtpUrl: string;
    /** http://<host>:<port> — HTTP API. */
    readonly httpUrl: string;
}

/**
 * Параметры startTestStack (§3.8). Флаг сервиса — `true` (контейнер `TEST_IMAGES`) или адреса уже поднятого сервиса:
 * только одноразовые service-контейнеры CI, общие долгоживущие серверы не поддерживаются.
 */
export interface TestStackOptions {
    /** Имя экземпляра сервиса (^[a-z][a-z0-9-]{1,31}$); метка verdeect.kit.service контейнеров. */
    readonly service: string;
    /** PostgreSQL TEST_IMAGES.postgres или `{adminUrl}`; суперпользователь — kitPostgresUrl; prepareDatabase и шаблон БД. */
    readonly postgres?: boolean | KitExternalPostgres;
    /**
     * Папка миграций drizzle-kit относительно `process.cwd()`: применяется к шаблону под ролью `<svc>_owner`, журнал —
     * `<svc>.__migrations`; без `postgres` — `TypeError` при вызове `startTestStack`.
     */
    readonly migrations?: string;
    /** mailpit (или `{smtpUrl, httpUrl}`) — kitSmtpUrl, kitMailpitUrl. */
    readonly mailpit?: boolean | KitExternalMailpit;
    /** MinIO с KMS (или `{endpoint, accessKey, secretKey}`) — kitS3Endpoint, kitS3AccessKey, kitS3SecretKey. */
    readonly minio?: boolean | KitExternalMinio;
    /**
     * RabbitMQ TEST_IMAGES.rabbitmq: definitions.json сервиса (как `verdeect-kit rabbitmq definitions`), vhost и
     * пользователь на воркер; адреса — kitRabbitmqUrl, kitRabbitmqManagementUrl, kitRabbitmqWorkers. Teardown удаляет
     * vhost и пользователей с префиксом `<svc>-test-` (AC-5.18); внешний брокер (`{amqpUrl, managementUrl}`) — только своего
     * прогона `<svc>-test-<runId>-`.
     */
    readonly rabbitmq?: boolean | KitExternalRabbitmq;
    /**
     * Префиксы ключей публикации пользователя воркера в `verdeect.events` (как `--publishes` CLI, `['identity.']`); без
     * них воркер не публикует. `publishTestEvent` ходит от администратора vhost и не ограничивается.
     */
    readonly publishes?: readonly string[];
    /**
     * Redis TEST_IMAGES.redis с aclfile (тот же генератор, что `verdeect-kit redis acl`): пользователь сервиса
     * `~<svc>:* &<svc>:*` — kitRedisUrl, администратор теста — kitRedisAdminUrl, имя сервиса — kitRedisService. Пользователей
     * на воркер нет: префикс воркера `<svc>:w<N>:` лежит внутри прав сервиса (AC-8.5). Внешний Redis (`{adminUrl}`) —
     * `ACL SETUSER <svc>` через администратора, в teardown — `ACL DELUSER`.
     */
    readonly redis?: boolean | KitExternalRedis;
    /**
     * События, которые публикует сервис: каталог покрытия прогона (`kitOutboxCoverageDir`); при `KIT_OUTBOX_COVERAGE=1`
     * teardown падает со списком событий без успешного `expectOutbox` (GAP-2, AC-5.13).
     */
    readonly outboxEvents?: readonly KitEvent[];
}

declare module 'vitest' {
    interface ProvidedContext {
        /** postgres://postgres:<пароль>@<host>:<port>/postgres — суперпользователь (флаг postgres). */
        readonly kitPostgresUrl?: string;
        /** Роль `<svc>_app` к БД `<svc>` — значение `DATABASE_URL` тестов (флаг postgres). */
        readonly kitDatabaseUrl?: string;
        /** Роль `<svc>_owner` к БД `<svc>` — `DATABASE_MIGRATOR_URL` (флаг postgres). */
        readonly kitDatabaseOwnerUrl?: string;
        /** Суперпользователь к БД `<svc>` (флаг postgres). */
        readonly kitDatabaseAdminUrl?: string;
        /** Имя сервиса: схема и роли БД (флаг postgres). */
        readonly kitDatabaseService?: string;
        /** Шаблонная БД `<svc>_template` для `createScratchDatabase` (флаг postgres). */
        readonly kitDatabaseTemplate?: string;
        /** smtp://<host>:<port 1025> (флаг mailpit). */
        readonly kitSmtpUrl?: string;
        /** http://<host>:<port 8025> — HTTP API mailpit (флаг mailpit). */
        readonly kitMailpitUrl?: string;
        /** http://<host>:<port 9000> (флаг minio). */
        readonly kitS3Endpoint?: string;
        /** Пользователь MinIO (флаг minio). */
        readonly kitS3AccessKey?: string;
        /** Пароль MinIO, случайный на прогон (флаг minio). */
        readonly kitS3SecretKey?: string;
        /** amqp://<администратор>:<пароль>@<host>:<port> — vhost `/`, полные права (флаг rabbitmq). */
        readonly kitRabbitmqUrl?: string;
        /** http://<host>:<port 15672> — management API без учётных данных (флаг rabbitmq). */
        readonly kitRabbitmqManagementUrl?: string;
        /**
         * vhost воркеров: индекс — `VITEST_POOL_ID − 1`; `url` — пользователь воркера с правами M3 сервиса, `adminUrl` —
         * администратор того же vhost (флаг rabbitmq).
         */
        readonly kitRabbitmqWorkers?: readonly KitRabbitWorker[];
        /** redis://<svc>:<пароль>@<host>:<port> — пользователь сервиса из aclfile, `REDIS_URL` тестов (флаг redis). */
        readonly kitRedisUrl?: string;
        /** redis://kit-test-admin:<пароль>@<host>:<port> — администратор теста: CLIENT LIST, ACL LOG, очистка (флаг redis). */
        readonly kitRedisAdminUrl?: string;
        /** Имя сервиса — пользователь Redis и префикс `workerScope().redisPrefix` (флаг redis). */
        readonly kitRedisService?: string;
        /** Каталог покрытия outbox прогона: файлы воркеров `w<N>.txt` (флаг outboxEvents). */
        readonly kitOutboxCoverageDir?: string;
    }
}

/** Сервис стека: имя для сообщения, запуск контейнера (внешний — `null`) и передача адресов после старта. */
interface StackPart {
    readonly name: string;
    readonly start: () => Promise<StartedTestContainer | null>;
    readonly provide: (project: TestProject) => Promise<void> | void;
    /** Очистка до остановки контейнера; ошибки — в stderr, teardown не падает. */
    readonly teardown?: () => Promise<void>;
}

/** Адрес контейнера `host:port` для внутреннего порта. */
function hostPort(container: StartedTestContainer, port: number): string {
    return `${container.getHost()}:${container.getMappedPort(port)}`;
}

/** Контейнер части после `start()` (провайдер вызывается только после успешного старта). */
function startedOf(container: StartedTestContainer | null): StartedTestContainer {
    if (container === null) {
        throw new Error('startTestStack: контейнер части не запущен');
    }

    return container;
}

/**
 * Значение флага: `true` — контейнер, объект — внешние адреса со строковыми полями `keys`.
 * @throws {TypeError} значение вне `boolean | {…}` или поле не непустая строка.
 */
function externalOf<T extends object>(
    name: string,
    value: boolean | T | undefined,
    keys: readonly (keyof T & string)[],
): T | null {
    if (value === undefined || typeof value === 'boolean') {
        return null;
    }
    for (const key of keys) {
        const field: unknown = (value as Record<string, unknown>)[key];
        if (typeof field !== 'string' || field === '') {
            throw new TypeError(`startTestStack: ${name}.${key} — нужна непустая строка адреса`);
        }
    }

    return value;
}

function enabled(value: unknown): boolean {
    return value === true || (typeof value === 'object' && value !== null);
}

/** Ошибка шага подготовки БД: в stderr — имя шага и код, без текста pg (адрес, имя роли); у migrate — и текст SQL. */
class PrepareStepError extends Error {
    constructor(step: string, cause: unknown) {
        const code = (cause as { code?: unknown } | null)?.code;
        const detail = step === 'migrate' ? `: ${errorMessage(cause)}` : '';
        super(`шаг ${step}, код ${typeof code === 'string' ? code : 'нет'}${detail}`, { cause });
    }
}

/** База с тем же именем есть, но без метки startTestStack: текст для разработчика (имя базы, подсказка CI). */
class UnlabeledDatabaseError extends Error {
    constructor(name: string, service: string) {
        super(
            `БД ${name} уже есть и создана не startTestStack; у service-контейнера CI POSTGRES_DB не должен совпадать с ${service} (используйте postgres)`,
        );
    }
}

async function step<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (error instanceof UnlabeledDatabaseError) {
            throw error;
        }
        throw new PrepareStepError(name, error);
    }
}

/** Метка баз startTestStack (§3.8 v1.26, AC-1.14): удаляются и пересоздаются только базы с ней. */
const DATABASE_LABEL = 'verdeect-kit startTestStack';

type PgClient = InstanceType<typeof Pg.Client>;

/** Метка базы: `undefined` — базы нет, `null` — есть без комментария. */
async function databaseLabel(client: PgClient, name: string): Promise<string | null | undefined> {
    const result = await client.query<{ label: string | null }>(
        "select shobj_description(oid, 'pg_database') as label from pg_database where datname = $1",
        [name],
    );
    const [row] = result.rows;

    return row === undefined ? undefined : row.label;
}

/**
 * Свежая база `name`: помеченная — остаток прерванного прогона, удаляется; без метки — отказ, ничего не удаляется;
 * затем `CREATE DATABASE` (`template` — копия шаблона) и метка.
 */
async function freshDatabase(
    client: PgClient,
    name: string,
    service: string,
    template?: string,
): Promise<void> {
    const label = await databaseLabel(client, name);
    if (label !== undefined && label !== DATABASE_LABEL) {
        throw new UnlabeledDatabaseError(name, service);
    }
    if (label === DATABASE_LABEL) {
        process.stderr.write(
            `startTestStack: БД ${name} осталась от прерванного прогона — пересоздаётся\n`,
        );
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
    }
    const from = template === undefined ? '' : ` TEMPLATE ${quoteIdentifier(template)}`;
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)}${from}`);
    await client.query(`COMMENT ON DATABASE ${quoteIdentifier(name)} IS '${DATABASE_LABEL}'`);
}

/** teardown: базы с меткой удаляются, без метки — остаются (запись в stderr). */
async function dropLabeledDatabases(pg: typeof Pg, adminUrl: string, names: readonly string[]) {
    const client = new pg.Client({ connectionString: adminUrl });
    client.on('error', () => undefined);
    await client.connect();
    try {
        for (const name of names) {
            const label = await databaseLabel(client, name);
            if (label === undefined) {
                continue;
            }
            if (label !== DATABASE_LABEL) {
                process.stderr.write(`startTestStack: БД ${name} без метки — не удаляется\n`);
                continue;
            }
            await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
        }
    } finally {
        await client.end();
    }
}

function withDatabase(base: string, database: string, user?: string, password?: string): string {
    const url = new URL(base);
    url.pathname = `/${database}`;
    if (user !== undefined && password !== undefined) {
        url.username = user;
        url.password = password;
    }

    return url.toString();
}

/**
 * Подготовка БД стека (§3.8, AC-4.18): шаблон `<svc>_template` — prepareDatabase, миграции; копия `<svc>` — права
 * уровня БД заново (при копировании не переносятся). Обе базы — с меткой startTestStack (AC-1.14, v1.26).
 */
async function prepareStackDatabase(
    adminUrl: string,
    service: string,
    migrations: string | undefined,
    project: TestProject,
): Promise<void> {
    const pg = (await loadPeer<{ default: typeof Pg }>('pg', 'testing')).default;
    const [{ prepareDatabase, grantDatabaseAccess }, { runMigrations }] = await Promise.all([
        import('../database/prepare-database.js'),
        import('../database/migrations.js'),
    ]);
    const ownerPassword = randomBytes(16).toString('hex');
    const appPassword = randomBytes(16).toString('hex');
    const template = `${service}_template`;
    const templateAdmin = withDatabase(adminUrl, template);
    await step('create-template', async () => {
        const client = new pg.Client({ connectionString: adminUrl });
        client.on('error', () => undefined);
        await client.connect();
        try {
            await freshDatabase(client, template, service);
        } finally {
            await client.end();
        }
    });
    await step('prepare', () =>
        prepareDatabase({ service, adminUrl: templateAdmin, ownerPassword, appPassword }),
    );
    if (migrations !== undefined) {
        await step('migrate', () =>
            runMigrations({
                url: withDatabase(adminUrl, template, `${service}_owner`, ownerPassword),
                folder: resolve(migrations),
                schema: service,
            }),
        );
    }
    await step('copy', async () => {
        const client = new pg.Client({ connectionString: adminUrl });
        client.on('error', () => undefined);
        await client.connect();
        try {
            await freshDatabase(client, service, service, template);
            await grantDatabaseAccess(client, service, service);
        } finally {
            await client.end();
        }
    });
    project.provide(
        'kitDatabaseUrl',
        withDatabase(adminUrl, service, `${service}_app`, appPassword),
    );
    project.provide(
        'kitDatabaseOwnerUrl',
        withDatabase(adminUrl, service, `${service}_owner`, ownerPassword),
    );
    project.provide('kitDatabaseAdminUrl', withDatabase(adminUrl, service));
    project.provide('kitDatabaseService', service);
    project.provide('kitDatabaseTemplate', template);
}

function postgresPart(
    labels: Record<string, string>,
    service: string,
    migrations: string | undefined,
    external: KitExternalPostgres | null,
): StackPart {
    const password = randomBytes(16).toString('hex');
    let container: StartedTestContainer | null = null;
    let adminUrl: string | null = null;

    return {
        name: 'postgres',
        start: async () => {
            if (external !== null) {
                return null;
            }
            const { GenericContainer, Wait } = await containers();
            container = await new GenericContainer(TEST_IMAGES.postgres)
                .withLabels(labels)
                .withEnvironment({
                    POSTGRES_USER: 'postgres',
                    POSTGRES_PASSWORD: password,
                    POSTGRES_DB: 'postgres',
                })
                .withExposedPorts(5432)
                .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
                .withCommand([
                    'postgres',
                    '-c',
                    'fsync=off',
                    '-c',
                    'synchronous_commit=off',
                    '-c',
                    'full_page_writes=off',
                ])
                // Сообщение готовности выводится дважды: init-скрипт и рабочий старт.
                .withWaitStrategy(
                    Wait.forLogMessage(/database system is ready to accept connections/, 2),
                )
                .withStartupTimeout(120_000)
                .start();

            return container;
        },
        provide: async (project) => {
            adminUrl =
                external?.adminUrl ??
                `postgres://postgres:${password}@${hostPort(startedOf(container), 5432)}/postgres`;
            project.provide('kitPostgresUrl', adminUrl);
            await prepareStackDatabase(adminUrl, service, migrations, project);
        },
        teardown: async () => {
            if (adminUrl === null) {
                return;
            }
            const pg = (await loadPeer<{ default: typeof Pg }>('pg', 'testing')).default;
            // Только базы с меткой startTestStack (AC-1.14): копия и шаблон.
            await dropLabeledDatabases(pg, adminUrl, [service, `${service}_template`]);
        },
    };
}

function mailpitPart(
    labels: Record<string, string>,
    external: KitExternalMailpit | null,
): StackPart {
    let container: StartedTestContainer | null = null;

    return {
        name: 'mailpit',
        start: async () => {
            if (external !== null) {
                return null;
            }
            const { GenericContainer, Wait } = await containers();
            container = await new GenericContainer(TEST_IMAGES.mailpit)
                .withLabels(labels)
                .withExposedPorts(1025, 8025)
                .withWaitStrategy(Wait.forHttp('/livez', 8025).forStatusCode(200))
                .withStartupTimeout(120_000)
                .start();

            return container;
        },
        provide: (project) => {
            project.provide(
                'kitSmtpUrl',
                external?.smtpUrl ?? `smtp://${hostPort(startedOf(container), 1025)}`,
            );
            project.provide(
                'kitMailpitUrl',
                external?.httpUrl ?? `http://${hostPort(startedOf(container), 8025)}`,
            );
        },
    };
}

function minioPart(labels: Record<string, string>, external: KitExternalMinio | null): StackPart {
    const password = randomBytes(16).toString('hex');
    let container: StartedTestContainer | null = null;

    return {
        name: 'minio',
        start: async () => {
            if (external !== null) {
                return null;
            }
            const { GenericContainer, Wait } = await containers();
            container = await new GenericContainer(TEST_IMAGES.minio)
                .withLabels(labels)
                .withEnvironment({
                    MINIO_ROOT_USER: MINIO_USER,
                    MINIO_ROOT_PASSWORD: password,
                    // KMS со статическим ключом на прогон: SSE-S3 (AES256) работает (§3.8, AC-1.12, К2).
                    MINIO_KMS_SECRET_KEY: `kit-test:${randomBytes(32).toString('base64')}`,
                })
                .withExposedPorts(9000)
                .withCommand(['server', '/data'])
                .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
                .withStartupTimeout(120_000)
                .start();

            return container;
        },
        provide: (project) => {
            project.provide(
                'kitS3Endpoint',
                external?.endpoint ?? `http://${hostPort(startedOf(container), 9000)}`,
            );
            project.provide('kitS3AccessKey', external?.accessKey ?? MINIO_USER);
            project.provide('kitS3SecretKey', external?.secretKey ?? password);
        },
    };
}

/** Число воркеров прогона: `maxWorkers` проектов (число ≥ 1), иначе `os.availableParallelism()`. */
export function maxWorkersOf(configs: readonly { readonly maxWorkers?: unknown }[]): number {
    const counts = configs
        .map(({ maxWorkers }) => maxWorkers)
        .filter((value): value is number => typeof value === 'number' && value >= 1);

    return counts.length === 0 ? Math.max(1, availableParallelism()) : Math.max(...counts);
}

function rabbitmqPart(
    labels: Record<string, string>,
    service: string,
    publishes: readonly string[] | undefined,
    external: KitExternalRabbitmq | null,
): StackPart {
    const password = randomBytes(16).toString('hex');
    const runId = randomBytes(4).toString('hex');
    // Внешний брокер: удаляются только объекты своего прогона (К1).
    const prefix = external === null ? `${service}-test-` : `${service}-test-${runId}-`;
    let container: StartedTestContainer | null = null;
    let admin: RabbitAdmin | undefined;

    return {
        name: 'rabbitmq',
        start: async () => {
            if (external !== null) {
                return null;
            }
            const { GenericContainer, Wait } = await containers();
            container = await new GenericContainer(TEST_IMAGES.rabbitmq)
                .withLabels(labels)
                .withEnvironment({
                    RABBITMQ_DEFAULT_USER: RABBIT_ADMIN,
                    RABBITMQ_DEFAULT_PASS: password,
                })
                .withExposedPorts(5672, 15672)
                .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
                .withStartupTimeout(120_000)
                .start();

            return container;
        },
        provide: async (project) => {
            const url =
                external?.amqpUrl ??
                `amqp://${RABBIT_ADMIN}:${password}@${hostPort(startedOf(container), 5672)}`;
            const managementUrl =
                external?.managementUrl ?? `http://${hostPort(startedOf(container), 15672)}/`;
            admin =
                external === null
                    ? new RabbitAdmin(managementUrl, RABBIT_ADMIN, password)
                    : rabbitAdminFromProvided(managementUrl, url);
            await admin.waitReady();
            const workers = maxWorkersOf([
                project.config,
                ...project.vitest.projects.map((item) => item.config),
            ]);
            const prepared = await prepareWorkerVhosts(admin, {
                service,
                ...(publishes === undefined ? {} : { publishes }),
                workers,
                runId,
                amqpAdminUrl: url,
                removeLeftovers: external === null,
            });
            if (prepared.removed.length > 0) {
                process.stderr.write(
                    `[startTestStack] удалены vhost прошлых прогонов: ${prepared.removed.join(', ')}\n`,
                );
            }
            project.provide('kitRabbitmqUrl', url);
            project.provide('kitRabbitmqManagementUrl', managementUrl);
            project.provide('kitRabbitmqWorkers', prepared.workers);
        },
        teardown: async () => {
            if (admin === undefined) {
                return;
            }
            const { vhosts, users } = await deleteTestVhosts(admin, prefix);
            process.stderr.write(
                `[startTestStack] RabbitMQ: удалено vhost ${vhosts}, пользователей ${users}\n`,
            );
        },
    };
}

/** Команда администратора внешнего Redis (ioredis — лениво, peer /redis). */
async function redisAdminCommand(adminUrl: string, args: readonly string[]): Promise<void> {
    const { Redis } = await loadPeer<typeof IORedis>('ioredis', 'testing');
    const client = new Redis(adminUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    client.on('error', () => undefined);
    try {
        await client.connect();
        await client.call(args[0] ?? '', ...args.slice(1));
    } finally {
        client.disconnect();
    }
}

function redisPart(
    labels: Record<string, string>,
    service: string,
    external: KitExternalRedis | null,
): StackPart {
    const password = randomBytes(16).toString('hex');
    const adminPassword = randomBytes(16).toString('hex');
    let container: StartedTestContainer | null = null;
    let created = false;

    return {
        name: 'redis',
        start: async () => {
            if (external !== null) {
                return null;
            }
            const { GenericContainer, Wait } = await containers();
            const aclfile = buildRedisAclFile({
                users: [{ service, passwordHash: redisPasswordHash(password) }],
                extra: [`user ${REDIS_ADMIN} on #${redisPasswordHash(adminPassword)} ~* &* +@all`],
            });
            container = await new GenericContainer(TEST_IMAGES.redis)
                .withLabels(labels)
                .withCopyContentToContainer([
                    { content: aclfile, target: REDIS_ACL_PATH, mode: 0o644 },
                ])
                .withCommand([
                    'redis-server',
                    '--aclfile',
                    REDIS_ACL_PATH,
                    '--save',
                    '',
                    '--appendonly',
                    'no',
                ])
                .withExposedPorts(6379)
                .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
                .withStartupTimeout(120_000)
                .start();

            return container;
        },
        provide: async (project) => {
            let address: string;
            let adminUrl: string;
            if (external === null) {
                address = hostPort(startedOf(container), 6379);
                adminUrl = `redis://${REDIS_ADMIN}:${adminPassword}@${address}`;
            } else {
                // Внешний Redis: пользователь сервиса — ACL SETUSER (aclfile не перечитывается), user default не трогаем.
                const url = new URL(external.adminUrl);
                address = url.host;
                adminUrl = external.adminUrl;
                await redisAdminCommand(adminUrl, [
                    'ACL',
                    'SETUSER',
                    service,
                    'reset',
                    ...redisUserRules(service, redisPasswordHash(password)),
                ]);
                created = true;
            }
            project.provide('kitRedisUrl', `redis://${service}:${password}@${address}`);
            project.provide('kitRedisAdminUrl', adminUrl);
            project.provide('kitRedisService', service);
        },
        teardown: async () => {
            if (external !== null && created) {
                await redisAdminCommand(external.adminUrl, ['ACL', 'DELUSER', service]);
            }
        },
    };
}

function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

/** globalSetup Vitest: `export default startTestStack({...})`; teardown останавливает контейнеры (§3.8). */
export function startTestStack(
    options: TestStackOptions,
): (project: TestProject) => Promise<() => Promise<void>> {
    assertServiceName(options.service, 'startTestStack');
    if (options.migrations !== undefined && !enabled(options.postgres)) {
        throw new TypeError('startTestStack: migrations требует postgres');
    }
    if (options.publishes !== undefined && !enabled(options.rabbitmq)) {
        throw new TypeError('startTestStack: publishes требует rabbitmq');
    }
    const external = {
        postgres: externalOf<KitExternalPostgres>('postgres', options.postgres, ['adminUrl']),
        mailpit: externalOf<KitExternalMailpit>('mailpit', options.mailpit, ['smtpUrl', 'httpUrl']),
        minio: externalOf<KitExternalMinio>('minio', options.minio, [
            'endpoint',
            'accessKey',
            'secretKey',
        ]),
        rabbitmq: externalOf<KitExternalRabbitmq>('rabbitmq', options.rabbitmq, [
            'amqpUrl',
            'managementUrl',
        ]),
        redis: externalOf<KitExternalRedis>('redis', options.redis, ['adminUrl']),
    };
    const badPrefix = options.publishes?.find((prefix) => !PUBLISH_PREFIX_PATTERN.test(prefix));
    if (badPrefix !== undefined) {
        throw new TypeError(
            `startTestStack: префикс publishes «${badPrefix}» вне формата ${PUBLISH_PREFIX_PATTERN.source}`,
        );
    }
    const labels = { 'verdeect.kit.service': options.service };

    return async (project) => {
        const parts = [
            ...(enabled(options.postgres)
                ? [postgresPart(labels, options.service, options.migrations, external.postgres)]
                : []),
            ...(enabled(options.mailpit) ? [mailpitPart(labels, external.mailpit)] : []),
            ...(enabled(options.minio) ? [minioPart(labels, external.minio)] : []),
            ...(enabled(options.rabbitmq)
                ? [rabbitmqPart(labels, options.service, options.publishes, external.rabbitmq)]
                : []),
            ...(enabled(options.redis) ? [redisPart(labels, options.service, external.redis)] : []),
        ];
        const results = await Promise.allSettled(parts.map((part) => part.start()));
        const started = results.flatMap((result) =>
            result.status === 'fulfilled' && result.value !== null ? [result.value] : [],
        );
        const failed = parts.filter((_, index) => results[index]?.status === 'rejected');
        const firstFailure = results.find((result) => result.status === 'rejected');
        if (firstFailure !== undefined) {
            await Promise.allSettled(started.map((container) => container.stop()));
            const names = failed.map((part) => part.name).join(', ');
            const message = `[startTestStack] не удалось запустить ${names}: ${errorMessage(firstFailure.reason)}`;
            process.stderr.write(`${message}\n`);
            throw new Error(message, { cause: firstFailure.reason });
        }
        let preparing = '';
        try {
            for (const part of parts) {
                preparing = part.name;
                await part.provide(project);
            }
        } catch (error) {
            await stopParts();
            const message = `[startTestStack] не удалось подготовить ${preparing}: ${errorMessage(error)}`;
            process.stderr.write(`${message}\n`);
            throw new Error(message, {
                cause: error,
            });
        }

        const coverage =
            options.outboxEvents === undefined
                ? undefined
                : mkdtempSync(join(tmpdir(), `kit-outbox-${options.service}-`));
        if (coverage !== undefined) {
            setCoverageDir(coverage);
            project.provide('kitOutboxCoverageDir', coverage);
        }

        return async () => {
            try {
                await stopParts();
                // После освобождения ресурсов: ошибка покрытия выходит из teardown.
                if (options.outboxEvents !== undefined && process.env.KIT_OUTBOX_COVERAGE === '1') {
                    assertOutboxCoverage(options.outboxEvents);
                }
            } finally {
                setCoverageDir(undefined);
                if (coverage !== undefined) {
                    rmSync(coverage, { recursive: true, force: true });
                }
            }
        };

        async function stopParts(): Promise<void> {
            for (const part of parts) {
                await part.teardown?.().catch((error: unknown) => {
                    process.stderr.write(
                        `[startTestStack] очистка ${part.name} не удалась: ${errorMessage(error)}\n`,
                    );
                });
            }
            await Promise.all(started.map((container) => container.stop()));
        }
    };
}
