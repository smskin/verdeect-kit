// Разбор команды CLI verdeect-kit и справка (prd.md §3.5, §3.8 v1.26, AC-3.7, AC-9.7; ARCHITECTURE.md «CLI»): одна
// таблица команд — для загрузки обработчика и для справки; обработчик грузится динамически только для выполняемой
// команды. main.ts только вызывает runCli: логика проверяется unit-тестом без процесса.
import { parseArgs } from 'node:util';

/** Обработчик команды: аргументы после имени команды → код выхода. */
type CommandHandler = (args: readonly string[]) => Promise<number>;

/** Запись вывода CLI: stdout — данные (JSON, справка), stderr — диагностика. */
export interface CliIo {
    /** Запись в stdout. */
    stdout(text: string): void;
    /** Запись в stderr. */
    stderr(text: string): void;
}

interface CommandEntry {
    /** Ленивый загрузчик обработчика. */
    readonly load: () => Promise<CommandHandler>;
    /** Формы вызова — как в таблице CLI README. */
    readonly forms: readonly string[];
}

const COMMANDS: Readonly<Record<string, CommandEntry>> = {
    openapi: {
        load: async () => (await import('./commands/openapi.js')).openapiCommand,
        forms: ['openapi --out <f> [--module <f>#<export>]'],
    },
    db: {
        load: async () => (await import('./commands/db.js')).dbCommand,
        forms: [
            'db prepare --service <svc>',
            'db migrate --folder <p> --schema <svc>',
            'db move-journal --from <s> --to <svc>',
        ],
    },
    rabbitmq: {
        load: async () => (await import('./commands/rabbitmq.js')).rabbitmqCommand,
        forms: [
            'rabbitmq definitions --services <svc,…> [--publishes <svc>=<prefix>,…] [--admin <user>] [--out <f>]',
        ],
    },
    redis: {
        load: async () => (await import('./commands/redis.js')).redisCommand,
        forms: ['redis acl --services <svc,…> --out <f>'],
    },
    crypto: {
        load: async () => (await import('./commands/crypto.js')).cryptoCommand,
        forms: ['crypto generate-secret [--bytes N]'],
    },
};

const HELP_FLAGS = new Set(['--help', '-h']);

/** Справка: строка на форму. */
function usage(commands: readonly string[]): string {
    const lines = commands.flatMap((name) =>
        (COMMANDS[name]?.forms ?? []).map((form) => `  verdeect-kit ${form}`),
    );

    return `Использование:\n${lines.join('\n')}\n`;
}

/**
 * Выполняет CLI: без аргументов, `help` или `--help` первым — справка в stdout, 0; `<команда> --help` — формы команды,
 * 0 (обработчик не грузится); неизвестная команда — JSON `UNKNOWN_COMMAND` в stdout и справка в stderr, 1; иначе —
 * обработчик команды.
 * @returns код выхода.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
    const { positionals } = parseArgs({ args: [...argv], strict: false, allowPositionals: true });
    const first = argv[0];
    const all = Object.keys(COMMANDS);
    if (first === undefined || first === 'help' || HELP_FLAGS.has(first)) {
        io.stdout(usage(all));

        return 0;
    }
    const command = positionals[0] ?? '';
    const entry = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
    if (entry === undefined) {
        io.stdout(
            `${JSON.stringify({
                error: {
                    code: 'UNKNOWN_COMMAND',
                    message: `неизвестная команда «${command}»; доступны: ${all.join(', ')}`,
                },
            })}\n`,
        );
        io.stderr(usage(all));

        return 1;
    }
    const args = argv.slice(argv.indexOf(command) + 1);
    if (args.some((arg) => HELP_FLAGS.has(arg))) {
        io.stdout(usage([command]));

        return 0;
    }
    const handler = await entry.load();

    return handler(args);
}
