// Клиент management API RabbitMQ тестового стека (prd.md §3.8 E5, AC-5.18, UC-14; П2): definitions.json, vhost и
// пользователь на воркер, удаление по префиксу <svc>-test-. Эталон — B test/support/broker.ts (BrokerAdmin). Внутренний
// модуль /testing: глобальный fetch, без amqplib.
import { randomBytes } from 'node:crypto';
import {
    buildDefinitions,
    hashRabbitPassword,
    type RabbitDefinitions,
} from '../internal/rabbitmq-definitions.js';

/** vhost воркера: пользователь воркера (`url`) и администратор (`adminUrl`) на том же vhost. */
export interface KitRabbitWorker {
    /** Имя vhost. */
    readonly vhost: string;
    /** amqp://<пользователь воркера>@host:port/<vhost> — права M3 сервиса. */
    readonly url: string;
    /** amqp://<администратор>@host:port/<vhost> — полные права (тесты, publishTestEvent). */
    readonly adminUrl: string;
    /** Префиксы публикации пользователя воркера (`startTestStack({publishes})`); пусто — не публикует. */
    readonly publishes: readonly string[];
}

/** Состояние очереди по management API. */
export interface RabbitQueueInfo {
    /** Переживает перезапуск. */
    readonly durable: boolean;
    /** Удаляется без потребителей. */
    readonly autoDelete: boolean;
    /** Эксклюзивная. */
    readonly exclusive: boolean;
    /** Аргументы. */
    readonly arguments: Readonly<Record<string, unknown>>;
    /** Сообщений всего. */
    readonly messages: number;
    /** Готовых к выдаче. */
    readonly messagesReady: number;
    /** Без подтверждения. */
    readonly messagesUnacknowledged: number;
    /** Потребителей. */
    readonly consumers: number;
}

const ALL = { configure: '.*', write: '.*', read: '.*' };

/** Запросы к management API с Basic auth администратора. */
export class RabbitAdmin {
    private readonly auth: string;

    constructor(
        private readonly managementUrl: string,
        /** Имя пользователя; по умолчанию — имя сервиса. */
        readonly user: string,
        password: string,
    ) {
        this.auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    }

