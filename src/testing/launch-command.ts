// Команда запуска приложения: разбор shell и распознавание форм (prd.md §3.8 v1.10, AC-1.8) для assertRepoConventions.
// Поддерживаемые формы: exec- и shell-форма; обёртки без аргументов exec, tini --, dumb-init, env (VAR=…) перед node
// или sh -c; sh/bash/ash/dash с любыми флагами до -c; несколько команд через перевод строки, ;, &&, ||, |, &,
// подоболочку; ${VAR:-умолчание}. Остальное, где возможен запуск приложения, — «команда не распознана».
import { basename } from 'node:path';
import { parse as parseShell } from 'shell-quote';
import { expandDefaults } from './repo-files.js';

const SHELLS = new Set(['sh', 'bash', 'ash', 'dash']);

/**
 * Опции node, которые без `=` съедают следующий токен. Источник — `node --help` Node.js 22.23.3 и 24.22.1 (опции
 * вида `--opt=...`, объединение версий) плюс алиасы, которые справка выводит отдельной строкой (`--loader`,
 * `--experimental-loader`, `--inspect-port`, `--debug-port`, `-p`/`--print`) и V8-опция `--stack-size`. Опции с
 * необязательным значением (`--inspect[=…]`, `--force-fips[=…]`) следующий токен не съедают.
 */
const NODE_VALUE_OPTIONS = new Set([
    '--allow-fs-read',
    '--allow-fs-write',
    '--build-snapshot-config',
    '-C',
    '--conditions',
    '--cpu-prof-dir',
    '--cpu-prof-interval',
    '--cpu-prof-name',
    '--debug-port',
    '--diagnostic-dir',
    '--disable-proto',
    '--disable-warning',
    '--dns-result-order',
    '-e',
    '--eval',
    '--env-file',
    '--env-file-if-exists',
    '--experimental-config-file',
    '--experimental-default-type',
    '--experimental-loader',
    '--experimental-package-map',
    '--experimental-sea-config',
    '--experimental-test-isolation',
    '--experimental-test-tag-filter',
    '--heap-prof-dir',
    '--heap-prof-interval',
    '--heap-prof-name',
    '--heapsnapshot-near-heap-limit',
    '--heapsnapshot-signal',
    '--icu-data-dir',
    '--import',
    '--input-type',
    '--inspect-port',
    '--inspect-publish-uid',
    '--loader',
    '--localstorage-file',
    '--max-http-header-size',
    '--max-old-space-size-percentage',
    '--network-family-autoselection-attempt-timeout',
    '--openssl-config',
    '-p',
    '--print',
    '-r',
    '--redirect-warnings',
    '--report-filename',
    '--report-signal',
    '--require',
    '--run',
    '--secure-heap',
    '--secure-heap-min',
    '--snapshot-blob',
    '--stack-size',
    '--test-concurrency',
    '--test-coverage-branches',
    '--test-coverage-exclude',
    '--test-coverage-functions',
    '--test-coverage-include',
    '--test-coverage-lines',
    '--test-global-setup',
    '--test-name-pattern',
    '--test-random-seed',
    '--test-reporter',
    '--test-reporter-destination',
    '--test-rerun-failures',
    '--test-shard',
    '--test-skip-pattern',
    '--test-timeout',
    '--title',
    '--tls-cipher-list',
    '--tls-keylog',
    '--trace-event-categories',
    '--trace-event-file-pattern',
    '--trace-require-module',
    '--unhandled-rejections',
    '--use-largepages',
    '--v8-pool-size',
    '--watch-kill-signal',
    '--watch-path',
]);

/** Файл входа приложения (§3.8 v1.10): main, main.js, main.mjs, main.cjs, main.ts. */
const APP_ENTRY = /^main(\.(js|mjs|cjs|ts))?$/;
/** Подделка вида `*.main.ts` / `*.main.js` (например, fake-services.main.ts). */
const FAKE_ENTRY = /.\.main\.(ts|js)$/;
/** Присваивание перед командой (`NODE_OPTIONS=… node …`, аргументы env). */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn']);
/** Раннеры и супервизоры, которые запускают приложение вместо node (§3.8 v1.10). */
const RUNNERS = new Set(['tsx', 'ts-node', 'pm2', 'pm2-runtime', 'nodemon']);
/** Обёртки с аргументами (§3.8 v1.10): пользователь перед командой. */
const ARGUMENT_WRAPPERS = new Set(['gosu', 'su-exec']);

