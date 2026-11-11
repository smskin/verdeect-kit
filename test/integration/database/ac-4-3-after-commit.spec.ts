// AC-4.3 (UC-5): Db.afterCommit — задачи после COMMIT по порядку, при откате не выполняются, сбой задачи не отменяет
// остальные; read-only — AfterCommitInReadOnlyError; транзакция не этого Db или вложенная —
// AfterCommitOutsideTransactionError (prd.md §3.3; KT-22 п. 2). Перенос I after-commit.int-spec.ts и O db.int-spec.ts.
import type { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AfterCommitInReadOnlyError,
    AfterCommitOutsideTransactionError,
} from '../../../src/database/db.js';
import { note } from '../../fixtures/database/schema.js';
import {
    adminQuery,
    createTestDb,
    ctx,
    truncateFixtures,
    type TestDb,
} from '../../support/database.js';

describe('UC-5: Db.afterCommit', () => {
    let test: TestDb;

    beforeAll(async () => {
        test = await createTestDb();
    });

    afterAll(async () => {
        await test.close();
    });

    beforeEach(async () => {
        await truncateFixtures();
    });

    it('AC-4.3: задачи после COMMIT по порядку, видят зафиксированные данные', async () => {
        const seen: string[] = [];
        await test.db.transaction(ctx('acme'), async (tx) => {
            await tx.insert(note).values({ id: 'a1', tenant: 'acme', body: 'x' });
            test.db.afterCommit(tx, async () => {
                const rows = await adminQuery<{ id: string }>('select id from kit.note');
                seen.push(`first:${rows.length}`);
            });
            test.db.afterCommit(tx, () => void seen.push('second'));
            seen.push('body');
        });

        expect(seen).toEqual(['body', 'first:1', 'second']);
    });

    it('AC-4.3: после ROLLBACK не выполняются', async () => {
        const task = vi.fn();
        await expect(
            test.db.transaction(ctx('acme'), (tx) => {
                test.db.afterCommit(tx, task);

                return Promise.reject(new Error('откат'));
            }),
        ).rejects.toThrow('откат');

        expect(task).not.toHaveBeenCalled();
    });

    it('AC-4.3: упавшая первая задача не отменяет вторую и результат транзакции', async () => {
        // Шпион экземпляра логгера Db, не прототипа: файл в проекте shared.
        const logger = (test.db as unknown as { logger: Logger }).logger;
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const second = vi.fn();
        try {
            const result = await test.db.transaction(ctx('acme'), (tx) => {
                test.db.afterCommit(tx, () => {
                    throw new Error('задача упала');
                });
                test.db.afterCommit(tx, second);

                return Promise.resolve('готово');
            });

            expect(result).toBe('готово');
            expect(second).toHaveBeenCalledOnce();
            expect(error).toHaveBeenCalledWith(expect.anything(), 'Db.afterCommit: задача упала');
        } finally {
            error.mockRestore();
        }
    });

    it('AC-4.3: afterCommit в read → AfterCommitInReadOnlyError', async () => {
        await expect(
            test.db.read(ctx('acme'), (tx) => {
                test.db.afterCommit(tx, () => undefined);

                return Promise.resolve();
            }),
        ).rejects.toBeInstanceOf(AfterCommitInReadOnlyError);
    });

    it('AC-4.3: afterCommit на дескрипторе readGlobal → AfterCommitInReadOnlyError', async () => {
        await expect(
            test.db.readGlobal((reader) => {
                test.db.afterCommit(reader, () => undefined);

                return Promise.resolve();
            }),
        ).rejects.toBeInstanceOf(AfterCommitInReadOnlyError);
    });

    it('AC-4.3: afterCommit с транзакцией другого Db или вложенной → AfterCommitOutsideTransactionError; своя — задача после COMMIT', async () => {
        const other = await createTestDb();
        const task = vi.fn();
        try {
            await expect(
                other.db.transaction(ctx('acme'), (tx) => {
                    test.db.afterCommit(tx, task);

                    return Promise.resolve();
                }),
            ).rejects.toBeInstanceOf(AfterCommitOutsideTransactionError);
            await expect(
                test.db.transaction(ctx('acme'), (tx) =>
                    tx.transaction((nested) => {
                        test.db.afterCommit(nested, task);

                        return Promise.resolve();
                    }),
                ),
            ).rejects.toBeInstanceOf(AfterCommitOutsideTransactionError);
            expect(task).not.toHaveBeenCalled();

            await test.db.transaction(ctx('acme'), (tx) => {
                test.db.afterCommit(tx, task);

                return Promise.resolve();
            });
            expect(task).toHaveBeenCalledOnce();
        } finally {
            await other.close();
        }
    });
});
