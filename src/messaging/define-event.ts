// defineEvent (prd.md §3.4, AC-5.15): определение события каталога 01 §7.2 с признаком tenant. Эталона в сервисах нет —
// там схемы событий в @verdict/contracts без признака; формат type — каталог 01 §7.2.
import { z } from 'zod';

/** Признак тенанта события: `'required'` — у события всегда есть компания, `'none'` — событие без компании. */
export type KitEventTenant = 'required' | 'none';

/** Событие каталога: тип, версия, вид субъекта, признак тенанта, схема `data` (zod без `.strict()`). */
export interface KitEvent<
    TType extends string = string,
    TData extends z.ZodObject = z.ZodObject,
    TTenant extends KitEventTenant = KitEventTenant,
> {
    /** Тип `<service>.<entity>.<action>`. */
    readonly type: TType;
    /** Версия схемы `data`, целое ≥ 1. */
    readonly version: number;
    /** Вид субъекта (`subject.kind` конверта), например `company`. */
    readonly subject: string;
    /** Признак тенанта. */
    readonly tenant: TTenant;
    /** Схема `data`. */
    readonly data: TData;
}

const TYPE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$/;
const MAX_TYPE = 120;
const SUBJECT = /^[a-z][a-z0-9_]*$/;

/**
 * Определение события. `tenant` по умолчанию `'required'`. `data` — `z.object` без `.strict()`: новые поля событий
 * добавляются без мажора. Результат заморожен.
 * @throws {TypeError} `type` вне формата каталога, `version` не целое ≥ 1, `subject` вне `^[a-z][a-z0-9_]*$`, `tenant`
 * вне `required | none`, `data` strict.
 */
export function defineEvent<
    TType extends string,
    TData extends z.ZodObject,
    TTenant extends KitEventTenant = 'required',
>(definition: {
    readonly type: TType;
    readonly version: number;
    readonly subject: string;
    readonly tenant?: TTenant;
    readonly data: TData;
}): KitEvent<TType, TData, TTenant> {
    const { type, version, subject, data } = definition;
    const fail = (reason: string): never => {
        throw new TypeError(`defineEvent(${type}): ${reason}`);
    };
    if (!TYPE.test(type) || type.length > MAX_TYPE) {
        fail('type вне формата <service>.<entity>.<action>');
    }
    if (!Number.isInteger(version) || version < 1) {
        fail('version — целое ≥ 1');
    }
    if (!SUBJECT.test(subject)) {
        fail('subject вне ^[a-z][a-z0-9_]*$');
    }
    const tenant = definition.tenant ?? ('required' as TTenant);
    if (tenant !== 'required' && tenant !== 'none') {
        fail("tenant — 'required' или 'none'");
    }
    if (!(data instanceof z.ZodObject)) {
        fail('data — z.object');
    }
    if (data._zod.def.catchall instanceof z.ZodNever) {
        fail('data без .strict(): новые поля событий добавляются без мажора');
    }

    return Object.freeze({ type, version, subject, tenant, data });
}

/**
 * Ключ пары (`type`, `version`) события: реестры подписчика и `outbox.events` (§3.4 v1.26–v1.27, AC-5.22, AC-5.23).
 * @internal
 */
export function eventKey(event: { readonly type: string; readonly version: number }): string {
    return `${event.type}@${event.version}`;
}
