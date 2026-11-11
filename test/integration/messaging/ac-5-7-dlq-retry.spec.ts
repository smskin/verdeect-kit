// AC-5.7 (UC-6): неразбираемое — сразу в kit.dlq с x-dlq-reason; ExpectedMessageError — повтор через kit.retry, после 5
// повторов DLQ с кодом, без GlitchTip; непредвиденная после исчерпания — DLQ retries-exhausted и ровно одно событие
// GlitchTip; data не по схеме — DLQ data (prd.md §3.4; П7). Эквивалентность — O subscriber.int-spec. initFakeSentry —
// проект isolated (Sentry — глобальное состояние процесса).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { BrokerClient } from '../../support/broker.js';
import { truncateFixtures } from '../../support/database.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import {
    TestConsumer,
    consumed,
    createSubscriberApp,
    initReady,
    memoryLogger,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

const { logger, lines } = memoryLogger();

const EXHAUSTED = { 'x-death': [{ queue: 'kit', reason: 'rejected', count: 5 }] };

describe('UC-6: DLQ и повторы', () => {
    const sentry = initFakeSentry();
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    async function dlqReason(): Promise<string | undefined> {
        await waitUntil(
            async () => ((await broker.queueInfo('kit.dlq'))?.messageCount ?? 0) > 0,
            'копия в kit.dlq',
        );
        const message = await broker.take('kit.dlq');

        return message?.properties.headers?.['x-dlq-reason'] as string | undefined;
    }

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createSubscriberApp({ overrides: [{ provide: KIT_LOGGER, useValue: logger }] });
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
        await truncateFixtures();
    });

    beforeEach(async () => {
        await broker.purge('kit', 'kit.retry', 'kit.dlq');
        lines.length = 0;
        sentry.delivered.length = 0;
    });

    it('AC-5.7: не JSON → kit.dlq, x-dlq-reason not-json', async () => {
        broker.publishRaw('kit.note.created', Buffer.from('{not json'));

        expect(await dlqReason()).toBe('not-json');
    });

    it('AC-5.7: неверный конверт (без id) → envelope', async () => {
        const envelope = testEnvelope();
        delete envelope['id'];
        broker.publishRaw('kit.note.created', Buffer.from(JSON.stringify(envelope)));

        expect(await dlqReason()).toBe('envelope');
    });

    it('AC-5.7: неподписанный тип → unsubscribed', async () => {
        // Привязки только для зарегистрированных типов: неподписанный тип приходит прямо в очередь.
        broker.sendToQueue(
            'kit',
            Buffer.from(JSON.stringify(testEnvelope({ type: 'kit.other.created' }))),
        );

        expect(await dlqReason()).toBe('unsubscribed');
    });

    it('AC-5.7: InvalidMessageError → причина из reason, без события GlitchTip', async () => {
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'invalid' } }));

        expect(await dlqReason()).toBe('test-invalid');
        expect(sentry.delivered).toHaveLength(0);
    });

    it("AC-5.7: признак tenant нарушен ('required' с tenant: null) → tenant", async () => {
        publishEnvelope(broker, testEnvelope({ tenant: null }));

        expect(await dlqReason()).toBe('tenant');
    });

    it('AC-5.7: ExpectedMessageError → повтор через .retry (RABBITMQ_RETRY_SECONDS=1), warn, без GlitchTip', async () => {
        const consumer = app.get(TestConsumer);
        const before = consumer.count();
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'expected' } }));
        await waitUntil(() => consumer.count() >= before + 2, 'вторая доставка после TTL', 10_000);

        expect(
            lines.some(
                (line) =>
                    line['level'] === 40 && line['msg'] === 'messaging: ожидаемый отказ, повтор',
            ),
        ).toBe(true);
        expect(sentry.delivered).toHaveLength(0);
    });

    it('AC-5.7: ExpectedMessageError после 5 повторов → DLQ с причиной = код, без GlitchTip', async () => {
        await broker.purge('kit', 'kit.retry', 'kit.dlq');
        sentry.delivered.length = 0;
        const envelope = testEnvelope({ data: { noteId: 'n1', title: 'expected' } });
        broker.sendToQueue('kit', Buffer.from(JSON.stringify(envelope)), { headers: EXHAUSTED });

        expect(await dlqReason()).toBe('TEST_DEPENDENCY_DOWN');
        expect(sentry.delivered).toHaveLength(0);
    });

    it('AC-5.7: непредвиденная ошибка до исчерпания повторов → retry и warn, без события GlitchTip', async () => {
        const before = await consumed(app, 'retry');
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'fail' } }));
        await waitUntil(async () => (await consumed(app, 'retry')) > before, 'retry');

        expect(sentry.delivered).toHaveLength(0);
        expect(
            lines.some(
                (line) =>
                    line['level'] === 40 && line['msg'] === 'messaging: ошибка обработчика, повтор',
            ),
        ).toBe(true);
        await broker.purge('kit', 'kit.retry');
    });

    it('AC-5.7: непредвиденная ошибка после пятого повтора → DLQ retries-exhausted, ровно одно событие GlitchTip (O subscriber)', async () => {
        await broker.purge('kit', 'kit.retry', 'kit.dlq');
        sentry.delivered.length = 0;
        broker.sendToQueue(
            'kit',
            Buffer.from(JSON.stringify(testEnvelope({ data: { noteId: 'n1', title: 'fail' } }))),
            { headers: EXHAUSTED },
        );

        expect(await dlqReason()).toBe('retries-exhausted');
        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');
        expect(sentry.delivered).toHaveLength(1);
    });

    it('AC-5.7: data не по схеме → DLQ data, путь поля в логе, значения нет', async () => {
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'секрет-777', title: 42 } }));

        expect(await dlqReason()).toBe('data');
        const line = lines.find((item) => item['msg'] === 'messaging: сообщение в DLQ');
        expect(line?.['fields']).toEqual(['title']);
        expect(JSON.stringify(lines)).not.toContain('секрет-777');
    });
});
