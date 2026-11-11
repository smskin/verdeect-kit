// Решение о повторной доставке (prd.md §3.4 «5 повторов по x-death», AC-5.7): сколько раз сообщение уже отклонялось из
// основной очереди и прошло <svc>.retry. Эталон — O redelivery.ts; из B — очередь параметром.
import { MAX_RETRIES } from './topology.js';

/** Решение после сбоя текущей доставки. */
export type RedeliveryDecision = 'retry' | 'dlq';

interface XDeathEntry {
    readonly queue?: unknown;
    readonly reason?: unknown;
    readonly count?: unknown;
}

/** Сколько раз сообщение уходило из `queue` с `reason: rejected` (`x-death`); нет заголовка — 0. */
export function retryCount(headers: Record<string, unknown> | undefined, queue: string): number {
    const deaths = headers?.['x-death'];
    if (!Array.isArray(deaths)) {
        return 0;
    }
    const rejected = (deaths as XDeathEntry[]).find(
        (entry) => entry.queue === queue && entry.reason === 'rejected',
    );
    const count = Number(rejected?.count ?? 0);

    return Number.isFinite(count) ? count : 0;
}

/** Повторить, пока повторов меньше MAX_RETRIES, иначе — DLQ. */
export function decideRedelivery(
    headers: Record<string, unknown> | undefined,
    queue: string,
): RedeliveryDecision {
    return retryCount(headers, queue) < MAX_RETRIES ? 'retry' : 'dlq';
}
