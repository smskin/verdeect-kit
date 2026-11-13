// AC-4.14 (UC-7; prd.md §3.3а v1.28, §6): повтор отдаёт тело в той же сериализации и с тем же Content-Type, что первый
// ответ, при любом теле (объект, массив, строка, число, toJSON, свой Content-Type, пустое); content_type хранится;
// запись без content_type (до колонки) — повтор как раньше. JSON-тела сравниваются после JSON.parse (порядок ключей jsonb,
// KT-87), прочие — побайтово.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminQuery } from '../../support/database.js';
import {
    createStand,
    handlers,
    post,
    resetHandlers,
    truncateIdempotency,
    userToken,
    type IdempotencyStand,
} from './support.js';

const CASES = [
    { name: 'объект', url: '/echo', json: true },
    { name: 'массив', url: '/secret-list', json: true },
    { name: 'экземпляр с toJSON', url: '/stamp', json: true },
    { name: 'строка', url: '/text', json: false },
    { name: 'число', url: '/number', json: false },
    { name: 'строка с Content-Type text/csv', url: '/csv', json: false },
    { name: 'пустой ответ', url: '/empty', json: false },
] as const;

async function storedContentType(): Promise<(string | null)[]> {
    const rows = await adminQuery<{ content_type: string | null }>(
        'select content_type from kit.idempotency_key',
    );

    return rows.map(({ content_type }) => content_type);
}

describe('UC-7: Idempotency-Key, Content-Type повтора', () => {
    let stand: IdempotencyStand;
    let token: string;

    beforeAll(async () => {
        stand = await createStand();
        token = await userToken(stand);
    });

    afterAll(async () => {
        await stand.close();
    });

    beforeEach(async () => {
        resetHandlers();
        await truncateIdempotency();
    });

    it.each(CASES)(
        'AC-4.14: $name — повтор совпадает с первым ответом по телу и Content-Type',
        async ({ url, json }) => {
            const first = await post(stand, url, { token, key: `ct-${url}` });
            const second = await post(stand, url, { token, key: `ct-${url}` });

            expect(second.statusCode).toBe(first.statusCode);
            expect(second.headers['idempotent-replayed']).toBe('true');
            expect(second.headers['content-type']).toBe(first.headers['content-type']);
            if (json) {
                expect(JSON.parse(second.payload)).toEqual(JSON.parse(first.payload));
            } else {
                expect(second.payload).toBe(first.payload);
            }
            expect(handlers.calls).toBe(1);
        },
    );

    it('AC-4.14: строка "abc" — повтор отдаёт ровно abc без кавычек JSON и text/plain первого ответа', async () => {
        const first = await post(stand, '/abc', { token, key: 'ct-abc' });
        const second = await post(stand, '/abc', { token, key: 'ct-abc' });

        expect(first.rawPayload.equals(Buffer.from('abc'))).toBe(true);
        expect(second.rawPayload.equals(Buffer.from('abc'))).toBe(true);
        expect(first.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(second.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(handlers.calls).toBe(1);
    });

    it('AC-4.14: content_type хранится — text/plain у строки, пусто у пустого ответа', async () => {
        await post(stand, '/text', { token, key: 'ct-store-text' });
        expect(await storedContentType()).toEqual(['text/plain; charset=utf-8']);

        await truncateIdempotency();
        await post(stand, '/empty', { token, key: 'ct-store-empty' });
        expect(await storedContentType()).toEqual(['']);
    });

    it('AC-4.14: запись без content_type (до колонки) — повтор как раньше', async () => {
        await post(stand, '/number', { token, key: 'ct-legacy' });
        await adminQuery('update kit.idempotency_key set content_type = null');
        const second = await post(stand, '/number', { token, key: 'ct-legacy' });

        expect(second.statusCode).toBe(201);
        expect(second.payload).toBe('42');
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(handlers.calls).toBe(1);
    });
});
