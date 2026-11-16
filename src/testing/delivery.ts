// waitForDelivery (prd.md §3.8 стр. 190 v1.31, AC-5.13): первый итог доставки брокера события id в этом экземпляре.
// Загрузка модуля включает журнал итогов подписчика (флаг globalThis): production без /testing журнала не ведёт
// (NFR-4). KitSubscriber — динамический импорт: /testing не импортирует /messaging статически (AC-1.2).
import type { INestApplicationContext } from '@nestjs/common';
import { KIT_DELIVERY_LOG_FLAG } from '../internal/tokens.js';
import { TEST_TIMEOUT_SCALE } from './timeout-scale.js';

(globalThis as Record<symbol, unknown>)[KIT_DELIVERY_LOG_FLAG] = true;

/**
 * Ждёт первый итог доставки брокера события `messageId` подписчиком приложения `app` (§3.8): сразу, если доставка уже
 * завершилась, иначе до `timeoutMs × TEST_TIMEOUT_SCALE`. Для подписчика `dedupe: 'none'`, где строки inbox нет.
 * Учитывается только очередь `<svc>` этого экземпляра; итог `duplicate` не записывается.
 * @throws {Error} срок вышел — текст с `messageId`.
 */
export async function waitForDelivery(
    app: Pick<INestApplicationContext, 'get'>,
    messageId: string,
    options: { readonly timeoutMs: number },
): Promise<{
    /** `handled` — обработан, `retry` — повтор, `dlq` — в DLQ, `skipped` — версия не подписана. */
    readonly result: 'handled' | 'retry' | 'dlq' | 'skipped';
    /** Причина DLQ (`x-dlq-reason`) — только при `dlq`. */
    readonly reason?: string;
}> {
    const { KitSubscriber } = await import('../messaging/subscriber.js');
    const outcome = await app
        .get(KitSubscriber)
        .awaitOutcome(messageId, options.timeoutMs * TEST_TIMEOUT_SCALE);

    // duplicate в журнал брокера не пишется (KitSubscriber.recordOutcome): остальные итоги — те же.
    return outcome as Awaited<ReturnType<typeof waitForDelivery>>;
}
