// assertAppRoleIsNotOwner, assertStrictTenantIsolation (prd.md §3.8, AC-4.6, AC-4.8). Проверки — по каталогу PostgreSQL
// под ролью приложения; pg не импортируется: db — объект с query.

/** Соединение с методом `query` (`pg.Pool`, `pg.Client`, `PoolClient`). */
export interface KitQueryable {
    /** Запрос с параметрами; строки результата. */
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const USER_SCHEMAS = `nspname not in ('pg_catalog', 'information_schema') and nspname not like 'pg\\_toast%' and nspname not like 'pg\\_temp%'`;

async function rows<T>(db: KitQueryable, text: string): Promise<T[]> {
    return (await db.query(text)).rows as T[];
}

/**
 * Роль соединения — роль приложения, а не владелец (AC-4.6): не суперпользователь, без `BYPASSRLS`, не владеет
 * схемами и таблицами, без `CREATE` на базе и схемах (KT-19 п. 1).
 * @throws {Error} «assertAppRoleIsNotOwner: <роль>: <нарушения через «; »>».
 */
export async function assertAppRoleIsNotOwner(db: KitQueryable): Promise<void> {
    const violations: string[] = [];
    const [role] = await rows<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        db,
        'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    if (role?.rolsuper === true) {
        violations.push('суперпользователь');
    }
    if (role?.rolbypassrls === true) {
        violations.push('BYPASSRLS');
    }
    const owner = '(select oid from pg_roles where rolname = current_user)';
    const schemas = await rows<{ nspname: string }>(
        db,
        `select nspname from pg_namespace where nspowner = ${owner} and ${USER_SCHEMAS} order by nspname`,
    );
    if (schemas.length > 0) {
        violations.push(`владеет схемами ${schemas.map((row) => row.nspname).join(', ')}`);
    }
    const tables = await rows<{ name: string }>(
        db,
        `select n.nspname || '.' || c.relname as name from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where c.relowner = ${owner} and ${USER_SCHEMAS.replaceAll('nspname', 'n.nspname')}
         order by 1`,
    );
    if (tables.length > 0) {
        violations.push(`владеет объектами ${tables.map((row) => row.name).join(', ')}`);
    }
    const [database] = await rows<{ name: string; create: boolean }>(
        db,
        `select current_database() as name, has_database_privilege(current_user, current_database(), 'CREATE') as create`,
    );
    if (database?.create === true) {
        violations.push(`CREATE на базе ${database.name}`);
    }
    const creatable = await rows<{ nspname: string }>(
        db,
        `select nspname from pg_namespace where ${USER_SCHEMAS} and has_schema_privilege(current_user, oid, 'CREATE') order by nspname`,
    );
    for (const schema of creatable) {
        violations.push(`CREATE на схеме ${schema.nspname}`);
    }
    if (violations.length > 0) {
        throw new Error(
            `assertAppRoleIsNotOwner: ${role?.rolname ?? 'неизвестная роль'}: ${violations.join('; ')}`,
        );
    }
}

/** Опции `assertStrictTenantIsolation`. */
export interface KitTenantIsolationOptions {
    /** Схема сервиса. */
    readonly schema: string;
    /**
     * Таблицы, которые проверка пропускает целиком: только таблицы, где колонка `tenant` не означает компанию; каждое
     * исключение — с причиной в тесте сервиса.
     */
    readonly except?: readonly string[];
}

/** Формы политик PostgreSQL 17 (`pg_policies.qual`) для `tenantPolicy` и `createIdempotencyTable`. */
const TENANT_POLICY = "(tenant = current_setting('app.tenant'::text, true))";
const IDEMPOTENCY_POLICY =
    "(NOT (tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant'::text, true), ''::text)))";
const IDEMPOTENCY_TABLE = 'idempotency_key';
const OUTBOX_TABLE = 'outbox';

/** Без внешних скобок и пробелов, в нижнем регистре. */
function normalize(expression: string | null): string {
    let text = (expression ?? '').replace(/\s+/g, '').toLowerCase();
    while (text.startsWith('(') && text.endsWith(')') && balanced(text.slice(1, -1))) {
        text = text.slice(1, -1);
    }

    return text;
}

function balanced(text: string): boolean {
    let depth = 0;
    for (const char of text) {
        depth += char === '(' ? 1 : char === ')' ? -1 : 0;
        if (depth < 0) {
            return false;
        }
    }

    return depth === 0;
}

