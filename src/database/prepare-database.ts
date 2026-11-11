// prepareDatabase (prd.md §3.3, AC-4.6, UC-12). Эталон — O prepare-database.ts: ALTER или CREATE ROLE, атрибуты,
// GRANT роли directory владельцу, права на БД, схема AUTHORIZATION владельца. По PRD: имя сервиса параметром; схема
// drizzle не создаётся (журнал — в схеме сервиса); USAGE схемы роли приложения; CREATE роли приложения — никогда (KT-19).
import type { Client } from 'pg';
import type { Logger } from 'pino';
import { assertServiceName } from '../internal/service-name.js';
import { quoteIdentifier } from '../internal/sql-identifier.js';
import { CONNECTION_TIMEOUT_MS, loadPg } from './pg.js';

/** Параметры `prepareDatabase` (prd.md §3.3). */
export interface KitPrepareDatabaseOptions {
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$`: роли `<svc>_owner`, `<svc>_app`, `<svc>_directory`, схема `<svc>`. */
    readonly service: string;
    /** Адрес БД сервиса под суперпользователем (или ролью с CREATEROLE). */
    readonly adminUrl: string;
    /** Пароль `<svc>_owner` (миграции). */
    readonly ownerPassword: string;
    /** Пароль `<svc>_app` (приложение). */
    readonly appPassword: string;
}

/** Результат `prepareDatabase`. */
export interface KitPrepareDatabaseResult {
    /** Имя подготовленной БД. */
    readonly database: string;
    /** Роли сервиса: owner, app, directory. */
    readonly roles: readonly string[];
    /** Роли, созданные этим вызовом (повтор — пусто). */
    readonly created: readonly string[];
}

const LOGIN_ATTRIBUTES = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
const DIRECTORY_ATTRIBUTES = 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS';

/** Имена ролей сервиса. */
export function serviceRoles(service: string): {
    readonly owner: string;
    readonly app: string;
    readonly directory: string;
} {
    return { owner: `${service}_owner`, app: `${service}_app`, directory: `${service}_directory` };
}

/** CREATE или ALTER роли с атрибутами; `true` — роль создана сейчас. DDL ролей не принимает `$1`. */
async function upsertRole(
    client: Client,
    role: string,
    attributes: string,
    logger?: Logger,
): Promise<boolean> {
    const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    const exists = (rowCount ?? 0) > 0;
    await client.query(
        `${exists ? 'ALTER' : 'CREATE'} ROLE ${quoteIdentifier(role)} ${attributes}`,
    );
    logger?.debug({ role, action: exists ? 'alter' : 'create' }, 'prepareDatabase: роль');

    return !exists;
}

/**
 * Права ролей сервиса на БД `database` (не на `current_database()`: вызывающий может быть подключён к `postgres`):
 * владельцу — `CONNECT, CREATE` (схема журнала мигратора), приложению — только `CONNECT` (KT-19 п. 1).
 */
export async function grantDatabaseAccess(
    client: Pick<Client, 'query'>,
    service: string,
    database: string,
): Promise<void> {
    const roles = serviceRoles(service);
    const db = quoteIdentifier(database);
    await client.query(
        `GRANT CONNECT, CREATE ON DATABASE ${db} TO ${quoteIdentifier(roles.owner)}`,
    );
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${quoteIdentifier(roles.app)}`);
}

/**
 * Идемпотентно создаёт роли `<svc>_owner`, `<svc>_app` (LOGIN, NOBYPASSRLS), `<svc>_directory` (NOLOGIN, BYPASSRLS)
 * и схему `<svc>` владельца; повтор меняет пароли на переданные. Права на таблицы и FORCE RLS — SQL-миграции сервиса.
 * @throws {TypeError} имя сервиса вне формата (до подключения).
 */
export async function prepareDatabase(
    options: KitPrepareDatabaseOptions,
    logger?: Logger,
): Promise<KitPrepareDatabaseResult> {
    assertServiceName(options.service, 'prepareDatabase');
    const roles = serviceRoles(options.service);
    const pg = await loadPg();
    const client = new pg.Client({
        connectionString: options.adminUrl,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    // Ошибка простаивающего клиента до end() не должна ронять процесс.
    client.on('error', () => undefined);
    await client.connect();
    try {
        const created: string[] = [];
        const logins: ReadonlyArray<readonly [string, string]> = [
            [roles.owner, options.ownerPassword],
            [roles.app, options.appPassword],
        ];
        for (const [role, password] of logins) {
            const attributes = `${LOGIN_ATTRIBUTES} PASSWORD ${pg.escapeLiteral(password)}`;
            if (await upsertRole(client, role, attributes, logger)) {
                created.push(role);
            }
        }
        if (await upsertRole(client, roles.directory, DIRECTORY_ATTRIBUTES, logger)) {
            created.push(roles.directory);
        }
        // Владелец передаёт функции SECURITY DEFINER роли directory (ALTER FUNCTION … OWNER).
        await client.query(
            `GRANT ${quoteIdentifier(roles.directory)} TO ${quoteIdentifier(roles.owner)}`,
        );

        const { rows } = await client.query<{ database: string }>(
            'SELECT current_database() AS database',
        );
        const database = rows[0]?.database ?? '';
        await grantDatabaseAccess(client, options.service, database);

        const schema = quoteIdentifier(options.service);
        const owner = quoteIdentifier(roles.owner);
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${owner}`);
        await client.query(`ALTER SCHEMA ${schema} OWNER TO ${owner}`);
        await client.query(
            `GRANT USAGE ON SCHEMA ${schema} TO ${quoteIdentifier(roles.app)}, ${quoteIdentifier(roles.directory)}`,
        );
        logger?.info({ service: options.service, database, created }, 'prepareDatabase: готово');

        return { database, roles: [roles.owner, roles.app, roles.directory], created };
    } finally {
        await client.end();
    }
}
