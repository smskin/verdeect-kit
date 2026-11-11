// isUniqueViolation, isConnectionError, isPoolTimeout — по форме объекта, обход cause, без pg и drizzle-orm (prd.md §3.3;
// rules/base.md). Эталоны: isUniqueViolation — I pg-errors.ts; isPoolTimeout — O pool-client.ts (сообщения);
// isConnectionError — по PRD (у I/O — instanceof DrizzleQueryError, не переносится; формы — KT-15 п. 9).
// tagPoolTimeout/poolTimeoutOf — метка пула /database: срок учтён (решение E3, KT-19 п. 3, AC-4.5).

/** Глубина обхода `cause` — как у `sanitizeError` (§3.2). */
const MAX_CAUSE_DEPTH = 10;

/** SQLSTATE нарушения уникальности (PostgreSQL, класс 23). */
const UNIQUE_VIOLATION = '23505';

/** Тексты pg-pool при истечении срока ожидания клиента (O pool-client.ts POOL_TIMEOUT_MESSAGES). */
const POOL_TIMEOUT_MESSAGES: ReadonlySet<string> = new Set([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
]);

/** SQLSTATE прекращения работы сервера: admin_shutdown, crash_shutdown, cannot_connect_now (класс 57P). */
const SHUTDOWN_SQLSTATES: ReadonlySet<string> = new Set(['57P01', '57P02', '57P03']);

/** Системные коды Node обрыва и отказа сети. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
]);

/** Начала сообщений pg при обрыве соединения (последнее — запрос на клиенте после обрыва, AC-4.10). */
const CONNECTION_MESSAGE_PREFIXES: readonly string[] = [
    'Connection terminated',
    'terminating connection',
    'Client has encountered a connection error',
];

interface ErrorShape {
    readonly code?: unknown;
    readonly constraint?: unknown;
    readonly message?: unknown;
    readonly cause?: unknown;
}

/** Ошибка и её `cause` до 10 уровней: только объекты, цикл не зацикливает. */
function causeChain(error: unknown): ErrorShape[] {
    const chain: ErrorShape[] = [];
    const seen = new Set<object>();
    let current = error;
    while (
        chain.length < MAX_CAUSE_DEPTH &&
        typeof current === 'object' &&
        current !== null &&
        !seen.has(current)
    ) {
        seen.add(current);
        chain.push(current);
        current = (current as ErrorShape).cause;
    }

    return chain;
}

/** Нарушение уникальности (23505); `constraint` — имя ограничения первого такого узла цепочки. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
    const node = causeChain(error).find((item) => item.code === UNIQUE_VIOLATION);
    if (node === undefined) {
        return false;
    }

    return constraint === undefined || node.constraint === constraint;
}

function isConnectionNode(node: ErrorShape): boolean {
    if (typeof node.code === 'string') {
        if (node.code.startsWith('08') && node.code.length === 5) {
            return true;
        }
        if (SHUTDOWN_SQLSTATES.has(node.code) || NETWORK_CODES.has(node.code)) {
            return true;
        }
    }
    const message = node.message;

    return (
        typeof message === 'string' &&
        CONNECTION_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix))
    );
}

/**
 * Ошибка соединения с PostgreSQL: SQLSTATE `08xxx`, `57P01`–`57P03`, системные коды обрыва сети, сообщения pg
 * «Connection terminated…», «terminating connection…» и «Client has encountered a connection error…» — в ошибке или
 * её `cause`.
 */
export function isConnectionError(error: unknown): boolean {
    return causeChain(error).some(isConnectionNode);
}

/** Срок ожидания клиента пула истёк (тексты pg-pool) — в ошибке или её `cause`, в том числе внутри `DomainError`. */
export function isPoolTimeout(error: unknown): boolean {
    return causeChain(error).some(isPoolTimeoutNode);
}

/** Имя пула `/database`: основной или пул чтения (метка `pool` метрики срока, AC-4.5). */
export type KitPoolName = 'main' | 'read';

/** Неперечисляемая метка «срок учтён пулом» на узле ошибки срока. */
const POOL_TAG = Symbol.for('verdeect-kit.pool');

function isPoolTimeoutNode(node: ErrorShape): boolean {
    return typeof node.message === 'string' && POOL_TIMEOUT_MESSAGES.has(node.message);
}

/**
 * Помечает узел срока пула в цепочке `cause` именем пула. `true` — метка поставлена сейчас (вызывающий
 * учитывает срок один раз); `false` — узла срока нет или он уже помечен.
 */
export function tagPoolTimeout(error: unknown, pool: KitPoolName): boolean {
    const node = causeChain(error).find(isPoolTimeoutNode);
    if (node === undefined || Object.prototype.hasOwnProperty.call(node, POOL_TAG)) {
        return false;
    }
    Object.defineProperty(node, POOL_TAG, { value: pool, enumerable: false });

    return true;
}

/** Имя пула из метки `tagPoolTimeout` первого помеченного узла цепочки или `null`. */
export function poolTimeoutOf(error: unknown): KitPoolName | null {
    for (const node of causeChain(error)) {
        const tag = (node as Record<symbol, unknown>)[POOL_TAG];
        if (tag === 'main' || tag === 'read') {
            return tag;
        }
    }

    return null;
}

/** SQLSTATE: 5 знаков `0-9A-Z` с цифрой (системные коды Node вроде `EPIPE` цифр не содержат). */
const SQLSTATE = /^(?=.*\d)[0-9A-Z]{5}$/;

/** SQLSTATE первого узла цепочки `cause` (до 10 уровней) или `null` — например, ошибка pg в `cause` `DrizzleQueryError`. */
export function sqlStateOf(error: unknown): string | null {
    for (const node of causeChain(error)) {
        if (typeof node.code === 'string' && SQLSTATE.test(node.code)) {
            return node.code;
        }
    }

    return null;
}
