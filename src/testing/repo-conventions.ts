// assertRepoConventions — один тест репозитория сервиса по правилам prd.md §3.8 v1.10 (AC-1.8, CE-1). Эталоны: образы — BFF
// test/image-tags.spec.ts и O test/support/images.spec.ts; compose как данные — P ac-6-1-production-compose.spec.ts и O
// test/support/compose-env.spec.ts. Правил --import, REPLICA_ID, stop_grace_period и «команда не распознана» в эталонах нет —
// они новые по PRD. Новое правило или ключ RENAMED_ENV_KEYS после 1.0.0 — мажор (G14).
// Единица проверки compose — слитый сервис (базовый файл ⊕ переопределение, !reset/!override по правилам Compose);
// команда запуска собирается по правилам Docker (ENTRYPOINT + CMD, стадии) и Compose (entrypoint: + command:).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { envBase } from '../config/index.js';
import { imageRepository, TEST_IMAGES } from './images.js';
import {
    analyzeLaunch,
    hasInstrumentImport,
    shellWords,
    type LaunchAnalysis,
} from './launch-command.js';
import {
    expandDefaults,
    imageTags,
    parseImageRef,
    readRepoFiles,
    RESET,
    type ComposeBuild,
    type ComposeCommand,
    type ComposeField,
    type ComposeService,
    type DockerStage,
    type LaunchInstruction,
    type RepoFiles,
} from './repo-files.js';

/** Параметры assertRepoConventions (§3.8). */
export interface RepoConventionsOptions {
    /** Корень репозитория сервиса. */
    readonly root: string;
}

type Rule =
    | 'test-images'
    | 'replica-id'
    | 'stop-grace-period'
    | 'env-keys'
    | 'peer-versions'
    | 'instrument-import'
    | 'command-unrecognized'
    | 'redaction-imports';

interface Violation {
    readonly rule: Rule;
    readonly file: string;
    readonly detail: string;
}

const RULE_ORDER: readonly Rule[] = [
    'test-images',
    'replica-id',
    'stop-grace-period',
    'env-keys',
    'peer-versions',
    'instrument-import',
    'command-unrecognized',
    'redaction-imports',
];

/** Старые имена ключей → новые (§3.8, явный список; расширение после 1.0.0 — мажор). Псевдонимов нет (P0). */
const RENAMED_ENV_KEYS: Readonly<Record<string, string>> = {
    IDENTITY_PORT: 'PORT',
    BFF_PORT: 'PORT',
    DATABASE_MIGRATION_URL: 'DATABASE_MIGRATOR_URL',
    SESSION_ENC_KEYS: 'ENCRYPTION_KEYS',
    SIGNING_KEY_ENCRYPTION_KEYS: 'ENCRYPTION_KEYS',
    CLIENT_SECRET_KEY: 'ENCRYPTION_KEYS',
    IDENTITY_SECRETS: 'ENCRYPTION_KEYS',
};

const BASE_KEYS = Object.keys(envBase);
const DEFAULT_SHUTDOWN_MS = 10_000;
const DOCKER_DEFAULT_GRACE_MS = 10_000;
const REQUIRED_FORM = 'node --import ./dist/instrument.js dist/main.js';
/** Порядок поиска базового файла Compose в каталоге проекта: первый найденный — база для переопределений. */
const BASE_COMPOSE_ORDER = [
    'compose.yaml',
    'compose.yml',
    'docker-compose.yaml',
    'docker-compose.yml',
];
const DURATION_UNITS_MS: Readonly<Record<string, number>> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
};

/** Peer-диапазоны пакета: путь верен и из src/testing, и из dist/testing. */
function kitPeerRanges(): Readonly<Record<string, string>> {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        peerDependencies?: Record<string, string>;
    };

    return manifest.peerDependencies ?? {};
}

/** Базовый файл Compose репозитория — первый найденный по порядку поиска Compose; null — базового файла нет. */
export function baseComposeFile(files: RepoFiles): string | null {
    const present = new Set(files.compose.map((service) => service.file));

    return BASE_COMPOSE_ORDER.find((name) => present.has(name)) ?? null;
}

/** Значение поля слитого сервиса и файл, где оно задано. */
interface Sourced<T> {
    readonly value: T;
    readonly file: string;
}

