// Чтение файлов репозитория сервиса для assertRepoConventions (prd.md §3.8, AC-1.8): compose, env_file, CI, Dockerfile,
// package.json, src/redaction.ts. Разбор compose — эталон O test/support/compose-env.spec.ts (yaml, merge, !reset);
// образы в тексте CI — эталон BFF test/image-tags.spec.ts (тег по regex, адреса вида postgres:5432 — не образ).
// Всё синхронно; пути в результатах — относительно root, через `/`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { parse, Scalar, YAMLMap, YAMLSeq, type CollectionTag, type ScalarTag } from 'yaml';

/** Значение `!reset` Compose: ключ сброшен к умолчанию, значение базового файла не наследуется. */
export const RESET: unique symbol = Symbol('compose !reset');

/** Поле сервиса Compose: значение, `RESET` или undefined — ключа нет (наследуется из базового файла). */
export type ComposeField<T> = T | typeof RESET | undefined;

/** `command:` / `entrypoint:` Compose: массив (argv) или строка (Compose делит её на слова без shell). */
export type ComposeCommand = readonly string[] | string;

/** `build:` Compose: путь Dockerfile относительно root и стадия (`target`) или null — последняя стадия. */
export interface ComposeBuild {
    /** Путь Dockerfile относительно root, через `/`. */
    readonly dockerfile: string;
    /** Стадия `target:` или null. */
    readonly target: string | null;
}

/** Сервис compose-файла (как записан в файле, без слияния с базовым файлом). */
export interface ComposeService {
    /** Путь compose-файла относительно root. */
    readonly file: string;
    /** `name:` верхнего уровня файла или null: свой `name:` — отдельный проект, с базовым файлом не сливается. */
    readonly project: string | null;
    /** Имя сервиса. */
    readonly name: string;
    /** Значение `image:` или null. */
    readonly image: string | null;
    /** environment ∪ env_file (environment перекрывает); null — ключ без значения. */
    readonly env: ReadonlyMap<string, string | null>;
    /** Ключ → файл, где он задан (compose или env-файл), относительно root. */
    readonly envSource: ReadonlyMap<string, string>;
    /** environment / env_file: `merge` — слияние с базовым, `reset` — `!reset`, `override` — `!override`. */
    readonly envMode: 'merge' | 'reset' | 'override';
    /** `stop_grace_period:`. */
    readonly stopGracePeriod: ComposeField<string>;
    /** `command:`. */
    readonly command: ComposeField<ComposeCommand>;
    /** `entrypoint:`. */
    readonly entrypoint: ComposeField<ComposeCommand>;
    /** `build:`. */
    readonly build: ComposeField<ComposeBuild>;
}

/** CMD или ENTRYPOINT: exec-форма (массив) или shell-форма (строка). */
export interface LaunchInstruction {
    /** Exec-форма или null — shell-форма. */
    readonly exec: readonly string[] | null;
    /** Текст инструкции после CMD/ENTRYPOINT. */
    readonly shell: string;
}

/** Стадия Dockerfile с итоговыми ENTRYPOINT и CMD (с учётом наследования `FROM <стадия>`). */
export interface DockerStage {
    /** Путь Dockerfile относительно root. */
    readonly file: string;
    /** Имя стадии (`AS <имя>`) или null. */
    readonly name: string | null;
    /** Последняя стадия файла (собирается без `target`). */
    readonly last: boolean;
    /** Итоговый ENTRYPOINT или null. */
    readonly entrypoint: LaunchInstruction | null;
    /** Итоговый CMD или null. */
    readonly cmd: LaunchInstruction | null;
}

/** Манифест package.json. */
export interface Manifest {
    /** Путь относительно root. */
    readonly file: string;
    /** dependencies ∪ devDependencies (имя → версия). */
    readonly dependencies: ReadonlyMap<string, string>;
    /** scripts.start или null. */
    readonly start: string | null;
}

/** Текстовый файл репозитория. */
export interface TextFile {
    /** Путь относительно root. */
    readonly file: string;
    /** Содержимое. */
    readonly text: string;
}

