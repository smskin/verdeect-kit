// Итог прохода очистки (prd.md §3.3а, §3.4, AC-9.5; KT-22 п. 5): общий для очистки идемпотентности и сообщений —
// messaging не импортирует idempotency (ARCHITECTURE). Перенос resultOf из kit-idempotency.module.ts (E4).

/** Итог прохода — метка `result` метрики `verdeect_cleanup_runs_total` (без `error`). */
export type CleanupResult = 'ok' | 'partial' | 'interrupted';

/**
 * `ok` — удалять больше нечего; `partial` — упёрся в `maxBatches`, записи старше срока остались; `interrupted` —
 * остановлен (выкат), алерт `VerdeectCleanupFailing` его не учитывает.
 */
export function resultOf(complete: boolean, batches: number, maxBatches: number): CleanupResult {
    if (complete) {
        return 'ok';
    }

    return batches === maxBatches ? 'partial' : 'interrupted';
}
