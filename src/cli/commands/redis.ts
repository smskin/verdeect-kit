// Команда verdeect-kit redis acl (prd.md §3.7, UC-12; D3 плана E8): aclfile Redis — `user default off`, пользователи
// сервисов с sha256 паролей из REDIS_PASSWORD_HASH_<SVC>, ключи и каналы <svc>:*. Образец — commands/rabbitmq.ts. Без
// ioredis: только internal/redis-acl динамическим import(). aclfile — не JSON, поэтому --out обязателен.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { z } from 'zod';

/** Окружение команды. */
export interface RedisCommandContext {
    /** Рабочий каталог (от него — путь `--out`). */
    readonly cwd: string;
    /** Запись результата в stdout. */
    readonly write: (text: string) => void;
    /** Переменные окружения (по умолчанию `process.env`). */
    readonly env: Readonly<Record<string, string | undefined>>;
}

const defaultContext: RedisCommandContext = {
    cwd: process.cwd(),
    write: (text) => void process.stdout.write(text),
    env: process.env,
};

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

async function createLogger(env: RedisCommandContext['env']): Promise<Logger> {
    const [{ envBase }, { createLoggerOptions }] = await Promise.all([
        import('../../config/fragments.js'),
        import('../../observability/logger-options.js'),
    ]);
    const parsed = z
        .object({ LOG_LEVEL: envBase.LOG_LEVEL, REPLICA_ID: envBase.REPLICA_ID })
        .safeParse(env);
    if (!parsed.success) {
        const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
        throw new CommandError('INVALID_ENVIRONMENT', 'Неверное окружение', { keys });
    }

    return pino(
        ...createLoggerOptions({ service: 'verdeect-kit', entry: 'cli', env: parsed.data })
            .pinoHttp,
    );
}

function parseOptions(args: readonly string[]): { services?: string; out?: string } {
    try {
        return parseArgs({
            args: [...args],
            strict: true,
            options: { services: { type: 'string' }, out: { type: 'string' } },
        }).values;
    } catch (error) {
        throw new CommandError('USAGE', error instanceof Error ? error.message : String(error));
    }
}

/** Копия servicesOf из rabbitmq.ts: та бросает свой CommandError, и failureOf здесь его не узнал бы. */
async function servicesOf(raw: string | undefined): Promise<string[]> {
    const services = (raw ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
    if (services.length === 0) {
        throw new CommandError('USAGE', 'нужна опция --services <svc,…>');
    }
    const { SERVICE_NAME_PATTERN } = await import('../../internal/service-name.js');
    const bad = services.find((name) => !SERVICE_NAME_PATTERN.test(name));
    if (bad !== undefined) {
        throw new CommandError(
            'USAGE',
            `--services: имя «${bad}» вне формата ^[a-z][a-z0-9-]{1,31}$`,
        );
    }
    if (new Set(services).size !== services.length) {
        throw new CommandError('USAGE', '--services: имя указано дважды');
    }

    return services;
}

async function acl(
    args: readonly string[],
    context: RedisCommandContext,
    logger: Logger,
): Promise<void> {
    const values = parseOptions(args);
    const services = await servicesOf(values.services);
    if (values.out === undefined) {
        throw new CommandError('USAGE', 'нужна опция --out <файл>: aclfile — не JSON');
    }
    const { buildRedisAclFile, redisPasswordHashKey, REDIS_PASSWORD_HASH } =
        await import('../../internal/redis-acl.js');
    // Только имена ключей в ошибке: значения хешей не выводятся.
    const keys: string[] = [];
    const users = services.map((service) => {
        const key = redisPasswordHashKey(service);
        const hash = context.env[key] ?? '';
        if (!REDIS_PASSWORD_HASH.test(hash)) {
            keys.push(key);
        }

        return { service, passwordHash: hash };
    });
    if (keys.length > 0) {
        throw new CommandError('INVALID_ENVIRONMENT', 'Неверное окружение', { keys });
    }
    const out = resolve(context.cwd, values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buildRedisAclFile({ users }));
    context.write(`${JSON.stringify({ out, services })}\n`);
    logger.info({ services, out }, 'redis acl: собрано');
}

function failureOf(error: unknown): Record<string, unknown> {
    if (error instanceof CommandError) {
        return { code: error.code, message: error.message, ...error.extra };
    }

    return { code: 'REDIS_COMMAND_FAILED', message: 'команда redis завершилась ошибкой' };
}

/** Обработчик команды `redis`: 0 — aclfile записан, 1 — ошибка (JSON `{error}` в stdout). */
export async function redisCommand(
    args: readonly string[],
    context: RedisCommandContext = defaultContext,
): Promise<number> {
    try {
        if (args[0] !== 'acl') {
            throw new CommandError('USAGE', 'подкоманда redis: acl');
        }
        const logger = await createLogger(context.env);
        logger.debug({ command: 'redis', sub: 'acl' }, 'cli: команда');
        await acl(args.slice(1), context, logger);

        return 0;
    } catch (error) {
        const failure = failureOf(error);
        process.stderr.write(`${JSON.stringify({ level: 'error', ...failure })}\n`);
        context.write(`${JSON.stringify({ error: failure })}\n`);

        return 1;
    }
}
