// Команда verdeect-kit crypto generate-secret [--bytes N] (prd.md §3.6, UC-10, AC-7.5): секрет base64url для
// ENCRYPTION_KEYS. Образец — commands/rabbitmq.ts. Без pg, ioredis, amqplib: только crypto динамическим import().
import { parseArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { z } from 'zod';

/** Окружение команды. */
export interface CryptoCommandContext {
    /** Запись результата в stdout. */
    readonly write: (text: string) => void;
    /** Переменные окружения (по умолчанию `process.env`). */
    readonly env: Readonly<Record<string, string | undefined>>;
}

const defaultContext: CryptoCommandContext = {
    write: (text) => void process.stdout.write(text),
    env: process.env,
};

const DEFAULT_BYTES = 32;
const BYTES_USAGE = '--bytes — целое не меньше 32';

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

async function createLogger(env: CryptoCommandContext['env']): Promise<Logger> {
    const [{ envBase }, { createLoggerOptions }] = await Promise.all([
        import('../../config/index.js'),
        import('../../observability/index.js'),
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

/** Разбор `generate-secret [--bytes N]` → число байт. */
function bytesOf(args: readonly string[]): number {
    let parsed: { values: { bytes?: string }; positionals: string[] };
    try {
        parsed = parseArgs({
            args: [...args],
            strict: true,
            allowPositionals: true,
            options: { bytes: { type: 'string' } },
        });
    } catch (error) {
        throw new CommandError('USAGE', error instanceof Error ? error.message : String(error));
    }
    const [sub, ...rest] = parsed.positionals;
    if (sub !== 'generate-secret' || rest.length > 0) {
        throw new CommandError('USAGE', 'подкоманда crypto: generate-secret [--bytes N]');
    }
    const raw = parsed.values.bytes;
    if (raw === undefined) {
        return DEFAULT_BYTES;
    }
    if (!/^\d+$/.test(raw) || Number(raw) < DEFAULT_BYTES) {
        throw new CommandError('USAGE', BYTES_USAGE);
    }

    return Number(raw);
}

function failureOf(error: unknown): Record<string, unknown> {
    if (error instanceof CommandError) {
        return { code: error.code, message: error.message, ...error.extra };
    }

    return { code: 'CRYPTO_COMMAND_FAILED', message: 'команда crypto завершилась ошибкой' };
}

/** Обработчик команды `crypto`: 0 — секрет в stdout `{"secret":"…"}`, 1 — ошибка (JSON `{error}` в stdout). */
export async function cryptoCommand(
    args: readonly string[],
    context: CryptoCommandContext = defaultContext,
): Promise<number> {
    try {
        const bytes = bytesOf(args);
        const logger = await createLogger(context.env);
        // Только число байт: секрет в лог не попадает.
        logger.debug(
            { command: 'crypto', sub: 'generate-secret', bytes },
            `crypto generate-secret: ${bytes} байт`,
        );
        const { generateSecret } = await import('../../crypto/index.js');
        context.write(`${JSON.stringify({ secret: generateSecret(bytes) })}\n`);

        return 0;
    } catch (error) {
        const failure = failureOf(error);
        process.stderr.write(`${JSON.stringify({ level: 'error', ...failure })}\n`);
        context.write(`${JSON.stringify({ error: failure })}\n`);

        return 1;
    }
}
