// KitLifecycle — участники остановки и сторож срока (prd.md §3.2 шаги 1–5, AC-2.10, AC-2.13, UC-8, NFR-8; KT-10, KT-11).
// Эталоны: общий срок от первого вызова — P/O RabbitConnection.shutdownDeadline(); флаг остановки первым действием —
// O instance-shutdown.ts begin(). Остаток срока от начала остановки — shutdownRemainingMs (AC-5.11). Механизм шагов и сторож с exit(1) написаны по PRD: эталона нет.
// Два режима (KT-11): сигнал ОС (listen) — сторож SHUTDOWN_TIMEOUT_MS от сигнала, по окончании шагов сторож unref и
// выход 0 сам; программный close() — те же шаги без сторожа и exit, ошибки участников — отказ close().
import * as Sentry from '@sentry/nestjs';
import type { Logger } from 'pino';
import type { KitBaseEnv } from '../config/fragments.js';
import type { HealthRegistry } from './health-registry.js';
import { sanitizeError } from './sanitize-error.js';
import { captureError } from './sentry.js';

/** Шаг участника (§3.2): 2 — приём соединений, 3 — подписчики и фоновые задачи, 4 — пулы, 5 — сервер метрик. */
export type KitShutdownStep = 2 | 3 | 4 | 5;

/** Участник остановки: участники одного шага работают параллельно. */
export interface KitShutdownParticipant {
    /** Имя для логов и сторожа. */
    readonly name: string;
    /** Останавливает участника; ошибка логируется, остальные шаги выполняются. */
    stop(): Promise<void> | void;
}

const STEPS: readonly KitShutdownStep[] = [2, 3, 4, 5];
const DEFAULT_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
const SENTRY_FLUSH_MS = 2000;

/** Момент `performance.now`, к которому истекает SHUTDOWN_TIMEOUT_MS от начала остановки (сигнал или close()). */
const stopDeadlines = new WeakMap<KitLifecycle, number>();

/**
 * Остаток SHUTDOWN_TIMEOUT_MS от начала остановки (сигнал или `close()`), мс; `undefined` — остановка не начата.
 * Для срока обработчиков /messaging (§3.4, AC-5.11).
 * @internal
 */
export function shutdownRemainingMs(lifecycle: KitLifecycle): number | undefined {
    const deadline = stopDeadlines.get(lifecycle);

    return deadline === undefined ? undefined : deadline - performance.now();
}

/** Остановка экземпляра приложения по шагам 1–5 (§3.2). Остановка одна на экземпляр. */
export class KitLifecycle {
    private readonly logger: Logger;
    private readonly health: HealthRegistry;
    private readonly timeoutMs: number;
    private readonly drainMs: number;
    private readonly participants = new Map<KitShutdownStep, KitShutdownParticipant[]>();
    private steps: Promise<unknown[]> | null = null;
    private closing: Promise<void> | null = null;
    private watchdog: NodeJS.Timeout | null = null;
    private finished = false;
    private currentStep: 1 | KitShutdownStep = 1;
    private readonly pending = new Set<string>();

    constructor(options: {
        readonly logger: Logger;
        readonly health: HealthRegistry;
        readonly env: Pick<KitBaseEnv, 'SHUTDOWN_TIMEOUT_MS' | 'SHUTDOWN_DRAIN_MS'>;
    }) {
        this.logger = options.logger;
        this.health = options.health;
        this.timeoutMs = options.env.SHUTDOWN_TIMEOUT_MS;
        this.drainMs = options.env.SHUTDOWN_DRAIN_MS;
    }

    /** Регистрирует участника шага; после начала остановки — ошибка разработчика. */
    register(
        participant: KitShutdownParticipant,
        options: { readonly step: KitShutdownStep },
    ): void {
        if (this.steps !== null) {
            throw new Error('KitLifecycle: регистрация после начала остановки');
        }
        const list = this.participants.get(options.step) ?? [];
        list.push(participant);
        this.participants.set(options.step, list);
    }

    /**
     * Остановка по сигналу ОС (умолч. SIGTERM, SIGINT): сторож срока, ошибки участников — `error` и GlitchTip.
     * Обработчик остаётся (`process.on`): повторный сигнал не включает действие Node по умолчанию посреди шагов.
     */
    listen(signals: readonly NodeJS.Signals[] = DEFAULT_SIGNALS): void {
        for (const signal of signals) {
            process.on(signal, () => this.onSignal(signal));
        }
    }

