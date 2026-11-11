// AC-9.5 (NFR-8): проход очистки идемпотентности — метрика verdeect_cleanup_runs_total{table, result, service} и info-лог
// с service, replica, table, deleted (prd.md §3.3а, KT-19 п. 2). Лог — через KIT_LOGGER приложения: подмена логгером в
// память (проект shared не зависит от корневого логгера nestjs-pino).
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KIT_LOGGER } from '../../../src/internal/tokens.js';
import { adminQuery } from '../../support/database.js';
import { cleanupRuns, createStand, truncateIdempotency, type IdempotencyStand } from './support.js';

describe('NFR-8: наблюдаемость очистки', () => {
    const lines: Record<string, unknown>[] = [];
    let stand: IdempotencyStand;

    beforeAll(async () => {
        const stream = new Writable({
            write(chunk: Buffer, _encoding, done) {
                for (const line of chunk.toString('utf8').split('\n')) {
                    if (line !== '') {
                        lines.push(JSON.parse(line) as Record<string, unknown>);
                    }
                }
                done();
            },
        });
        const logger = pino(
            { level: 'info', base: { service: 'kit', replica: 'replica-1' } },
            stream,
        );
        await truncateIdempotency();
        stand = await createStand({ overrides: [{ provide: KIT_LOGGER, useValue: logger }] });
    });

    afterAll(async () => {
        await stand.close();
    });

    it('AC-9.5: проход очистки — verdeect_cleanup_runs_total с метками table="idempotency_key", result="ok", service="kit" растёт; лог «очистка идемпотентности: проход» с полями service, replica, table, deleted', async () => {
        await adminQuery(
            `insert into kit.idempotency_key (tenant, subject, key, fingerprint, created_at)
             values ('acme', 'user:u', 'o', 'f', now() - interval '25 hours')`,
        );
        const before = await cleanupRuns(stand.metrics, 'ok');
        lines.length = 0;

        await stand.cleanup.run();

        expect(await cleanupRuns(stand.metrics, 'ok')).toBe(before + 1);
        const metric = stand.metrics.registry.getSingleMetric('verdeect_cleanup_runs_total');
        const values = (await metric?.get())?.values ?? [];
        expect(values).toContainEqual(
            expect.objectContaining({
                labels: expect.objectContaining({ table: 'idempotency_key', result: 'ok' }),
            }),
        );
        expect(await stand.metrics.registry.metrics()).toMatch(
            /verdeect_cleanup_runs_total\{table="idempotency_key",result="ok",service="kit"\} \d+/,
        );
        const pass = lines.find((line) => line.msg === 'очистка идемпотентности: проход');
        expect(pass).toMatchObject({
            service: 'kit',
            replica: 'replica-1',
            table: 'idempotency_key',
            deleted: 1,
            result: 'ok',
        });
    });
});
