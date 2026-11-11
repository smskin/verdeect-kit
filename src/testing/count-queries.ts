// countQueries (prd.md §3.8, AC-4.15, UC-14): подсчёт запросов пула за время fn — обёртка query выданных клиентов.
// pg не импортируется: пул — структурный тип.

/** Клиент пула с методом `query` (`pg.PoolClient`). */
interface CountableClient {
    query: (...args: never[]) => unknown;
}

/** Пул с событием `acquire` (`pg.Pool`). */
export interface KitCountablePool {
    /** Подписка на выдачу клиента. */
    on(event: 'acquire', listener: (client: CountableClient) => void): unknown;
    /** Отписка. */
    off(event: 'acquire', listener: (client: CountableClient) => void): unknown;
}

function textOf(query: unknown): string {
    if (typeof query === 'string') {
        return query;
    }
    const text = (query as { text?: unknown } | null)?.text;

    return typeof text === 'string' ? text : String(query);
}

/**
 * Считает все запросы пула за время `fn` (по порядку, текст SQL без параметров). Параллельная нагрузка на тот же пул
 * попадёт в счёт; запросы, начатые до вызова, — нет. Методы клиентов восстанавливаются после.
 */
export async function countQueries<T>(
    pool: KitCountablePool,
    fn: () => Promise<T>,
): Promise<{ readonly result: T; readonly count: number; readonly queries: readonly string[] }> {
    const queries: string[] = [];
    // undefined — query был методом прототипа: восстановление снимает собственное свойство.
    const wrapped = new Map<CountableClient, CountableClient['query'] | undefined>();
    const onAcquire = (client: CountableClient): void => {
        if (wrapped.has(client)) {
            return;
        }
        const original = client.query;
        wrapped.set(client, Object.hasOwn(client, 'query') ? original : undefined);
        // boundary: обёртка сохраняет все перегрузки query pg (текст, конфиг, обратный вызов).
        client.query = ((...args: never[]) => {
            queries.push(textOf(args[0]));

            return original.apply(client, args);
        }) as CountableClient['query'];
    };
    pool.on('acquire', onAcquire);
    try {
        const result = await fn();

        return { result, count: queries.length, queries: [...queries] };
    } finally {
        pool.off('acquire', onAcquire);
        for (const [client, original] of wrapped) {
            if (original === undefined) {
                delete (client as Partial<CountableClient>).query;
            } else {
                client.query = original;
            }
        }
    }
}
