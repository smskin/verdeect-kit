#!/usr/bin/env node
// CLI verdeect-kit (prd.md §3.5, AC-3.7; ARCHITECTURE.md «CLI»): разбор команды и динамическая загрузка только её
// обработчика (openapi, db, rabbitmq, crypto, redis). Результат — JSON в stdout, ошибка — JSON и код выхода 1. process.exit не вызывается: его вызывают только
// failStartup и сторож KitLifecycle; код выхода — process.exitCode.
import 'reflect-metadata';
import { parseArgs } from 'node:util';

/** Обработчик команды: аргументы после имени команды → код выхода. */
type CommandHandler = (args: readonly string[]) => Promise<number>;

const COMMANDS: Readonly<Record<string, () => Promise<CommandHandler>>> = {
    openapi: async () => (await import('./commands/openapi.js')).openapiCommand,
    db: async () => (await import('./commands/db.js')).dbCommand,
    rabbitmq: async () => (await import('./commands/rabbitmq.js')).rabbitmqCommand,
    crypto: async () => (await import('./commands/crypto.js')).cryptoCommand,
    redis: async () => (await import('./commands/redis.js')).redisCommand,
};

/** Точка входа: `verdeect-kit <команда> [опции]`. */
async function main(argv: readonly string[]): Promise<number> {
    const { positionals } = parseArgs({ args: [...argv], strict: false, allowPositionals: true });
    const command = positionals[0] ?? '';
    const load = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (load === undefined) {
        process.stdout.write(
            `${JSON.stringify({
                error: {
                    code: 'UNKNOWN_COMMAND',
                    message: `неизвестная команда «${command}»; доступны: ${Object.keys(COMMANDS).join(', ')}`,
                },
            })}\n`,
        );

        return 1;
    }
    const handler = await load();

    return handler(argv.slice(argv.indexOf(command) + 1));
}

process.exitCode = await main(process.argv.slice(2));
