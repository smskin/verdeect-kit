// AC-4.8 (UC-1): assertStrictTenantIsolation — строгий RLS схемы сервиса под ролью приложения: политика, FORCE, 0 строк
// под пустым тенантом, исключения outbox и idempotency_key, функция idempotency_purge (prd.md §3.8 v1.14). Перенос
// приёмов O ac-10-2-rls и fr-21-roles; нестрогая модель I («пустой тенант видит всё») должна падать. Каждое нарушение —
// своя БД createScratchDatabase(), изменения — администратором, проверка — под kit_app.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
    createScratchDatabase,
    type KitScratchDatabase,
} from '../../../src/testing/scratch-database.js';
import {
    assertStrictTenantIsolation,
    type KitTenantIsolationOptions,
} from '../../../src/testing/tenant-isolation.js';
import { adminQuery } from '../../support/postgres.js';

const OPTIONS: KitTenantIsolationOptions = { schema: 'kit' };
const PURGE = 'kit.idempotency_purge(integer)';

/** Свежая мигрированная БД: администратор готовит нарушение, проверка — пулом роли kit_app. */
async function withScratch(
    prepare: string[],
    check: (run: (options?: KitTenantIsolationOptions) => Promise<void>) => Promise<void>,
): Promise<void> {
    const scratch: KitScratchDatabase = await createScratchDatabase();
    const pool = new pg.Pool({ connectionString: scratch.url, max: 2 });
    try {
        for (const statement of prepare) {
            await adminQuery(scratch.adminUrl, statement);
        }
        await check((options = OPTIONS) => assertStrictTenantIsolation(pool, options));
    } finally {
        await pool.end();
        await scratch.drop();
    }
}

const SEED_NOTES = [
    "insert into kit.note (id, tenant, body) values ('a1', 'acme', 'x'), ('g1', 'globex', 'y')",
];

