// AC-5.9 (UC-6): onReplica — неразобранное сообщение или ошибка обработчика: без повтора и DLQ, error-лог, событие
// GlitchTip (captureThrottled), verdeect_events_consumed_total{result="dlq"} +1 (prd.md §3.4 v1.15; П24). initFakeSentry —
// проект isolated (Sentry — глобальное состояние процесса).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { BrokerClient } from '../../support/broker.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import {
    ReplicaConsumer,
    consumed,
    createMessagingApp,
    initReady,
    memoryLogger,
    publishEnvelope,
    resetQueues,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: ошибки очереди реплики', () => {
    const sentry = initFakeSentry();
    const { logger, lines } = memoryLogger();
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createMessagingApp({
            options: { subscriber: { dedupe: 'none' } },
            providers: [ReplicaConsumer],
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app, 'subscriber-replica');
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
    });

    beforeEach(() => {
        sentry.delivered.length = 0;
        lines.length = 0;
    });

    it('AC-5.9: ошибка обработчика onReplica → без повтора, error-лог, событие GlitchTip, verdeect_events_consumed_total{result="dlq"} +1', async () => {
        const consumer = app.get(ReplicaConsumer);
        const before = await consumed(app, 'dlq');
        publishEnvelope(broker, testEnvelope({ data: { noteId: 'n1', title: 'fail' } }));
        await waitUntil(async () => (await consumed(app, 'dlq')) === before + 1, 'dlq +1');
        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');

        expect(consumer.calls).toBe(1);
        expect(
            lines.filter(
                (line) =>
                    line['level'] === 50 &&
                    line['msg'] === 'messaging: сообщение реплики не обработано',
            ),
        ).toHaveLength(1);
        expect(sentry.delivered).toHaveLength(1);
    });

    it('AC-5.9: неразобранное сообщение реплики (не JSON) → без повтора, error-лог, событие GlitchTip, result="dlq"', async () => {
        const before = await consumed(app, 'dlq', 'unknown');
        broker.publishRaw('kit.note.created', Buffer.from('{not json'));
        await waitUntil(
            async () => (await consumed(app, 'dlq', 'unknown')) === before + 1,
            'dlq +1',
        );
        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');

        expect(lines.some((line) => line['level'] === 50 && line['reason'] === 'not-json')).toBe(
            true,
        );
    });
});
