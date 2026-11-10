// startTestStack — globalSetup Vitest: контейнеры TEST_IMAGES раз на прогон, адреса через provide (prd.md §3.8, E1;
// AC-1.12, AC-1.13). Эталоны — O test/support/global-setup.ts (minio, provide, teardown), I global-setup.ts (mailpit),
// O setup-error.ts (текст ошибки в stderr до throw: Vite теряет текст ошибок globalSetup).
// E1: только postgres, mailpit, minio; без подготовки БД и миграций (E4), rabbitmq (E5), redis (E8).
import { randomBytes } from 'node:crypto';
import type * as Testcontainers from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { loadPeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { TEST_IMAGES } from './images.js';

const { GenericContainer, Wait } = await loadPeer<typeof Testcontainers>(
    'testcontainers',
    'testing',
);

const MINIO_USER = 'kit-test';

/** Параметры startTestStack в E1 (§3.8). */
export interface TestStackOptions {
    /** Имя экземпляра сервиса (^[a-z][a-z0-9-]{1,31}$); метка verdeect.kit.service контейнеров. */
    readonly service: string;
    /** PostgreSQL TEST_IMAGES.postgres, суперпользователь — kitPostgresUrl. */
    readonly postgres?: boolean;
    /** mailpit — kitSmtpUrl, kitMailpitUrl. */
    readonly mailpit?: boolean;
    /** MinIO — kitS3Endpoint, kitS3AccessKey, kitS3SecretKey. */
    readonly minio?: boolean;
}

declare module 'vitest' {
    interface ProvidedContext {
        /** postgres://postgres:<пароль>@<host>:<port>/postgres — суперпользователь (флаг postgres). */
        readonly kitPostgresUrl?: string;
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
    }
}

/** Сервис стека: имя для сообщения, запуск контейнера и передача адресов после старта. */
interface StackPart {
    readonly name: string;
    readonly start: () => Promise<StartedTestContainer>;
    readonly provide: (container: StartedTestContainer, project: TestProject) => void;
}

function postgresPart(labels: Record<string, string>): StackPart {
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
        provide: (container, project) => {
            const host = container.getHost();
            const port = container.getMappedPort(5432);
            project.provide(
                'kitPostgresUrl',
                `postgres://postgres:${password}@${host}:${port}/postgres`,
            );
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

function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

/** globalSetup Vitest: `export default startTestStack({...})`; teardown останавливает контейнеры (§3.8). */
export function startTestStack(
    options: TestStackOptions,
): (project: TestProject) => Promise<() => Promise<void>> {
    assertServiceName(options.service, 'startTestStack');
    const labels = { 'verdeect.kit.service': options.service };

    return async (project) => {
        const parts = [
            ...(options.postgres === true ? [postgresPart(labels)] : []),
            ...(options.mailpit === true ? [mailpitPart(labels)] : []),
            ...(options.minio === true ? [minioPart(labels)] : []),
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
        parts.forEach((part, index) => {
            const container = started[index];
            if (container !== undefined) {
                part.provide(container, project);
            }
        });

        return async () => {
            await Promise.all(started.map((container) => container.stop()));
        };
    };
}