/** Слитый сервис Compose: базовый файл ⊕ переопределение (§3.8 v1.10). */
interface MergedService {
    /** Файл переопределения (или базовый файл для сервиса базового файла). */
    readonly file: string;
    readonly name: string;
    readonly env: ReadonlyMap<string, string | null>;
    readonly envSource: ReadonlyMap<string, string>;
    readonly stopGracePeriod: string | null;
    readonly command: Sourced<ComposeCommand> | null;
    readonly entrypoint: Sourced<ComposeCommand> | null;
    readonly build: ComposeBuild | null;
}

/** Поле переопределения: своё значение, `!reset` — умолчание (null), нет ключа — значение базового файла. */
function pick<T>(
    own: ComposeField<T>,
    ownFile: string,
    base: ComposeService | undefined,
    select: (service: ComposeService) => ComposeField<T>,
): Sourced<T> | null {
    if (own === RESET) {
        return null;
    }
    if (own !== undefined) {
        return { value: own, file: ownFile };
    }
    const inherited = base === undefined ? undefined : select(base);

    return inherited === undefined || inherited === RESET || base === undefined
        ? null
        : { value: inherited, file: base.file };
}

function mergeService(service: ComposeService, base: ComposeService | undefined): MergedService {
    const inherit = base !== undefined && base !== service && service.envMode === 'merge';
    const env = new Map(inherit ? base.env : []);
    const envSource = new Map(inherit ? base.envSource : []);
    for (const [key, value] of service.env) {
        env.set(key, value);
        envSource.set(key, service.envSource.get(key) ?? service.file);
    }
    const other = base === service ? undefined : base;

    return {
        file: service.file,
        name: service.name,
        env,
        envSource,
        stopGracePeriod:
            pick(service.stopGracePeriod, service.file, other, (s) => s.stopGracePeriod)?.value ??
            null,
        command: pick(service.command, service.file, other, (s) => s.command),
        entrypoint: pick(service.entrypoint, service.file, other, (s) => s.entrypoint),
        build: pick(service.build, service.file, other, (s) => s.build)?.value ?? null,
    };
}

/** Стадия Dockerfile, которую собирает `build:` сервиса: `target` или последняя стадия. */
function buildStage(files: RepoFiles, build: ComposeBuild | null): DockerStage | undefined {
    if (build === null) {
        return undefined;
    }
    const stages = files.docker.filter((stage) => stage.file === build.dockerfile);

    const target = build.target?.toLowerCase() ?? null;

    return target === null
        ? stages.find((stage) => stage.last)
        : stages.find((stage) => stage.name === target);
}

/** Argv строки или массива Compose: подстановка `${VAR:-умолчание}`, `$$` — литерал `$`. */
function composeArgv(command: ComposeCommand): string[] {
    const words = typeof command === 'string' ? shellWords(expandDefaults(command)) : [...command];

    return words
        .map((word) => expandDefaults(word).replaceAll('$$', ''))
        .map((word) =>
            // `$$` — экранированный `$` Compose: до shell доходит переменная shell, её разбирает analyzeLaunch.
            word.replaceAll('', '$'),
        );
}

/** Argv инструкции Docker: exec-форма как есть, shell-форма — `/bin/sh -c "<текст>"`. */
function instructionArgv(instruction: LaunchInstruction): string[] {
    return instruction.exec === null ? ['/bin/sh', '-c', instruction.shell] : [...instruction.exec];
}

/** Команда запуска стадии по правилам Docker; null — ни CMD, ни ENTRYPOINT. */
function stageLaunch(stage: DockerStage): { kind: string; argv: string[] } | null {
    const { entrypoint, cmd } = stage;
    if (entrypoint === null) {
        return cmd === null ? null : { kind: 'CMD', argv: instructionArgv(cmd) };
    }
    if (entrypoint.exec === null || cmd === null) {
        // Shell-форма ENTRYPOINT отбрасывает CMD (как в Docker).
        return { kind: 'ENTRYPOINT', argv: instructionArgv(entrypoint) };
    }

    return { kind: 'ENTRYPOINT + CMD', argv: [...entrypoint.exec, ...instructionArgv(cmd)] };
}

/**
 * Команда сервиса Compose (§3.8 v1.10, B6): `entrypoint:` задан — CMD образа отбрасывается, `command:` — его
 * аргументы; только `command:` — аргументы ENTRYPOINT стадии Dockerfile (если Dockerfile найден). Файл — где задана
 * команда. null — сервис запускается командой Dockerfile.
 */
