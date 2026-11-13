// kitMetrics и alertRulesTemplate (prd.md §3.2, AC-2.8, AC-2.11). Эталон — O metrics-server.ts (реестр на экземпляр) и
// O orch-metrics.ts (метрики на реестре экземпляра). По PRD v1.12: @prometheus-io/client, как у O; метка service по
// умолчанию, метрики процесса Node, имена verdeect_*. Глобального реестра нет: два приложения в процессе не смешиваются.
// AC-9.5 (E4): метрика очистки verdeect_cleanup_runs_total.
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
    /**
     * `verdeect_cleanup_runs_total{table, result}` — проходы фоновой очистки. `table` — имя таблицы без схемы, только
     * таблицы пакета (`idempotency_key`; E5 — `outbox`, `inbox`); `result`: `ok` — проход завершён, `partial` — упёрся
     * в `maxBatches`, записи старше срока остались, `interrupted` — остановлен (выкат; алерт не срабатывает), `error` —
     * проход упал. Проход без блокировки метрику не меняет;
     * число удалённых строк — в `info`-логе прохода.
     */
    readonly cleanupRuns: Counter<'table' | 'result'>;
    /**
     * `verdeect_events_skipped_total{type, version}` — события подписанного `type` с неподписанной версией,
     * подтверждённые без обработки (§3.4 v1.26, AC-5.22). Ожидаемы на время перехода версии; правила алерта нет.
     */
    readonly eventsSkipped: Counter<'type' | 'version'>;
    /**
     * @internal Источник `verdeect_outbox_*` при запросе `/metrics` (`collect()`, §3.4 v1.25): регистрирует relay, `null` —
     * снять. Источник сам ставит значения и не отклоняется; запрос в полёте общий для обеих метрик.
     */
    setOutboxSource(source: (() => Promise<void>) | null): void;
}

/** Создаёт реестр экземпляра с меткой `service`, метриками процесса Node и метриками пакета (§3.2, AC-2.8). */
export function kitMetrics(options: { readonly service: string }): KitMetrics {
    assertServiceName(options.service, 'kitMetrics');
    const registry = new Registry();
    registry.setDefaultLabels({ service: options.service });
    collectDefaultMetrics({ register: registry });
    const registers = [registry];
    let outboxSource: (() => Promise<void>) | null = null;
    let outboxInFlight: Promise<void> | null = null;
    // registry.metrics() вызывает get() метрик параллельно: обе метрики outbox ждут один запрос.
    const collectOutbox = (): Promise<void> | undefined => {
        if (outboxSource === null) {
            return undefined;
        }
        outboxInFlight ??= outboxSource().finally(() => {
            outboxInFlight = null;
        });

        return outboxInFlight;
    };

    return {
        registry,
        outboxPending: new Gauge({
            name: 'verdeect_outbox_pending',
            help: 'Неотправленные строки outbox',
            registers,
            collect: collectOutbox,
        }),
        outboxLagSeconds: new Gauge({
            name: 'verdeect_outbox_lag_seconds',
            help: 'Возраст самой старой неотправленной строки outbox, с',
            registers,
            collect: collectOutbox,
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
        cleanupRuns: new Counter({
            name: 'verdeect_cleanup_runs_total',
            help: 'Проходы фоновой очистки по таблице и итогу (ok, partial, interrupted, error)',
            labelNames: ['table', 'result'] as const,
            registers,
        }),
        eventsSkipped: new Counter({
            name: 'verdeect_events_skipped_total',
            help: 'События с неподписанной версией подписанного типа, подтверждённые без обработки',
            labelNames: ['type', 'version'] as const,
            registers,
        }),
        setOutboxSource: (source) => {
            outboxSource = source;
        },
    };
}

/** Абсолютный путь к шаблону правил vmalert `alerts/verdeect-kit.rules.yml` внутри установленного пакета (§3.2). */
export const alertRulesTemplate: string = fileURLToPath(
    new URL('../../alerts/verdeect-kit.rules.yml', import.meta.url),
);