/** Файлы репозитория сервиса, разобранные для правил §3.8. */
export interface RepoFiles {
    /** Сервисы всех compose-файлов корня. */
    readonly compose: readonly ComposeService[];
    /** CI-файлы: .gitlab-ci.yml, .github/workflows/*.yml|yaml. */
    readonly ci: readonly TextFile[];
    /** Стадии Dockerfile корня и apps/*. */
    readonly docker: readonly DockerStage[];
    /** package.json корня, apps/*, packages/*. */
    readonly manifests: readonly Manifest[];
    /** src/redaction.ts и apps/*\/src/redaction.ts. */
    readonly redaction: readonly TextFile[];
}

const COMPOSE_FILE = /^(docker-)?compose(\.[\w-]+)*\.ya?ml$/;
const DOCKERFILE = /^Dockerfile(\.[\w-]+)?$/;
const WORKFLOW_FILE = /\.ya?ml$/;

/**
 * Предел раскрытий алиасов YAML на файл compose. Умолчание yaml (100) меньше реальных файлов с x-* якорями и `<<:`
 * (verdeect-orchestrator compose.e2e.yml); предел конечный: файл сверх него — ошибка разбора с именем файла, а не
 * зависание на «бомбе алиасов».
 */
const MAX_ALIAS_COUNT = 1000;

/** Метки тегов Compose в результате разбора yaml (строки: yaml оборачивает их в скаляр). */
const RESET_MARK = '\u0000kit:reset';
const OVERRIDE_MARK = '\u0000kit:override';

// Теги Compose: !reset — сброс значения к умолчанию, !override — замена значения базового файла вместо слияния.
const CUSTOM_TAGS: (ScalarTag | CollectionTag)[] = [
    { tag: '!reset', resolve: () => RESET_MARK },
    { tag: '!reset', collection: 'map', nodeClass: YAMLMap, resolve: () => new Scalar(RESET_MARK) },
    { tag: '!reset', collection: 'seq', nodeClass: YAMLSeq, resolve: () => new Scalar(RESET_MARK) },
    { tag: '!override', resolve: (value: string) => value },
    {
        tag: '!override',
        collection: 'map',
        nodeClass: YAMLMap,
        resolve: (map) => {
            if (map instanceof YAMLMap) {
                (map as YAMLMap<unknown, unknown>).set(OVERRIDE_MARK, true);
            }

            return map;
        },
    },
    {
        tag: '!override',
        collection: 'seq',
        nodeClass: YAMLSeq,
        resolve: (seq) => {
            if (seq instanceof YAMLSeq) {
                (seq as YAMLSeq<unknown>).add(OVERRIDE_MARK);
            }

            return seq;
        },
    },
];

function toPosix(path: string): string {
    return path.split(sep).join(posix.sep);
}

function rel(root: string, path: string): string {
    return toPosix(relative(root, path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listFiles(dir: string, pattern: RegExp): string[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        return [];
    }

    return readdirSync(dir)
        .filter((name) => pattern.test(name) && statSync(join(dir, name)).isFile())
        .sort()
        .map((name) => join(dir, name));
}

function listDirs(dir: string): string[] {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        return [];
    }

    return readdirSync(dir)
        .filter((name) => statSync(join(dir, name)).isDirectory())
        .sort()
        .map((name) => join(dir, name));
}

function parseFailure(root: string, file: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);

    return new Error(`assertRepoConventions: не удалось разобрать ${rel(root, file)}: ${message}`, {
        cause: error,
    });
}

/** Интерполяции `${VAR:-default}` и `${VAR-default}` → `default`; `${VAR}` без умолчания не меняется. */
export function expandDefaults(text: string): string {
    return text.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}/g, '$1');
}

/**
 * Разбор env-файла: `KEY=VALUE`, комментарии `#` и пустые строки пропускаются, `export ` и кавычки снимаются; у
 * значения без кавычек снимается ` #…` (как в Compose).
 */
