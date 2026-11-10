// failStartup и StartupFailure (prd.md §3.2, AC-2.9, UC-3, NFR-4, NFR-9). Эталон — O fail-startup.ts: доменная ветка
// ModelCatalogError заменена интерфейсом StartupFailure (распознаётся по форме), параметр exit не переносится.
import * as Sentry from '@sentry/nestjs';
import type { Logger } from 'pino';
import { InvalidEnvironmentError } from '../config/parse-env.js';
import { sanitizeError } from './sanitize-error.js';
import { captureError } from './sentry.js';

/** Ожидание отправки события GlitchTip перед выходом (§3.2). */
const SENTRY_FLUSH_MS = 2000;

/** Код события прочих отказов запуска. */
const STARTUP_FAILED = 'STARTUP_FAILED';

/** Ошибка запуска сервиса (§3.2): код и подробности без секретов попадают в fatal-лог и тег события. */
export interface StartupFailure {
    /** Код отказа (SCREAMING_SNAKE). */
    readonly startupCode: string;
    /** Подробности для лога — без значений окружения, секретов и ПДн. */
    startupDetails(): Readonly<Record<string, unknown>>;
}

function isStartupFailure(raw: unknown): raw is StartupFailure {
    if (typeof raw !== 'object' || raw === null) {
        return false;
    }
    const { startupCode, startupDetails } = raw as Partial<Record<keyof StartupFailure, unknown>>;

    return typeof startupCode === 'string' && typeof startupDetails === 'function';
}

/** Подробности отказа; исключение в startupDetails() не отменяет fatal-лог, событие и exit(1). */
function detailsOf(raw: StartupFailure): Readonly<Record<string, unknown>> {
    try {
        return raw.startupDetails();
    } catch {
        return {};
    }
}

/** Пишет fatal-лог отказа и возвращает код события. */
function logFailure(raw: unknown, logger: Logger): string {
    if (raw instanceof InvalidEnvironmentError) {
        // Только имена ключей: значения окружения не попадают никуда (NFR-4).
        logger.fatal({ code: raw.code, keys: raw.keys }, 'Неверное окружение — запуск остановлен');

        return raw.code;
    }
    if (isStartupFailure(raw)) {
        logger.fatal({ ...detailsOf(raw), code: raw.startupCode }, 'Отказ запуска');

        return raw.startupCode;
    }
    logger.fatal({ code: STARTUP_FAILED, err: sanitizeError(raw) }, 'Отказ запуска');

    return STARTUP_FAILED;
}

/**
 * Отказ запуска (§3.2, UC-3): `fatal`-лог, событие GlitchTip с ожиданием отправки до 2 с, `exit(1)`.
 * `InvalidEnvironmentError` — код и имена ключей; `StartupFailure` — `startupCode` и `startupDetails()`;
 * прочее — через `sanitizeError`.
 */
export async function failStartup(raw: unknown, logger: Logger): Promise<never> {
    const code = logFailure(raw, logger);
    captureError(raw, { tags: { code } });
    await Sentry.flush(SENTRY_FLUSH_MS);

    return process.exit(1);
}
