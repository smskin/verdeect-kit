// startTestStack — globalSetup Vitest: контейнеры TEST_IMAGES раз на прогон, адреса через provide (prd.md §3.8, E1;
// AC-1.12, AC-1.13). Эталоны — O test/support/global-setup.ts (minio, provide, teardown), I global-setup.ts (mailpit),
// O setup-error.ts (текст ошибки в stderr до throw: Vite теряет текст ошибок globalSetup).
// E4: при postgres — prepareDatabase и шаблон <svc>_template; migrations — runMigrations до копии; redis (E8) — позже.
// Код БД — динамический import() (без pg /testing импортируется).
// E5: rabbitmq — definitions.json (internal/rabbitmq-definitions, как CLI), vhost и пользователь на воркер (эталон B
// test/support/broker.ts), удаление по префиксу <svc>-test-.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type Pg from 'pg';
import type * as Testcontainers from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { loadPeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import type { KitEvent } from '../messaging/define-event.js';
import { TEST_IMAGES } from './images.js';
import { assertOutboxCoverage, setCoverageDir } from './outbox-coverage.js';
import {
    deleteTestVhosts,
    prepareWorkerVhosts,
    RabbitAdmin,
    type KitRabbitWorker,
} from './rabbitmq-admin.js';

const { GenericContainer, Wait } = await loadPeer<typeof Testcontainers>(
    'testcontainers',
    'testing',
);

const MINIO_USER = 'kit-test';
const RABBIT_ADMIN = 'kit-admin';

/** Параметры startTestStack в E1 (§3.8). */
export interface TestStackOptions {
    /** Имя экземпляра сервиса (^[a-z][a-z0-9-]{1,31}$); метка verdeect.kit.service контейнеров. */
    readonly service: string;
    /** PostgreSQL TEST_IMAGES.postgres, суперпользователь — kitPostgresUrl; с E4 — prepareDatabase и шаблон БД. */
    readonly postgres?: boolean;
    /**
     * Папка миграций drizzle-kit относительно `process.cwd()`: применяется к шаблону под ролью `<svc>_owner`, журнал —
     * `<svc>.__migrations`; без `postgres: true` — `TypeError` при вызове `startTestStack`.
     */
    readonly migrations?: string;
    /** mailpit — kitSmtpUrl, kitMailpitUrl. */
    readonly mailpit?: boolean;
    /** MinIO — kitS3Endpoint, kitS3AccessKey, kitS3SecretKey. */
    readonly minio?: boolean;
    /**
     * RabbitMQ TEST_IMAGES.rabbitmq: definitions.json сервиса (как `verdeect-kit rabbitmq definitions`), vhost и
     * пользователь на воркер; адреса — kitRabbitmqUrl, kitRabbitmqManagementUrl, kitRabbitmqWorkers. Teardown удаляет
     * vhost и пользователей с префиксом `<svc>-test-` (AC-5.18).
     */
    readonly rabbitmq?: boolean;
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
        /** Каталог покрытия outbox прогона: файлы воркеров `w<N>.txt` (флаг outboxEvents). */
        readonly kitOutboxCoverageDir?: string;
    }
}

/** Сервис стека: имя для сообщения, запуск контейнера и передача адресов после старта. */
interface StackPart {
    readonly name: string;
    readonly start: () => Promise<StartedTestContainer>;
    readonly provide: (
        container: StartedTestContainer,
        project: TestProject,
    ) => Promise<void> | void;
    /** Очистка до остановки контейнера; ошибки — в stderr, teardown не падает. */
    readonly teardown?: () => Promise<void>;
}

/** Ошибка шага подготовки БД: в stderr — имя шага и код, без текста pg (адрес, имя роли); у migrate — и текст SQL. */
class PrepareStepError extends Error {
    constructor(step: string, cause: unknown) {
        const code = (cause as { code?: unknown } | null)?.code;
        const detail = step === 'migrate' ? `: ${errorMessage(cause)}` : '';
        super(`шаг ${step}, код ${typeof code === 'string' ? code : 'нет'}${detail}`, { cause });
    }
}

async function step<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        throw new PrepareStepError(name, error);
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

async function adminExec(pg: typeof Pg, url: string, sql: string): Promise<void> {
    const client = new pg.Client({ connectionString: url });
    client.on('error', () => undefined);
    await client.connect();
    try {
        await client.query(sql);
    } finally {
        await client.end();
    }
}

