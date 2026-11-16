// Расписание фоновой очистки outbox/inbox и идемпотентности (prd.md §3.4 стр. 133 v1.31, AC-5.12): цепочка таймеров
// вместо setInterval. После выполненного прохода и после ошибки — через CLEANUP_INTERVAL_MS (1 ч); замок занят другой
// репликой — через 5 мин + random() × 1 мин. Таймеры и random — через cleanupClock: тест подменяет его методы.
// Только node:* и zod (ARCHITECTURE.md): интервал объявлен здесь, /messaging (topology.ts) его реэкспортирует.

/** Интервал очистки после выполненного прохода и после ошибки, мс (1 ч, §3.4). */
export const CLEANUP_INTERVAL_MS = 3_600_000;

/** Повтор при занятом замке, мс (5 мин). */
export const CLEANUP_RETRY_MS = 300_000;

/** Случайная добавка к повтору при занятом замке, мс (до 1 мин). */
export const CLEANUP_RETRY_JITTER_MS = 60_000;

/** Итог прохода для расписания: выполнен, замок занят, ошибка. */
export type CleanupOutcome = 'done' | 'busy' | 'error';

/** @internal Часы расписания очистки: таймер (`unref`), отмена и случайное число. */
export const cleanupClock = {
    /** Таймер, не держащий процесс. */
    setTimeout: (fn: () => void, ms: number): NodeJS.Timeout => setTimeout(fn, ms).unref(),
    /** Отмена таймера. */
    clearTimeout: (timer: NodeJS.Timeout | undefined): void => clearTimeout(timer),
    /** Случайное число [0, 1). */
    random: (): number => Math.random(),
};

/** Задержка до следующего прохода по итогу текущего. */
export function nextCleanupDelay(outcome: CleanupOutcome): number {
    if (outcome === 'busy') {
        return CLEANUP_RETRY_MS + Math.floor(cleanupClock.random() * CLEANUP_RETRY_JITTER_MS);
    }

    return CLEANUP_INTERVAL_MS;
}
