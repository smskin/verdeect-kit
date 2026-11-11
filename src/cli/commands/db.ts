// Команда verdeect-kit db prepare|migrate|move-journal (prd.md §3.3 v1.14, AC-4.17, UC-12). Эталон — O run-cli.ts
// (db:prepare, migrate). Подпути пакета — динамическим import() (ARCHITECTURE «CLI»); окружение — только prepareEnvSchema /
// migrateEnvSchema и LOG_LEVEL, REPLICA_ID логгера. Текст ошибок pg (имя роли, хост) не выводится.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { z } from 'zod';

/** Окружение команды. */
export interface DbCommandContext {
    /** Рабочий каталог (от него — путь `--folder`). */
    readonly cwd: string;
    /** Запись строки результата в stdout. */
    readonly write: (line: string) => void;
    /** Переменные окружения (по умолчанию `process.env`). */
    readonly env: Readonly<Record<string, string | undefined>>;
}

const defaultContext: DbCommandContext = {
    cwd: process.cwd(),
    write: (line) => void process.stdout.write(line),
    env: process.env,
};

const SUBCOMMANDS_MESSAGE = 'подкоманда db: prepare, migrate, move-journal';

/** Ошибка команды: JSON в stdout и код 1. */
class CommandError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly extra: Readonly<Record<string, unknown>> = {},
    ) {
        super(message);
    }
}

/** Только имена ключей: значения окружения не выводятся. */
function invalidEnvironment(error: z.ZodError): CommandError {
    const keys = [...new Set(error.issues.map((issue) => issue.path.map(String).join('.')))];

    return new CommandError('INVALID_ENVIRONMENT', 'Неверное окружение', { keys });
}

function parseEnv<T extends z.ZodType>(schema: T, env: DbCommandContext['env']): z.infer<T> {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        throw invalidEnvironment(parsed.error);
    }

    return parsed.data;
}

async function createLogger(env: DbCommandContext['env']): Promise<Logger> {
    const [{ envBase }, { createLoggerOptions }] = await Promise.all([
        import('../../config/index.js'),
        import('../../observability/index.js'),
    ]);
    const parsed = parseEnv(
        z.object({ LOG_LEVEL: envBase.LOG_LEVEL, REPLICA_ID: envBase.REPLICA_ID }),
        env,
    );

    return pino(
        ...createLoggerOptions({ service: 'verdeect-kit', entry: 'cli', env: parsed }).pinoHttp,
    );
}

/** Опции подкоманды; неизвестная опция или опция без значения — `USAGE`. */
function parseOptions<K extends string>(
    args: readonly string[],
    names: readonly K[],
): Partial<Record<K, string>> {
    const options = Object.fromEntries(names.map((name) => [name, { type: 'string' as const }]));
    try {
        return parseArgs({ args: [...args], options, strict: true }).values as Partial<
            Record<K, string>
        >;
    } catch (error) {
        throw new CommandError('USAGE', error instanceof Error ? error.message : String(error));
    }
}

function required<K extends string>(values: Partial<Record<K, string>>, names: readonly K[]): void {
    for (const name of names) {
        if (values[name] === undefined) {
            throw new CommandError('USAGE', `нужна опция --${name}`);
        }
    }
}

async function prepare(
    args: readonly string[],
    context: DbCommandContext,
    logger: Logger,
): Promise<unknown> {
    const values = parseOptions(args, ['service']);
    if (values.service === undefined) {
        throw new CommandError('USAGE', 'нужна опция --service <svc>');
    }
    const { SERVICE_NAME_PATTERN } = await import('../../internal/service-name.js');
    if (!SERVICE_NAME_PATTERN.test(values.service)) {
        throw new CommandError(
            'USAGE',
            '--service: имя сервиса вне формата ^[a-z][a-z0-9-]{1,31}$',
        );
    }
    const { prepareEnvSchema } = await import('../../config/cli-schemas.js');
    const env = parseEnv(prepareEnvSchema, context.env);
    const { prepareDatabase } = await import('../../database/prepare-database.js');
    const result = await prepareDatabase(
        {
            service: values.service,
            adminUrl: env.DATABASE_ADMIN_URL,
            ownerPassword: env.DB_OWNER_PASSWORD,
            appPassword: env.DB_APP_PASSWORD,
        },
        logger,
    );

    return { database: result.database, roles: result.roles, created: result.created };
}

