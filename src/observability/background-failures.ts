// backgroundFailed, backgroundSucceeded, KitBackgroundLogger (prd.md §3.2 v1.34, AC-2.16). Эталон — O background-failures.ts
// (5b74b27). Отличия по PRD: функции вместо класса, task по формату вместо закрытого списка, метрика verdeect_ (итоги —
// backgroundFailureTotals для metrics.ts), логгер в стиле pino, сообщения пакета.
import { sanitizeError } from './sanitize-error.js';
import { captureError } from './sentry.js';

/**
 * Логгер фоновой задачи в стиле pino: `(поля, сообщение)`. Подходит логгер `nestjs-pino`/pino сервиса; Nest `Logger` —
 * через адаптер сервиса (README).
 */
export interface KitBackgroundLogger {
    /** Первый сбой серии. */
    error(fields: Record<string, unknown>, message: string): void;
    /** Повторный сбой серии (`failures` — номер сбоя). */
    warn(fields: Record<string, unknown>, message: string): void;
    /** Серия закрыта успехом (`failures` — число сбоев серии). */
    info(fields: Record<string, unknown>, message: string): void;
}

const TASK_FORMAT = /^[a-z][a-z0-9_.-]{1,63}$/;

// ponytail: серия и счёт — на процесс; при N репликах до N событий на серию (README). Общая серия (Redis) — если
// GlitchTip потребует.
/** Открытые серии: task → число сбоев подряд. */
const series = new Map<string, number>();
/** Все сбои процесса по task (только растут): `verdeect_background_failures_total`. */
const totals = new Map<string, number>();

function assertTask(task: string, fn: string): void {
    if (typeof task !== 'string' || !TASK_FORMAT.test(task)) {
        throw new TypeError(`${fn}: task вне формата ^[a-z][a-z0-9_.-]{1,63}$`);
    }
}

/**
 * Сбой прохода фоновой задачи `task` (§3.2): первый сбой серии — `error`-лог и одно событие GlitchTip (через
 * `sanitizeError`), следующие — `warn` с `{task, failures}` без события; каждый сбой —
 * `verdeect_background_failures_total{task}` +1. Пропуск прохода (замок не взят, срок не наступил) — не вызывать.
 * @param task имя задачи, `^[a-z][a-z0-9_.-]{1,63}$`; закрытого списка нет.
 * @throws {TypeError} `task` вне формата.
 */
export function backgroundFailed(task: string, err: unknown, logger: KitBackgroundLogger): void {
    assertTask(task, 'backgroundFailed');
    totals.set(task, (totals.get(task) ?? 0) + 1);
    const failures = (series.get(task) ?? 0) + 1;
    series.set(task, failures);
    if (failures === 1) {
        captureError(err);
        logger.error({ task, err: sanitizeError(err) }, 'фоновая задача: сбой');

        return;
    }
    logger.warn({ task, failures, err: sanitizeError(err) }, 'фоновая задача: сбой повторяется');
}

/**
 * Успешный проход фоновой задачи `task` (§3.2): открытая серия закрывается (`info` с `failures`), следующий сбой — снова
 * событие; без серии — ничего. Пропуск прохода — не вызывать.
 * @param task имя задачи, `^[a-z][a-z0-9_.-]{1,63}$`.
 * @throws {TypeError} `task` вне формата.
 */
export function backgroundSucceeded(task: string, logger: KitBackgroundLogger): void {
    assertTask(task, 'backgroundSucceeded');
    const failures = series.get(task);
    if (failures === undefined) {
        return;
    }
    series.delete(task);
    logger.info({ task, failures }, 'фоновая задача: серия сбоев закрыта');
}

/** @internal Итоги сбоев процесса по `task` для `collect()` метрики `verdeect_background_failures_total` (metrics.ts). */
export function backgroundFailureTotals(): ReadonlyMap<string, number> {
    return totals;
}
