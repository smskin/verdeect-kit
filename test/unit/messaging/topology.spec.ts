// §3.4, П9 (U): имена очередей экземпляра и общий срок обработчиков остановки (prd.md §3.4); src/messaging/topology.ts.
import { describe, expect, it } from 'vitest';
import * as topology from '../../../src/messaging/topology.js';

describe('UC-6: топология', () => {
    it('§3.4: queuesOf(bff-app) → bff-app, bff-app.retry, bff-app.dlq; replicaQueueOf → bff-app.replica.r1', () => {
        expect(topology.queuesOf('bff-app')).toEqual({
            main: 'bff-app',
            retry: 'bff-app.retry',
            dlq: 'bff-app.dlq',
        });
        expect(topology.replicaQueueOf('bff-app', 'r1')).toBe('bff-app.replica.r1');
    });

    it('П9: handlersDeadlineMs({10_000, 0}) = 7_000; ({2_000, 1_500}) = 1_000', () => {
        expect(
            topology.handlersDeadlineMs({ SHUTDOWN_TIMEOUT_MS: 10_000, SHUTDOWN_DRAIN_MS: 0 }),
        ).toBe(7_000);
        expect(
            topology.handlersDeadlineMs({ SHUTDOWN_TIMEOUT_MS: 2_000, SHUTDOWN_DRAIN_MS: 1_500 }),
        ).toBe(1_000);
    });

    it('§3.4: константы PRD — пачка 100, срок 5 с, опрос 1 с, пауза 1 с → 5 мин, 5 неудач, prefetch 10, 5 повторов, 7 дней, 1000 × 100, раз в час', () => {
        expect(topology).toMatchObject({
            RELAY_BATCH_SIZE: 100,
            RELAY_BATCH_DEADLINE_MS: 5_000,
            RELAY_POLL_MS: 1_000,
            RELAY_BACKOFF_MIN_MS: 1_000,
            RELAY_BACKOFF_MAX_MS: 300_000,
            RELAY_ALERT_ATTEMPTS: 5,
            CONSUMER_PREFETCH: 10,
            MAX_RETRIES: 5,
            RETENTION_DAYS: 7,
            CLEANUP_BATCH_SIZE: 1_000,
            CLEANUP_MAX_BATCHES: 100,
            CLEANUP_INTERVAL_MS: 3_600_000,
            DLQ_REASON_HEADER: 'x-dlq-reason',
            EVENTS_EXCHANGE: 'verdeect.events',
        });
    });
});
