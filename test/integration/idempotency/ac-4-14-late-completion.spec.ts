// AC-4.14 (UC-7): поздняя попытка идемпотентности — первый запрос дольше 5 мин, повтор перехватил строку и завершился,
// первый завершается поздно: ответ повтора не перезаписан, warn и verdeect_idempotency_late_completions_total{scope} +1,
// scope — шаблон маршрута Fastify без значений параметров (prd.md §3.3а, §3.2 v1.31).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminQuery } from '../../support/database.js';
import {
    closeGate,
    createStand,
    handlers,
    nextEntry,
    post,
    resetHandlers,
    truncateIdempotency,
    userToken,
    type IdempotencyStand,
} from './support.js';

describe('UC-7: поздняя попытка идемпотентности', () => {
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

    it('AC-4.14: попытка, чью блокировку перехватил повтор, завершается: ответ повтора не перезаписан, verdeect_idempotency_late_completions_total{scope="<шаблон маршрута>"} +1, значения параметра пути в метке нет', async () => {
        const releaseFirst = closeGate();
        const entered = nextEntry();
        const first = post(stand, '/items/v-42', { token, key: 'k-late' });
        await entered;
        await adminQuery(
            "update kit.idempotency_key set created_at = now() - interval '6 minutes' where key = 'k-late'",
        );
        handlers.gate = null;

        const second = await post(stand, '/items/v-42', { token, key: 'k-late' });
        releaseFirst();
        await first;
        const replay = await post(stand, '/items/v-42', { token, key: 'k-late' });
        const { values } = await stand.metrics.idempotencyLateCompletions.get();

        expect(second.statusCode).toBe(201);
        expect(replay.headers['idempotent-replayed']).toBe('true');
        // Ответ повтора (n = 2), а не поздней первой попытки (n = 1).
        expect(replay.json()).toEqual(second.json());
        expect(replay.json()).toMatchObject({ n: 2 });
        expect(values).toEqual([
            expect.objectContaining({ labels: { scope: '/items/:id' }, value: 1 }),
        ]);
        expect(JSON.stringify(values)).not.toContain('v-42');
    });
});