/** Операторы shell-quote, которые разделяют простые команды. */
const COMMAND_SEPARATORS = new Set(['&&', '||', ';', ';;', '&', '|', '|&', '(', ')', '<(']);
/** Операторы перенаправления: следующее слово — файл, а не аргумент команды. */
const REDIRECTS = new Set(['<', '>', '>>', '>&']);
/** Заменитель `$` на время разбора: shell-quote подставил бы вместо переменных пустую строку. */
const DOLLAR = '';

/**
 * Строки скрипта shell: перевод строки вне кавычек делит команды (как `;`), `\` перед переводом строки — продолжение
 * строки; комментарий `#` в начале слова вне кавычек снимается до конца своей строки. Строки — без комментариев.
 */
export function shellLines(text: string): string[] {
    const lines: string[] = [];
    let line = '';
    let quote: string | null = null;
    let comment = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text.charAt(index);
        const next = text.charAt(index + 1);
        if (comment) {
            if (char === '\n') {
                comment = false;
                lines.push(line);
                line = '';
            }
            continue;
        }
        if (char === '\\' && quote !== "'") {
            if (next === '\n') {
                index += 1;
                continue;
            }
            line += char + next;
            index += 1;
            continue;
        }
        if (quote !== null) {
            if (char === quote) {
                quote = null;
            }
            line += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            line += char;
            continue;
        }
        if (char === '#' && (line === '' || /\s$/.test(line))) {
            comment = true;
            continue;
        }
        if (char === '\n') {
            lines.push(line);
            line = '';
            continue;
        }
        line += char;
    }
    lines.push(line);

    return lines.filter((item) => item.trim() !== '');
}

/** Простые команды одной строки скрипта (без переводов строки и комментариев вне кавычек). */
function lineCommands(text: string): string[][] {
    const commands: string[][] = [];
    let words: string[] = [];
    let skipNext = false;
    let lastWasWord = false;
    const flush = (): void => {
        if (words.length > 0) {
            commands.push(words);
        }
        words = [];
    };
    const restore = (word: string): string => word.replaceAll(DOLLAR, '$');
    const entries = parseShell(text.replaceAll('$', DOLLAR), (key) => `$${key}`);
    for (const entry of entries) {
        if (typeof entry === 'string') {
            lastWasWord = !skipNext;
            if (skipNext) {
                skipNext = false;
                continue;
            }
            words.push(restore(entry));
            continue;
        }
        if ('comment' in entry) {
            // Комментарии сняты в shellLines; сюда попадает только `#` внутри слова — конец строки.
            break;
        }
        if (entry.op === 'glob') {
            words.push(restore(entry.pattern));
            lastWasWord = true;
            continue;
        }
        if (COMMAND_SEPARATORS.has(entry.op)) {
            skipNext = false;
            lastWasWord = false;
            flush();
            continue;
        }
        skipNext = REDIRECTS.has(entry.op);
        // `2>&1`: номер дескриптора перед перенаправлением — часть перенаправления, не аргумент команды.
        if (skipNext && lastWasWord && /^\d+$/.test(words.at(-1) ?? '')) {
            words.pop();
        }
        lastWasWord = false;
    }
    flush();

    return commands;
}

/**
 * Простые команды shell-строки (shell-quote): `&&`, `||`, `;`, `&`, `|`, `(`, `)` и перевод строки — разделители,
 * кавычки и экранирование — по правилам shell. Переменные `$VAR` и `${VAR}` остаются в токенах как есть.
 */
function shellCommands(text: string): string[][] {
    return shellLines(text).flatMap(lineCommands);
}

/**
 * Слова строки без выполнения shell (как Compose делит строковые `command:`/`entrypoint:`): кавычки снимаются,
 * операторы остаются словами. Переменные остаются как есть.
 */
export function shellWords(text: string): string[] {
    return parseShell(text.replaceAll('$', DOLLAR), (key) => `$${key}`).map((entry) => {
        if (typeof entry === 'string') {
            return entry.replaceAll(DOLLAR, '$');
        }
        if ('comment' in entry) {
            return `#${entry.comment}`;
        }

        return entry.op === 'glob' ? entry.pattern : entry.op;
    });
}

