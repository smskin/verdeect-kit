// inbox подписчика (prd.md §3.4 «inbox занимается в той же транзакции до обработчика», §6, AC-5.6). Эталон — O
// inbox-guard.ts: insert … on conflict do nothing; параллельная доставка того же id ждёт первую транзакцию (СУБД).
import type { DbTx } from '../database/db.js';
import type { KitInboxTable } from './tables.js';

/** Занимает `id` события в транзакции обработчика; `false` — уже обработано (`duplicate`). */
export async function claimInbox(
    tx: DbTx,
    table: KitInboxTable,
    id: string,
    type: string,
): Promise<boolean> {
    const rows = await tx
        .insert(table)
        .values({ id, type })
        .onConflictDoNothing()
        .returning({ id: table.id });

    return rows.length > 0;
}
