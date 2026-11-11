// Ошибки обработчика и отказ запуска /messaging (prd.md §3.4, AC-5.7, AC-5.15, AC-5.19). Эталон — O
// expected-message-error.ts, invalid-message.error.ts; MessagingStartupError — отказ запуска по образцу kit (П1, П8).
import type { StartupFailure } from '../observability/fail-startup.js';

const CODE = /^[A-Z][A-Z0-9_]*$/;
const MAX_REASON = 200;

/**
 * Ожидаемый отказ обработки (например, зависимость временно недоступна): `warn` и повтор через `<svc>.retry` до 5 раз,
 * затем DLQ с `x-dlq-reason` = `code`; в GlitchTip не отправляется. Сервис наследует класс со своим кодом.
 */
export abstract class ExpectedMessageError extends Error {
    /**
     * @param code Код отказа SCREAMING_SNAKE — значение `x-dlq-reason` после исчерпания повторов.
     * @param message Текст для лога, без ПДн.
     * @throws {TypeError} `code` не SCREAMING_SNAKE.
     */
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        if (!CODE.test(code)) {
            throw new TypeError(`ExpectedMessageError: код «${code}» не SCREAMING_SNAKE`);
        }
        this.name = new.target.name;
    }
}

/**
 * Сообщение нельзя обработать никогда — сразу в `<svc>.dlq` без повторов, `x-dlq-reason` = `reason`. В `reason` —
 * только пути полей и коды, без значений и ПДн; длиннее 200 символов обрезается.
 */
export class InvalidMessageError extends Error {
    /** Код ошибки. */
    readonly code = 'INVALID_MESSAGE';
    /** Причина отказа (≤ 200 символов) — значение `x-dlq-reason`. */
    readonly reason: string;

    /** @param reason Причина: пути полей и коды, без значений. */
    constructor(reason: string) {
        const trimmed = reason.slice(0, MAX_REASON);
        super(`сообщение отклонено: ${trimmed}`);
        this.reason = trimmed;
        this.name = 'InvalidMessageError';
    }
}

/** Коды отказа запуска /messaging. */
export type MessagingStartupCode = 'MESSAGING_TENANT_NOT_NULLABLE' | 'MESSAGING_RETRY_TTL_MISMATCH';

/**
 * Отказ запуска `/messaging` с кодом: `MESSAGING_TENANT_NOT_NULLABLE` — событие `tenant: 'none'` при NOT NULL `tenant`
 * outbox; `MESSAGING_RETRY_TTL_MISMATCH` — `<svc>.retry` объявлена с другим TTL. `failStartup` пишет `startupCode` и
 * `startupDetails()` — только имена (тип события, таблица, очередь), без значений окружения.
 */
export class MessagingStartupError extends Error implements StartupFailure {
    /**
     * @param startupCode Код отказа.
     * @param message Текст для лога.
     * @param details Имена (тип события, таблица, очередь).
     */
    constructor(
        readonly startupCode: MessagingStartupCode,
        message: string,
        private readonly details: Readonly<Record<string, string>>,
    ) {
        super(message);
        this.name = 'MessagingStartupError';
    }

    /** Подробности отказа для лога: только имена. */
    startupDetails(): Readonly<Record<string, string>> {
        return this.details;
    }
}
