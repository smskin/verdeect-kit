// AC-4.14 (UC-7): без функции <схема>.idempotency_purge KitIdempotencyModule отказывает при старте — createTestApp
// отклоняется, bootstrapService — fatal через failStartup и exit 1 (prd.md §3.3а v1.14). Проект isolated: vi.stubEnv и
// перехват process.exit (стенд bootstrapService).
import { createTestSigner } from '@verdeect/auth/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootstrapService } from '../../../src/http/bootstrap-service.js';
import {
    createScratchDatabase,
    type KitScratchDatabase,
} from '../../../src/testing/scratch-database.js';
import { adminQuery } from '../../support/postgres.js';
import { expectExit, useBootstrapStand } from '../../unit/http/bootstrap-support.js';
import { createStand, standEnv, standModule } from './support.js';

describe('UC-7: функция очистки обязательна', () => {
    let scratch: KitScratchDatabase;
    const stand = useBootstrapStand();

    beforeAll(async () => {
        scratch = await createScratchDatabase();
        await adminQuery(scratch.adminUrl, 'DROP FUNCTION kit.idempotency_purge(integer)');
    });

    afterAll(async () => {
        await scratch.drop();
    });

    it('AC-4.14: без функции idempotency_purge createTestApp отказывает, текст называет idempotencyPurgeSql', async () => {
        await expect(createStand({ url: scratch.url })).rejects.toThrow(
            'KitIdempotencyModule: нет функции kit.idempotency_purge — добавьте idempotencyPurgeSql(kit) в SQL-миграцию сервиса',
        );
    });

    it('AC-4.14: bootstrapService без функции — fatal через failStartup с текстом про idempotencyPurgeSql, exit 1, порт не открыт', async () => {
        const signer = await createTestSigner();
        vi.stubEnv('DATABASE_URL', scratch.url);
        try {
            const exit = await expectExit(
                bootstrapService({ module: standModule(signer), service: 'kit', env: standEnv }),
            );

            expect(exit.code).toBe(1);
            const fatal = stand.records().find((record) => record.level === 60);
            expect(JSON.stringify(fatal)).toContain('idempotencyPurgeSql(kit)');
            expect(
                stand.records().some((record) => /слушает|listening/i.test(String(record.msg))),
            ).toBe(false);
        } finally {
            await signer.close();
        }
    });
});
