// OutboxStore (prd.md §3.4, §6, UC-5, AC-5.1, AC-5.2, AC-5.15). Эталон — O outbox-store.ts; по PRD — id = newId('evt') в
// коде, tenant/actor/traceId из DbContext (txContextOf), проверка data и признака tenant до записи, afterCommit →
// relay.wake(); SQL-триггеров нет (P0). Запросы relay и очистки — построителем Drizzle по объекту таблицы (AC-9.4).
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, DbTx } from '../database/db.js';
import { newId, ulid } from '../internal/ids.js';
import { txContextOf } from '../internal/tx-context.js';
import type { KitEvent } from './define-event.js';
import { nestLog, type MessagingLog } from './rabbit-connection.js';
import type { KitOutboxTable } from './tables.js';

/** Предел `last_error`. */
const LAST_ERROR_MAX = 500;

/** Шаг опроса `awaitPublished`, мс. */
const AWAIT_POLL_MS = 100;

/** Строка, взятая relay. */
export interface OutboxClaimedRow {
    /** id события. */
    readonly id: string;
    /** Тип. */
    readonly type: string;
    /** Версия. */
    readonly version: number;
    /** Тенант. */
    readonly tenant: string | null;
    /** id субъекта. */
    readonly subjectId: string;
    /** Актор. */
    readonly actor: Record<string, unknown>;
    /** traceId. */
    readonly traceId: string;
    /** Данные. */
    readonly data: Record<string, unknown>;
    /** Время события. */
    readonly occurredAt: Date;
    /** Неудачных публикаций. */
    readonly attempts: number;
}

/** Зависимости `OutboxStore` (внутренние). */
export interface OutboxStoreDeps {
    /** `Db` сервиса. */
    readonly db: Db;
    /** Таблица outbox. */
    readonly table: KitOutboxTable;
    /** События `outbox.events` модуля по type. */
    readonly events: ReadonlyMap<string, KitEvent>;
    /** Пробуждение relay после COMMIT. */
    readonly wake: () => void;
    /** Логгер. */
    readonly log?: MessagingLog;
}

/**
 * Запись событий в outbox в транзакции сервиса (§3.4): `add(tx, Event, {subjectId, data})`. Строка видна relay после
 * `COMMIT` вместе с изменением домена; откат транзакции — ни изменения, ни события.
 */
export class OutboxStore {
    private readonly log: MessagingLog;

    /** @internal Создаёт KitMessagingModule. */
    constructor(private readonly deps: OutboxStoreDeps) {
        this.log = deps.log ?? nestLog('OutboxStore');
    }

    /**
     * Добавляет событие в outbox транзакции `tx` (`Db.transaction`): `tenant`, `actor`, `traceId` — из `DbContext`,
     * `id` — `evt_` + ULID; после `COMMIT` relay публикует его без ожидания опроса. Любая ошибка — исключение до записи:
     * транзакция сервиса откатывается.
     * @returns id события.
     * @throws {TypeError} событие не из `outbox.events`, `tx` не из `Db.transaction`, признак `tenant` нарушен, пустой
     * `subjectId`, `data` не по схеме (в тексте — пути полей без значений).
     * @throws {AfterCommitInReadOnlyError} `tx` из `Db.read`.
     */
    async add<E extends KitEvent>(
        tx: DbTx,
        event: E,
        input: { readonly subjectId: string; readonly data: z.input<E['data']> },
    ): Promise<string> {
        const { type } = event;
        if (this.deps.events.get(type) !== event) {
            throw new TypeError(
                `OutboxStore.add: событие ${type} не объявлено в KitMessagingModule.forRoot({outbox: {events}})`,
            );
        }
        const ctx = txContextOf(tx);
        if (ctx === undefined) {
            throw new TypeError('OutboxStore.add: tx — не транзакция Db.transaction');
        }
        const tenant = ctx.tenant ?? '';
        if (event.tenant === 'required' && tenant === '') {
            throw new TypeError(
                `OutboxStore.add: событие ${type} требует компанию (tenant: 'required'), в DbContext тенанта нет`,
            );
        }
        if (event.tenant === 'none' && tenant !== '') {
            throw new TypeError(
                `OutboxStore.add: событие ${type} без компании (tenant: 'none'), а в DbContext тенант задан`,
            );
        }
        if (typeof input.subjectId !== 'string' || input.subjectId === '') {
            throw new TypeError(`OutboxStore.add: событие ${type} — пустой subjectId`);
        }
        const parsed = event.data.safeParse(input.data);
        if (!parsed.success) {
            const paths = [
                ...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)')),
            ];
            throw new TypeError(
                `OutboxStore.add: data события ${type} не по схеме: ${paths.join(', ')}`,
            );
        }
        // До INSERT: read-only транзакция отклоняется здесь (AfterCommitInReadOnlyError), а не ошибкой 25006.
        this.deps.db.afterCommit(tx, () => {
            this.deps.wake();
        });
        const id = newId('evt');
        await tx.insert(this.deps.table).values({
            id,
            tenant: event.tenant === 'none' ? null : tenant,
            type,
            version: event.version,
            subjectId: input.subjectId,
            actor: { ...ctx.actor },
            traceId: ctx.traceId,
            data: parsed.data as Record<string, unknown>,
        });
        this.log.debug({ type, id }, 'outbox: строка добавлена');

