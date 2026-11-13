// AC-4.14 (UC-7; prd.md §3.3а v1.26, KT-76 п. 4): @Idempotent({redact}) — поля верхнего уровня ответа заменяются на
// null только в хранилище; клиент получает исходное тело; повтор отдаёт сохранённую копию; массив и не объект — как есть;
// не простой объект (Date, Buffer, экземпляр класса) — как есть (KT-79); имена с путём — TypeError при объявлении.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Idempotent } from '../../../src/idempotency/idempotent.decorator.js';
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

async function storedBodies(): Promise<string[]> {
    const rows = await adminQuery<{ body: string | null }>(
        'select response_body::text as body from kit.idempotency_key',
    );

    return rows.map(({ body }) => body ?? '');
}

describe('UC-7: Idempotency-Key, redact', () => {
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

    it('AC-4.14: первый ответ содержит secret, в response_body хранилища подстроки секрета нет', async () => {
        const first = await post(stand, '/secret', { token, key: 'r-1' });
        const { secret } = first.json<{ secret: string }>();

        expect(first.statusCode).toBe(201);
        expect(secret).toMatch(/^sk_/);
        const bodies = await storedBodies();
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).not.toContain(secret);
        expect(JSON.parse(bodies[0] ?? 'null')).toEqual({ id: 1, secret: null });
    });

    it('AC-4.14: повтор — 201, тот же Location, secret: null, Idempotent-Replayed: true, обработчик вызван один раз', async () => {
        const first = await post(stand, '/secret', { token, key: 'r-2' });
        const second = await post(stand, '/secret', { token, key: 'r-2' });

        expect(second.statusCode).toBe(201);
        expect(second.headers.location).toBe(first.headers.location);
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.json()).toEqual({ id: 1, secret: null });
        expect(handlers.calls).toBe(1);
    });

    it('AC-4.14: ответ-массив сохраняется как есть', async () => {
        const first = await post(stand, '/secret-list', { token, key: 'r-3' });
        const second = await post(stand, '/secret-list', { token, key: 'r-3' });

        const bodies = await storedBodies();
        expect(JSON.parse(bodies[0] ?? 'null')).toEqual(first.json());
        expect(second.json()).toEqual(first.json());
        expect(handlers.calls).toBe(1);
    });

    it('AC-4.14: ответ не простой объект (экземпляр класса с toJSON) сохраняется как есть — повтор возвращает то же тело', async () => {
        const first = await post(stand, '/secret-stamp', { token, key: 'r-4' });
        const second = await post(stand, '/secret-stamp', { token, key: 'r-4' });

        expect(first.json()).toEqual({ at: '2026-11-13T12:00:00.001Z', secret: 'stamp' });
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.json()).toEqual(first.json());
        expect(handlers.calls).toBe(1);
    });

    it.each([[''], ['data.secret'], ['items[0]']])(
        'AC-4.14: redact с именем «%s» — TypeError «redact — только поля верхнего уровня» при объявлении @Idempotent',
        (name) => {
            expect(() => Idempotent({ redact: [name] })).toThrow(
                new TypeError('@Idempotent: redact — только поля верхнего уровня'),
            );
        },
    );
});