export function parseEnvFile(text: string): Map<string, string> {
    const env = new Map<string, string>();
    for (const source of text.split(/\r?\n/)) {
        const line = source.trim().replace(/^export\s+/, '');
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        const eq = line.indexOf('=');
        if (eq === -1) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        const raw = line.slice(eq + 1).trim();
        // Как Compose: значение в кавычках — до парной кавычки (` #…` после неё — комментарий); у значения без
        // кавычек ` #…` — комментарий.
        const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(raw);
        env.set(key, quoted === null ? raw.replace(/\s+#.*$/, '') : (quoted[2] ?? ''));
    }

    return env;
}

/** Разобранное значение `image:` compose. */
export interface ImageRef {
    /** Репозиторий без префикса Docker Hub (`postgres`, `axllent/mailpit`); null — не определяется (переменная). */
    readonly repository: string | null;
    /** Тег до `@sha256:…`; без тега — `latest`. */
    readonly tag: string;
    /** В теге осталась неразрешённая переменная. */
    readonly tagUnresolved: boolean;
}

const DOCKER_HUB_PREFIXES = ['docker.io/library/', 'docker.io/'];

/**
 * Значение `image:` как ссылка на образ: подстановка `${VAR:-default}`, снятие префикса Docker Hub, отдельно
 * дайджест `@sha256:…`; тег — после последнего `:` за последним `/` (порт реестра — не тег), без тега — `latest`.
 */
export function parseImageRef(image: string): ImageRef {
    let name = expandDefaults(image).trim();
    const at = name.indexOf('@');
    if (at !== -1) {
        name = name.slice(0, at);
    }
    const prefix = DOCKER_HUB_PREFIXES.find((candidate) => name.startsWith(candidate));
    if (prefix !== undefined) {
        name = name.slice(prefix.length);
    }
    const colon = name.indexOf(':', name.lastIndexOf('/') + 1);
    const repository = colon === -1 ? name : name.slice(0, colon);
    const tag = colon === -1 ? 'latest' : name.slice(colon + 1);

    return {
        repository: repository === '' || repository.includes('$') ? null : repository,
        tag,
        tagUnresolved: tag.includes('$'),
    };
}

/** Префикс Docker Hub в свободном тексте (`docker.io/library/`, `docker.io/`) — снимается, как в parseImageRef. */
const DOCKER_HUB_PREFIX_IN_TEXT = /(?<![\w./@-])docker\.io\/(?:library\/)?/g;

/**
 * Образы репозитория `repository` в свободном тексте (CI): `<repo>:<тег>`; префикс Docker Hub снимается; тег
 * учитывается, только если в нём есть точка или буква.
 */
export function imageTags(text: string, repository: string): string[] {
    const escaped = repository.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\w./@-])${escaped}:([A-Za-z0-9][\\w.-]*)`, 'g');

    const normalized = expandDefaults(text).replace(DOCKER_HUB_PREFIX_IN_TEXT, '');

    return [...normalized.matchAll(pattern)]
        .map((match) => match[1] ?? '')
        .filter((tag) => /[.A-Za-z]/.test(tag));
}

function scalar(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    return typeof value === 'string' ? value : String(value);
}

function environmentOf(value: unknown): Map<string, string | null> {
    const env = new Map<string, string | null>();
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = String(item);
            const eq = text.indexOf('=');
            env.set(eq === -1 ? text : text.slice(0, eq), eq === -1 ? null : text.slice(eq + 1));
        }
    } else if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            env.set(key, scalar(item));
        }
    }

    return env;
}

function envFilePaths(value: unknown): string[] {
    const items = Array.isArray(value)
        ? value
        : value === undefined || value === null
          ? []
          : [value];

    return items.flatMap((item) => {
        if (typeof item === 'string') {
            return [item];
        }
        if (isRecord(item) && typeof item.path === 'string') {
            return [item.path];
        }

        return [];
    });
}

function isReset(value: unknown): boolean {
    return value === RESET_MARK;
}

function commandField(value: unknown): ComposeField<ComposeCommand> {
    if (isReset(value)) {
        return RESET;
    }
    if (typeof value === 'string') {
        return value;
    }

    return Array.isArray(value) ? value.map(String) : undefined;
}

function scalarField(value: unknown): ComposeField<string> {
    if (isReset(value)) {
        return RESET;
    }

    return scalar(value) ?? undefined;
}

/** `build:` — строка (каталог контекста) или `{context, dockerfile, target}`; путь Dockerfile — от каталога compose. */
function buildField(value: unknown, root: string, composeDir: string): ComposeField<ComposeBuild> {
    if (isReset(value)) {
        return RESET;
    }
    const spec = typeof value === 'string' ? { context: value } : isRecord(value) ? value : null;
    if (spec === null) {
        return undefined;
    }
    const context = typeof spec.context === 'string' ? spec.context : '.';
    const dockerfile = typeof spec.dockerfile === 'string' ? spec.dockerfile : 'Dockerfile';

    return {
        dockerfile: rel(root, join(composeDir, context, dockerfile)),
        target: typeof spec.target === 'string' ? spec.target : null,
    };
}

function withoutMarks(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.filter((item) => item !== OVERRIDE_MARK);
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== OVERRIDE_MARK));
    }

    return value;
}

function hasOverrideMark(value: unknown): boolean {
    return Array.isArray(value)
        ? value.includes(OVERRIDE_MARK)
        : isRecord(value) && OVERRIDE_MARK in value;
}

/**
 * Файлы, отслеживаемые git в `root` (`git ls-files`, пути относительно root); вне git-репозитория или без git — null:
 * читаются все файлы (§3.8 v1.25).
 */
function trackedFiles(root: string): ReadonlySet<string> | null {
    try {
        const output = execFileSync('git', ['ls-files', '-z'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            // Большой репозиторий: по умолчанию 1 МБ — ENOBUFS молча включил бы неотслеживаемые .env.
            maxBuffer: 256 * 1024 * 1024,
        });

        return new Set(output.split('\0').filter(Boolean));
    } catch (error) {
        const { code, status } = error as { code?: unknown; status?: unknown };
        // Нет git (ENOENT) или не git-репозиторий (выход 128) — читаются все файлы; прочее — ошибка.
        if (code === 'ENOENT' || status === 128) {
            return null;
        }
        throw error;
    }
}

function readComposeFile(
    root: string,
    path: string,
    tracked: ReadonlySet<string> | null,
): ComposeService[] {
    let document: unknown;
    try {
        document = parse(readFileSync(path, 'utf8'), {
            merge: true,
            customTags: CUSTOM_TAGS,
            maxAliasCount: MAX_ALIAS_COUNT,
        });
    } catch (error) {
        throw parseFailure(root, path, error);
    }
    const services = isRecord(document) && isRecord(document.services) ? document.services : {};
    const file = rel(root, path);
    const project = isRecord(document) ? scalar(document.name) : null;

    return Object.entries(services).map(([name, raw]) => {
        const service = isRecord(raw) ? raw : {};
        const env = new Map<string, string | null>();
        const envSource = new Map<string, string>();
        if (!isReset(service.env_file)) {
            for (const envFile of envFilePaths(withoutMarks(service.env_file))) {
                const envPath = join(dirname(path), envFile);
                // Неотслеживаемые git файлы (.env, .env.e2e разработчика) не читаются.
                if (
                    !existsSync(envPath) ||
                    (tracked !== null && !tracked.has(rel(root, envPath)))
                ) {
                    continue;
                }
                for (const [key, value] of parseEnvFile(readFileSync(envPath, 'utf8'))) {
                    env.set(key, value);
                    envSource.set(key, rel(root, envPath));
                }
            }
        }
        if (!isReset(service.environment)) {
            for (const [key, value] of environmentOf(withoutMarks(service.environment))) {
                env.set(key, value);
                envSource.set(key, file);
            }
        }
        const envMode =
            isReset(service.environment) || isReset(service.env_file)
                ? 'reset'
                : hasOverrideMark(service.environment) || hasOverrideMark(service.env_file)
                  ? 'override'
                  : 'merge';

        return {
            file,
            project,
            name,
            image: scalar(service.image),
            env,
            envSource,
            envMode,
            stopGracePeriod: scalarField(service.stop_grace_period),
            command: commandField(withoutMarks(service.command)),
            entrypoint: commandField(withoutMarks(service.entrypoint)),
            build: buildField(service.build, root, dirname(path)),
        };
    });
}

/** Exec-форма инструкции или null: невалидный JSON (`['node', …]`) Docker выполняет как shell-форму. */
function execForm(body: string): string[] | null {
    if (!body.startsWith('[')) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(body);

        return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
        return null;
    }
}

interface StageState {
    readonly name: string | null;
    entrypoint: LaunchInstruction | null;
    cmd: LaunchInstruction | null;
    /** CMD унаследован от стадии-основы: ENTRYPOINT этой стадии его сбрасывает (как в Docker). */
    cmdInherited: boolean;
}

/**
 * Стадии Dockerfile по правилам Docker: продолжение строки `\` (с пробелами и табуляцией до перевода строки),
 * последние CMD/ENTRYPOINT стадии перекрывают предыдущие, `FROM <стадия>` наследует её ENTRYPOINT и CMD, ENTRYPOINT
 * сбрасывает унаследованный CMD. CMD внутри HEALTHCHECK — не CMD стадии.
 */
function readDockerfile(root: string, path: string): DockerStage[] {
    const text = readFileSync(path, 'utf8').replace(/\\[ \t]*\r?\n/g, ' ');
    const file = rel(root, path);
    const stages: StageState[] = [];
    for (const line of text.split(/\r?\n/)) {
        const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
        if (from !== null) {
            const image = (from[1] ?? '').toLowerCase();
            const parent = stages.find((stage) => stage.name === image);
            stages.push({
                name: from[2]?.toLowerCase() ?? null,
                entrypoint: parent?.entrypoint ?? null,
                cmd: parent?.cmd ?? null,
                cmdInherited: parent?.cmd != null,
            });
            continue;
        }
        const stage = stages.at(-1);
        const match = /^\s*(CMD|ENTRYPOINT)\s+(.*)$/i.exec(line);
        if (stage === undefined || match === null) {
            continue;
        }
        const body = (match[2] ?? '').trim();
        const instruction = { exec: execForm(body), shell: body };
        if ((match[1] ?? '').toUpperCase() === 'CMD') {
            stage.cmd = instruction;
            stage.cmdInherited = false;
        } else {
            stage.entrypoint = instruction;
            if (stage.cmdInherited) {
                stage.cmd = null;
                stage.cmdInherited = false;
            }
        }
    }

    return stages.map((stage, index) => ({
        file,
        name: stage.name,
        last: index === stages.length - 1,
        entrypoint: stage.entrypoint,
        cmd: stage.cmd,
    }));
}

function readManifest(root: string, path: string): Manifest {
    let json: unknown;
    try {
        json = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        throw parseFailure(root, path, error);
    }
    const manifest = isRecord(json) ? json : {};
    const dependencies = new Map<string, string>();
    for (const field of ['dependencies', 'devDependencies']) {
        const section = manifest[field];
        if (isRecord(section)) {
            for (const [name, version] of Object.entries(section)) {
                dependencies.set(name, String(version));
            }
        }
    }
    const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};

    return {
        file: rel(root, path),
        dependencies,
        start: typeof scripts.start === 'string' ? scripts.start : null,
    };
}

function readText(root: string, path: string): TextFile {
    return { file: rel(root, path), text: readFileSync(path, 'utf8') };
}

function existing(paths: readonly string[]): string[] {
    return paths.filter((path) => existsSync(path) && statSync(path).isFile());
}

/** Находит и разбирает файлы репозитория сервиса; отсутствующий каталог — пустой список. */
export function readRepoFiles(root: string): RepoFiles {
    const tracked = trackedFiles(root);
    const apps = listDirs(join(root, 'apps'));
    const packages = listDirs(join(root, 'packages'));
    const ciFiles = [
        ...existing([join(root, '.gitlab-ci.yml')]),
        ...listFiles(join(root, '.github', 'workflows'), WORKFLOW_FILE),
    ];

    return {
        compose: listFiles(root, COMPOSE_FILE).flatMap((path) =>
            readComposeFile(root, path, tracked),
        ),
        ci: ciFiles.map((path) => readText(root, path)),
        docker: [root, ...apps]
            .flatMap((dir) => listFiles(dir, DOCKERFILE))
            .flatMap((path) => readDockerfile(root, path)),
        manifests: existing(
            [root, ...apps, ...packages].map((dir) => join(dir, 'package.json')),
        ).map((path) => readManifest(root, path)),
        redaction: existing([root, ...apps].map((dir) => join(dir, 'src', 'redaction.ts'))).map(
            (path) => readText(root, path),
        ),
    };
}