    private async request(
        method: string,
        path: string,
        body?: unknown,
        ok: readonly number[] = [200, 201, 204],
    ): Promise<Response> {
        const response = await fetch(new URL(path, this.managementUrl), {
            method,
            headers: { authorization: this.auth, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!ok.includes(response.status)) {
            // Без тела и пароля: только метод, путь и статус.
            throw new Error(`RabbitMQ management ${method} ${path}: статус ${response.status}`);
        }

        return response;
    }

    /** Ожидание готовности management API (15672 поднимается позже 5672). */
    async waitReady(timeoutMs = 60_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            try {
                await this.request('GET', 'api/overview');

                return;
            } catch (error) {
                if (Date.now() > deadline) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
    }

    /** Импорт definitions.json (vhosts, users, permissions, exchanges). */
    async loadDefinitions(definitions: RabbitDefinitions): Promise<void> {
        await this.request('POST', 'api/definitions', definitions);
    }

    /** Права пользователя на vhost. */
    async setPermissions(
        vhost: string,
        user: string,
        permissions: { readonly configure: string; readonly write: string; readonly read: string },
    ): Promise<void> {
        await this.request(
            'PUT',
            `api/permissions/${encodeURIComponent(vhost)}/${encodeURIComponent(user)}`,
            permissions,
        );
    }

    /** Topic-права пользователя на exchange vhost (удаляются брокером вместе с exchange). */
    async setTopicPermissions(
        vhost: string,
        user: string,
        permissions: { readonly exchange: string; readonly write: string; readonly read: string },
    ): Promise<void> {
        await this.request(
            'PUT',
            `api/topic-permissions/${encodeURIComponent(vhost)}/${encodeURIComponent(user)}`,
            permissions,
        );
    }

    /** Имена vhost. */
    async listVhosts(): Promise<string[]> {
        const response = await this.request('GET', 'api/vhosts');

        return ((await response.json()) as { name: string }[]).map(({ name }) => name);
    }

    /** Имена пользователей. */
    async listUsers(): Promise<string[]> {
        const response = await this.request('GET', 'api/users');

        return ((await response.json()) as { name: string }[]).map(({ name }) => name);
    }

    /** Удаление vhost; нет — успех. */
    async deleteVhost(name: string): Promise<void> {
        await this.request(
            'DELETE',
            `api/vhosts/${encodeURIComponent(name)}`,
            undefined,
            [204, 404],
        );
    }

    /** Удаление пользователя; нет — успех. */
    async deleteUser(name: string): Promise<void> {
        await this.request(
            'DELETE',
            `api/users/${encodeURIComponent(name)}`,
            undefined,
            [204, 404],
        );
    }

    /** Очередь vhost или `null`. */
    async queue(vhost: string, name: string): Promise<RabbitQueueInfo | null> {
        const response = await this.request(
            'GET',
            `api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(name)}`,
            undefined,
            [200, 404],
        );
        if (response.status === 404) {
            return null;
        }
        const raw = (await response.json()) as Record<string, unknown>;
        const count = (key: string): number => (typeof raw[key] === 'number' ? raw[key] : 0);

        return {
            durable: raw['durable'] === true,
            autoDelete: raw['auto_delete'] === true,
            exclusive: raw['exclusive'] === true,
            arguments: (raw['arguments'] as Record<string, unknown> | undefined) ?? {},
            messages: count('messages'),
            messagesReady: count('messages_ready'),
            messagesUnacknowledged: count('messages_unacknowledged'),
            consumers: count('consumers'),
        };
    }
}

/** Администратор из `kitRabbitmqUrl` (учётные данные в URL amqp) и `kitRabbitmqManagementUrl` (без них). */
export function rabbitAdminFromProvided(managementUrl: string, amqpAdminUrl: string): RabbitAdmin {
    const url = new URL(amqpAdminUrl);

    return new RabbitAdmin(
        managementUrl,
        decodeURIComponent(url.username),
        decodeURIComponent(url.password),
    );
}

function amqpUrl(base: string, user: string, password: string, vhost: string): string {
    const url = new URL(base);
    url.username = encodeURIComponent(user);
    url.password = encodeURIComponent(password);
    url.pathname = `/${encodeURIComponent(vhost)}`;

    return url.toString();
}

/** Удаление vhost и пользователей с префиксом. */
export async function deleteTestVhosts(
    admin: RabbitAdmin,
    prefix: string,
): Promise<{ readonly vhosts: number; readonly users: number }> {
    const [vhosts, users] = await Promise.all([admin.listVhosts(), admin.listUsers()]);
    const ownVhosts = vhosts.filter((name) => name.startsWith(prefix));
    const ownUsers = users.filter((name) => name.startsWith(prefix));
    await Promise.all(ownVhosts.map((name) => admin.deleteVhost(name)));
    await Promise.all(ownUsers.map((name) => admin.deleteUser(name)));

    return { vhosts: ownVhosts.length, users: ownUsers.length };
}

/**
 * vhost и пользователь на каждый воркер `1..workers` (`<service>-test-<runId>-w<n>`) из `buildDefinitions` — те же
 * права, что CLI; администратору — полные права на vhost. До создания удаляются остатки прошлых прогонов с префиксом.
 */
export async function prepareWorkerVhosts(
    admin: RabbitAdmin,
    options: {
        /** Имя сервиса — права на его очереди. */
        readonly service: string;
        /** Префиксы ключей публикации в `verdeect.events`; нет — воркер не публикует. */
        readonly publishes?: readonly string[];
        readonly workers: number;
        readonly runId: string;
        readonly amqpAdminUrl: string;
        /** Удалить остатки прошлых прогонов `<svc>-test-` (контейнер); внешний брокер — `false`: только свой прогон. */
        readonly removeLeftovers?: boolean;
    },
): Promise<{ readonly removed: readonly string[]; readonly workers: readonly KitRabbitWorker[] }> {
    const prefix = `${options.service}-test-`;
    const leftovers =
        options.removeLeftovers === false
            ? []
            : (await admin.listVhosts()).filter((name) => name.startsWith(prefix));
    if (leftovers.length > 0) {
        await deleteTestVhosts(admin, prefix);
    }
    const admins = new URL(options.amqpAdminUrl);
    const adminPassword = decodeURIComponent(admins.password);
    const workers: KitRabbitWorker[] = [];
    for (let n = 1; n <= options.workers; n += 1) {
        const vhost = `${prefix}${options.runId}-w${n}`;
        const password = randomBytes(16).toString('hex');
        await admin.loadDefinitions(
            buildDefinitions({
                vhost,
                users: [
                    {
                        service: options.service,
                        user: vhost,
                        passwordHash: hashRabbitPassword(password),
                        ...(options.publishes === undefined
                            ? {}
                            : { publishes: options.publishes }),
                    },
                ],
            }),
        );
        await admin.setPermissions(vhost, admin.user, ALL);
        workers.push({
            vhost,
            url: amqpUrl(options.amqpAdminUrl, vhost, password, vhost),
            adminUrl: amqpUrl(options.amqpAdminUrl, admin.user, adminPassword, vhost),
            publishes: options.publishes ?? [],
        });
    }

    return { removed: leftovers, workers };
}