        return id;
    }

    /** @internal Пачка неопубликованных по `seq` под `FOR UPDATE SKIP LOCKED` (relay). */
    async claimBatch(tx: DbTx, limit: number): Promise<OutboxClaimedRow[]> {
        const t = this.deps.table;

        return tx
            .select({
                id: t.id,
                type: t.type,
                version: t.version,
                tenant: t.tenant,
                subjectId: t.subjectId,
                actor: t.actor,
                traceId: t.traceId,
                data: t.data,
                occurredAt: t.occurredAt,
                attempts: t.attempts,
            })
            .from(t)
            .where(isNull(t.publishedAt))
            .orderBy(t.seq)
            .limit(limit)
            .for('update', { skipLocked: true });
    }

    /** @internal Отметка опубликованных. */
    async markPublished(tx: DbTx, ids: readonly string[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }
        const t = this.deps.table;
        await tx
            .update(t)
            .set({ publishedAt: sql`now()` })
            .where(inArray(t.id, [...ids]));
    }

    /** @internal Неудача публикации: `attempts + 1`, `last_error` ≤ 500; возвращает новое `attempts`. */
    async markFailed(tx: DbTx, id: string, error: string): Promise<number> {
        const t = this.deps.table;
        const [row] = await tx
            .update(t)
            .set({ attempts: sql`${t.attempts} + 1`, lastError: error.slice(0, LAST_ERROR_MAX) })
            .where(and(eq(t.id, id), isNull(t.publishedAt)))
            .returning({ attempts: t.attempts });

        return row?.attempts ?? 0;
    }

    /**
     * Ждёт, пока relay реплики опубликует строки (опрос `published_at` раз в 100 мс): по `id` или по `traceId`. По сроку
     * исключения нет — `pending > 0`. Работает при любом `listen`; сам не публикует (порядок по `seq` — у relay).
     * @throws {TypeError} пустой `traceId` или `timeoutMs` не целое ≥ 0.
     */
    async awaitPublished(
        target: readonly string[] | { readonly traceId: string },
        options: { readonly timeoutMs: number },
    ): Promise<{ readonly published: number; readonly pending: number }> {
        const { timeoutMs } = options;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
            throw new TypeError('OutboxStore.awaitPublished: timeoutMs — целое ≥ 0');
        }
        const t = this.deps.table;
        let where;
        if (Array.isArray(target)) {
            if (target.length === 0) {
                return { published: 0, pending: 0 };
            }
            where = inArray(t.id, [...(target as readonly string[])]);
        } else {
            const { traceId } = target as { readonly traceId: string };
            if (typeof traceId !== 'string' || traceId === '') {
                throw new TypeError('OutboxStore.awaitPublished: пустой traceId');
            }
            where = eq(t.traceId, traceId);
        }
        const ctx = { tenant: null, traceId: ulid(), actor: { channel: 'system' } } as const;
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const counts = await this.deps.db.transaction(ctx, async (tx) => {
                const [row] = await tx
                    .select({
                        published: sql<number>`count(*) filter (where ${t.publishedAt} is not null)::int`,
                        pending: sql<number>`count(*) filter (where ${t.publishedAt} is null)::int`,
                    })
                    .from(t)
                    .where(where);

                return { published: row?.published ?? 0, pending: row?.pending ?? 0 };
            });
            if (counts.pending === 0 || Date.now() >= deadline) {
                return counts;
            }
            await sleep(Math.min(AWAIT_POLL_MS, Math.max(0, deadline - Date.now())));
        }
    }

    /** @internal Число неопубликованных и возраст старейшей, с (метрики). */
    async stats(tx: DbTx): Promise<{ readonly pending: number; readonly lag: number }> {
        const t = this.deps.table;
        const { rows } = await tx.execute<{ pending: number; lag: number }>(
            sql`select count(*)::int as pending,
                coalesce(extract(epoch from now() - min(${t.occurredAt}))::float8, 0) as lag
                from ${t} where ${t.publishedAt} is null`,
        );

        return { pending: rows[0]?.pending ?? 0, lag: Math.max(0, rows[0]?.lag ?? 0) };
    }
}