function quote(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

interface PolicyRow {
    readonly policyname: string;
    readonly permissive: string;
    readonly cmd: string;
    readonly qual: string | null;
    readonly with_check: string | null;
}

/** Соединение для транзакции: клиент пула (`pg.Pool` — `connect` и `totalCount`) или само соединение. */
async function withConnection<T>(
    db: KitQueryable,
    work: (connection: KitQueryable) => Promise<T>,
): Promise<T> {
    const pool = db as KitQueryable & {
        connect?: () => Promise<KitQueryable & { release: () => void }>;
    };
    if (typeof pool.connect !== 'function' || !('totalCount' in db)) {
        return work(db);
    }
    const client = await pool.connect();
    try {
        return await work(client);
    } finally {
        client.release();
    }
}

async function policyViolations(
    db: KitQueryable,
    schema: string,
    table: string,
): Promise<string[]> {
    const policies = (
        await db.query(
            'select policyname, permissive, cmd, qual, with_check from pg_policies where schemaname = $1 and tablename = $2',
            [schema, table],
        )
    ).rows as PolicyRow[];
    if (policies.length === 0) {
        return [`${table}: нет политики`];
    }
    if (table === OUTBOX_TABLE) {
        return [];
    }
    const expected = normalize(table === IDEMPOTENCY_TABLE ? IDEMPOTENCY_POLICY : TENANT_POLICY);

    return policies
        .filter(
            (policy) =>
                policy.permissive !== 'PERMISSIVE' ||
                policy.cmd !== 'ALL' ||
                normalize(policy.qual) !== expected ||
                normalize(policy.with_check) !== expected,
        )
        .map((policy) => `${table}.${policy.policyname}: нестрогая политика`);
}

async function visibleRows(db: KitQueryable, schema: string, table: string): Promise<string[]> {
    const filter = table === IDEMPOTENCY_TABLE ? ' where tenant is not null' : '';

    return withConnection(db, async (connection) => {
        await connection.query('begin');
        try {
            await connection.query("select set_config('app.tenant', '', true)");
            const { rows } = await connection.query(
                `select count(*)::int as count from ${quote(schema)}.${quote(table)}${filter}`,
            );
            const count = (rows[0] as { count?: number } | undefined)?.count ?? 0;

            return count > 0
                ? [`${table}: под ролью приложения с пустым тенантом видно ${count} строк`]
                : [];
        } catch (error) {
            if ((error as { code?: unknown }).code === '42501') {
                return [`${table}: у роли приложения нет SELECT`];
            }
            throw error;
        } finally {
            await connection.query('rollback');
        }
    });
}

/** Функция очистки — по точной сигнатуре `idempotency_purge(integer)`; другая перегрузка — «функции нет» (KT-22 п. 7). */
async function purgeViolations(db: KitQueryable, schema: string): Promise<string[]> {
    const name = `${schema}.idempotency_purge`;
    const [fn] = (
        await db.query(
            `select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig,
                    has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
             from pg_proc p
             where p.oid = to_regprocedure($1)`,
            [`${quote(schema)}.idempotency_purge(integer)`],
        )
    ).rows as {
        prosecdef: boolean;
        owner: string;
        proconfig: string[] | null;
        public_execute: boolean;
    }[];
    if (fn === undefined) {
        return [`нет функции ${name} (idempotencyPurgeSql)`];
    }
    const violations: string[] = [];
    if (!fn.prosecdef) {
        violations.push(`${name}: не SECURITY DEFINER`);
    }
    if (fn.owner !== `${schema}_directory`) {
        violations.push(`${name}: владелец ${fn.owner}, нужен ${schema}_directory`);
    }
    if (!(fn.proconfig ?? []).some((item) => item.startsWith('search_path='))) {
        violations.push(`${name}: search_path не задан`);
    }
    if (fn.public_execute) {
        violations.push(`${name}: EXECUTE у PUBLIC`);
    }

    return violations;
}

/**
 * Строгий RLS схемы сервиса (§3.8, AC-4.8) — соединение **роли приложения**: каждая таблица с колонкой `tenant` — RLS,
 * `FORCE`, строгая политика (`tenantPolicy`; `idempotency_key` — `createIdempotencyTable`; `outbox` — только наличие
 * политики до E5); под пустым тенантом 0 строк (вызывать после вставки данных фабриками); при таблице идемпотентности —
 * функция `idempotency_purge` `SECURITY DEFINER`, владелец `<svc>_directory`, `search_path`, без `EXECUTE` у `PUBLIC`.
 * @throws {Error} «assertStrictTenantIsolation(<схема>): <нарушения через «; »>».
 */
export async function assertStrictTenantIsolation(
    db: KitQueryable,
    options: KitTenantIsolationOptions,
): Promise<void> {
    const { schema } = options;
    const except = new Set(options.except ?? []);
    const tables = (
        await db.query(
            `select c.relname, c.relrowsecurity, c.relforcerowsecurity
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant' and not a.attisdropped
             where n.nspname = $1 and c.relkind in ('r', 'p') order by c.relname collate "C"`,
            [schema],
        )
    ).rows as { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[];
    const violations: string[] = [];
    if (tables.length === 0) {
        violations.push('в схеме нет таблиц с колонкой tenant');
    }
    for (const table of tables.filter((item) => !except.has(item.relname))) {
        const name = table.relname;
        if (!table.relrowsecurity) {
            violations.push(`${name}: RLS не включён`);
        }
        if (!table.relforcerowsecurity) {
            violations.push(`${name}: нет FORCE ROW LEVEL SECURITY`);
        }
        violations.push(...(await policyViolations(db, schema, name)));
        if (name !== OUTBOX_TABLE) {
            violations.push(...(await visibleRows(db, schema, name)));
        }
    }
    if (tables.some((item) => item.relname === IDEMPOTENCY_TABLE && !except.has(item.relname))) {
        violations.push(...(await purgeViolations(db, schema)));
    }
    if (violations.length > 0) {
        throw new Error(`assertStrictTenantIsolation(${schema}): ${violations.join('; ')}`);
    }
}
