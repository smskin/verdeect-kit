// AC-5.16 (UC-5): строка, не опубликованная 5 раз подряд, — error-лог и ровно одно событие GlitchTip с id и type, без
// data; паузы 1 → 2 → 4 … до 300 с (prd.md §3.4). Relay — на подменённых часах (RelayTimers), реальных пауз нет;
// initFakeSentry — файл изолирован по умолчанию (vitest.timing.config.ts без isolate: false).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay, type RelayTimers } from '../../../src/messaging/outbox-relay.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { ManagedChannel, MessagingLog } from '../../../src/messaging/rabbit-connection.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import { adminQuery, createTestDb, truncateFixtures, type TestDb } from '../../support/database.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import { TestNoteCreated, outboxRows, waitUntil } from '../../support/messaging.js';

interface LogRecord {
    readonly level: string;
    readonly fields: Record<string, unknown>;
    readonly message: string;
}

/** Управляемые часы: пауза цикла — по tick() теста; confirm не наступает; stats — только по abort. */
function controlledTimers(): { timers: RelayTimers; pauses: number[]; tick: () => void } {
    const pauses: number[] = [];
    let release: (() => void) | undefined;
    const untilAbort = (signal: AbortSignal): Promise<void> =>
        new Promise((resolve) => {
            if (signal.aborted) {
                resolve();
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
        });

    return {
        pauses,
        tick: () => {
            const current = release;
            release = undefined;
            current?.();
        },
        timers: {
            now: () => 0,
            sleep: (ms, signal, kind) => {
                if (kind !== 'pause') {
                    return untilAbort(signal);
                }
                pauses.push(ms);

                return Promise.race([
                    new Promise<void>((resolve) => {
                        release = resolve;
                    }),
                    untilAbort(signal),
                ]);
            },
        },
    };
}

describe('UC-5: неудачи публикации', () => {
    let test: TestDb;
    const sentry = initFakeSentry();

    beforeAll(async () => {
        await truncateFixtures();
        test = await createTestDb();
    });

    afterAll(async () => {
        await test.close();
        await truncateFixtures();
    });

    it('AC-5.16: строка, не опубликованная 5 раз подряд, — error-лог и событие GlitchTip с id и type, без data; паузы 1 → 2 → 4 … до 300 с', async () => {
        await adminQuery(
            `insert into kit.outbox (id, tenant, type, version, subject_id, actor, trace_id, data)
             values ('evt_stuck', 'acme', 'kit.note.created', 1, 'n1', '{}', 't', '{"noteId":"n1","title":"секрет"}')`,
        );
        const records: LogRecord[] = [];
        const log: MessagingLog = {
            debug: (fields, message) =>
                records.push({ level: 'debug', fields: { ...fields }, message }),
            info: (fields, message) =>
                records.push({ level: 'info', fields: { ...fields }, message }),
            warn: (fields, message) =>
                records.push({ level: 'warn', fields: { ...fields }, message }),
            error: (fields, message) =>
                records.push({ level: 'error', fields: { ...fields }, message }),
        };
        const channel = {
            publish: () => Promise.reject(new Error('nack')),
            close: () => Promise.resolve(),
        } as unknown as ManagedChannel;
        const { timers, pauses, tick } = controlledTimers();
        const events = new Map([[TestNoteCreated.type, TestNoteCreated]]);
        const store = new OutboxStore({
            db: test.db,
            table: fixtureSchema.outbox,
            events,
            wake: () => undefined,
            log,
        });
        const relay = new OutboxRelay({
            db: test.db,
            store,
            connection: {
                isConnected: () => true,
                isChannelReady: () => true,
                createChannel: () => channel,
                onChannelReady: () => () => undefined,
                shutdownDeadline: () => new Promise<false>(() => undefined),
            },
            events,
            log,
            timers,
        });

        relay.onApplicationBootstrap();
        for (let pause = 1; pause <= 9; pause += 1) {
            await waitUntil(() => pauses.length === pause, `пауза ${pause}`);
            if (pause < 9) {
                tick();
            }
        }
        expect(pauses).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000]);
        expect((await outboxRows())[0]?.attempts).toBe(9);

        tick();
        await waitUntil(() => pauses.length === 10, 'пауза 10');
        expect(pauses[9]).toBe(300000);
        expect((await outboxRows())[0]?.attempts).toBe(10);
        await relay.beforeApplicationShutdown();

        await waitUntil(() => sentry.delivered.length >= 1, 'событие GlitchTip');
        expect(sentry.delivered).toHaveLength(1);
        const body = sentry.delivered[0]?.body ?? '';
        expect(body).toContain('evt_stuck');
        expect(body).toContain('kit.note.created');
        expect(body).toContain('"attempts":5');
        expect(body).not.toContain('секрет');
        expect(body).not.toContain('"data"');
        const errors = records.filter((record) => record.level === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0]?.fields).toEqual({
            id: 'evt_stuck',
            type: 'kit.note.created',
            attempts: 5,
        });
    });
});