function composeLaunch(
    files: RepoFiles,
    merged: MergedService,
): { argv: string[]; file: string } | null {
    if (merged.entrypoint !== null) {
        return {
            argv: [
                ...composeArgv(merged.entrypoint.value),
                ...(merged.command === null ? [] : composeArgv(merged.command.value)),
            ],
            file: merged.entrypoint.file,
        };
    }
    if (merged.command === null) {
        return null;
    }
    const command = composeArgv(merged.command.value);
    const entrypoint = buildStage(files, merged.build)?.entrypoint ?? null;
    if (entrypoint === null) {
        return { argv: command, file: merged.command.file };
    }
    if (entrypoint.exec === null) {
        return { argv: instructionArgv(entrypoint), file: merged.command.file };
    }

    return { argv: [...entrypoint.exec, ...command], file: merged.command.file };
}

type ServiceKind = 'infra' | 'fake' | 'one-shot' | 'app';

/** Сервис Compose для правил: слитое представление, команда и её разбор, вид. */
interface CheckedService {
    readonly merged: MergedService;
    readonly launch: { argv: string[]; file: string } | null;
    readonly analysis: LaunchAnalysis | null;
    readonly kind: ServiceKind;
}

/**
 * Вид сервиса (§3.8 v1.10): без ключей envBase (у слитого сервиса) — инфраструктура; подделка `*.main.ts`; одноразовое
 * задание — своя или унаследованная команда без запуска приложения и без формы «команда не распознана»; иначе —
 * приложение (в том числе без `command:` — запуск командой Dockerfile).
 */
function checkedServices(files: RepoFiles): CheckedService[] {
    const baseFile = baseComposeFile(files);

    return files.compose.map((service) => {
        const base = files.compose.find(
            (other) => other.file === baseFile && other.name === service.name,
        );
        const merged = mergeService(service, base);
        const launch = composeLaunch(files, merged);
        const analysis = launch === null ? null : analyzeLaunch(launch.argv);
        const isCandidate = BASE_KEYS.some((key) => merged.env.has(key));
        let kind: ServiceKind = 'app';
        if (!isCandidate) {
            kind = 'infra';
        } else if (analysis !== null && analysis.fake && analysis.launches.length === 0) {
            kind = 'fake';
        } else if (
            analysis !== null &&
            analysis.launches.length === 0 &&
            analysis.unrecognized.length === 0
        ) {
            kind = 'one-shot';
        }

        return { merged, launch, analysis, kind };
    });
}

/** Ожидаемый образ TEST_IMAGES по репозиторию (`postgres` → `postgres:17.11-alpine3.24`). */
const EXPECTED_BY_REPOSITORY: ReadonlyMap<string, string> = new Map(
    Object.values(TEST_IMAGES).map((image) => [imageRepository(image), image]),
);

/**
 * `image:` compose — как значение (§3.8): репозиторий из TEST_IMAGES требует ровно тег TEST_IMAGES; без тега —
 * `latest`; неразрешённая переменная в теге — «тег не определён». Образы вне TEST_IMAGES и образы, чей
 * репозиторий не определяется (переменная), не проверяются.
 */
function composeImage(service: ComposeService): Violation[] {
    if (service.image === null) {
        return [];
    }
    const ref = parseImageRef(service.image);
    const expected =
        ref.repository === null ? undefined : EXPECTED_BY_REPOSITORY.get(ref.repository);
    if (expected === undefined || `${ref.repository}:${ref.tag}` === expected) {
        return [];
    }
    const found = `${ref.repository}:${ref.tag}`;
    const detail = ref.tagUnresolved
        ? `сервис ${service.name} — образ ${found} — тег не определён, ожидается ${expected}`
        : `сервис ${service.name} — образ ${found}, ожидается ${expected}`;

    return [{ rule: 'test-images', file: service.file, detail }];
}

/** Образы в свободном тексте CI: тег учитывается, только если в нём есть точка или буква (`postgres:5432` — адрес). */
function ciImages(text: string, file: string): Violation[] {
    return [...EXPECTED_BY_REPOSITORY].flatMap(([repository, expected]) =>
        imageTags(text, repository)
            .filter((tag) => `${repository}:${tag}` !== expected)
            .map((tag) => ({
                rule: 'test-images' as const,
                file,
                detail: `образ ${repository}:${tag}, ожидается ${expected}`,
            })),
    );
}

function testImages(files: RepoFiles): Violation[] {
    return [
        ...files.compose.flatMap(composeImage),
        ...files.ci.flatMap((ci) => ciImages(ci.text, ci.file)),
    ];
}

