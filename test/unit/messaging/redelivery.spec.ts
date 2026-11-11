// AC-5.7 (UC-6): повторы по x-death своей очереди — retryCount, decideRedelivery (prd.md §3.4). Эталон — O
// redelivery.spec.ts; из B — очередь параметром.
import { describe, expect, it } from 'vitest';
import { decideRedelivery, retryCount } from '../../../src/messaging/redelivery.js';

const death = (queue: string, reason: string, count: unknown): Record<string, unknown> => ({
    'x-death': [{ queue, reason, count }],
});

describe('UC-6: повторная доставка', () => {
    it('AC-5.7: retryCount — запись x-death своей очереди с reason rejected', () => {
        expect(retryCount(death('kit', 'rejected', 3), 'kit')).toBe(3);
        expect(
            retryCount(
                {
                    'x-death': [
                        { queue: 'kit.retry', reason: 'expired', count: 3 },
                        { queue: 'kit', reason: 'rejected', count: 2 },
                    ],
                },
                'kit',
            ),
        ).toBe(2);
    });

    it('AC-5.7: чужая очередь / expired / нечисло / нет заголовка → 0', () => {
        expect(retryCount(death('other', 'rejected', 3), 'kit')).toBe(0);
        expect(retryCount(death('kit', 'expired', 3), 'kit')).toBe(0);
        expect(retryCount(death('kit', 'rejected', 'x'), 'kit')).toBe(0);
        expect(retryCount(undefined, 'kit')).toBe(0);
        expect(retryCount({ 'x-death': 'bad' }, 'kit')).toBe(0);
    });

    it('AC-5.7: decideRedelivery — 4 → retry, 5 → dlq', () => {
        expect(decideRedelivery(death('kit', 'rejected', 4), 'kit')).toBe('retry');
        expect(decideRedelivery(death('kit', 'rejected', 5), 'kit')).toBe('dlq');
    });
});
