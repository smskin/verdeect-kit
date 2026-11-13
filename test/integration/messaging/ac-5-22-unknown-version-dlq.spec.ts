// AC-5.22 (UC-6 А8; prd.md §3.4 v1.28): on(E v1, h, {unknownVersion: 'dlq'}) — конверт неподписанной версии уходит в
// <svc>.dlq с x-dlq-reason: version, error-лог {id, type, version}, consumed{type, result: 'dlq'} +1, captureThrottled;
// обработчик не вызывается, inbox не занимается, skipped не растёт; неподписанный type — DLQ unsubscribed, опция не
// влияет. initFakeSentry — проект isolated (Sentry — глобальное состояние процесса).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { BrokerClient } from '../../support/broker.js';
import { adminQuery, truncateFixtures } from '../../support/database.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import {
    TestConsumerDlq,
    TestNoteCreated,
    consumed,
    createMessagingApp,
    dlqReason,
    initReady,
    memoryLogger,
    publishEnvelope,
    resetQueues,
    skipped,
    testEnvelope,
    waitUntil,
} from '../../support/messaging.js';

describe('UC-6: unknownVersion: dlq', () => {
    const sentry = initFakeSentry();
    const { logger, lines } = memoryLogger();
    let app: NestFastifyApplication;
    let broker: BrokerClient;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        broker = await BrokerClient.connect();
        app = await createMessagingApp({
            options: { subscriber: { inbox: fixtureSchema.inbox } },
            providers: [TestConsumerDlq],
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app);
    });

    afterAll(async () => {
        await app.close();
        await broker.close();
        await truncateFixtures();
    });

    it("AC-5.22: on(E v1, h, {unknownVersion: 'dlq'}): конверт v2 — в DLQ с x-dlq-reason: version, обработчик не вызван, в inbox нет, skipped не растёт", async () => {
        publishEnvelope(
            broker,
            testEnvelope({
                id: 'evt_dlq_v2',
                version: 2,
                data: { noteId: 'n2', title: 'ok', priority: 1 },
            }),
        );

        expect(await dlqReason(broker)).toBe('version');
        await waitUntil(async () => (await consumed(app, 'dlq')) === 1, "consumed{result: 'dlq'}");
        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');

        expect(app.get(TestConsumerDlq).received).toHaveLength(0);
        expect(await adminQuery('select id from kit.inbox')).toHaveLength(0);
        expect(await skipped(app, 2)).toBe(0);
        expect(sentry.delivered).toHaveLength(1);
        expect(
            lines.find(
                (line) => line['level'] === 50 && line['msg'] === 'messaging: сообщение в DLQ',
            ),
        ).toMatchObject({
            id: 'evt_dlq_v2',
            type: TestNoteCreated.type,
            version: 2,
            reason: 'version',
        });
    });

    it("AC-5.22: unknownVersion: 'dlq' — неподписанный type уходит в DLQ unsubscribed, не version", async () => {
        lines.length = 0;
        // Привязки только для зарегистрированных типов: неподписанный тип приходит прямо в очередь (как AC-5.7).
        broker.sendToQueue(
            'kit',
            Buffer.from(
                JSON.stringify(
                    testEnvelope({ id: 'evt_other', type: 'kit.other.created', version: 2 }),
                ),
            ),
        );

        expect(await dlqReason(broker)).toBe('unsubscribed');
        const line = lines.find(
            (item) => item['level'] === 50 && item['msg'] === 'messaging: сообщение в DLQ',
        );
        expect(line).toMatchObject({ id: 'evt_other', reason: 'unsubscribed' });
        expect(line).not.toHaveProperty('version');
        expect(app.get(TestConsumerDlq).received).toHaveLength(0);
    });
});
