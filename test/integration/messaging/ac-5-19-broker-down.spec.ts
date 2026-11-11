// AC-5.19 (UC-6): брокер недоступен при старте → сервис запущен, /health rabbitmq: down; TTL .retry расходится при
// подключении после старта → error + GlitchTip, канал подписчика закрыт, новых попыток объявить топологию нет, relay
// продолжает работу (prd.md §3.4 v1.15; П8). Брокер «недоступен» — tcpProxy. Проект isolated: initFakeSentry и шпион
// на прототипе Channel amqplib (объявления очередей подписчика).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { HealthRegistry } from '../../../src/observability/health-registry.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { BrokerClient } from '../../support/broker.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import {
    TestConsumer,
    TestNoteCreated,
    createOutboxApp,
    memoryLogger,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';

const FATAL = 'rabbitmq: фатальная ошибка настройки канала, повторов не будет';

describe('UC-6: брокер при старте и TTL после старта', () => {
    const sentry = initFakeSentry();
    const { logger, lines } = memoryLogger();
    let proxy: TcpProxy;
    let broker: BrokerClient;
    let app: NestFastifyApplication;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        await proxy.break();
        app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
            env: { RABBITMQ_URL: proxy.url },
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
    });

    afterAll(async () => {
        await app.close();
        await proxy.close();
        await broker.deleteQueue('kit.retry').catch(() => undefined);
        await broker.close();
        await truncateFixtures();
    });

    it('AC-5.19: брокер недоступен при старте → сервис запущен, /health rabbitmq: down', async () => {
        const report = await app.get(HealthRegistry).evaluate();

        expect(report.checks['rabbitmq']).toBe('down');
        expect(report.checks['database']).toBe('up');
    });

    it('AC-5.19: TTL .retry расходится при подключении после старта → error + GlitchTip, канал подписчика закрыт, новых попыток объявить топологию нет', async () => {
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await broker.channel.assertQueue('kit.retry', {
            durable: true,
            messageTtl: 99_000,
            deadLetterExchange: '',
            deadLetterRoutingKey: 'kit',
        });
        sentry.delivered.length = 0;
        // Шпион на прототипе Channel (его наследует ConfirmChannel подписчика): считаются объявления kit.retry.
        const channelProto = Object.getPrototypeOf(broker.channel) as {
            assertQueue: (queue: string, ...rest: unknown[]) => Promise<unknown>;
        };
        const assertQueue = vi.spyOn(channelProto, 'assertQueue');
        const retryDeclarations = (): number =>
            assertQueue.mock.calls.filter(([queue]) => queue === 'kit.retry').length;

        await proxy.restore();
        await waitUntil(
            () => lines.some((line) => line['msg'] === FATAL),
            'фатальная ошибка настройки',
            15_000,
        );
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');

        expect(lines.filter((line) => line['msg'] === FATAL && line['level'] === 50)).toHaveLength(
            1,
        );
        expect(connection.isChannelReady('subscriber')).toBe(false);
        expect(retryDeclarations()).toBe(1);

        // relay продолжает работу: событие публикуется, топология подписчика не объявляется заново.
        const captured = await broker.capture('kit.#');
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'ok' },
            }),
        );
        await waitUntil(() => captured.length === 1, 'relay опубликовал');
        // Окно — сигнал системы: два тика метрик relay (раз в RELAY_POLL_MS = 1 с) длиннее паузы повтора настройки
        // RABBITMQ_RETRY_SECONDS = 1 с; за окно kit.retry не объявлялась снова.
        let ticks = 0;
        await countQueries(
            mainPoolOf(app.get(Db)),
            () => waitUntil(() => ticks >= 2, 'два тика метрик relay'),
            {
                onQuery: (text) => {
                    if (text.includes('as pending')) {
                        ticks += 1;
                    }
                },
            },
        );
        expect(retryDeclarations()).toBe(1);
        assertQueue.mockRestore();
        expect(lines.filter((line) => line['msg'] === FATAL)).toHaveLength(1);
        expect(
            lines.filter((line) => line['msg'] === 'rabbitmq: канал открывается заново'),
        ).toHaveLength(0);
        expect((await broker.queueInfo('kit.retry'))?.messageCount).toBe(0);
    });
});
