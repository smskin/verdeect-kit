// HealthRegistry — пробы /health (prd.md §3.2, AC-2.7, UC-13). Эталон — O health-registry.ts: параллельные пробы,
// гонка со сроком 2 с, исключение пробы → down, повторная регистрация имени заменяет пробу. По PRD: имя — строка,
// critical — в опциях, флаг остановки — здесь (с начала остановки — 503). Лог — только при смене состояния пробы.
import type { Logger } from 'pino';
import { sanitizeError } from './sanitize-error.js';

/** Проба зависимости: `true` — up. Исключение и ответ дольше 2 с — down. */
export type HealthProbe = () => Promise<boolean>;

/** Ответ `/health` (§3.2). */
export interface HealthReport {
    /** `ok` — всё up; `degraded` — down некритичная; `unavailable` — down критичная или идёт остановка. */
    readonly status: 'ok' | 'degraded' | 'unavailable';
    /** Состояние каждой пробы по имени. */
    readonly checks: Readonly<Record<string, 'up' | 'down'>>;
}

/** Срок пробы (§3.2). */
export const PROBE_TIMEOUT_MS = 2000;

interface ProbeResult {
    readonly up: boolean;
    readonly error?: unknown;
}

/** Реестр проб готовности; один на экземпляр приложения. */
export class HealthRegistry {
    private readonly logger: Logger;
    private readonly probes = new Map<string, { critical: boolean; probe: HealthProbe }>();
    private readonly lastState = new Map<string, 'up' | 'down'>();
    private stopping = false;

    constructor(options: { readonly logger: Logger }) {
        this.logger = options.logger;
    }

    /** Регистрирует пробу; повторная регистрация имени заменяет прежнюю. */
    register(name: string, probe: HealthProbe, options: { readonly critical: boolean }): void {
        this.probes.set(name, { critical: options.critical, probe });
    }

    /** Шаг 1 остановки: с этого момента `evaluate` — `unavailable` без запуска проб. */
    markStopping(): void {
        this.stopping = true;
    }

    /** Идёт ли остановка. */
    get isStopping(): boolean {
        return this.stopping;
    }

    /** Запускает пробы параллельно и сводит статус; при остановке — `unavailable` без проб. */
    async evaluate(): Promise<HealthReport> {
        if (this.stopping) {
            return { status: 'unavailable', checks: {} };
        }
        const results = await Promise.all(
            [...this.probes.entries()].map(async ([name, { critical, probe }]) => {
                const result = await runProbe(probe);
                this.trackState(name, critical, result);

                return { name, critical, up: result.up };
            }),
        );

        const checks: Record<string, 'up' | 'down'> = {};
        for (const result of results) {
            checks[result.name] = result.up ? 'up' : 'down';
        }
        const down = results.filter((result) => !result.up);
        if (down.some((result) => result.critical)) {
            return { status: 'unavailable', checks };
        }

        return { status: down.length > 0 ? 'degraded' : 'ok', checks };
    }

    /** Лог только при смене состояния: up → down (и первый down) — warn, down → up — info. */
    private trackState(name: string, critical: boolean, result: ProbeResult): void {
        const previous = this.lastState.get(name);
        const current = result.up ? 'up' : 'down';
        this.lastState.set(name, current);
        if (previous === current) {
            return;
        }
        if (current === 'down') {
            this.logger.warn(
                {
                    check: name,
                    critical,
                    ...(result.error === undefined ? {} : { err: sanitizeError(result.error) }),
                },
                'проба здоровья: down',
            );

            return;
        }
        if (previous === 'down') {
            this.logger.info({ check: name }, 'проба здоровья: up');
        }
    }
}

/** Проба в гонке со сроком; таймер снимается после ответа. */
async function runProbe(probe: HealthProbe): Promise<ProbeResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ProbeResult>((resolve) => {
        timer = setTimeout(() => resolve({ up: false }), PROBE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([probe().then((up) => ({ up: up === true })), timeout]);
    } catch (error) {
        return { up: false, error };
    } finally {
        clearTimeout(timer);
    }
}
