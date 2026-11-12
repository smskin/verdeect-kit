// Помощник RabbitMQ уровня I/T (prd.md §3.4, §3.8 E5): временная очередь на verdeect.events, публикация, чтение и
// очистка очередей, пассивная проверка exchange — на vhost воркера из startTestStack (AC-5.18). Эталон — O
// test/support/broker.ts (копия BrokerClient Identity); vhost воркера — B test/support/broker.ts.
import amqp, {
    type Channel,
    type ChannelModel,
    type ConsumeMessage,
    type GetMessage,
    type Options,
} from 'amqplib';
import { inject } from 'vitest';
import { EVENTS_EXCHANGE, topicPermissionsOf } from '../../src/internal/rabbitmq-definitions.js';
import type { KitRabbitWorker } from '../../src/testing/rabbitmq-admin.js';
import { rabbitAdminFromProvided, type RabbitAdmin } from '../../src/testing/rabbitmq-admin.js';

/** vhost воркера: `url` — пользователь с правами M3 сервиса kit, `adminUrl` — администратор. */
export function workerBroker(): KitRabbitWorker {
    const workers = inject('kitRabbitmqWorkers');
    const pool = Number(process.env.VITEST_POOL_ID ?? '1');
    const worker = workers?.[pool - 1];
    if (worker === undefined) {
        throw new Error(
            `kitRabbitmqWorkers: нет vhost для воркера ${pool} (globalSetup без rabbitmq)`,
        );
    }

    return worker;
}

/** Префиксы публикации пользователя воркера — `publishes` globalSetup уровней I и T. */
const KIT_PUBLISHES = ['kit.'];

/** Management API основного стека (администратор). */
export function brokerAdmin(): RabbitAdmin {
    const managementUrl = inject('kitRabbitmqManagementUrl');
    const url = inject('kitRabbitmqUrl');
    if (managementUrl === undefined || url === undefined) {
        throw new Error('kitRabbitmqUrl не передан: globalSetup без rabbitmq');
    }

    return rabbitAdminFromProvided(managementUrl, url);
}

/** Сообщение, пойманное `capture`. */
export interface CapturedMessage {
    readonly routingKey: string;
    readonly properties: ConsumeMessage['properties'];
    readonly body: Record<string, unknown>;
}

/** Прямое соединение помощника с брокером (мимо прокси). */
export class BrokerClient {
    private constructor(
        private readonly model: ChannelModel,
        readonly channel: Channel,
    ) {}

    /** Соединение администратором vhost воркера (по умолчанию). */
    static async connect(url: string = workerBroker().adminUrl): Promise<BrokerClient> {
        const model = await amqp.connect(url);
        model.on('error', () => undefined);
        const channel = await model.createChannel();
        channel.on('error', () => undefined);

        return new BrokerClient(model, channel);
    }

    /** Временная эксклюзивная очередь на verdeect.events по шаблону; сообщения копятся в массиве. */
    async capture(pattern = '#'): Promise<CapturedMessage[]> {
        const messages: CapturedMessage[] = [];
        const { queue } = await this.channel.assertQueue('', { exclusive: true, autoDelete: true });
        await this.channel.bindQueue(queue, EVENTS_EXCHANGE, pattern);
        await this.channel.consume(
            queue,
            (msg) => {
                if (msg === null) {
                    return;
                }
                messages.push({
                    routingKey: msg.fields.routingKey,
                    properties: msg.properties,
                    body: JSON.parse(msg.content.toString('utf8')) as Record<string, unknown>,
                });
            },
            { noAck: true },
        );

        return messages;
    }

    /** Публикация в verdeect.events. */
    publishRaw(routingKey: string, content: Buffer, options: Options.Publish = {}): void {
        this.channel.publish(EVENTS_EXCHANGE, routingKey, content, {
            persistent: true,
            contentType: 'application/json',
            ...options,
        });
    }

    /** Публикация прямо в очередь. */
    sendToQueue(queue: string, content: Buffer, options: Options.Publish = {}): void {
        this.channel.sendToQueue(queue, content, { persistent: true, ...options });
    }

    /** Состояние очереди; null — очереди нет. */
    async queueInfo(
        queue: string,
    ): Promise<{ messageCount: number; consumerCount: number } | null> {
        try {
            return await this.withProbe(async (probe) => {
                const { messageCount, consumerCount } = await probe.checkQueue(queue);

                return { messageCount, consumerCount };
            });
        } catch {
            return null;
        }
    }

    /** Забирает одно сообщение очереди (без подтверждения брокеру) или null. */
    async take(queue: string): Promise<GetMessage | null> {
        const msg = await this.channel.get(queue, { noAck: true });

        return msg === false ? null : msg;
    }

    /** Очистка существующих очередей. */
    async purge(...queues: readonly string[]): Promise<void> {
        for (const queue of queues) {
            if ((await this.queueInfo(queue)) !== null) {
                await this.withProbe((probe) => probe.purgeQueue(queue));
            }
        }
    }

    /** Удаление очереди. */
    async deleteQueue(queue: string): Promise<void> {
        await this.withProbe((probe) => probe.deleteQueue(queue));
    }

    /** checkExchange: 404 → false. */
    async exchangeExists(name: string): Promise<boolean> {
        try {
            await this.withProbe((probe) => probe.checkExchange(name));

            return true;
        } catch {
            return false;
        }
    }

    /** Удаление exchange. */
    async deleteExchange(name: string): Promise<void> {
        await this.withProbe((probe) => probe.deleteExchange(name));
    }

    /**
     * Объявление verdeect.events (как definitions.json) и topic-права пользователя воркера на него: брокер удаляет их
     * вместе с exchange, без восстановления следующие файлы воркера публиковали бы с любым ключом.
     */
    async declareEventsExchange(): Promise<void> {
        await this.withProbe((probe) =>
            probe.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true }),
        );
        // Пользователь воркера назван как его vhost (prepareWorkerVhosts).
        const { vhost } = workerBroker();
        await brokerAdmin().setTopicPermissions(vhost, vhost, {
            exchange: EVENTS_EXCHANGE,
            ...topicPermissionsOf(KIT_PUBLISHES),
        });
    }

    /** Закрытие соединения. */
    async close(): Promise<void> {
        await this.model.close().catch(() => undefined);
    }

    /** Одноразовый канал: ошибка сервера (404) закрывает его, основной канал остаётся открытым. */
    private async withProbe<T>(work: (probe: Channel) => Promise<T>): Promise<T> {
        const probe = await this.model.createChannel();
        probe.on('error', () => undefined);
        try {
            return await work(probe);
        } finally {
            await probe.close().catch(() => undefined);
        }
    }
}
