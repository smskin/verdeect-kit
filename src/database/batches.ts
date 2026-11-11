// deleteInBatches (prd.md §3.3, AC-4.11, UC-8, UC-9). Эталон — O batches.ts (выход при неполной пачке, maxBatches,
// shouldContinue); I — отслеживание идущих пачек в Db. По PRD: пачка — Db.transaction с системным контекстом, SQL
// возвращает одну строку с колонкой deleted.
import { Logger } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { ulid } from '../internal/ids.js';
import { isStopping, trackBatchRun, transactionOn, type Db, type DbTx } from './db.js';
import type { PoolClient } from './pg.js';
import type { DbContext } from './tenant.js';

/** Опции `deleteInBatches`. */
export interface KitDeleteInBatchesOptions {
    /** `Db` сервиса: пачки — его транзакции, остановка `Db` прекращает новые пачки. */
    readonly db: Db;
    /**
     * SQL пачки по её размеру; результат — одна строка с целой колонкой `deleted`, например
     * `WITH d AS (DELETE … LIMIT n RETURNING 1) SELECT count(*)::int AS deleted FROM d` или вызов функции
     * `SECURITY DEFINER` (строгий RLS скрывает строки компаний от системного контекста).
     */
    readonly sql: (batchSize: number) => SQL;
    /** Размер пачки, целое ≥ 1. */
    readonly batchSize: number;
    /** Предел пачек за проход, целое ≥ 1. */
    readonly maxBatches: number;
    /** `false` — следующая пачка не начинается, текущая дорабатывает. */
    readonly shouldContinue?: () => boolean;
    /**
     * Соединение для пачек — обычно соединение блокировки из `runExclusive(db, key, (connection) => …)`: второе
     * соединение пула не берётся. Без него — транзакция `Db` на соединении основного пула.
     */
    readonly connection?: PoolClient;
}

/** Итог прохода `deleteInBatches`. */
export interface KitDeleteInBatchesResult {
    /** Удалено строк. */
    readonly deleted: number;
    /** Выполнено пачек. */
    readonly batches: number;
    /** `true` — проход закончился неполной пачкой; `false` — остановлен maxBatches, shouldContinue или остановкой Db. */
    readonly complete: boolean;
}

const logger = new Logger('deleteInBatches');

function assertPositiveInt(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`deleteInBatches: ${name} — целое ≥ 1`);
    }
}

function deletedOf(rows: readonly unknown[]): number {
    const value = (rows[0] as { deleted?: unknown } | undefined)?.deleted;

    return typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
        ? Number(value)
        : 0;
}

async function runBatches(options: KitDeleteInBatchesOptions): Promise<KitDeleteInBatchesResult> {
    const ctx: DbContext = { tenant: null, traceId: ulid(), actor: { channel: 'system' } };
    let deleted = 0;
    let batches = 0;
    while (
        batches < options.maxBatches &&
        !isStopping(options.db) &&
        (options.shouldContinue?.() ?? true)
    ) {
        const batch = (tx: DbTx) => tx.execute(options.sql(options.batchSize));
        const result =
            options.connection === undefined
                ? await options.db.transaction(ctx, batch)
                : await transactionOn(options.db, options.connection, ctx, batch);
        const count = deletedOf(result.rows);
        batches += 1;
        deleted += count;
        logger.debug({ batch: batches, deleted: count }, 'deleteInBatches: пачка');
        if (count < options.batchSize) {
            return { deleted, batches, complete: true };
        }
    }

    return { deleted, batches, complete: false };
}

/**
 * Удаление пачками: транзакция на пачку, до неполной пачки или `maxBatches` (AC-4.11). Остановка `Db` (шаг 3) ждёт
 * текущую пачку, новая не начинается.
 * @throws {RangeError} `batchSize` или `maxBatches` не целое ≥ 1.
 */
export function deleteInBatches(
    options: KitDeleteInBatchesOptions,
): Promise<KitDeleteInBatchesResult> {
    assertPositiveInt(options.batchSize, 'batchSize');
    assertPositiveInt(options.maxBatches, 'maxBatches');

    return trackBatchRun(options.db, runBatches(options));
}
