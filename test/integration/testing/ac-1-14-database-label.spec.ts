// AC-1.14 (UC-14; prd.md §3.8 v1.26): база-шаблон <svc>_template и копия <svc> startTestStack получают метку COMMENT ON
// DATABASE … IS 'verdeect-kit startTestStack'; с меткой — остаток прерванного прогона, пересоздаётся; без метки — отказ
// запуска с именем базы и подсказкой POSTGRES_DB, база не удаляется; teardown удаляет только помеченные базы.
// Внешний сервер — PostgreSQL globalSetup пакета (kitPostgresUrl).
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { startTestStack } from '../../../src/testing/start-test-stack.js';
import { adminQuery, adminUrl, dropDatabase, dropServiceRoles } from '../../support/postgres.js';

const SERVICE = 'kitlabel';
const TEMPLATE = `${SERVICE}_template`;
const LABEL = 'verdeect-kit startTestStack';

function start(): Promise<() => Promise<void>> {
    const project = { provide: vi.fn() };

    return startTestStack({ service: SERVICE, postgres: { adminUrl: adminUrl() } })(
        project as never,
    );
}

async function labels(): Promise<Record<string, string | null>> {
    const rows = await adminQuery<{ datname: string; label: string | null }>(
        adminUrl(),
        `select datname, shobj_description(oid, 'pg_database') as label from pg_database
         where datname = any($1) order by datname`,
        [[SERVICE, TEMPLATE]],
    );

    return Object.fromEntries(rows.map((row) => [row.datname, row.label]));
}

async function dropAll(): Promise<void> {
    await dropDatabase(SERVICE);
    await dropDatabase(TEMPLATE);
}

describe('UC-14: метка БД startTestStack', () => {
    afterEach(dropAll);

    afterAll(async () => {
        await dropServiceRoles(SERVICE, []);
    });

    it("AC-1.14: шаблон и копия получают COMMENT 'verdeect-kit startTestStack'", async () => {
        const teardown = await start();
        try {
            expect(await labels()).toEqual({ [SERVICE]: LABEL, [TEMPLATE]: LABEL });
        } finally {
            await teardown();
        }
    });

    it('AC-1.14: повторный прогон после прерванного проходит', async () => {
        // Первый прогон «прерван»: teardown не вызван, обе базы остались.
        await start();
        const teardown = await start();
        expect(await labels()).toEqual({ [SERVICE]: LABEL, [TEMPLATE]: LABEL });

        await teardown();
        expect(await labels()).toEqual({});
    });

    it.each([[SERVICE], [TEMPLATE]])(
        'AC-1.14: база %s без метки — запуск падает, текст содержит имя базы и POSTGRES_DB, база не удалена',
        async (name) => {
            await adminQuery(adminUrl(), `CREATE DATABASE "${name}"`);

            const error = await start().then(
                () => undefined,
                (reason: unknown) => reason,
            );

            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain(name);
            expect((error as Error).message).toContain('POSTGRES_DB');
            expect((await labels())[name]).toBeNull();
        },
    );

    it('AC-1.14: teardown не удаляет базу без метки', async () => {
        const teardown = await start();
        await adminQuery(adminUrl(), `COMMENT ON DATABASE "${SERVICE}" IS NULL`);

        await teardown();

        expect(await labels()).toEqual({ [SERVICE]: null });
    });
});
