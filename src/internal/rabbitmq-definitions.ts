// definitions.json RabbitMQ (prd.md §3.4 M3, UC-12, AC-5.10): одна функция для CLI `rabbitmq definitions` и тестового
// стека. Эталон прав — O docs/messaging.md (or-119), P docs/deployment.md (реплика); обобщение: configure
// ^<svc>(\..*)?$, read — и своя DLQ (П13). Без внешних пакетов: только node:crypto.
import { createHash, randomBytes } from 'node:crypto';
import { assertServiceName } from './service-name.js';

/** Exchange событий; объявляет его только definitions.json, сервис проверяет пассивно. */
export const EVENTS_EXCHANGE = 'verdeect.events';

/** Алгоритм хеша пароля пользователя в definitions. */
const HASHING = 'rabbit_password_hashing_sha256';

/** Права пользователя сервиса на vhost (регулярки RabbitMQ). */
export interface RabbitPermissions {
    /** Регулярка configure. */
    readonly configure: string;
    /** Регулярка write. */
    readonly write: string;
    /** Регулярка read. */
    readonly read: string;
}

/** Префикс ключей публикации сервиса: оканчивается точкой (`identity.`, `audit.agent.`). */
export const PUBLISH_PREFIX_PATTERN = /^[a-z][a-z0-9.]*\.$/;

/**
 * Права M3: свои очереди `<svc>`, `<svc>.retry`, `<svc>.dlq`, `<svc>.replica.<id>`; `write` на `verdeect.events` —
 * только при непустом `publishes` (ключи ограничивает {@link topicPermissionsOf}).
 */
export function permissionsOf(
    service: string,
    publishes: readonly string[] = [],
): RabbitPermissions {
    const own = `${service.replaceAll('-', '\\-')}(\\..*)?`;
    const events = publishes.length > 0 ? 'verdeect\\.events|' : '';

    return {
        configure: `^${own}$`,
        write: `^(${events}amq\\.default|${own})$`,
        read: `^(verdeect\\.events|${own})$`,
    };
}

/** Topic-права на `verdeect.events`: `write` — ключи своих префиксов (без них — `^$`), `read` — `.*`. */
export function topicPermissionsOf(publishes: readonly string[] = []): {
    readonly write: string;
    readonly read: string;
} {
    return {
        write:
            publishes.length === 0
                ? '^$'
                : `^(${publishes.map((prefix) => prefix.replaceAll('.', '\\.')).join('|')})`,
        read: '.*',
    };
}

/** Хеш пароля `rabbit_password_hashing_sha256`: `base64(salt ‖ sha256(salt ‖ utf8(password)))`, соль 4 байта. */
export function hashRabbitPassword(password: string, salt: Buffer = randomBytes(4)): string {
    const digest = createHash('sha256')
        .update(Buffer.concat([salt, Buffer.from(password, 'utf8')]))
        .digest();

    return Buffer.concat([salt, digest]).toString('base64');
}

/** Ключ окружения CLI с хешем пароля сервиса: `bff-app` → `RABBITMQ_PASSWORD_HASH_BFF_APP` (П3). */
export function passwordHashKey(service: string): string {
    return `RABBITMQ_PASSWORD_HASH_${service.toUpperCase().replaceAll('-', '_')}`;
}

/** Пользователь брокера сервиса: имя по умолчанию — имя сервиса; права — на очереди `service`. */
export interface KitBrokerUser {
    /** Имя сервиса — права на его очереди. */
    readonly service: string;
    /** Имя пользователя; по умолчанию — имя сервиса. */
    readonly user?: string;
    /** Хеш `rabbit_password_hashing_sha256`. */
    readonly passwordHash: string;
    /** Префиксы ключей публикации в `verdeect.events`; нет — сервис не публикует. */
    readonly publishes?: readonly string[];
}