/** Длинные опции bash со значением (`bash --help`). */
const SHELL_VALUE_LONG_OPTIONS = new Set(['--rcfile', '--init-file']);
/** Флаг `-c` оболочки: отдельно или в кластере коротких флагов (`-ec`). */
const SHELL_C_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

/** Вызов оболочки: не оболочка или без `-c` — `none`; скрипт `-c` выделен — `script`; есть `-c`, но разбор не удался — `unparsed`. */
type ShellCall =
    | { readonly kind: 'none' }
    | { readonly kind: 'script'; readonly script: string }
    | { readonly kind: 'unparsed' };

/**
 * Вызов `sh|bash|ash|dash [флаги] -c <скрипт>` (§3.8 v1.11): короткие флаги и кластеры пропускаются, `o`/`O` (в `-o`,
 * `+o`, `-O`, `+O` и в кластере, например `-eo`) забирают следующий токен (имя опции); длинные `--<имя>` пропускаются,
 * `--rcfile` и `--init-file` — со значением. Есть `-c`, а скрипт выделить не удалось — `unparsed`.
 */
function shellCall(tokens: readonly string[]): ShellCall {
    const [shell] = tokens;
    if (shell === undefined || !SHELLS.has(basename(shell))) {
        return { kind: 'none' };
    }
    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (/^--[A-Za-z][\w-]*$/.test(token)) {
            index += SHELL_VALUE_LONG_OPTIONS.has(token) ? 1 : 0;
            continue;
        }
        if (!/^[-+][A-Za-z]+$/.test(token)) {
            break;
        }
        const optionNames = [...token.slice(1)].filter(
            (flag) => flag === 'o' || flag === 'O',
        ).length;
        if (token.startsWith('-') && token.includes('c')) {
            const script = tokens[index + 1 + optionNames];

            return script === undefined ? { kind: 'unparsed' } : { kind: 'script', script };
        }
        index += optionNames;
    }

    return tokens.slice(1).some((token) => SHELL_C_FLAG.test(token))
        ? { kind: 'unparsed' }
        : { kind: 'none' };
}

/** Скрипт вызова `sh|bash|ash|dash [флаги] -c <скрипт>` или null (см. shellCall). */
export function shellScript(tokens: readonly string[]): string | null {
    const call = shellCall(tokens);

    return call.kind === 'script' ? call.script : null;
}

/**
 * Команды запуска: массив — как есть, строка — по правилам shell; `sh -c "<скрипт>"` (и `sh -ec`, `bash -lc`,
 * `sh -e -c`, `bash -eo pipefail -c`) раскрывается рекурсивно.
 */
export function tokenize(command: string | readonly string[]): string[][] {
    const commands = typeof command === 'string' ? shellCommands(command) : [[...command]];

    return commands.flatMap((tokens) => {
        const script = shellScript(tokens);

        return script === null ? [tokens] : tokenize(script);
    });
}

/** Входной файл node-команды или null; опции со значением (NODE_VALUE_OPTIONS) без `=` съедают следующий токен. */
export function nodeEntry(tokens: readonly string[]): { entry: string; imports: string[] } | null {
    const found = nodeEntryAt(tokens);

    return found === null ? null : { entry: found.entry, imports: found.imports };
}

/** nodeEntry с индексом файла входа в tokens. */
function nodeEntryAt(
    tokens: readonly string[],
): { entry: string; imports: string[]; index: number } | null {
    const start = tokens.findIndex((token) => basename(token) === 'node');
    if (start === -1) {
        return null;
    }
    const imports: string[] = [];
    for (let index = start + 1; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (!token.startsWith('-')) {
            return { entry: token, imports, index };
        }
        const eq = token.indexOf('=');
        const name = eq === -1 ? token : token.slice(0, eq);
        let value: string | undefined;
        if (eq !== -1) {
            value = token.slice(eq + 1);
        } else if (NODE_VALUE_OPTIONS.has(name)) {
            index += 1;
            value = tokens[index];
        }
        if (name === '--import' && value !== undefined) {
            imports.push(value);
        }
    }

    return null;
}

/** Форма, которую правило не распознаёт (§3.8 v1.10): описание формы и простая команда, где она найдена. */
export interface UnrecognizedForm {
    /** Найденная форма по-русски: «раннер pnpm start», «обёртка с аргументами gosu» и т. п. */
    readonly form: string;
    /** Команда через пробел. */
    readonly command: string;
}

