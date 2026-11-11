// runExclusive (prd.md §3.3, AC-4.12, UC-9): pg_try_advisory_lock на выделенном соединении основного пула. Эталон O
// job-lock (Redis) не переносится — по PRD advisory lock.
import { Logger } from '@nestjs/common';
import { sanitizeError } from '../observability/sanitize-error.js';
import { mainPoolOf, withPoolClient, type Db } from './db.js';
import type { PoolClient } from './pg.js';

const logger = new Logger('runExclusive');

/**
 * `fn` выполняется не больше чем в одной реплике одновременно: блокировка `pg_try_advisory_lock(hashtextextended(key,
 * 0))` без ожидания; занято — `{ran: false}`. Блокировка держит одно соединение основного пула; `fn` получает его
 * аргументом — работа на нём (например, `deleteInBatches({connection})`) не берёт второе соединение, поэтому
 * достаточно `DB_POOL_MAX = 1` (KT-22 п. 4). Транзакции `fn` через `Db` берут другие соединения пула.
 * @throws {TypeError} пустой `key`.
 */
export async function runExclusive<T>(
    db: Db,
    key: string,
    fn: (connection: PoolClient) => Promise<T>,
): Promise<{ readonly ran: true; readonly result: T } | { readonly ran: false }> {
    if (key === '') {
        throw new TypeError('runExclusive: пустой ключ');
    }

    return withPoolClient(mainPoolOf(db), async (client) => {
        const { rows } = await client.query<{ locked: boolean }>(
            'select pg_try_advisory_lock(hashtextextended($1, 0)) as locked',
            [key],
        );
        if (rows[0]?.locked !== true) {
            logger.debug({ key }, 'runExclusive: занято');

            return { ran: false } as const;
        }
        try {
            return { ran: true, result: await fn(client) } as const;
        } finally {
            try {
                await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);
            } catch (error) {
                // Сломанный клиент закрывается release(error) — блокировка сеанса снимется вместе с ним.
                logger.warn(
                    { key, err: sanitizeError(error) },
                    'runExclusive: снять блокировку не удалось',
                );
                client.emit('error', error instanceof Error ? error : new Error('unlock'));
            }
        }
    });
}