/** definitions.json формата импорта management plugin RabbitMQ 4.x. */
export interface RabbitDefinitions {
    /** Версия брокера формата. */
    readonly rabbit_version: string;
    /** vhost. */
    readonly vhosts: readonly { readonly name: string }[];
    /** Пользователи. */
    readonly users: readonly {
        /** Имя. */
        readonly name: string;
        /** Хеш пароля. */
        readonly password_hash: string;
        /** Алгоритм хеша. */
        readonly hashing_algorithm: string;
        /** Теги. */
        readonly tags: readonly string[];
    }[];
    /** Права. */
    readonly permissions: readonly ({
        /** Имя пользователя; по умолчанию — имя сервиса. */
        readonly user: string;
        /** vhost. */
        readonly vhost: string;
    } & RabbitPermissions)[];
    /** Topic-права на `verdeect.events`. */
    readonly topic_permissions: readonly {
        /** Имя пользователя. */
        readonly user: string;
        /** vhost. */
        readonly vhost: string;
        /** Exchange. */
        readonly exchange: string;
        /** Регулярка ключей публикации. */
        readonly write: string;
        /** Регулярка ключей чтения. */
        readonly read: string;
    }[];
    /** Exchange. */
    readonly exchanges: readonly {
        /** Имя. */
        readonly name: string;
        /** vhost. */
        readonly vhost: string;
        /** Тип. */
        readonly type: 'topic';
        /** Переживает перезапуск. */
        readonly durable: true;
        /** Без автоудаления. */
        readonly auto_delete: false;
        /** Не внутренний. */
        readonly internal: false;
        /** Аргументы. */
        readonly arguments: Readonly<Record<string, never>>;
    }[];
    /** Очередей нет — их объявляет подписчик. */
    readonly queues: readonly never[];
    /** Привязок нет. */
    readonly bindings: readonly never[];
}

/**
 * definitions.json: vhost, пользователи с хешами, права M3, topic-права на `verdeect.events`, exchange `verdeect.events` (topic, durable). Очередей нет:
 * топологию объявляет подписчик (TTL `.retry` не фиксируется в файле развёртывания).
 * @throws {TypeError} имя сервиса вне формата, дубликат или префикс публикации вне формата.
 */
export function buildDefinitions(input: {
    /** vhost. */
    readonly vhost?: string;
    /** Пользователи. */
    readonly users: readonly KitBrokerUser[];
}): RabbitDefinitions {
    const vhost = input.vhost ?? '/';
    const seen = new Set<string>();
    for (const { service } of input.users) {
        assertServiceName(service, 'rabbitmq definitions');
        if (seen.has(service)) {
            throw new TypeError(`rabbitmq definitions: сервис ${service} указан дважды`);
        }
        seen.add(service);
    }
    for (const { service, publishes = [] } of input.users) {
        const bad = publishes.find((prefix) => !PUBLISH_PREFIX_PATTERN.test(prefix));
        if (bad !== undefined) {
            throw new TypeError(
                `rabbitmq definitions: префикс «${bad}» сервиса ${service} вне формата ${PUBLISH_PREFIX_PATTERN.source}`,
            );
        }
    }

    return {
        rabbit_version: '4.3.6',
        vhosts: [{ name: vhost }],
        users: input.users.map(({ service, user, passwordHash }) => ({
            name: user ?? service,
            password_hash: passwordHash,
            hashing_algorithm: HASHING,
            tags: [],
        })),
        permissions: input.users.map(({ service, user, publishes }) => ({
            user: user ?? service,
            vhost,
            ...permissionsOf(service, publishes),
        })),
        topic_permissions: input.users.map(({ service, user, publishes }) => ({
            user: user ?? service,
            vhost,
            exchange: EVENTS_EXCHANGE,
            ...topicPermissionsOf(publishes),
        })),
        exchanges: [
            {
                name: EVENTS_EXCHANGE,
                vhost,
                type: 'topic',
                durable: true,
                auto_delete: false,
                internal: false,
                arguments: {},
            },
        ],
        queues: [],
        bindings: [],
    };
}
