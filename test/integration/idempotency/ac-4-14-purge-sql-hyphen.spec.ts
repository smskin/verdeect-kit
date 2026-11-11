// KT-20 п. 1 (AC-4.14): idempotencyPurgeSql для схемы с дефисом — сервис bff-app: функция создаётся по тексту пакета,
// SECURITY DEFINER, владелец bff-app_directory, у PUBLIC нет EXECUTE; под bff-app_app удаляет записи старше 24 ч
// (prd.md §3.3а v1.14). Своя БД, роли bff-app_* удаляются в afterAll.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pgSchema } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDatabase } from '../../../src/database/prepare-database.js';
import { idempotencyPurgeSql } from '../../../src/idempotency/table.js';
import {
    adminQuery,
    adminUrl,
    createDatabase,
    databaseUrl,
    dropDatabase,
    dropServiceRoles,
    uniqueName,
} from '../../support/postgres.js';

const SERVICE = 'bff-app';
const OWNER_PASSWORD = 'bff-owner-secret';
const APP_PASSWORD = 'bff-app-secret';
const MIGRATIONS = fileURLToPath(new URL('../../fixtures/database/migrations', import.meta.url));

/** DDL таблицы идемпотентности фикстуры (0002_*.sql) со схемой bff-app. */
function tableDdl(): string[] {
    const file = readdirSync(MIGRATIONS).find((name) => name.startsWith('0002_'));

    return readFileSync(`${MIGRATIONS}/${String(file)}`, 'utf8')
        .replaceAll('"kit"', `"${SERVICE}"`)
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== '');
}

describe('KT-20: функция очистки для схемы с дефисом', () => {
    const database = uniqueName('kt20');
    let owner: string;
    let app: string;
    let admin: string;

    beforeAll(async () => {
        await createDatabase(database);
        admin = databaseUrl(adminUrl(), { database });
        await prepareDatabase({
            service: SERVICE,
            adminUrl: admin,
            ownerPassword: OWNER_PASSWORD,
            appPassword: APP_PASSWORD,
        });
        owner = databaseUrl(admin, {
            database,
            user: `${SERVICE}_owner`,
            password: OWNER_PASSWORD,
        });
        app = databaseUrl(admin, { database, user: `${SERVICE}_app`, password: APP_PASSWORD });
        for (const statement of [
            ...tableDdl(),
            `GRANT SELECT, INSERT, UPDATE, DELETE ON "${SERVICE}"."idempotency_key" TO "${SERVICE}_app"`,
            ...idempotencyPurgeSql(pgSchema(SERVICE)).split('\n--> statement-breakpoint\n'),
        ]) {
            await adminQuery(owner, statement);
        }
    });

    afterAll(async () => {
        await dropServiceRoles(SERVICE, [database]);
        await dropDatabase(database);
    });

    it('KT-20: функция "bff-app"."idempotency_purge" создана — SECURITY DEFINER, владелец bff-app_directory, search_path задан, у PUBLIC нет EXECUTE', async () => {
        const [row] = await adminQuery<{
            definer: boolean;
            owner: string;
            config: string[];
            public: boolean;
            app: boolean;
        }>(
            admin,
            `select p.prosecdef as definer, pg_get_userbyid(p.proowner) as owner, p.proconfig as config,
                    has_function_privilege('public', p.oid, 'EXECUTE') as public,
                    has_function_privilege('bff-app_app', p.oid, 'EXECUTE') as app
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'bff-app' and p.proname = 'idempotency_purge'`,
        );

        expect(row).toEqual({
            definer: true,
            owner: 'bff-app_directory',
            config: ['search_path="bff-app", pg_temp'],
            public: false,
            app: true,
        });
    });

    it('KT-20: под bff-app_app вызов функции удаляет запись старше 24 ч, свежая остаётся', async () => {
        await adminQuery(
            admin,
            `insert into "bff-app".idempotency_key (tenant, subject, key, fingerprint, created_at) values
             ('acme', 'user:u', 'old', 'f', now() - interval '25 hours'), ('acme', 'user:u', 'new', 'f', now())`,
        );

        const [result] = await adminQuery<{ deleted: number }>(
            app,
            'select "bff-app".idempotency_purge(100) as deleted',
        );
        const rows = await adminQuery<{ key: string }>(
            admin,
            'select key from "bff-app".idempotency_key',
        );

        expect(result?.deleted).toBe(1);
        expect(rows).toEqual([{ key: 'new' }]);
    });
});
