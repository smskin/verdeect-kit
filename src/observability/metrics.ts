// kitMetrics и alertRulesTemplate (prd.md §3.2, AC-2.8, AC-2.11). Эталон — O metrics-server.ts (реестр на экземпляр) и
// O orch-metrics.ts (метрики на реестре экземпляра). По PRD v1.12: @prometheus-io/client, как у O; метка service по
// умолчанию, метрики процесса Node, имена verdeect_*. Глобального реестра нет: два приложения в процессе не смешиваются.
import { fileURLToPath } from 'node:url';
import { collectDefaultMetrics, Counter, Gauge, Registry } from '@prometheus-io/client';
import { assertServiceName } from '../internal/service-name.js';

/** Реестр и метрики пакета одного экземпляра приложения (§3.2). Метрики домена — `<service>_*`, вне пакета. */
export interface KitMetrics {
    /** Реестр экземпляра: метки `service`, метрики процесса Node и пакета. */
    readonly registry: Registry;
    /** `verdeect_outbox_pending` — неотправленные строки outbox. */
    readonly outboxPending: Gauge;
    /** `verdeect_outbox_lag_seconds` — возраст самой старой неотправленной строки. */
    readonly outboxLagSeconds: Gauge;
    /** `verdeect_events_consumed_total{type, result}`; result: handled | duplicate | retry | dlq. */
    readonly eventsConsumed: Counter<'type' | 'result'>;
    /** `verdeect_db_pool_wait_timeouts_total{pool}` — истёк срок ожидания клиента пула. */
    readonly dbPoolWaitTimeouts: Counter<'pool'>;
    /** `verdeect_rate_limit_unavailable_total` — лимитер без Redis (fail-open). */
    readonly rateLimitUnavailable: Counter;
}

/** Создаёт реестр экземпляра с меткой `service`, метриками процесса Node и метриками пакета (§3.2, AC-2.8). */
export function kitMetrics(options: { readonly service: string }): KitMetrics {
    assertServiceName(options.service, 'kitMetrics');
    const registry = new Registry();
    registry.setDefaultLabels({ service: options.service });
    collectDefaultMetrics({ register: registry });
    const registers = [registry];

    return {
        registry,
        outboxPending: new Gauge({
            name: 'verdeect_outbox_pending',
            help: 'Неотправленные строки outbox',
            registers,
        }),
        outboxLagSeconds: new Gauge({
            name: 'verdeect_outbox_lag_seconds',
            help: 'Возраст самой старой неотправленной строки outbox, с',
            registers,
        }),
        eventsConsumed: new Counter({
            name: 'verdeect_events_consumed_total',
            help: 'Принятые события по типу и результату (handled, duplicate, retry, dlq)',
            labelNames: ['type', 'result'] as const,
            registers,
        }),
        dbPoolWaitTimeouts: new Counter({
            name: 'verdeect_db_pool_wait_timeouts_total',
            help: 'Истёк срок ожидания клиента пула БД',
            labelNames: ['pool'] as const,
            registers,
        }),
        rateLimitUnavailable: new Counter({
            name: 'verdeect_rate_limit_unavailable_total',
            help: 'Проверки лимита без Redis (запрос пропущен)',
            registers,
        }),
    };
}

/** Абсолютный путь к шаблону правил vmalert `alerts/verdeect-kit.rules.yml` внутри установленного пакета (§3.2). */
export const alertRulesTemplate: string = fileURLToPath(
    new URL('../../alerts/verdeect-kit.rules.yml', import.meta.url),
);
