// Ключи метаданных декораторов: Idempotent → @Api без цикла http ↔ idempotency (ARCHITECTURE.md; prd.md §3.3а, §3.5).

/** Ключ метаданных `@Idempotent` на методе обработчика; значение — `KitIdempotentOptions`. */
export const IDEMPOTENT_METADATA = 'verdeect-kit:idempotent';

/** Опции `@Idempotent` (prd.md §3.3а). */
export interface KitIdempotentOptions {
    /** Ключ `Idempotency-Key` обязателен: без него — 400 `IDEMPOTENCY_KEY_REQUIRED`. По умолчанию `false`. */
    readonly required?: boolean;
    /**
     * Путь поля тела через точку, из которого берётся тенант области для служебного принципала
     * (`service`); у пользователя и агента тенант — только из принципала, поле игнорируется.
     */
    readonly tenantFromBody?: string;
    /**
     * Имена полей верхнего уровня ответа, которые в хранилище заменяются на `null` (одноразовые секреты): клиент
     * получает исходное тело, повтор — сохранённую копию с `null`. Один уровень, без путей; ответ-массив или не
     * объект сохраняется как есть.
     */
    readonly redact?: readonly string[];
}