/** Запуск приложения: argv node после снятия обёрток и простая команда, как она записана. */
export interface AppLaunch {
    /** Argv node без обёрток (`exec`, `tini --`, …). */
    readonly tokens: readonly string[];
    /** Простая команда через пробел, как записана. */
    readonly command: string;
}

/** Результат разбора команды запуска. */
export interface LaunchAnalysis {
    /** Простые команды node с файлом входа приложения (main, main.js, …). */
    readonly launches: readonly AppLaunch[];
    /** Есть подделка `*.main.ts` / `*.main.js`. */
    readonly fake: boolean;
    /** Нераспознанные формы. */
    readonly unrecognized: readonly UnrecognizedForm[];
}

interface Accumulator {
    readonly launches: AppLaunch[];
    fake: boolean;
    readonly unrecognized: UnrecognizedForm[];
}

function unrecognized(acc: Accumulator, form: string, tokens: readonly string[]): void {
    acc.unrecognized.push({ form, command: tokens.join(' ') });
}

/**
 * Опции обёрток init (§3.8 v1.11). Источники: README tini (`-s`, `-g`, `-v`, `-w`, `-l`; `-p <сигнал>`, `-e <код>`) и
 * `dumb-init --help` (`-c`/`--single-child`, `-v`/`--verbose`; `-r`/`--rewrite <s:r>`). `--` — конец опций.
 */
const WRAPPER_OPTIONS: Readonly<
    Record<string, { flags: ReadonlySet<string>; values: ReadonlySet<string> }>
> = {
    tini: { flags: new Set(['-s', '-g', '-v', '-w', '-l']), values: new Set(['-p', '-e']) },
    'dumb-init': {
        flags: new Set(['-c', '--single-child', '-v', '--verbose']),
        values: new Set(['-r', '--rewrite']),
    },
};

/** Аргументы обёртки init после её опций; опция вне списка — «опция обёртки <имя>», null. */
function initWrapperArgs(
    head: string,
    tokens: readonly string[],
    acc: Accumulator,
): string[] | null {
    const spec = WRAPPER_OPTIONS[head];
    const rest = tokens.slice(1);
    if (spec === undefined) {
        return rest;
    }
    let index = 0;
    while (index < rest.length) {
        const token = rest[index] ?? '';
        if (token === '--') {
            return rest.slice(index + 1);
        }
        if (!token.startsWith('-')) {
            break;
        }
        const eq = token.indexOf('=');
        const name = eq === -1 ? token : token.slice(0, eq);
        if (spec.flags.has(token)) {
            index += 1;
        } else if (spec.values.has(name)) {
            index += eq === -1 ? 2 : 1;
        } else {
            unrecognized(acc, `опция обёртки ${name}`, tokens);

            return null;
        }
    }

    return rest.slice(index);
}

/** Обёртка (`exec`, `tini [опции] [--]`, `dumb-init [опции] [--]`, `env [VAR=…] [-флаги]`) снимается; иначе null. */
function unwrap(tokens: readonly string[], acc: Accumulator): string[] | null {
    const head = basename(tokens[0] ?? '');
    const rest = tokens.slice(1);
    if (head === 'exec') {
        return rest;
    }
    if (head === 'tini' || head === 'dumb-init') {
        return initWrapperArgs(head, tokens, acc) ?? [];
    }
    if (head === 'env') {
        let index = 0;
        while (
            index < rest.length &&
            (ASSIGNMENT.test(rest[index] ?? '') || (rest[index] ?? '').startsWith('-'))
        ) {
            index += 1;
        }

        return rest.slice(index);
    }

    return null;
}

/** Запуск через раннер (§3.8 v1.10): pnpm/npm/yarn start*, run start*, nest start, tsx, ts-node, pm2*, nodemon. */
function runnerForm(tokens: readonly string[]): boolean {
    const head = basename(tokens[0] ?? '');
    if (PACKAGE_MANAGERS.has(head)) {
        return tokens.slice(1).some((token) => /^start([:-].*)?$/.test(token));
    }
    if (head === 'nest') {
        return tokens[1] === 'start';
    }

    return RUNNERS.has(head) || head.startsWith('pm2');
}

/** `node --run start*` — раннер скриптов package.json. */
function nodeRunsScript(tokens: readonly string[]): boolean {
    return tokens.some(
        (token, index) =>
            (token === '--run' && /^start/.test(tokens[index + 1] ?? '')) ||
            /^--run=start/.test(token),
    );
}