function replicaId(files: RepoFiles): Violation[] {
    return files.compose
        .filter((service) => service.env.has('REPLICA_ID'))
        .map((service) => ({
            rule: 'replica-id',
            file: service.envSource.get('REPLICA_ID') ?? service.file,
            detail: `сервис ${service.name} задаёт REPLICA_ID — не задавайте, умолчание — hostname()`,
        }));
}

/** Длительность Docker в мс или null, если не распознана. */
function durationMs(text: string): number | null {
    const value = text.trim();
    if (!/^(\d+(?:\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(value)) {
        return null;
    }
    let total = 0;
    for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) {
        total += Number(match[1]) * (DURATION_UNITS_MS[match[2] ?? ''] ?? 0);
    }

    return total;
}

/**
 * SHUTDOWN_TIMEOUT_MS слитого сервиса: целое, `${NAME:-N}` / `${NAME-N}` → N; ключа нет — умолчание envBase; иное
 * (переменная без умолчания, текст) — null, «значение не определено».
 */
function shutdownMs(merged: MergedService): number | null {
    if (!merged.env.has('SHUTDOWN_TIMEOUT_MS')) {
        return DEFAULT_SHUTDOWN_MS;
    }
    const raw = expandDefaults(merged.env.get('SHUTDOWN_TIMEOUT_MS') ?? '').trim();

    return /^\d+$/.test(raw) ? Number(raw) : null;
}

function stopGracePeriod(services: readonly CheckedService[]): Violation[] {
    return services
        .filter((service) => service.kind === 'app')
        .flatMap(({ merged }): Violation[] => {
            const declared = merged.stopGracePeriod;
            const expanded = declared === null ? null : expandDefaults(declared);
            const violation = (detail: string): Violation[] => [
                {
                    rule: 'stop-grace-period',
                    file: merged.file,
                    detail: `сервис ${merged.name} — ${detail}`,
                },
            ];
            if (expanded?.includes('$') === true) {
                return violation(`stop_grace_period «${declared ?? ''}» — значение не определено`);
            }
            const graceMs = expanded === null ? DOCKER_DEFAULT_GRACE_MS : durationMs(expanded);
            if (graceMs === null) {
                return violation(`stop_grace_period «${declared ?? ''}» не распознан`);
            }
            const shutdown = shutdownMs(merged);
            if (shutdown === null) {
                // Значение окружения в текст не попадает (NFR-4).
                return violation(
                    'SHUTDOWN_TIMEOUT_MS — значение не определено или не целое число мс',
                );
            }
            if (graceMs > shutdown) {
                return [];
            }

            return violation(
                `stop_grace_period ${graceMs} мс ≤ SHUTDOWN_TIMEOUT_MS ${shutdown} мс (нужно 15s при 10000)`,
            );
        });
}

/** Ключи окружения — у слитого сервиса приложения или одноразового задания; файл — где ключ задан. */
function envKeys(services: readonly CheckedService[]): Violation[] {
    return services
        .filter((service) => service.kind === 'app' || service.kind === 'one-shot')
        .flatMap(({ merged }) =>
            Object.entries(RENAMED_ENV_KEYS)
                .filter(([old]) => merged.env.has(old))
                .map(([old, current]) => ({
                    rule: 'env-keys' as const,
                    file: merged.envSource.get(old) ?? merged.file,
                    detail: `сервис ${merged.name} — ключ ${old}, используйте ${current}`,
                })),
        );
}

function kitManifests(files: RepoFiles): RepoFiles['manifests'] {
    return files.manifests.filter((manifest) => manifest.dependencies.has('@verdeect/kit'));
}

function peerVersions(files: RepoFiles): Violation[] {
    const ranges = kitPeerRanges();

    return kitManifests(files).flatMap((manifest) =>
        Object.entries(ranges).flatMap(([name, range]): Violation[] => {
            const version = manifest.dependencies.get(name);
            if (version === undefined) {
                return [];
            }
            if (semver.valid(version) === null) {
                return [
                    {
                        rule: 'peer-versions',
                        file: manifest.file,
                        detail: `${name} ${version} — нужна точная версия`,
                    },
                ];
            }
            if (!semver.satisfies(version, range)) {
                return [
                    {
                        rule: 'peer-versions',
                        file: manifest.file,
                        detail: `${name} ${version} вне диапазона ${range} пакета @verdeect/kit`,
                    },
                ];
            }

            return [];
        }),
    );
}

/** Источник команды запуска для правил instrument-import и command-unrecognized. */
interface LaunchSource {
    readonly file: string;
    readonly source: string;
    readonly analysis: LaunchAnalysis;
    /** Проверять ли «команда не распознана» (§3.8 v1.10: приложения и задания compose, их стадии, start). */
    readonly checkForms: boolean;
    /**
     * Обязателен распознанный запуск приложения (§3.8 v1.11): стадия, которой запускается приложение без своей команды
     * compose, и `scripts.start`. null — не обязателен; иначе — итоговая команда для текста нарушения (`''` — у
     * стадии нет ни CMD, ни ENTRYPOINT).
     */
    readonly requiredLaunch: string | null;
}

/** Стадии Dockerfile, на которые ссылаются приложения и задания compose; Dockerfile без ссылок — последняя стадия. */
function referencedStages(files: RepoFiles, services: readonly CheckedService[]): Set<DockerStage> {
    const referenced = new Set<DockerStage>();
    const referencedFiles = new Set<string>();
    for (const { merged, kind } of services) {
        if (merged.build !== null) {
            referencedFiles.add(merged.build.dockerfile);
        }
        const stage = buildStage(files, merged.build);
        if (stage !== undefined && (kind === 'app' || kind === 'one-shot')) {
            referenced.add(stage);
        }
    }
    for (const stage of files.docker) {
        if (stage.last && !referencedFiles.has(stage.file)) {
            referenced.add(stage);
        }
    }

    return referenced;
}

/**
 * Стадии, которыми запускаются приложения compose без своей команды (`command:`/`entrypoint:`): стадия `build:`; у
 * приложения без `build:` (образ `image:`) — последние стадии Dockerfile, на которые нет ссылок из `build:`.
 */
function appImageStages(files: RepoFiles, services: readonly CheckedService[]): Set<DockerStage> {
    const builtFiles = new Set(
        services.flatMap(({ merged }) => (merged.build === null ? [] : [merged.build.dockerfile])),
    );
    const imageStages = files.docker.filter((stage) => stage.last && !builtFiles.has(stage.file));
    const stages = new Set<DockerStage>();
    for (const { merged, launch, kind } of services) {
        if (kind !== 'app' || launch !== null) {
            continue;
        }
        const stage = buildStage(files, merged.build);
        const launched = merged.build === null ? imageStages : stage === undefined ? [] : [stage];
        for (const item of launched) {
            stages.add(item);
        }
    }

    return stages;
}

const NO_LAUNCH: LaunchAnalysis = { launches: [], fake: false, unrecognized: [] };

function launchSources(files: RepoFiles, services: readonly CheckedService[]): LaunchSource[] {
    const referenced = referencedStages(files, services);
    const appStages = appImageStages(files, services);
    const fromCompose = services.flatMap(({ merged, launch, analysis, kind }) =>
        kind === 'app' && launch !== null && analysis !== null
            ? [
                  {
                      file: launch.file,
                      source: `сервис ${merged.name}`,
                      analysis,
                      checkForms: true,
                      requiredLaunch: null,
                  },
              ]
            : [],
    );
    const fromDocker = files.docker.flatMap((stage): LaunchSource[] => {
        const launch = stageLaunch(stage);
        const required = appStages.has(stage);
        if (launch === null) {
            // Ни CMD, ни ENTRYPOINT у стадии приложения — запуск не найден.
            return required
                ? [
                      {
                          file: stage.file,
                          source: `стадия ${stage.name ?? '(без имени)'}`,
                          analysis: NO_LAUNCH,
                          checkForms: true,
                          requiredLaunch: '',
                      },
                  ]
                : [];
        }

        return [
            {
                file: stage.file,
                source: launch.kind,
                analysis: analyzeLaunch(launch.argv),
                checkForms: referenced.has(stage),
                requiredLaunch: required ? launch.argv.join(' ') : null,
            },
        ];
    });
    const fromStart = kitManifests(files).flatMap((manifest) =>
        manifest.start === null
            ? []
            : [
                  {
                      file: manifest.file,
                      source: 'scripts.start',
                      analysis: analyzeLaunch(manifest.start),
                      checkForms: true,
                      requiredLaunch: manifest.start,
                  },
              ],
    );

    return [...fromCompose, ...fromDocker, ...fromStart];
}

/** Запуск приложения без `--import …instrument` в аргументах node (NODE_OPTIONS не засчитывается, §3.8 v1.10). */
function instrumentImport(sources: readonly LaunchSource[]): Violation[] {
    return sources.flatMap(({ file, source, analysis }) =>
        analysis.launches
            .filter((launch) => !hasInstrumentImport(launch.tokens))
            .map((launch) => ({
                rule: 'instrument-import' as const,
                file,
                detail: `${source} «${launch.command}» — нет --import …instrument`,
            })),
    );
}

/**
 * Формы команды вне перечня §3.8 — «команда не распознана»; у источника с обязательным запуском (v1.11) нет ни
 * запуска приложения, ни подделки, ни нераспознанной формы — «не найден запуск приложения».
 */
function commandUnrecognized(sources: readonly LaunchSource[]): Violation[] {
    const violation = (file: string, source: string, command: string, form: string): Violation => ({
        rule: 'command-unrecognized',
        file,
        detail: `${source}${command === '' ? '' : ` «${command}»`} — команда не распознана: ${form}; нужна форма ${REQUIRED_FORM}`,
    });

    return sources
        .filter((source) => source.checkForms)
        .flatMap(({ file, source, analysis, requiredLaunch }) => {
            const found = analysis.unrecognized.map(({ form, command }) =>
                violation(file, source, command, form),
            );
            const missing =
                requiredLaunch !== null &&
                found.length === 0 &&
                analysis.launches.length === 0 &&
                !analysis.fake;

            return missing
                ? [
                      violation(
                          file,
                          source,
                          requiredLaunch,
                          requiredLaunch === ''
                              ? 'не найден запуск приложения: нет CMD и ENTRYPOINT'
                              : `не найден запуск приложения: ${requiredLaunch.split(/\s+/)[0] ?? ''}…`,
                      ),
                  ]
                : found;
        });
}

function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ALLOWED_REDACTION_IMPORT =
    /^import\s+type\s*\{[^}]*\}\s*from\s*(['"])@verdeect\/kit\/observability\1\s*;?$/;

function redactionImports(files: RepoFiles): Violation[] {
    return files.redaction.flatMap(({ file, text }) => {
        const source = stripComments(text);
        const statements = [
            ...source.matchAll(
                /\bimport\b[\s\S]*?(?:from\s*['"][^'"]*['"]|['"][^'"]*['"]|\(\s*['"][^'"]*['"]\s*\))\s*;?/g,
            ),
            ...source.matchAll(/\bexport\b[^;]*?\bfrom\s*['"][^'"]*['"]\s*;?/g),
            ...source.matchAll(/\brequire\s*\(\s*['"][^'"]*['"]\s*\)/g),
        ].map((match) => match[0].trim());

        return statements
            .filter((statement) => !ALLOWED_REDACTION_IMPORT.test(statement))
            .map((statement) => ({
                rule: 'redaction-imports' as const,
                file,
                detail: `импорт ${specifierOf(statement)} — разрешены только типы из @verdeect/kit/observability`,
            }));
    });
}

function specifierOf(statement: string): string {
    const quoted = /['"]([^'"]*)['"]/.exec(statement);

    return quoted?.[1] ?? statement.slice(0, 60);
}

/** Одно нарушение на (правило, файл, текст): базовый сервис и его переопределения дают одинаковые находки. */
function unique(violations: readonly Violation[]): Violation[] {
    const seen = new Set<string>();

    return violations.filter((violation) => {
        const key = `${violation.rule}\n${violation.file}\n${violation.detail}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);

        return true;
    });
}

/** Проверяет репозиторий сервиса по правилам §3.8; при нарушениях бросает ошибку со списком. */
export function assertRepoConventions(options: RepoConventionsOptions): void {
    const files = readRepoFiles(options.root);
    const services = checkedServices(files);
    const sources = launchSources(files, services);
    const violations = unique([
        ...testImages(files),
        ...replicaId(files),
        ...stopGracePeriod(services),
        ...envKeys(services),
        ...peerVersions(files),
        ...instrumentImport(sources),
        ...commandUnrecognized(sources),
        ...redactionImports(files),
    ]).sort(
        (a, b) =>
            RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) || a.file.localeCompare(b.file),
    );
    if (violations.length === 0) {
        return;
    }
    throw new Error(
        `assertRepoConventions: нарушены правила (${violations.length}):\n` +
            violations.map((v) => `- [${v.rule}] ${v.file}: ${v.detail}`).join('\n'),
    );
}
