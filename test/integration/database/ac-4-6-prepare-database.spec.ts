// AC-4.6 (UC-12): prepareDatabase — роли <svc>_owner, <svc>_app, <svc>_directory и схема, повтор без изменений
// (prd.md §3.3, §5.4). Перенос O fr-21-roles.int-spec.ts (атрибуты, повтор db:prepare — created: []), обобщён на имя
// сервиса; assertAppRoleIsNotOwner (§3.8, KT-19 п. 1). Своя БД и сервис kitprep; БД и роли удаляются в afterAll.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '../../../src/database/prepare-database.js';
import { assertAppRoleIsNotOwner } from '../../../src/testing/tenant-isolation.js';
import {
    adminQuery,
    adminUrl,
    createDatabase,
    databaseUrl,
    dropDatabase,
    dropServiceRoles,
    uniqueName,
} from '../../support/postgres.js';

const SERVICE = 'kitprep';
const OWNER_PASSWORD = 'owner-secret';
const APP_PASSWORD = 'app-secret';

interface RoleRow {
    readonly rolname: string;
    readonly rolcanlogin: boolean;
    readonly rolbypassrls: boolean;
    readonly rolsuper: boolean;
    readonly rolcreatedb: boolean;
    readonly rolcreaterole: boolean;
}

describe('UC-12: подготовка БД', () => {
    const database = uniqueName('ac46');
    let url: string;

    async function roles(): Promise<RoleRow[]> {
        return adminQuery<RoleRow>(
            url,
            `select rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
             from pg_roles where rolname like 'kitprep\\_%' order by rolname`,
        );
    }

    async function schemaOwners(): Promise<Array<{ nspname: string; owner: string }>> {
        return adminQuery(
            url,
            `select nspname, pg_get_userbyid(nspowner) as owner from pg_namespace
             where nspname in ('kitprep', 'drizzle') order by nspname`,
        );
    }

    beforeAll(async () => {
        await createDatabase(database);
        url = databaseUrl(adminUrl(), { database });
    });

    afterAll(async () => {
        await dropServiceRoles(SERVICE, [database]);
        await dropDatabase(database);
    });

    it('AC-4.6: роли kitprep_owner (LOGIN, NOBYPASSRLS), kitprep_app (LOGIN, NOBYPASSRLS, не суперпользователь), kitprep_directory (NOLOGIN, BYPASSRLS) созданы', async () => {
        const result = await prepareDatabase({
            service: SERVICE,
            adminUrl: url,
            ownerPassword: OWNER_PASSWORD,
            appPassword: APP_PASSWORD,
        });

        expect(result).toEqual({
            database,
            roles: ['kitprep_owner', 'kitprep_app', 'kitprep_directory'],
            created: ['kitprep_owner', 'kitprep_app', 'kitprep_directory'],
        });
        const flags = { rolsuper: false, rolcreatedb: false, rolcreaterole: false };
        expect(await roles()).toEqual([
            { rolname: 'kitprep_app', rolcanlogin: true, rolbypassrls: false, ...flags },
            { rolname: 'kitprep_directory', rolcanlogin: false, rolbypassrls: true, ...flags },
            { rolname: 'kitprep_owner', rolcanlogin: true, rolbypassrls: false, ...flags },
        ]);
    });

    it('AC-4.6: схема kitprep принадлежит kitprep_owner, схемы drizzle нет', async () => {
        expect(await schemaOwners()).toEqual([{ nspname: 'kitprep', owner: 'kitprep_owner' }]);
    });

    it('AC-4.6: повторный prepareDatabase — без ошибок, created: [], атрибуты и владелец схемы прежние', async () => {
        const before = await roles();

        const result = await prepareDatabase({
            service: SERVICE,
            adminUrl: url,
            ownerPassword: OWNER_PASSWORD,
            appPassword: APP_PASSWORD,
        });

        expect(result.created).toEqual([]);
        expect(await roles()).toEqual(before);
        expect(await schemaOwners()).toEqual([{ nspname: 'kitprep', owner: 'kitprep_owner' }]);
    });

    it('AC-4.6: kitprep_app входит с паролем, kitprep_directory — нет (NOLOGIN)', async () => {
        const [row] = await adminQuery<{ user: string }>(
            databaseUrl(url, { database, user: 'kitprep_app', password: APP_PASSWORD }),
            'select current_user as user',
        );
        expect(row?.user).toBe('kitprep_app');

        const client = new pg.Client({
            connectionString: databaseUrl(url, {
                database,
                user: 'kitprep_directory',
                password: 'x',
            }),
        });
        await expect(client.connect()).rejects.toMatchObject({
            code: expect.stringMatching(/^28/),
        });
    });

    async function asRole<T>(
        user: string,
        password: string,
        work: (client: pg.Client) => Promise<T>,
    ): Promise<T> {
        const client = new pg.Client({
            connectionString: databaseUrl(url, { database, user, password }),
        });
        await client.connect();
        try {
            return await work(client);
        } finally {
            await client.end();
        }
    }

    async function withGrant(
        grant: string,
        revoke: string,
        work: () => Promise<void>,
    ): Promise<void> {
        await adminQuery(url, grant);
        try {
            await work();
        } finally {
            await adminQuery(url, revoke);
        }
    }

    it('AC-4.6: assertAppRoleIsNotOwner проходит под kitprep_app', async () => {
        await asRole('kitprep_app', APP_PASSWORD, (client) => assertAppRoleIsNotOwner(client));
    });

    it('AC-4.6: assertAppRoleIsNotOwner падает под kitprep_owner (владелец схемы)', async () => {
        await expect(
            asRole('kitprep_owner', OWNER_PASSWORD, (client) => assertAppRoleIsNotOwner(client)),
        ).rejects.toThrow(/kitprep_owner: .*владеет схемами kitprep/);
    });

    it('AC-4.6: kitprep_app без CREATE на базе и схеме после prepareDatabase', async () => {
        const [row] = await adminQuery<{ db: boolean; schema: boolean }>(
            url,
            `select has_database_privilege('kitprep_app', current_database(), 'CREATE') as db,
                    has_schema_privilege('kitprep_app', 'kitprep', 'CREATE') as schema`,
        );

        expect(row).toEqual({ db: false, schema: false });
    });

    it('AC-4.6: assertAppRoleIsNotOwner падает после GRANT CREATE ON DATABASE … TO kitprep_app', async () => {
        const db = pg.escapeIdentifier(database);
        await withGrant(
            `GRANT CREATE ON DATABASE ${db} TO kitprep_app`,
            `REVOKE CREATE ON DATABASE ${db} FROM kitprep_app`,
            async () => {
                await expect(
                    asRole('kitprep_app', APP_PASSWORD, (client) =>
                        assertAppRoleIsNotOwner(client),
                    ),
                ).rejects.toThrow(`CREATE на базе ${database}`);
            },
        );
    });

    it('AC-4.6: assertAppRoleIsNotOwner падает после GRANT CREATE ON SCHEMA kitprep TO kitprep_app', async () => {
        await withGrant(
            'GRANT CREATE ON SCHEMA kitprep TO kitprep_app',
            'REVOKE CREATE ON SCHEMA kitprep FROM kitprep_app',
            async () => {
                await expect(
                    asRole('kitprep_app', APP_PASSWORD, (client) =>
                        assertAppRoleIsNotOwner(client),
                    ),
                ).rejects.toThrow('CREATE на схеме kitprep');
            },
        );
    });

    it('§3.3: имя сервиса вне формата → TypeError без подключения к БД', async () => {
        await expect(
            prepareDatabase({
                service: 'Kit_1',
                adminUrl: 'postgres://nobody@127.0.0.1:1/none',
                ownerPassword: 'a',
                appPassword: 'b',
            }),
        ).rejects.toBeInstanceOf(TypeError);
    });
});