function analyzeSimple(input: readonly string[], acc: Accumulator): void {
    let tokens = input.map((token) => expandDefaults(token));
    while (tokens.length > 0 && ASSIGNMENT.test(tokens[0] ?? '')) {
        tokens = tokens.slice(1);
    }
    for (;;) {
        const head = basename(tokens[0] ?? '');
        if (head.includes('$')) {
            unrecognized(acc, 'переменная без умолчания', input);

            return;
        }
        if (ARGUMENT_WRAPPERS.has(head)) {
            unrecognized(acc, `обёртка с аргументами ${head}`, input);

            return;
        }
        if (head === 'eval') {
            unrecognized(acc, 'eval', input);

            return;
        }
        if (PACKAGE_MANAGERS.has(head) && (tokens[1] === 'exec' || tokens[1] === 'dlx')) {
            tokens = tokens.slice(2);
            continue;
        }
        if (head === 'npx' || head === 'pnpx') {
            tokens = tokens.slice(1);
            while (tokens[0]?.startsWith('-') === true) {
                tokens = tokens.slice(1);
            }
            continue;
        }
        const unwrapped = unwrap(tokens, acc);
        if (unwrapped === null) {
            break;
        }
        tokens = unwrapped;
    }
    if (tokens.length === 0) {
        return;
    }
    const call = shellCall(tokens);
    if (call.kind === 'script') {
        analyzeInto(call.script, acc);

        return;
    }
    if (call.kind === 'unparsed') {
        unrecognized(acc, 'вызов оболочки не распознан', input);

        return;
    }
    const head = basename(tokens[0] ?? '');
    if (runnerForm(tokens)) {
        unrecognized(acc, `раннер ${head}`, input);

        return;
    }
    if (head !== 'node') {
        // main.* в аргументах любой команды — запуск, который правило не распознаёт (`./docker-entrypoint.sh node dist/main.js`).
        if (APP_ENTRY.test(head)) {
            unrecognized(acc, 'файл входа main.* на месте программы', input);
        } else if (tokens.some((token) => APP_ENTRY.test(basename(token)))) {
            unrecognized(acc, `файл входа main.* в аргументах ${head}`, input);
        }

        return;
    }
    if (nodeRunsScript(tokens)) {
        unrecognized(acc, 'раннер node --run', input);

        return;
    }
    const entry = nodeEntryAt(tokens);
    // Переменная без умолчания — среди опций node до файла входа и в самом файле входа; после него не проверяется.
    if (
        tokens
            .slice(0, entry === null ? tokens.length : entry.index + 1)
            .some((token) => token.includes('$'))
    ) {
        unrecognized(acc, 'переменная без умолчания', input);

        return;
    }
    const entryName = entry === null ? '' : basename(entry.entry);
    if (APP_ENTRY.test(entryName)) {
        acc.launches.push({ tokens, command: input.join(' ') });

        return;
    }
    if (FAKE_ENTRY.test(entryName)) {
        acc.fake = true;

        return;
    }
    if (tokens.slice(1).some((token) => APP_ENTRY.test(basename(token)))) {
        unrecognized(acc, 'файл входа main.* не на месте первого аргумента node', input);
    }
}

function analyzeInto(input: string | readonly string[], acc: Accumulator): void {
    if (typeof input === 'string' && /\$\(|`/.test(input)) {
        unrecognized(acc, 'подстановка команд $(…) или `…`', [input]);
    }
    for (const tokens of typeof input === 'string' ? shellCommands(input) : [[...input]]) {
        analyzeSimple(tokens, acc);
    }
}

/**
 * Разбор команды запуска (argv exec-формы или shell-строка): запуски приложения, подделки и нераспознанные формы
 * (§3.8 v1.10). `--import` засчитывается только в аргументах node, NODE_OPTIONS не учитывается.
 */
export function analyzeLaunch(input: string | readonly string[]): LaunchAnalysis {
    const acc: Accumulator = { launches: [], fake: false, unrecognized: [] };
    analyzeInto(input, acc);

    return acc;
}

/** У запуска приложения есть `--import` со значением, где есть `instrument`. */
export function hasInstrumentImport(tokens: readonly string[]): boolean {
    return (nodeEntry(tokens)?.imports ?? []).some((value) => value.includes('instrument'));
}
