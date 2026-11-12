// AC-2.8, AC-9.5 (U, UC-13): реестр содержит метрики процесса Node и метрики пакета verdeect_* с меткой service; второй
// экземпляр приложения в том же процессе — свой реестр (prd.md §3.2). §3.2: alertRulesTemplate указывает на файл.
// Перенос: O orch-metrics.spec.ts («реестр содержит все метрики», «метки без sub, tenant»).
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertRulesTemplate, kitMetrics } from '../../../src/observability/index.js';

const KIT_PACKAGE_METRICS = [
    'verdeect_outbox_pending',
    'verdeect_outbox_lag_seconds',
    'verdeect_events_consumed_total',
    'verdeect_db_pool_wait_timeouts_total',
    'verdeect_rate_limit_unavailable_total',
    'verdeect_cleanup_runs_total',
];

describe('UC-13: метрики пакета', () => {
    it('AC-9.5: kitMetrics — verdeect_cleanup_runs_total{table,result} с меткой service', async () => {
        const metrics = kitMetrics({ service: 'kit-test' });
        metrics.cleanupRuns.inc({ table: 'idempotency_key', result: 'ok' });

        const text = await metrics.registry.metrics();

        expect(text).toContain('# TYPE verdeect_cleanup_runs_total counter');
        expect(text).toContain(
            'verdeect_cleanup_runs_total{table="idempotency_key",result="ok",service="kit-test"} 1',
        );
    });

    it('AC-2.8: реестр содержит метрики процесса Node и verdeect_* с меткой service', async () => {
        const metrics = kitMetrics({ service: 'kit-test' });
        metrics.outboxPending.set(3);
        metrics.eventsConsumed.inc({ type: 'svc.thing.created', result: 'handled' });

        const text = await metrics.registry.metrics();

        expect(text).toMatch(/^process_cpu_user_seconds_total\{service="kit-test"\}/m);
        expect(text).toMatch(/^nodejs_heap_size_used_bytes\{service="kit-test"\}/m);
        for (const name of KIT_PACKAGE_METRICS) {
            expect(text).toContain(`# TYPE ${name} `);
        }
        expect(text).toContain('verdeect_outbox_pending{service="kit-test"} 3');
        expect(text).toContain(
            'verdeect_events_consumed_total{type="svc.thing.created",result="handled",service="kit-test"} 1',
        );
    });

    it('AC-2.8: метки метрик пакета без sub и tenant', async () => {
        const metrics = kitMetrics({ service: 'kit-test' });

        const json = await metrics.registry.getMetricsAsJSON();
        const labels = json
            .filter((metric) => metric.name.startsWith('verdeect_'))
            .flatMap((metric) => metric.values.flatMap((value) => Object.keys(value.labels)));

        expect(labels).not.toContain('sub');
        expect(labels).not.toContain('tenant');
    });

    it('AC-2.8: второй экземпляр — свой реестр, значения не смешиваются', async () => {
        const first = kitMetrics({ service: 'first' });
        const second = kitMetrics({ service: 'second' });
        first.outboxPending.set(7);
        second.outboxPending.set(1);

        expect(first.registry).not.toBe(second.registry);
        expect(await first.registry.metrics()).toContain(
            'verdeect_outbox_pending{service="first"} 7',
        );
        expect(await second.registry.metrics()).toContain(
            'verdeect_outbox_pending{service="second"} 1',
        );
        expect(await second.registry.metrics()).not.toContain('service="first"');
    });

    it('§3.2: alertRulesTemplate указывает на существующий файл', () => {
        expect(isAbsolute(alertRulesTemplate)).toBe(true);
        expect(alertRulesTemplate).toMatch(/alerts[/\\]verdeect-kit\.rules\.yml$/);
        expect(existsSync(alertRulesTemplate)).toBe(true);
    });
});