/**
 * Подготовка БД стека (§3.8, AC-4.18): шаблон `<svc>_template` — prepareDatabase, миграции; копия `<svc>` — права
 * уровня БД заново (при копировании не переносятся).
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
    await step('create-template', () =>
        adminExec(pg, adminUrl, `CREATE DATABASE ${quoteIdentifier(template)}`),
    );
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
        await adminExec(
            pg,
            adminUrl,
            `CREATE DATABASE ${quoteIdentifier(service)} TEMPLATE ${quoteIdentifier(template)}`,
        );
        const client = new pg.Client({ connectionString: adminUrl });
        client.on('error', () => undefined);
        await client.connect();
        try {
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
): StackPart {
    const password = randomBytes(16).toString('hex');

    return {
        name: 'postgres',
        start: () =>
            new GenericContainer(TEST_IMAGES.postgres)
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
                .start(),
        provide: async (container, project) => {
            const host = container.getHost();
            const port = container.getMappedPort(5432);
            const url = `postgres://postgres:${password}@${host}:${port}/postgres`;
            project.provide('kitPostgresUrl', url);
            await prepareStackDatabase(url, service, migrations, project);
        },
    };
}

function mailpitPart(labels: Record<string, string>): StackPart {
    return {
        name: 'mailpit',
        start: () =>
            new GenericContainer(TEST_IMAGES.mailpit)
                .withLabels(labels)
                .withExposedPorts(1025, 8025)
                .withWaitStrategy(Wait.forHttp('/livez', 8025).forStatusCode(200))
                .withStartupTimeout(120_000)
                .start(),
        provide: (container, project) => {
            const host = container.getHost();
            project.provide('kitSmtpUrl', `smtp://${host}:${container.getMappedPort(1025)}`);
            project.provide('kitMailpitUrl', `http://${host}:${container.getMappedPort(8025)}`);
        },
    };
}

function minioPart(labels: Record<string, string>): StackPart {
    const password = randomBytes(16).toString('hex');

    return {
        name: 'minio',
        start: () =>
            new GenericContainer(TEST_IMAGES.minio)
                .withLabels(labels)
                .withEnvironment({ MINIO_ROOT_USER: MINIO_USER, MINIO_ROOT_PASSWORD: password })
                .withExposedPorts(9000)
                .withCommand(['server', '/data'])
                .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
                .withStartupTimeout(120_000)
                .start(),
        provide: (container, project) => {
            project.provide(
                'kitS3Endpoint',
                `http://${container.getHost()}:${container.getMappedPort(9000)}`,
            );
            project.provide('kitS3AccessKey', MINIO_USER);
            project.provide('kitS3SecretKey', password);
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

function rabbitmqPart(labels: Record<string, string>, service: string): StackPart {
    const password = randomBytes(16).toString('hex');
    const prefix = `${service}-test-`;
    let admin: RabbitAdmin | undefined;

    return {
        name: 'rabbitmq',
        start: () =>
            new GenericContainer(TEST_IMAGES.rabbitmq)
                .withLabels(labels)
                .withEnvironment({
                    RABBITMQ_DEFAULT_USER: RABBIT_ADMIN,
                    RABBITMQ_DEFAULT_PASS: password,
                })
                .withExposedPorts(5672, 15672)
                .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
                .withStartupTimeout(120_000)
                .start(),
        provide: async (container, project) => {
            const host = container.getHost();
            const url = `amqp://${RABBIT_ADMIN}:${password}@${host}:${container.getMappedPort(5672)}`;
            const managementUrl = `http://${host}:${container.getMappedPort(15672)}/`;
            admin = new RabbitAdmin(managementUrl, RABBIT_ADMIN, password);
            await admin.waitReady();
            const workers = maxWorkersOf([
                project.config,
                ...project.vitest.projects.map((item) => item.config),
            ]);
            const prepared = await prepareWorkerVhosts(admin, {
                service,
                workers,
                runId: randomBytes(4).toString('hex'),
                amqpAdminUrl: url,
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

function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

/** globalSetup Vitest: `export default startTestStack({...})`; teardown останавливает контейнеры (§3.8). */
export function startTestStack(
    options: TestStackOptions,
): (project: TestProject) => Promise<() => Promise<void>> {
    assertServiceName(options.service, 'startTestStack');
    if (options.migrations !== undefined && options.postgres !== true) {
        throw new TypeError('startTestStack: migrations требует postgres: true');
    }
    const labels = { 'verdeect.kit.service': options.service };

    return async (project) => {
        const parts = [
            ...(options.postgres === true
                ? [postgresPart(labels, options.service, options.migrations)]
                : []),
            ...(options.mailpit === true ? [mailpitPart(labels)] : []),
            ...(options.minio === true ? [minioPart(labels)] : []),
            ...(options.rabbitmq === true ? [rabbitmqPart(labels, options.service)] : []),
        ];
        const results = await Promise.allSettled(parts.map((part) => part.start()));
        const started = results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
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
            for (const [index, part] of parts.entries()) {
                const container = started[index];
                if (container !== undefined) {
                    preparing = part.name;
                    await part.provide(container, project);
                }
            }
        } catch (error) {
            await Promise.allSettled(started.map((container) => container.stop()));
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