    /**
     * Программное закрытие (тесты сервиса, CLI): шаги 1–5 без сторожа и `exit`. Ошибка участника — отказ после
     * всех шагов (несколько — `AggregateError`). Повторный вызов возвращает тот же промис.
     */
    close(): Promise<void> {
        this.closing ??= this.start({ mode: 'close' }).then(throwFailures);

        return this.closing;
    }

    private onSignal(signal: NodeJS.Signals): void {
        if (this.watchdog !== null) {
            return;
        }
        // t0 — сигнал: сторож взводится до шагов, пауза входит в срок (CE-7).
        this.watchdog = setTimeout(() => void this.onDeadline(), this.timeoutMs);
        void this.start({ signal }).then(() => {
            // Шаги завершены: процесс без открытых дескрипторов выходит сам с кодом 0 (KT-10 п. 4).
            this.watchdog?.unref();
        });
    }

    private start(context: { readonly signal: NodeJS.Signals } | { readonly mode: 'close' }) {
        // Начало остановки — один раз: первый сигнал или первый close(), кто раньше (AC-5.11).
        if (!stopDeadlines.has(this)) {
            stopDeadlines.set(this, performance.now() + this.timeoutMs);
        }
        this.steps ??= this.run(context);

        return this.steps;
    }

    private async run(context: object): Promise<unknown[]> {
        const startedAt = performance.now();
        const failures: unknown[] = [];
        this.logger.info(context, 'остановка: начало');

        // Шаг 1: /health 503 и пауза SHUTDOWN_DRAIN_MS — балансировщик выводит реплику.
        this.health.markStopping();
        if (this.drainMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.drainMs));
        }

        // Шаги 2–5: участники шага параллельно, следующий шаг — после завершения предыдущего.
        for (const step of STEPS) {
            await this.runStep(step, failures);
        }

        this.finished = true;
        this.logger.info({ durationMs: elapsed(startedAt) }, 'остановка: завершена');

        return failures;
    }

    private async runStep(step: KitShutdownStep, failures: unknown[]): Promise<void> {
        const list = this.participants.get(step) ?? [];
        const startedAt = performance.now();
        this.currentStep = step;
        for (const participant of list) {
            this.pending.add(participant.name);
        }
        this.logger.debug(
            { step, participants: list.map((participant) => participant.name) },
            'остановка: шаг начат',
        );
        await Promise.allSettled(
            list.map((participant) => this.stopParticipant(step, participant, failures)),
        );
        this.logger.debug({ step, durationMs: elapsed(startedAt) }, 'остановка: шаг завершён');
    }

    private async stopParticipant(
        step: KitShutdownStep,
        participant: KitShutdownParticipant,
        failures: unknown[],
    ): Promise<void> {
        const startedAt = performance.now();
        try {
            await participant.stop();
            this.logger.debug(
                { step, participant: participant.name, durationMs: elapsed(startedAt) },
                'остановка: участник завершён',
            );
        } catch (error) {
            failures.push(error);
            this.logger.error(
                { step, participant: participant.name, err: sanitizeError(error) },
                'остановка: участник завершился с ошибкой',
            );
            if (this.watchdog !== null) {
                captureError(error, { tags: { code: 'SHUTDOWN_PARTICIPANT_FAILED' } });
            }
        } finally {
            this.pending.delete(participant.name);
        }
    }

    /** Сторож: шаги не уложились в срок или процесс не вышел после них — error, GlitchTip, exit(1). */
    private async onDeadline(): Promise<void> {
        if (this.finished) {
            this.logger.error(
                { code: 'SHUTDOWN_NOT_EXITED', timeoutMs: this.timeoutMs },
                'процесс не завершился после остановки',
            );
            captureError(new Error('Процесс не завершился после остановки'), {
                tags: { code: 'SHUTDOWN_NOT_EXITED' },
            });
        } else {
            this.logger.error(
                {
                    code: 'SHUTDOWN_TIMEOUT',
                    step: this.currentStep,
                    pending: [...this.pending],
                    timeoutMs: this.timeoutMs,
                },
                'срок остановки истёк',
            );
            captureError(new Error('Срок остановки истёк'), {
                tags: { code: 'SHUTDOWN_TIMEOUT' },
            });
        }
        await Sentry.flush(SENTRY_FLUSH_MS);
        process.exit(1);
    }
}

function elapsed(startedAt: number): number {
    return Math.round(performance.now() - startedAt);
}

/** Отказ close(): одна ошибка — она сама, несколько — AggregateError. */
function throwFailures(failures: readonly unknown[]): void {
    if (failures.length === 1) {
        throw failures[0];
    }
    if (failures.length > 1) {
        throw new AggregateError(
            failures,
            'KitLifecycle: участники остановки завершились с ошибкой',
        );
    }
}