describe('UC-1: строгий RLS', () => {
    it('AC-4.8: note с tenantPolicy и FORCE — под kit_app с пустым тенантом 0 строк, с чужим — 0 строк', async () => {
        await withScratch(SEED_NOTES, async (run) => {
            await run();
        });
        const scratch = await createScratchDatabase();
        const client = new pg.Client({ connectionString: scratch.url });
        try {
            await adminQuery(scratch.adminUrl, SEED_NOTES[0] ?? '');
            await client.connect();
            const count = async (tenant: string): Promise<number> => {
                await client.query('begin');
                await client.query("select set_config('app.tenant', $1, true)", [tenant]);
                const { rows } = await client.query<{ count: number }>(
                    "select count(*)::int as count from kit.note where tenant = 'acme'",
                );
                await client.query('rollback');

                return rows[0]?.count ?? -1;
            };

            expect(await count('')).toBe(0);
            expect(await count('globex')).toBe(0);
            expect(await count('acme')).toBe(1);
        } finally {
            await client.end();
            await scratch.drop();
        }
    });

    it('AC-4.8: фикстура пакета проходит assertStrictTenantIsolation (idempotency_key и функция — исключения строгой модели проходят)', async () => {
        await withScratch([], async (run) => {
            await run();
        });
    });

    it('AC-4.8: таблица без политики → падает', async () => {
        await withScratch(
            [
                'CREATE TABLE kit.bare (tenant text not null)',
                'ALTER TABLE kit.bare ENABLE ROW LEVEL SECURITY',
                'ALTER TABLE kit.bare FORCE ROW LEVEL SECURITY',
                'GRANT SELECT ON kit.bare TO kit_app',
            ],
            async (run) => {
                await expect(run()).rejects.toThrow('bare: нет политики');
            },
        );
    });

    it('AC-4.8: без FORCE → падает', async () => {
        await withScratch(['ALTER TABLE kit.note NO FORCE ROW LEVEL SECURITY'], async (run) => {
            await expect(run()).rejects.toThrow('note: нет FORCE ROW LEVEL SECURITY');
        });
    });

    it('AC-4.8: нестрогая политика (IS NULL OR …) → падает', async () => {
        await withScratch(
            [
                'DROP POLICY tenant_isolation ON kit.note',
                "CREATE POLICY tenant_isolation ON kit.note USING (nullif(current_setting('app.tenant', true), '') IS NULL OR tenant = current_setting('app.tenant', true)) WITH CHECK (tenant = current_setting('app.tenant', true))",
            ],
            async (run) => {
                await expect(run()).rejects.toThrow('note.tenant_isolation: нестрогая политика');
            },
        );
    });

    it('AC-4.8: под пустым тенантом видны строки (политика USING (true)) → падает', async () => {
        await withScratch(
            [
                ...SEED_NOTES,
                'DROP POLICY tenant_isolation ON kit.note',
                'CREATE POLICY tenant_isolation ON kit.note USING (true) WITH CHECK (true)',
            ],
            async (run) => {
                const error: unknown = await run().catch((caught: unknown) => caught);

                expect(String(error)).toContain('note.tenant_isolation: нестрогая политика');
                expect(String(error)).toContain(
                    'note: под ролью приложения с пустым тенантом видно 2 строк',
                );
                expect(String(error)).not.toContain('acme');
            },
        );
    });

    it('AC-4.8: таблица outbox с политикой и FORCE проходит (исключение строгой модели)', async () => {
        await withScratch(
            [
                'CREATE TABLE kit.outbox (id text primary key, tenant text)',
                'ALTER TABLE kit.outbox ENABLE ROW LEVEL SECURITY',
                'ALTER TABLE kit.outbox FORCE ROW LEVEL SECURITY',
                'CREATE POLICY outbox_all ON kit.outbox USING (true) WITH CHECK (true)',
                "insert into kit.outbox values ('m1', 'acme')",
            ],
            async (run) => {
                await run();
            },
        );
    });

    it('AC-4.8: idempotency_key с записью без компании и записью acme проходит', async () => {
        await withScratch(
            [
                "insert into kit.idempotency_key (tenant, subject, key, fingerprint) values (null, 'service:s', 'k1', 'f'), ('acme', 'user:u', 'k2', 'f')",
            ],
            async (run) => {
                await run();
            },
        );
    });

    it('AC-4.8: функции idempotency_purge нет → падает с idempotencyPurgeSql в тексте', async () => {
        await withScratch([`DROP FUNCTION ${PURGE}`], async (run) => {
            await expect(run()).rejects.toThrow(
                'нет функции kit.idempotency_purge (idempotencyPurgeSql)',
            );
        });
    });

    it('AC-4.8: функция без SECURITY DEFINER (ALTER FUNCTION … SECURITY INVOKER) → падает', async () => {
        await withScratch([`ALTER FUNCTION ${PURGE} SECURITY INVOKER`], async (run) => {
            await expect(run()).rejects.toThrow('kit.idempotency_purge: не SECURITY DEFINER');
        });
    });

    it('AC-4.8: владелец не kit_directory (ALTER FUNCTION … OWNER TO kit_owner) → падает', async () => {
        await withScratch([`ALTER FUNCTION ${PURGE} OWNER TO kit_owner`], async (run) => {
            await expect(run()).rejects.toThrow(
                'kit.idempotency_purge: владелец kit_owner, нужен kit_directory',
            );
        });
    });

    it('AC-4.8: у PUBLIC есть EXECUTE (GRANT EXECUTE … TO PUBLIC) → падает', async () => {
        await withScratch([`GRANT EXECUTE ON FUNCTION ${PURGE} TO PUBLIC`], async (run) => {
            await expect(run()).rejects.toThrow('kit.idempotency_purge: EXECUTE у PUBLIC');
        });
    });

    it('AC-4.8: search_path сброшен (ALTER FUNCTION … RESET search_path) → падает', async () => {
        await withScratch([`ALTER FUNCTION ${PURGE} RESET search_path`], async (run) => {
            await expect(run()).rejects.toThrow('kit.idempotency_purge: search_path не задан');
        });
    });

    it('AC-4.8: except пропускает таблицу', async () => {
        await withScratch(['ALTER TABLE kit.note NO FORCE ROW LEVEL SECURITY'], async (run) => {
            await run({ schema: 'kit', except: ['note'] });
        });
    });

    it('AC-4.8: схема без таблиц с колонкой tenant (опечатка в имени) → падает', async () => {
        await withScratch([], async (run) => {
            await expect(run({ schema: 'kti' })).rejects.toThrow(
                'в схеме нет таблиц с колонкой tenant',
            );
        });
    });
});
