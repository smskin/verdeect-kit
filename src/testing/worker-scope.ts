// workerScope (prd.md §3.8 v1.14, UC-14): E4 — tenant; E5 — rabbitmq (vhost воркера из startTestStack, AC-5.18);
// E8 — redisPrefix <svc>:w<N>: (AC-8.5). Записей в таблицы не создаёт (N2, CE-4).
import { randomBytes } from 'node:crypto';
import { missingPeerMessage } from '../internal/peer.js';
import type { KitRabbitWorker } from './rabbitmq-admin.js';

// Без vitest /testing импортируется; геттер rabbitmq синхронный и не может ждать loadPeer.
const vitest = await import('vitest').catch(() => undefined);

/** Слаг компании: формат claim `tenant` (01 §5.2; TENANT_SLUG O без ведущего `_` служебных компаний). */
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** Область воркера Vitest (§3.8). */
export interface KitWorkerScope {
    /**
     * Слаг компании воркера `w<VITEST_POOL_ID>-<8 hex>` — значение `DbContext.tenant` и claim `tenant` токена. Строку
     * компании, если нужна, создаёт фабрика сервиса; `tenantId` — фабрика сервиса.
     */
    readonly tenant: string;
    /**
     * vhost воркера с пользователем по правам M3 сервиса из `startTestStack({rabbitmq: true})`: `url` — значение
     * `RABBITMQ_URL` тестов. Удаляется в teardown прогона (AC-5.18).
     * @throws {TypeError} стек без `rabbitmq: true` или нет записи для воркера (при обращении).
     */
    readonly rabbitmq: { readonly vhost: string; readonly url: string };
    /**
     * Префикс ключей и каналов Redis воркера `<svc>:w<VITEST_POOL_ID>:` — лежит внутри прав ACL сервиса
     * (`startTestStack({redis: true})`, AC-8.5); подставляется в приложение через `redisWorkerOverride()`.
     * @throws {TypeError} стек без `redis: true` (при обращении).
     */
    readonly redisPrefix: string;
}

let scope: KitWorkerScope | undefined;

type ReadWorkers = () => readonly KitRabbitWorker[] | undefined;
type ReadRedisService = () => string | undefined;

function readProvided(): readonly KitRabbitWorker[] | undefined {
    if (vitest === undefined) {
        throw new Error(missingPeerMessage('vitest', 'testing'));
    }

    return vitest.inject('kitRabbitmqWorkers');
}

function readProvidedRedisService(): string | undefined {
    if (vitest === undefined) {
        throw new Error(missingPeerMessage('vitest', 'testing'));
    }

    return vitest.inject('kitRedisService');
}

/** `workerScope` с источниками vhost и имени сервиса Redis (внутренняя: тесты подменяют `inject`). */
export function workerScopeWith(
    readWorkers: ReadWorkers,
    readRedisService: ReadRedisService = readProvidedRedisService,
): KitWorkerScope {
    const tenant = `w${process.env.VITEST_POOL_ID ?? '0'}-${randomBytes(4).toString('hex')}`;
    if (!TENANT_SLUG.test(tenant)) {
        throw new Error(`workerScope: tenant «${tenant}» вне формата ${TENANT_SLUG.source}`);
    }
    let rabbitmq: KitWorkerScope['rabbitmq'] | undefined;
    const result = { tenant } as KitWorkerScope;
    Object.defineProperty(result, 'rabbitmq', {
        enumerable: true,
        get: (): KitWorkerScope['rabbitmq'] => {
            rabbitmq ??= rabbitmqOf(readWorkers());

            return rabbitmq;
        },
    });
    let redisPrefix: string | undefined;
    Object.defineProperty(result, 'redisPrefix', {
        enumerable: true,
        get: (): string => {
            redisPrefix ??= redisPrefixOf(readRedisService());

            return redisPrefix;
        },
    });

    return result;
}

function rabbitmqOf(workers: readonly KitRabbitWorker[] | undefined): KitWorkerScope['rabbitmq'] {
    if (workers === undefined) {
        throw new TypeError('workerScope().rabbitmq: startTestStack запущен без rabbitmq: true');
    }
    const pool = Number(process.env.VITEST_POOL_ID ?? '1');
    const worker = workers[pool - 1];
    if (worker === undefined) {
        throw new TypeError(
            `workerScope().rabbitmq: нет vhost для воркера ${pool} (vhost в стеке: ${workers.length})`,
        );
    }

    return { vhost: worker.vhost, url: worker.url };
}

function redisPrefixOf(service: string | undefined): string {
    if (service === undefined) {
        throw new TypeError('workerScope().redisPrefix: startTestStack запущен без redis: true');
    }

    return `${service}:w${process.env.VITEST_POOL_ID ?? '1'}:`;
}

/** Область текущего воркера: одно значение на воркер, разные воркеры — разные. */
export function workerScope(): KitWorkerScope {
    scope ??= workerScopeWith(readProvided);

    return scope;
}
