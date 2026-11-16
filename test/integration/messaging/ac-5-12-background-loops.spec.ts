// AC-5.12 (UC-9, prd.md §3.8 стр. 191, 193 v1.31): createTestApp({backgroundLoops: false}) — relay не публикует,
// очистка не планируется, OutboxStore.add и подписчик работают; stopBackgroundLoops(app) ждёт текущий проход relay,
// новых проходов нет, последующий app.close() укладывается в срок остановки; повтор — без действия. Без фиксированных
// пауз: отсутствие проходов проверяется по состоянию цикла и вызовам drain после wake() и одной макрозадачи.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Db } from '../../../src/database/db.js';
import { MessagingCleanup } from '../../../src/messaging/cleanup.js';
import { OutboxRelay } from '../../../src/messaging/outbox-relay.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import { stopBackgroundLoops } from '../../../src/testing/background-loops.js';
import { publishTestEvent, waitForInbox } from '../../../src/testing/test-events.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { ctx, truncateFixtures } from '../../support/database.js';
import {
    TestConsumer,
    TestNoteCreated,
    createOutboxApp,
    messagingCleanupRuns,
    outboxRows,
    resetQueues,
} from '../../support/messaging.js';

/** Срок остановки стенда (умолчание SHUTDOWN_TIMEOUT_MS). */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function add(app: NestFastifyApplication, n: string): Promise<string> {
    return app.get(Db).transaction(ctx('acme'), (tx) =>
        app.get(OutboxStore).add(tx, TestNoteCreated, {
            subjectId: n,
            data: { noteId: n, title: 'T' },
        }),
    );
}

/** Одна макрозадача: микрозадачи цикла relay после wake() успевают выполниться. */
function macrotask(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

async function published(id: string): Promise<boolean> {
    return (await outboxRows()).some((row) => row.id === id && row.published_at !== null);
}

describe('UC-9: фоновые циклы в тестах', () => {
    let app: NestFastifyApplication | undefined;

    beforeEach(async () => {
        await truncateFixtures();
        await resetQueues();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await app?.close();
        app = undefined;
    });

    it('AC-5.12: createTestApp({backgroundLoops: false}) — после OutboxStore.add и COMMIT строка не опубликована, проходов очистки нет, подписчик потребляет событие', async () => {
        app = await createOutboxApp({
            subscriber: { inbox: fixtureSchema.inbox },
            providers: [TestConsumer],
            backgroundLoops: false,
        });
        const relay = app.get(OutboxRelay);
        const drain = vi.spyOn(relay as unknown as { drain: () => Promise<unknown> }, 'drain');
        const id = await add(app, 'n1');
        relay.wake();
        await macrotask();

        // Цикл relay и расписание очистки не созданы: проверка состояния, а не ожидание по времени.
        expect((relay as unknown as { loop: unknown }).loop).toBeNull();
        expect(
            (app.get(MessagingCleanup) as unknown as { current: unknown }).current,
        ).toBeUndefined();
        expect(drain).not.toHaveBeenCalled();
        expect(await published(id)).toBe(false);
        for (const table of ['outbox', 'inbox'] as const) {
            for (const result of ['ok', 'partial', 'interrupted', 'error']) {
                expect(await messagingCleanupRuns(app, table, result)).toBe(0);
            }
        }
        const envelope = await publishTestEvent(TestNoteCreated, { noteId: 'r1', title: 'ok' });
        await waitForInbox(envelope.id, { timeoutMs: 5_000 });
        expect(app.get(TestConsumer).count()).toBe(1);
    });

    it('AC-5.12: stopBackgroundLoops(app) во время прохода relay ждёт его, новых проходов нет, последующий app.close() укладывается в полный срок остановки', async () => {
        app = await createOutboxApp();
        const relay = app.get(OutboxRelay);
        const target = relay as unknown as { drain: () => Promise<unknown> };
        const drain = target.drain.bind(relay);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let entered: () => void = () => undefined;
        const inPass = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let passes = 0;
        vi.spyOn(target, 'drain').mockImplementation(async () => {
            passes += 1;
            entered();
            await gate;

            return drain();
        });
        const first = await add(app, 'n1');
        await inPass;

        let stopCalled: () => void = () => undefined;
        const stopEntered = new Promise<void>((resolve) => {
            stopCalled = resolve;
        });
        const stopLoops = relay.stopLoops.bind(relay);
        vi.spyOn(relay, 'stopLoops').mockImplementation(() => {
            stopCalled();

            return stopLoops();
        });
        let stoppedAt: number | null = null;
        const stopping = stopBackgroundLoops(app).then(() => {
            stoppedAt = passes;
        });
        // Остановка relay началась; завершиться её не пускает шлагбаум прохода, а не время.
        await stopEntered;
        await macrotask();
        expect(stoppedAt).toBeNull();
        release();
        await stopping;
        // Проход дорабатывает и завершается: после остановки цикла строки пачки не публикуются (как на шаге 3).
        expect(await published(first)).toBe(false);
        const second = await add(app, 'n2');
        relay.wake();
        await macrotask();

        expect(await published(second)).toBe(false);
        expect(passes).toBe(stoppedAt);
        await stopBackgroundLoops(app);
        const startedAt = performance.now();
        await app.close();
        app = undefined;
        expect(performance.now() - startedAt).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    });
});
