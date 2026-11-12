// Команда verdeect-kit rabbitmq definitions (prd.md §3.4 M3, UC-12, AC-5.10): definitions.json для брокера — vhost,
// пользователи сервисов с хешами паролей из RABBITMQ_PASSWORD_HASH_<SVC> (П3), права, topic-права по --publishes, exchange verdeect.events. Образец —
// commands/db.ts. Без amqplib, pg и messaging: только internal/rabbitmq-definitions динамическим import().
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { z } from 'zod';

/** Окружение команды. */
export interface RabbitmqCommandContext {
    /** Рабочий каталог (от него — путь `--out`). */
    readonly cwd: string;
    /** Запись результата в stdout. */
    readonly write: (text: string) => void;
    /** Переменные окружения (по умолчанию `process.env`). */
    readonly env: Readonly<Record<string, string | undefined>>;
}

const defaultContext: RabbitmqCommandContext = {
    cwd: process.cwd(),
    write: (text) => void process.stdout.write(text),
    env: process.env,
};

/** base64 соли (4 байта) и sha256 (32 байта) — не короче 44 знаков. */
const HASH_FORMAT = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_HASH_LENGTH = 44;

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

async function createLogger(env: RabbitmqCommandContext['env']): Promise<Logger> {
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

function parseOptions(args: readonly string[]): {
    services?: string;
    out?: string;
    publishes?: string[];
    admin?: string;
} {
    try {
        return parseArgs({
            args: [...args],
            strict: true,
            options: {
                services: { type: 'string' },
                out: { type: 'string' },
                publishes: { type: 'string', multiple: true },
                admin: { type: 'string' },
            },
        }).values;
    } catch (error) {
        throw new CommandError('USAGE', error instanceof Error ? error.message : String(error));
    }
}

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

/** `--publishes <svc>=<префикс>[,<префикс>…]` (повторяемая) → префиксы по сервисам из `--services`. */
async function publishesOf(
    raw: readonly string[],
    services: readonly string[],
): Promise<Map<string, string[]>> {
    const { PUBLISH_PREFIX_PATTERN } = await import('../../internal/rabbitmq-definitions.js');
    const result = new Map<string, string[]>();
    for (const item of raw) {
        const at = item.indexOf('=');
        const service = item.slice(0, at).trim();
        if (at < 0 || !services.includes(service)) {
            throw new CommandError(
                'USAGE',
                `--publishes: «${item}» — нужен <svc>=<префикс>[,<префикс>…] для сервиса из --services`,
            );
        }
        const prefixes = item
            .slice(at + 1)
            .split(',')
            .map((prefix) => prefix.trim());
        const bad = prefixes.find((prefix) => !PUBLISH_PREFIX_PATTERN.test(prefix));
        if (bad !== undefined) {
            throw new CommandError(
                'USAGE',
                `--publishes: префикс «${bad}» вне формата ${PUBLISH_PREFIX_PATTERN.source}`,
            );
        }
        result.set(service, [...new Set([...(result.get(service) ?? []), ...prefixes])]);
    }

    return result;
}

/** `--admin <user>`: имя в формате сервиса и не совпадает с `--services` (§3.4 v1.24, только dev и e2e). */
async function adminOf(
    raw: string | undefined,
    services: readonly string[],
): Promise<string | undefined> {
    if (raw === undefined) {
        return undefined;
    }
    const { SERVICE_NAME_PATTERN } = await import('../../internal/service-name.js');
    if (!SERVICE_NAME_PATTERN.test(raw)) {
        throw new CommandError('USAGE', `--admin: имя «${raw}» вне формата ^[a-z][a-z0-9-]{1,31}$`);
    }
    if (services.includes(raw)) {
        throw new CommandError('USAGE', `--admin: имя «${raw}» совпадает с сервисом из --services`);
    }

    return raw;
}

async function definitions(
    args: readonly string[],
    context: RabbitmqCommandContext,
    logger: Logger,
): Promise<void> {
    const values = parseOptions(args);
    const services = await servicesOf(values.services);
    const publishes = await publishesOf(values.publishes ?? [], services);
    const admin = await adminOf(values.admin, services);
    const { buildDefinitions, passwordHashKey } =
        await import('../../internal/rabbitmq-definitions.js');
    // Только имена ключей в ошибке: значения хешей не выводятся.
    const keys: string[] = [];
    const users = services.map((service) => {
        const key = passwordHashKey(service);
        const hash = context.env[key] ?? '';
        if (hash.length < MIN_HASH_LENGTH || !HASH_FORMAT.test(hash)) {
            keys.push(key);
        }

        return { service, passwordHash: hash, publishes: publishes.get(service) ?? [] };
    });
    let adminUser: { user: string; passwordHash: string } | undefined;
    if (admin !== undefined) {
        const key = passwordHashKey(admin);
        const hash = context.env[key] ?? '';
        if (hash.length < MIN_HASH_LENGTH || !HASH_FORMAT.test(hash)) {
            keys.push(key);
        }
        adminUser = { user: admin, passwordHash: hash };
    }
    if (keys.length > 0) {
        throw new CommandError('INVALID_ENVIRONMENT', 'Неверное окружение', { keys });
    }
    if (adminUser !== undefined) {
        // Не зависит от LOG_LEVEL: файл с администратором не должен уйти в production незамеченным.
        process.stderr.write(
            `${JSON.stringify({ level: 'warn', code: 'ADMIN_USER', user: adminUser.user, message: 'rabbitmq definitions --admin: файл только для dev и e2e, в production не использовать' })}\n`,
        );
    }
    const json = `${JSON.stringify(buildDefinitions({ users, ...(adminUser === undefined ? {} : { admin: adminUser }) }), null, 2)}\n`;
    if (values.out === undefined) {
        context.write(json);
        logger.info({ services }, 'rabbitmq definitions: собрано');

        return;
    }
    const out = resolve(context.cwd, values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json);
    context.write(`${JSON.stringify({ out, services })}\n`);
    logger.info({ services, out }, 'rabbitmq definitions: собрано');
}

function failureOf(error: unknown): Record<string, unknown> {
    if (error instanceof CommandError) {
        return { code: error.code, message: error.message, ...error.extra };
    }

    return { code: 'RABBITMQ_COMMAND_FAILED', message: 'команда rabbitmq завершилась ошибкой' };
}

/** Обработчик команды `rabbitmq`: 0 — definitions собраны, 1 — ошибка (JSON `{error}` в stdout). */
export async function rabbitmqCommand(
    args: readonly string[],
    context: RabbitmqCommandContext = defaultContext,
): Promise<number> {
    try {
        if (args[0] !== 'definitions') {
            throw new CommandError('USAGE', 'подкоманда rabbitmq: definitions');
        }
        const logger = await createLogger(context.env);
        logger.debug({ command: 'rabbitmq', sub: 'definitions' }, 'cli: команда');
        await definitions(args.slice(1), context, logger);

        return 0;
    } catch (error) {
        const failure = failureOf(error);
        process.stderr.write(`${JSON.stringify({ level: 'error', ...failure })}\n`);
        context.write(`${JSON.stringify({ error: failure })}\n`);

        return 1;
    }
}
