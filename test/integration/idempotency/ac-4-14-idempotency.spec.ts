// AC-4.14 (UC-7): Idempotency-Key по HTTP — повтор, другое тело, параллельный первый, обязательный ключ, формат, брошенная
// in_progress, срок 24 ч, область (sub, компания, служба, tenantFromBody), ошибка обработчика, маршрут без guard'а, RLS
// таблицы (prd.md §3.3а v1.14). Перенос O http/shared/idempotency и ac-2-2-idempotency. Проект isolated: initFakeSentry —
// процесс-глобальный Sentry.
import * as Sentry from '@sentry/nestjs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintOf } from '../../../src/idempotency/idempotency.interceptor.js';
import { workerScope } from '../../../src/testing/worker-scope.js';
import { adminQuery, appUrl } from '../../support/database.js';
import { initFakeSentry, type DeliveredEvent } from '../../support/fake-sentry.js';
import {
    OTHER_TENANT,
    createStand,
    handlers,
    post,
    resetHandlers,
    serviceToken,
    truncateIdempotency,
    userToken,
    type IdempotencyStand,
} from './support.js';

async function until(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function gate(): () => void {
    let release = (): void => undefined;
    handlers.gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    return release;
}

describe('UC-7: Idempotency-Key', () => {
    let stand: IdempotencyStand;
    let delivered: DeliveredEvent[];
    let token: string;
    const tenant = workerScope().tenant;

    beforeAll(async () => {
        delivered = initFakeSentry().delivered;
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

    it('AC-4.14: повтор с тем же ключом и телом — сохранённый статус 201, тело, Location + Idempotent-Replayed: true; обработчик один раз', async () => {
        const first = await post(stand, '/echo', { token, key: 'k-1', body: { a: 1 } });
        const second = await post(stand, '/echo', { token, key: 'k-1', body: { a: 1 } });

        expect(first.statusCode).toBe(201);
        expect(first.headers['idempotent-replayed']).toBeUndefined();
        expect(second.statusCode).toBe(201);
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.headers.location).toBe('/echo/1');
        expect(second.json()).toEqual(first.json());
        expect(handlers.calls).toBe(1);
    });

    it('AC-4.14: другое тело — 422 IDEMPOTENCY_KEY_REUSED', async () => {
        await post(stand, '/echo', { token, key: 'k-2', body: { a: 1 } });
        const reused = await post(stand, '/echo', { token, key: 'k-2', body: { a: 2 } });

        expect(reused.statusCode).toBe(422);
        expect(reused.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    });

    it('AC-4.14: параллельный первый — 409 IDEMPOTENCY_IN_PROGRESS', async () => {
        const release = gate();
        const first = post(stand, '/echo', { token, key: 'k-3' });
        await until(() => handlers.calls === 1);

        const second = await post(stand, '/echo', { token, key: 'k-3' });
        release();

        expect(second.statusCode).toBe(409);
        expect(second.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
        expect((await first).statusCode).toBe(201);
    });

    it('AC-4.14: два параллельных запроса с одним ключом — обработчик один раз', async () => {
        const responses = await Promise.all([
            post(stand, '/echo', { token, key: 'k-4' }),
            post(stand, '/echo', { token, key: 'k-4' }),
        ]);

        expect(handlers.calls).toBe(1);
        expect(responses.map((item) => item.statusCode).sort()).toContain(201);
        for (const item of responses) {
            expect([201, 409]).toContain(item.statusCode);
        }
    });

    it('AC-4.14: required без ключа — 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
        const response = await post(stand, '/strict', { token });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
        expect(handlers.calls).toBe(0);
    });

    it('AC-4.14: ключ 201 знак — 422 VALIDATION_FAILED path Idempotency-Key', async () => {
        const response = await post(stand, '/echo', { token, key: 'x'.repeat(201) });

        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
            error: {
                code: 'VALIDATION_FAILED',
                details: { issues: [{ path: 'Idempotency-Key', code: 'invalid' }] },
            },
        });
    });

    it('AC-4.14: in_progress старше 5 мин переиспользуется; моложе — 409', async () => {
        const fingerprint = fingerprintOf('POST', '/echo', {});
        const seed = (key: string, minutes: number) =>
            adminQuery(
                `insert into kit.idempotency_key (tenant, subject, key, fingerprint, state, created_at)
                 values ($1, 'user:user-a', $2, $3, 'in_progress', now() - make_interval(mins => $4))`,
                [tenant, key, fingerprint, minutes],
            );
        await seed('k-old', 6);
        await seed('k-young', 1);

        expect((await post(stand, '/echo', { token, key: 'k-old' })).statusCode).toBe(201);
        expect((await post(stand, '/echo', { token, key: 'k-young' })).statusCode).toBe(409);
        expect(handlers.calls).toBe(1);
    });

    it('AC-4.14: запись старше 24 ч — запрос выполняется заново без Idempotent-Replayed', async () => {
        await post(stand, '/echo', { token, key: 'k-5' });
        await adminQuery(
            "update kit.idempotency_key set created_at = now() - interval '25 hours' where key = 'k-5'",
        );

        const again = await post(stand, '/echo', { token, key: 'k-5' });

        expect(again.statusCode).toBe(201);
        expect(again.headers['idempotent-replayed']).toBeUndefined();
        expect(handlers.calls).toBe(2);
    });

    it('AC-4.14: ключ одного sub не виден другому sub и другой компании', async () => {
        const otherSub = await userToken(stand, { sub: 'user-b' });
        const otherTenant = await userToken(stand, { tenant: OTHER_TENANT });
        const responses = [
            await post(stand, '/echo', { token, key: 'k-6' }),
            await post(stand, '/echo', { token: otherSub, key: 'k-6' }),
            await post(stand, '/echo', { token: otherTenant, key: 'k-6' }),
        ];

        expect(responses.map((item) => item.statusCode)).toEqual([201, 201, 201]);
        expect(responses.every((item) => item.headers['idempotent-replayed'] === undefined)).toBe(
            true,
        );
        expect(handlers.calls).toBe(3);
    });

    it("AC-4.14: сервисный вызов с tenantFromBody 'tenant' — ключ одного client_id в двух компаниях не пересекается; без поля tenant — область client_id", async () => {
        const svc = await serviceToken(stand);
        const acme = await post(stand, '/service', {
            token: svc,
            key: 'k-7',
            body: { tenant: 'acme' },
        });
        const globex = await post(stand, '/service', {
            token: svc,
            key: 'k-7',
            body: { tenant: OTHER_TENANT },
        });
        const bare = await post(stand, '/service', { token: svc, key: 'k-7', body: {} });
        const bareAgain = await post(stand, '/service', { token: svc, key: 'k-7', body: {} });

        expect([acme, globex, bare].map((item) => item.statusCode)).toEqual([201, 201, 201]);
        expect(globex.headers['idempotent-replayed']).toBeUndefined();
        expect(bareAgain.headers['idempotent-replayed']).toBe('true');
        expect(handlers.calls).toBe(3);
        const rows = await adminQuery<{ tenant: string | null }>(
            "select tenant from kit.idempotency_key where key = 'k-7' order by tenant nulls last",
        );
        expect(rows.map((row) => row.tenant)).toEqual(['acme', OTHER_TENANT, null]);
    });

    it('AC-4.14: сервисный вызов без tenantFromBody (tenant NULL) — повтор → сохранённый ответ и Idempotent-Replayed; параллельный первый → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
        const svc = await serviceToken(stand);
        await post(stand, '/service-plain', { token: svc, key: 'k-8' });
        const replay = await post(stand, '/service-plain', { token: svc, key: 'k-8' });
        expect(replay.statusCode).toBe(201);
        expect(replay.headers['idempotent-replayed']).toBe('true');

        const release = gate();
        const first = post(stand, '/service-plain', { token: svc, key: 'k-9' });
        await until(() => handlers.calls === 2);
        const second = await post(stand, '/service-plain', { token: svc, key: 'k-9' });
        release();

        expect(second.statusCode).toBe(409);
        expect((await first).statusCode).toBe(201);
    });

    it('AC-4.14: вызов пользователя с подложным tenant в теле не меняет область', async () => {
        const response = await post(stand, '/echo', {
            token,
            key: 'k-10',
            body: { tenant: OTHER_TENANT },
        });

        expect(response.statusCode).toBe(201);
        const rows = await adminQuery<{ tenant: string; subject: string }>(
            "select tenant, subject from kit.idempotency_key where key = 'k-10'",
        );
        expect(rows).toEqual([{ tenant, subject: 'user:user-a' }]);
    });

    it('AC-4.14: обработчик бросил — повтор выполняется заново; ошибка не сохраняется', async () => {
        handlers.fail = 'domain';
        const failed = await post(stand, '/echo', { token, key: 'k-11' });
        expect(failed.statusCode).toBe(422);
        expect(await adminQuery("select 1 from kit.idempotency_key where key = 'k-11'")).toEqual(
            [],
        );

        handlers.fail = null;
        const again = await post(stand, '/echo', { token, key: 'k-11' });

        expect(again.statusCode).toBe(201);
        expect(again.headers['idempotent-replayed']).toBeUndefined();
        expect(handlers.calls).toBe(2);
    });

    it("AC-4.14: маршрут с @Idempotent без guard'а и с Idempotency-Key — 500 INTERNAL_ERROR, обработчик не вызван, событие GlitchTip ровно одно", async () => {
        const before = delivered.length;
        const response = await post(stand, '/open', { key: 'k-12' });
        await Sentry.flush(2000);

        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
        expect(handlers.calls).toBe(0);
        expect(delivered.length - before).toBe(1);
    });

    it("AC-4.14: маршрут с @Idempotent без guard'а без Idempotency-Key — 500 INTERNAL_ERROR, обработчик не вызван, событие GlitchTip ровно одно", async () => {
        const before = delivered.length;
        const response = await post(stand, '/open', {});
        await Sentry.flush(2000);

        expect(response.statusCode).toBe(500);
        expect(handlers.calls).toBe(0);
        expect(delivered.length - before).toBe(1);
    });

    it('AC-4.14: запись компании недоступна под другой компанией и без компании (политика IS NOT DISTINCT FROM)', async () => {
        await adminQuery(
            `insert into kit.idempotency_key (tenant, subject, key, fingerprint) values
             ($1, 'user:user-a', 'r-1', 'f'), ($2, 'user:user-a', 'r-2', 'f'), (null, 'service:svc', 'r-3', 'f')`,
            [tenant, OTHER_TENANT],
        );
        const visible = async (setting: string): Promise<string[]> => {
            const client = new pg.Client({ connectionString: appUrl() });
            await client.connect();
            try {
                await client.query('begin');
                await client.query("select set_config('app.tenant', $1, true)", [setting]);
                const { rows } = await client.query<{ key: string }>(
                    'select key from kit.idempotency_key order by key',
                );
                await client.query('commit');

                return rows.map((row) => row.key);
            } finally {
                await client.end();
            }
        };

        expect(await visible(tenant)).toEqual(['r-1']);
        expect(await visible(OTHER_TENANT)).toEqual(['r-2']);
        expect(await visible('')).toEqual(['r-3']);
    });
});