async function migrate(
    args: readonly string[],
    context: DbCommandContext,
    logger: Logger,
): Promise<unknown> {
    const values = parseOptions(args, ['folder', 'schema']);
    required(values, ['folder', 'schema']);
    const { migrateEnvSchema } = await import('../../config/cli-schemas.js');
    const env = parseEnv(migrateEnvSchema, context.env);
    const { runMigrations } = await import('../../database/migrations.js');
    const schema = values.schema ?? '';
    const { applied } = await runMigrations(
        {
            url: env.DATABASE_MIGRATOR_URL,
            folder: resolve(context.cwd, values.folder ?? ''),
            schema,
        },
        logger,
    );

    return { schema, applied };
}

async function moveJournal(
    args: readonly string[],
    context: DbCommandContext,
    logger: Logger,
): Promise<unknown> {
    const values = parseOptions(args, ['from', 'to']);
    required(values, ['from', 'to']);
    const { migrateEnvSchema } = await import('../../config/cli-schemas.js');
    const env = parseEnv(migrateEnvSchema, context.env);
    const migrations = await import('../../database/migrations.js');
    const from = values.from ?? '';
    const to = values.to ?? '';
    const { moved } = await migrations.moveJournal(
        { url: env.DATABASE_MIGRATOR_URL, from, to },
        logger,
    );

    return { from, to, moved };
}

type Subcommand = (
    args: readonly string[],
    context: DbCommandContext,
    logger: Logger,
) => Promise<unknown>;

const SUBCOMMANDS: Readonly<Record<string, Subcommand>> = {
    prepare,
    migrate,
    'move-journal': moveJournal,
};

/** Перевод ошибки в JSON без адресов, паролей и текста pg; порядок проверок важен — ошибки pg тоже `Error`. */
async function failureOf(error: unknown): Promise<Record<string, unknown>> {
    if (error instanceof CommandError) {
        return { code: error.code, message: error.message, ...error.extra };
    }
    const { isConnectionError, sqlStateOf } = await import('../../internal/pg-errors.js');
    if (isConnectionError(error)) {
        return { code: 'DATABASE_UNAVAILABLE', message: 'БД недоступна' };
    }
    if (error instanceof TypeError || (error instanceof Error && error.name === 'KitUsageError')) {
        return { code: 'USAGE', message: error.message };
    }
    // SQLSTATE — по цепочке cause: у DrizzleQueryError код pg во вложенной ошибке (KT-22 п. 6).
    const code = sqlStateOf(error);
    const sqlState = code === null ? {} : { sqlState: code };

    return { code: 'DB_COMMAND_FAILED', message: 'команда db завершилась ошибкой', ...sqlState };
}

async function run(args: readonly string[], context: DbCommandContext): Promise<void> {
    const sub = args[0] ?? '';
    const handler = Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : undefined;
    if (handler === undefined) {
        throw new CommandError('USAGE', SUBCOMMANDS_MESSAGE);
    }
    const logger = await createLogger(context.env);
    logger.debug({ command: 'db', sub }, 'cli: команда');
    const result = await handler(args.slice(1), context, logger);
    context.write(`${JSON.stringify(result)}\n`);
}

/** Обработчик команды `db`: 0 — подкоманда выполнена, 1 — ошибка (JSON `{error}` в stdout). */
export async function dbCommand(
    args: readonly string[],
    context: DbCommandContext = defaultContext,
): Promise<number> {
    try {
        await run(args, context);

        return 0;
    } catch (error) {
        const failure = await failureOf(error);
        process.stderr.write(`${JSON.stringify({ level: 'error', ...failure })}\n`);
        context.write(`${JSON.stringify({ error: failure })}\n`);

        return 1;
    }
}
