// Множитель тайм-аутов тестов (prd.md §3.8, E1); эталон — verdeect-platform-client test/support/timeout-scale.ts.
// По умолчанию 1. Задаётся вручную на загруженной машине (load average > числа ядер — 2–3).
// Сообщение в консоль из O (scripts/timeout-scale.mjs) не перенесено: NFR-8. Подпуть @verdeect/kit/testing/timeout-scale
// без условия development (AC-9.6) — для vitest.config.ts: граф файла только node:*, других импортов нет.

/**
 * Множитель testTimeout/hookTimeout из TEST_TIMEOUT_SCALE; пусто — 1.
 * @param env окружение; по умолчанию `process.env`.
 * @throws {Error} значение не число > 0.
 */
export function readTimeoutScale(
    env: Readonly<Record<string, string | undefined>> = process.env,
): number {
    const raw = env.TEST_TIMEOUT_SCALE?.trim() ?? '';
    if (raw === '') {
        return 1;
    }
    const scale = Number(raw);
    if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`TEST_TIMEOUT_SCALE=${raw}: нужно число > 0`);
    }

    return scale;
}

/** Множитель тайм-аутов тестов текущего процесса (§3.8). */
export const TEST_TIMEOUT_SCALE: number = readTimeoutScale(process.env);
