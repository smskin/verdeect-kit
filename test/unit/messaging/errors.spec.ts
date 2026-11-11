// AC-5.7, AC-5.15, AC-5.19 (U): ExpectedMessageError, InvalidMessageError, MessagingStartupError (prd.md §3.4);
// src/messaging/errors.ts. Эталон — O expected-message-error.ts, invalid-message.error.ts.
import { describe, expect, it } from 'vitest';
import {
    ExpectedMessageError,
    InvalidMessageError,
    MessagingStartupError,
} from '../../../src/messaging/errors.js';

class DependencyDown extends ExpectedMessageError {
    constructor() {
        super('DEPENDENCY_DOWN', 'зависимость недоступна');
    }
}

describe('UC-6: ошибки обработчика', () => {
    it('AC-5.7: ExpectedMessageError — code SCREAMING_SNAKE, name подкласса', () => {
        const error = new DependencyDown();

        expect(error.code).toBe('DEPENDENCY_DOWN');
        expect(error.name).toBe('DependencyDown');
        expect(error).toBeInstanceOf(ExpectedMessageError);
        expect(() => new (class extends ExpectedMessageError {})('bad-code', 'x')).toThrow(
            TypeError,
        );
    });

    it('AC-5.7: InvalidMessageError — code INVALID_MESSAGE, reason ≤ 200', () => {
        const error = new InvalidMessageError('x'.repeat(300));

        expect(error.code).toBe('INVALID_MESSAGE');
        expect(error.reason).toHaveLength(200);
        expect(error.name).toBe('InvalidMessageError');
        expect(new InvalidMessageError('data.name').message).toBe('сообщение отклонено: data.name');
    });

    it('§3.4: MessagingStartupError реализует StartupFailure (startupCode, startupDetails)', () => {
        const error = new MessagingStartupError('MESSAGING_TENANT_NOT_NULLABLE', 'отказ', {
            event: 'kit.a.b',
        });

        expect(typeof error.startupCode).toBe('string');
        expect(typeof error.startupDetails).toBe('function');
        expect(error.startupDetails()).toEqual({ event: 'kit.a.b' });
    });
});
