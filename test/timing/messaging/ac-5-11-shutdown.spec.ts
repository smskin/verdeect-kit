// AC-5.11 (UC-8): остановка — подписчик снимает потребителей и дожидается начатой доставки; обработчик дольше срока —
// подписчик идёт дальше после shutdownDeadline; relay при неподтверждённой публикации фиксирует транзакцию пачки без
// attempts + 1 — всё в общем сроке (prd.md §3.4; П9). Эквивалентность — O subscriber (остановка), P outbox-relay (STOPPED).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Db, mainPoolOf } from '../../../src/database/db.js';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { KIT_RABBIT_CONNECTION } from '../../../src/messaging/config.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { RabbitConnection } from '../../../src/messaging/rabbit-connection.js';
import { countQueries } from '../../../src/testing/count-queries.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import { TEST_TIMEOUT_SCALE } from '../../../src/testing/timeout-scale.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, ctx, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    createMessagingApp,
    createOutboxApp,
    initReady,
    memoryLogger,
    outboxRows,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

const isClaim = (text: string): boolean =>
    text.includes('for update skip locked') && !text.toLowerCase().includes('delete');

describe('UC-8: остановка сообщений', () => {
    let broker: BrokerClient | undefined;
    let proxy: TcpProxy | undefined;

    afterEach(async () => {
        await broker?.close();
        broker = undefined;
        await proxy?.restore();
        await proxy?.close();
        proxy = undefined;
        await truncateFixtures();
    });

    it('AC-5.11: остановка — подписчик снимает потребителей и дожидается начатой доставки, relay дорабатывает пачку, очистка не начинает новую — в общем сроке', async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        const app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
        });
        await initReady(app);
        const consumer = app.get(TestConsumer);
        const entered = consumer.nextEntry();
        publishEnvelope(
            broker,
            testEnvelope({ id: 'evt_stop_1', data: { noteId: 'n1', title: 'block' } }),
        );
        await entered;

        const t0 = performance.now();
        const closing = app.close();
        const client = broker;
        await waitUntil(
            async () => (await client.queueInfo('kit'))?.consumerCount === 0,
            'потребители сняты',
        );
        consumer.gate.release();
        await closing;

        expect(performance.now() - t0).toBeLessThan(10_000 * TEST_TIMEOUT_SCALE);
        expect((await client.queueInfo('kit'))?.messageCount).toBe(0);
        expect(await adminQuery("select id from kit.inbox where id = 'evt_stop_1'")).toHaveLength(
            1,
        );
    });

    it('AC-5.11: обработчик дольше shutdownDeadline → сообщение возвращено в очередь, остановка укладывается в SHUTDOWN_TIMEOUT_MS, сторож не срабатывает', async () => {
        await resetQueues();
        broker = await BrokerClient.connect();
        const { logger, lines } = memoryLogger();
        const app = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [TestConsumer],
            env: { SHUTDOWN_TIMEOUT_MS: '4000' },
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app);
        const consumer = app.get(TestConsumer);
        try {
            const entered = consumer.nextEntry();
            publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'block' } }));
            await entered;
            const t0 = performance.now();
            await app.close();

            expect(performance.now() - t0).toBeLessThan(4_000 * TEST_TIMEOUT_SCALE);
            expect(
                lines.some(
                    (line) =>
                        line['msg'] === 'messaging: срок остановки подписчика вышел, идём дальше',
                ),
            ).toBe(true);
            // Без ack: брокер возвращает доставку при закрытии соединения на шаге 4 (эталон O), повтор закроет inbox.
            const client = broker;
            await waitUntil(
                async () => (await client.queueInfo('kit'))?.messageCount === 1,
                'сообщение возвращено в kit',
            );
            expect(lines.some((line) => line['code'] === 'SHUTDOWN_TIMEOUT')).toBe(false);
        } finally {
            consumer.gate.release();
        }
    });

    it('AC-5.11: relay — остановка во время неподтверждённой публикации: транзакция пачки зафиксирована, строка без attempts + 1 и last_error, close в общем сроке', async () => {
        await truncateFixtures();
        proxy = await tcpProxy(workerScope().rabbitmq.url);
        const app: NestFastifyApplication = await createOutboxApp({
            env: { RABBITMQ_URL: proxy.url },
        });
        const connection = app.get<RabbitConnection>(KIT_RABBIT_CONNECTION);
        await waitUntil(() => connection.isChannelReady('outbox-relay'), 'канал relay');
        proxy.freeze();
        let armed = false;
        let signal = (): void => undefined;
        const firstClaim = new Promise<void>((resolve) => {
            signal = resolve;
        });
        let closeMs = Infinity;

        const { queries } = await countQueries(
            mainPoolOf(app.get(Db)),
            async () => {
                await app.get(Db).transaction(ctx('acme'), (tx) =>
                    app.get(OutboxStore).add(tx, TestNoteCreated, {
                        subjectId: 'n1',
                        data: { noteId: 'n1', title: 'T' },
                    }),
                );
                armed = true;
                await firstClaim;
                // Захват вернулся, relay ушёл в publish на замороженный прокси.
                await waitUntil(
                    async () =>
                        (
                            await adminQuery(
                                `select 1 from pg_stat_activity where state = 'idle in transaction'
                                 and query ilike '%for update skip locked%' and query not ilike '%delete%'`,
                            )
                        ).length > 0,
                    'relay: пачка захвачена, публикация не подтверждена',
                    5_000,
                );
                const t0 = performance.now();
                await app.close();
                closeMs = performance.now() - t0;
            },
            {
                onQuery: (text) => {
                    if (armed && isClaim(text)) {
                        signal();
                    }
                },
            },
        );

        expect(queries.filter(isClaim).length).toBeGreaterThan(0);
        expect(closeMs).toBeLessThan(10_000 * TEST_TIMEOUT_SCALE);
        const [row] = await outboxRows();
        expect(row).toMatchObject({ published_at: null, attempts: 0, last_error: null });
    });
});
