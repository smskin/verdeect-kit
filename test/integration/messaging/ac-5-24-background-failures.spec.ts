// AC-5.24 (UC-5, UC-9): серии сбоев фоновых задач /messaging — relay (outbox-relay) и очистка (messaging-cleanup)
// (prd.md §3.4 v1.34 стр. 131, 134; §3.2 backgroundFailed). Недоступная БД — закрытый порт tcpProxy.break(): подключение
// сразу получает ECONNREFUSED, срока драйвера нет. Relay — на подменённых часах (RelayTimers), как AC-5.16; реальных
// пауз нет. initFakeSentry — файл в проекте isolated.
import * as Sentry from '@sentry/nestjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteInBatches, runExclusive } from '../../../src/database/index.js';
import { messagingCleanupLockKey } from '../../../src/internal/outbox-policy.js';
import { MessagingCleanup } from '../../../src/messaging/cleanup.js';
import { OutboxRelay, type RelayTimers } from '../../../src/messaging/outbox-relay.js';
import { OutboxStore } from '../../../src/messaging/outbox-store.js';
import type { ManagedChannel, MessagingLog } from '../../../src/messaging/rabbit-connection.js';
import { kitMetrics } from '../../../src/observability/metrics.js';
import { tcpProxy, type TcpProxy } from '../../../src/testing/tcp-proxy.js';
import * as fixtureSchema from '../../fixtures/database/schema.js';
import {
    adminQuery,
    appUrl,
    createTestDb,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';
import { initFakeSentry } from '../../support/fake-sentry.js';
import { TestNoteCreated, barrier, waitUntil } from '../../support/messaging.js';

interface LogRecord {
    readonly level: string;
    readonly fields: Record<string, unknown>;
    readonly message: string;
}

function recordingLog(): { log: MessagingLog; records: LogRecord[] } {
    const records: LogRecord[] = [];
    const push =
        (level: string) =>
        (fields: object, message: string): void => {
            records.push({ level, fields: { ...fields } as Record<string, unknown>, message });
        };

    return {
        records,
        log: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    };
}

/** Записи серии задачи `task`: уровень и `failures`. */
function seriesOf(records: readonly LogRecord[], task: string): string[] {
    return records
        .filter((record) => record.fields['task'] === task)
        .map((record) => `${record.level}:${String(record.fields['failures'] ?? '-')}`);
}

/** Управляемые часы relay: пауза цикла — по tick() теста; срок подтверждения не наступает. */
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

const metrics = kitMetrics({ service: 'kit' });

/** `verdeect_background_failures_total{task}` — счётчик процесса. */
async function failuresTotal(task: string): Promise<number> {
    const metric = await metrics.registry
        .getSingleMetric('verdeect_background_failures_total')
        ?.get();

    return metric?.values.find((value) => value.labels['task'] === task)?.value ?? 0;
}

/** `verdeect_cleanup_runs_total{table, result}` реестра теста. */
async function cleanupRuns(table: string, result: string): Promise<number> {
    const metric = await metrics.registry.getSingleMetric('verdeect_cleanup_runs_total')?.get();

    return (
        metric?.values.find(
            (value) => value.labels['table'] === table && value.labels['result'] === result,
        )?.value ?? 0
    );
}

describe('UC-9: серии сбоев фоновых задач /messaging', () => {
    const sentry = initFakeSentry();
    let proxy: TcpProxy;
    let test: TestDb;

    beforeAll(async () => {
        await truncateFixtures();
        proxy = await tcpProxy(appUrl());
        test = await createTestDb({ url: proxy.url, poolMax: 2 });
    });

    afterAll(async () => {
        await proxy.restore();
        await test.close();
        await proxy.close();
        await truncateFixtures();
    });

    beforeEach(async () => {
        await proxy.restore();
        sentry.delivered.length = 0;
    });

    it('AC-5.24: БД недоступна (закрытый порт, tcpProxy.break — ECONNREFUSED) — N = 3 прохода relay → одно событие GlitchTip, verdeect_background_failures_total{task="outbox-relay"} = 3; после restore успешный проход закрывает серию (info); новый сбой — второе событие', async () => {
        const { log, records } = recordingLog();
        const channel = {
            publish: () => Promise.resolve(),
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
        const before = await failuresTotal('outbox-relay');

        relay.onApplicationBootstrap();
        try {
            // Проход 0 — БД доступна: успех без открытой серии — без лога серии.
            await waitUntil(() => pauses.length === 1, 'первый проход');
            await proxy.break();
            for (let pass = 1; pass <= 3; pass += 1) {
                tick();
                await waitUntil(() => pauses.length === pass + 1, `сбой ${pass}`);
            }
            await waitUntil(() => sentry.delivered.length >= 1, 'событие первого сбоя');

            expect(seriesOf(records, 'outbox-relay')).toEqual(['error:-', 'warn:2', 'warn:3']);
            expect((await failuresTotal('outbox-relay')) - before).toBe(3);

            await proxy.restore();
            tick();
            await waitUntil(() => pauses.length === 5, 'проход после restore');
            expect(seriesOf(records, 'outbox-relay')).toEqual([
                'error:-',
                'warn:2',
                'warn:3',
                'info:3',
            ]);

            await proxy.break();
            tick();
            await waitUntil(() => pauses.length === 6, 'новый сбой');
            await waitUntil(() => sentry.delivered.length >= 2, 'событие новой серии');

            expect(seriesOf(records, 'outbox-relay').at(-1)).toBe('error:-');
            expect(sentry.delivered).toHaveLength(2);
            expect((await failuresTotal('outbox-relay')) - before).toBe(4);
        } finally {
            await proxy.restore();
            await relay.stopLoops();
        }
    });

    /** Очистка напрямую по MessagingCleanupDeps: БД — через прокси, без расписания. */
    function cleanupStand(): { cleanup: MessagingCleanup; records: LogRecord[] } {
        const { log, records } = recordingLog();
        const cleanup = new MessagingCleanup({
            db: test.db,
            database: { runExclusive, deleteInBatches },
            schema: 'kit',
            tables: { outbox: fixtureSchema.outbox, inbox: fixtureSchema.inbox },
            metrics,
            log,
            backgroundLoops: false,
        });

        return { cleanup, records };
    }

    /** Закрывает серию прошлого теста: БД доступна, проход без ошибок. */
    async function closeSeries(cleanup: MessagingCleanup): Promise<void> {
        await proxy.restore();
        expect(await cleanup.run()).toEqual({ ran: true });
        await Sentry.flush(2000);
        sentry.delivered.length = 0;
    }

    it('AC-5.24: проход очистки с ошибкой БД → серия messaging-cleanup (одно событие, error); повторный сбой — без события, warn', async () => {
        const { cleanup, records } = cleanupStand();
        await closeSeries(cleanup);
        const from = records.length;
        const before = await failuresTotal('messaging-cleanup');

        await proxy.break();
        expect(await cleanup.run()).toEqual({ ran: false });
        expect(await cleanup.run()).toEqual({ ran: false });
        await Sentry.flush(2000);

        expect(seriesOf(records.slice(from), 'messaging-cleanup')).toEqual(['error:-', 'warn:2']);
        expect(sentry.delivered).toHaveLength(1);
        expect((await failuresTotal('messaging-cleanup')) - before).toBe(2);
    });

    it('AC-5.24: проход с занятым замком ({ran: false}) серию не меняет и не закрывает', async () => {
        const { cleanup, records } = cleanupStand();
        await closeSeries(cleanup);
        const from = records.length;
        await proxy.break();
        await cleanup.run();
        await cleanup.run();
        await proxy.restore();

        const other = await createTestDb();
        const gate = barrier();
        const held = barrier();
        try {
            const holding = runExclusive(other.db, messagingCleanupLockKey('kit'), async () => {
                held.release();
                await gate.wait;
            });
            await held.wait;
            expect(await cleanup.run()).toEqual({ ran: false });
            gate.release();
            await holding;
        } finally {
            gate.release();
            await other.close();
        }
        expect(seriesOf(records.slice(from), 'messaging-cleanup')).toEqual(['error:-', 'warn:2']);
        expect(
            records
                .slice(from)
                .some((record) => record.message === 'очистка сообщений: другая реплика'),
        ).toBe(true);

        expect(await cleanup.run()).toEqual({ ran: true });
        await Sentry.flush(2000);

        expect(seriesOf(records.slice(from), 'messaging-cleanup')).toEqual([
            'error:-',
            'warn:2',
            'info:2',
        ]);
        expect(sentry.delivered).toHaveLength(1);
    });

    it('AC-5.24: ошибка одной таблицы (REVOKE DELETE ON kit.outbox) — сбой прохода, inbox очищен, успеха нет', async () => {
        const { cleanup, records } = cleanupStand();
        await closeSeries(cleanup);
        const from = records.length;
        await adminQuery(
            "insert into kit.inbox (id, type, received_at) values ('m_old', 'kit.note.created', now() - make_interval(days => 8))",
        );
        const before = {
            series: await failuresTotal('messaging-cleanup'),
            outboxError: await cleanupRuns('outbox', 'error'),
            inboxOk: await cleanupRuns('inbox', 'ok'),
        };

        await adminQuery('REVOKE DELETE ON kit.outbox FROM kit_app');
        try {
            await cleanup.run();
        } finally {
            await adminQuery('GRANT DELETE ON kit.outbox TO kit_app');
        }

        expect((await failuresTotal('messaging-cleanup')) - before.series).toBe(1);
        expect((await cleanupRuns('outbox', 'error')) - before.outboxError).toBe(1);
        expect((await cleanupRuns('inbox', 'ok')) - before.inboxOk).toBe(1);
        expect(await adminQuery("select 1 from kit.inbox where id = 'm_old'")).toHaveLength(0);
        expect(seriesOf(records.slice(from), 'messaging-cleanup')).toEqual(['error:-']);
    });
});
