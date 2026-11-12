// AC-9.5 (NFR-8): relay, подписчик и очистка пишут метрики с меткой service и логи с полями service и replica (prd.md
// §3.2, §3.4). Логгер — KIT_LOGGER приложения, подмена pino в память (как E4 ac-9-5-cleanup-observability.spec.ts).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { KIT_LOGGER, KIT_PACKAGE_METRICS } from '../../../src/internal/tokens.js';
import { MessagingCleanup } from '../../../src/messaging/cleanup.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { KitMetrics } from '../../../src/observability/metrics.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    consumed,
    createOutboxApp,
    initReady,
    memoryLogger,
    resetQueues,
    waitUntil,
} from '../../support/messaging.js';

describe('NFR-8: наблюдаемость сообщений', () => {
    const { logger, lines } = memoryLogger('debug');
    let app: NestFastifyApplication;

    beforeAll(async () => {
        await truncateFixtures();
        await resetQueues();
        app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
            env: { LOG_LEVEL: 'debug' },
            overrides: [{ provide: KIT_LOGGER, useValue: logger }],
        });
        await initReady(app);
        await initReady(app, 'outbox-relay');
        await app.get(MessagingCleanup).idle();
    });

    afterAll(async () => {
        await app.close();
        await truncateFixtures();
    });

    it('AC-9.5: relay, подписчик и очистка пишут метрики с меткой service и логи с полями service и replica', async () => {
        await app.get(Db).transaction(ctx('acme'), (tx) =>
            app.get(OutboxStore).add(tx, TestNoteCreated, {
                subjectId: 'n1',
                data: { noteId: 'n1', title: 'ok' },
            }),
        );
        await waitUntil(async () => (await consumed(app, 'handled')) === 1, 'handled');
        await app.get(MessagingCleanup).run();
        const { registry } = app.get<KitMetrics>(KIT_PACKAGE_METRICS);

        const text = (await registry.metrics()).split('\n');
        expect(text.some((line) => line.startsWith('verdeect_outbox_pending{service="kit"}'))).toBe(
            true,
        );
        expect(
            text.some((line) => line.startsWith('verdeect_outbox_lag_seconds{service="kit"}')),
        ).toBe(true);
        expect(
            text.some(
                (line) =>
                    line.startsWith('verdeect_events_consumed_total{') &&
                    line.includes('service="kit"') &&
                    line.includes('type="kit.note.created"') &&
                    line.includes('result="handled"'),
            ),
        ).toBe(true);
        for (const table of ['outbox', 'inbox']) {
            expect(
                text.some(
                    (line) =>
                        line.startsWith('verdeect_cleanup_runs_total{') &&
                        line.includes('service="kit"') &&
                        line.includes(`table="${table}"`),
                ),
                table,
            ).toBe(true);
        }
        for (const msg of [
            'outbox: пачка опубликована',
            'messaging: доставка',
            'очистка сообщений: проход',
        ]) {
            const found = lines.filter((line) => line['msg'] === msg);
            expect(found.length, msg).toBeGreaterThan(0);
            expect(
                found.every((line) => line['service'] === 'kit' && line['replica'] === 'kit-1'),
                msg,
            ).toBe(true);
        }
    });
});
