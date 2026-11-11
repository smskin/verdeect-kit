// Конверт события 01 §7.1 (prd.md §3.4, AC-5.2, AC-5.7, AC-5.15). Эталон — O/P/I event-envelope.ts (схема одинаковая);
// по PRD все поля §7.1 обязательны, tenant/actor/traceId — nullable (П21), subject — {kind, id}.
import { z } from 'zod';
import type { KitEvent } from './define-event.js';

/** Схема конверта события `01` §7.1 (не strict: новые поля конверта не ломают подписчиков). */
export const EnvelopeSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    version: z.number().int().min(1),
    occurredAt: z.iso.datetime({ offset: true }),
    tenant: z.string().min(1).nullable(),
    actor: z.record(z.string(), z.unknown()).nullable(),
    subject: z.object({ kind: z.string().min(1), id: z.string().min(1) }),
    data: z.record(z.string(), z.unknown()),
    traceId: z.string().min(1).nullable(),
});

type TenantOf<E extends KitEvent> = [E['tenant']] extends ['none']
    ? null
    : [E['tenant']] extends ['required']
      ? string
      : string | null;

/** Конверт события `E`: `tenant` — `string` для `'required'`, `null` для `'none'`; `data` — выход схемы события. */
export type Envelope<E extends KitEvent = KitEvent> = Omit<
    z.output<typeof EnvelopeSchema>,
    'type' | 'data' | 'tenant' | 'version'
> & {
    readonly type: E['type'];
    readonly version: number;
    readonly data: z.output<E['data']>;
    readonly tenant: TenantOf<E>;
};

/** Поля строки outbox, из которых relay собирает конверт. */
export interface OutboxRowForEnvelope {
    /** id события. */
    readonly id: string;
    /** Тип. */
    readonly type: string;
    /** Версия. */
    readonly version: number;
    /** Время события. */
    readonly occurredAt: Date;
    /** Тенант. */
    readonly tenant: string | null;
    /** Актор `DbContext`. */
    readonly actor: Record<string, unknown> | null;
    /** Вид субъекта — из `defineEvent.subject`. */
    readonly subjectKind: string;
    /** id субъекта. */
    readonly subjectId: string;
    /** Данные. */
    readonly data: Record<string, unknown>;
    /** traceId. */
    readonly traceId: string | null;
}

/** Конверт из строки outbox (relay). */
export function buildEnvelope(row: OutboxRowForEnvelope): Envelope {
    return {
        id: row.id,
        type: row.type,
        version: row.version,
        occurredAt: row.occurredAt.toISOString(),
        tenant: row.tenant,
        actor: row.actor,
        subject: { kind: row.subjectKind, id: row.subjectId },
        data: row.data,
        traceId: row.traceId,
    };
}

/** Итог разбора тела сообщения: `fields` — верхнеуровневые имена полей с ошибкой, без значений. */
export type ParsedEnvelope =
    | { readonly ok: true; readonly envelope: Envelope }
    | {
          readonly ok: false;
          readonly reason: 'not-json' | 'envelope';
          readonly fields: readonly string[];
      };

/** Разбор тела входящего сообщения по `EnvelopeSchema`. */
export function parseEnvelope(content: Buffer): ParsedEnvelope {
    let raw: unknown;
    try {
        raw = JSON.parse(content.toString('utf8'));
    } catch {
        return { ok: false, reason: 'not-json', fields: [] };
    }
    const result = EnvelopeSchema.safeParse(raw);
    if (!result.success) {
        const fields = result.error.issues.map((issue) =>
            issue.path.length === 0 ? '(root)' : String(issue.path[0]),
        );

        return { ok: false, reason: 'envelope', fields: [...new Set(fields)] };
    }

    return { ok: true, envelope: result.data };
}

/** Тенант конверта нарушает признак события: `'required'` без тенанта или `'none'` с тенантом (AC-5.15). */
export function tenantViolation(
    event: KitEvent,
    envelope: { readonly tenant: string | null },
): boolean {
    return event.tenant === 'required' ? envelope.tenant === null : envelope.tenant !== null;
}
