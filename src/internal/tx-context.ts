// Связь транзакции Db с её DbContext (prd.md §3.4 OutboxStore.add — tenant, actor, traceId из DbContext; П4 плана E5).
// Внутренний модуль: database пишет, messaging читает — без импорта значений database (AC-1.2).
import type { DbContext } from '../database/tenant.js';

const contexts = new WeakMap<object, DbContext>();

/** Связывает транзакцию `Db.transaction`/`Db.read` с её контекстом; запись живёт, пока жив `tx`. */
export function bindTxContext(tx: object, ctx: DbContext): void {
    contexts.set(tx, ctx);
}

/** Контекст транзакции `Db`; для `readGlobal` и чужого объекта — `undefined`. */
export function txContextOf(tx: object): DbContext | undefined {
    return contexts.get(tx);
}
