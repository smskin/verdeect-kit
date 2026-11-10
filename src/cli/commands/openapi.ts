// Команда `verdeect-kit openapi --out <файл> [--module <файл>#<экспорт>]` (prd.md §3.5, AC-3.7, AC-3.8). Документ —
// buildOpenApiDocument по метаданным модуля сервиса без создания приложения; окружение сервиса не нужно. title и version
// — из package.json в cwd; рядом с --out — contracts/openapi.extra.json (глубокое слияние). Подпути пакета загружаются
// динамическим import() (ARCHITECTURE.md «CLI»). CLI разбирает только свои ключи окружения (LOG_LEVEL, REPLICA_ID).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { pino, type Logger } from 'pino';
import { z } from 'zod';

/** Модуль сервиса по умолчанию (§3.5), относительно cwd. */
const DEFAULT_MODULE = 'dist/app.module.js#AppModule';

/** Окружение команды. */
export interface OpenApiCommandContext {
    /** Рабочий каталог (корень проекта сервиса). */
    readonly cwd: string;
    /** Запись строки результата в stdout. */
    readonly write: (line: string) => void;
}

const defaultContext: OpenApiCommandContext = {
    cwd: process.cwd(),
    write: (line) => void process.stdout.write(line),
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

async function createLogger(): Promise<Logger> {
    const [{ envBase }, { createLoggerOptions }] = await Promise.all([
        import('../../config/index.js'),
        import('../../observability/index.js'),
    ]);
    const parsed = z
        .object({ LOG_LEVEL: envBase.LOG_LEVEL, REPLICA_ID: envBase.REPLICA_ID })
        .safeParse(process.env);
    if (!parsed.success) {
        // Только имена ключей: значения окружения не выводятся.
        const keys = [
            ...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.'))),
        ];
        throw new CommandError('INVALID_ENVIRONMENT', 'Неверное окружение', { keys });
    }

    return pino(
        ...createLoggerOptions({ service: 'verdeect-kit', entry: 'cli', env: parsed.data })
            .pinoHttp,
    );
}

async function packageInfo(cwd: string): Promise<{ title: string; version: string }> {
    const path = join(cwd, 'package.json');
    let manifest: unknown;
    try {
        manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch {
        throw new CommandError('INVALID_PACKAGE_JSON', `нет или не разобран ${path}`);
    }
    const parsed = z
        .object({ name: z.string().min(1), version: z.string().min(1) })
        .safeParse(manifest);
    if (!parsed.success) {
        throw new CommandError(
            'INVALID_PACKAGE_JSON',
            `в ${path} нужны поля name и version (info.version обязателен в OpenAPI 3.1)`,
        );
    }

    return { title: parsed.data.name, version: parsed.data.version };
}

async function loadModule(cwd: string, spec: string): Promise<unknown> {
    const hash = spec.lastIndexOf('#');
    const file = hash === -1 ? spec : spec.slice(0, hash);
    const name = hash === -1 ? 'AppModule' : spec.slice(hash + 1);
    const path = resolve(cwd, file);
    if (!existsSync(path)) {
        throw new CommandError('MODULE_NOT_FOUND', `файл модуля не найден: ${file}`);
    }
    const loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    const module = loaded[name];
    if (module === undefined) {
        throw new CommandError('MODULE_NOT_FOUND', `в ${file} нет экспорта ${name}`);
    }

    return module;
}

async function readExtra(path: string): Promise<Record<string, unknown> | null> {
    if (!existsSync(path)) {
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(await readFile(path, 'utf8'));
    } catch {
        throw new CommandError('INVALID_EXTRA', `${path}: не разобран как JSON`);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new CommandError('INVALID_EXTRA', `${path}: ожидается объект JSON`);
    }

    return value as Record<string, unknown>;
}

/** Опции команды; неизвестная опция или опция без значения — `USAGE`. */
function parseOptions(args: readonly string[]): { out?: string; module?: string } {
    try {
        return parseArgs({
            args: [...args],
            options: { out: { type: 'string' }, module: { type: 'string' } },
            strict: true,
        }).values;
    } catch (error) {
        throw new CommandError('USAGE', error instanceof Error ? error.message : String(error));
    }
}

async function run(args: readonly string[], context: OpenApiCommandContext): Promise<void> {
    const values = parseOptions(args);
    if (values.out === undefined) {
        throw new CommandError('USAGE', 'нужна опция --out <файл>');
    }
    const logger = await createLogger();
    logger.debug({ command: 'openapi' }, 'cli: команда');
    const info = await packageInfo(context.cwd);
    const module = await loadModule(context.cwd, values.module ?? DEFAULT_MODULE);
    const { buildOpenApiDocument, deepMerge } = await import('../../http/api/openapi-document.js');
    const out = resolve(context.cwd, values.out);
    const built = await buildOpenApiDocument(
        module as Parameters<typeof buildOpenApiDocument>[0],
        info,
        logger,
    );
    const extra = await readExtra(join(dirname(out), 'openapi.extra.json'));
    const document = extra === null ? { ...built } : deepMerge({ ...built }, extra);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    const operations = Object.values(built.paths).reduce(
        (count, item) => count + Object.keys(item).length,
        0,
    );
    logger.info({ out: values.out, operations }, 'openapi: записан');
    context.write(`${JSON.stringify({ written: values.out, operations })}\n`);
}

/** Обработчик команды `openapi`: 0 — документ записан, 1 — ошибка (JSON `{error}` в stdout). */
export async function openapiCommand(
    args: readonly string[],
    context: OpenApiCommandContext = defaultContext,
): Promise<number> {
    try {
        await run(args, context);

        return 0;
    } catch (error) {
        const failure =
            error instanceof CommandError
                ? { code: error.code, message: error.message, ...error.extra }
                : {
                      code: 'OPENAPI_FAILED',
                      message: error instanceof Error ? error.message : String(error),
                  };
        process.stderr.write(`${JSON.stringify({ level: 'error', ...failure })}\n`);
        context.write(`${JSON.stringify({ error: failure })}\n`);

        return 1;
    }
}
