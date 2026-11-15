// KitLifecycle — участники остановки и сторож срока (prd.md §3.2 шаги 1–5, AC-2.10, AC-2.13, UC-8, NFR-8; KT-10, KT-11).
// Эталоны: общий срок от первого вызова — P/O RabbitConnection.shutdownDeadline(); флаг остановки первым действием —
// O instance-shutdown.ts begin(). Остаток срока от начала остановки — shutdownRemainingMs (AC-5.11). Механизм шагов и сторож с exit(1) написаны по PRD: эталона нет.
// Два режима (KT-11): сигнал ОС (listen) — сторож SHUTDOWN_TIMEOUT_MS от сигнала, по окончании шагов сторож unref и
// выход 0 сам; программный close() — те же шаги без сторожа и exit, ошибки участников — отказ close().
// v1.30 (BFF-77): шаг 2 в два этапа — 2a участники сервиса, 2b участник http пакета (registerHttpServer, server.close());
// порядок не зависит от порядка регистрации.
import * as Sentry from '@sentry/nestjs';
import type { Logger } from 'pino';
import type { KitBaseEnv } from '../config/fragments.js';
import type { HealthRegistry } from './health-registry.js';
import { sanitizeError } from './sanitize-error.js';
import { captureError } from './sentry.js';

/**
 * Шаг участника (§3.2): 2 — приём соединений, 3 — подписчики и фоновые задачи, 4 — пулы, 5 — сервер метрик.
 * Шаг 2 сервиса — «хук `onStopAccepting`»: закрытие долгих соединений (WebSocket — своим кодом, например 1001; SSE —
 * концом ответа); выполняется до `server.close()` участника `http` пакета при любом порядке регистрации.
 */
export type KitShutdownStep = 2 | 3 | 4 | 5;

/**
 * Участник остановки: участники одного шага работают параллельно; на шаге 2 участники сервиса завершаются до
 * `server.close()` участника `http` пакета.
 */
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

/** Этап шага 2 (§3.2 v1.30): 2a — участники сервиса, 2b — участник `http` пакета. */
type ShutdownStage = '2a' | '2b';

/** Участники `http` пакета (этап 2b): отличаются меткой, а не именем — сервис тоже может назвать участника 'http'. */
const httpServers = new WeakSet<KitShutdownParticipant>();

/**
 * Регистрирует участника `http` пакета — этап 2b шага 2 (§3.2): вызывается после завершения участников шага 2 сервиса.
 * @internal
 */
export function registerHttpServer(
    lifecycle: KitLifecycle,
    participant: KitShutdownParticipant,
): void {
    lifecycle.register(participant, { step: 2 });
    httpServers.add(participant);
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
    private currentStage: ShutdownStage | null = null;
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

    /**
     * Регистрирует участника шага; после начала остановки — ошибка разработчика. Участники шага 2 сервиса («хук
     * `onStopAccepting`») вызываются одновременно и завершаются до `server.close()` участника `http` пакета.
     */
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
        this.currentStep = step;
        if (step !== 2) {
            await this.runStage(step, null, list, failures);
            return;
        }
        // Шаг 2a: участники сервиса закрывают долгие соединения; 2b: затем server.close() участника http.
        await this.runStage(
            step,
            '2a',
            list.filter((participant) => !httpServers.has(participant)),
            failures,
        );
        await this.runStage(
            step,
            '2b',
            list.filter((participant) => httpServers.has(participant)),
            failures,
        );
    }

    /** Этап: участники одновременно, pending — имена участников этапа. */
    private async runStage(
        step: KitShutdownStep,
        stage: ShutdownStage | null,
        list: readonly KitShutdownParticipant[],
        failures: unknown[],
    ): Promise<void> {
        const startedAt = performance.now();
        const fields = stage === null ? { step } : { step, stage };
        this.currentStage = stage;
        for (const participant of list) {
            this.pending.add(participant.name);
        }
        this.logger.debug(
            { ...fields, participants: list.map((participant) => participant.name) },
            'остановка: шаг начат',
        );
        await Promise.allSettled(
            list.map((participant) => this.stopParticipant(step, participant, failures)),
        );
        this.logger.debug({ ...fields, durationMs: elapsed(startedAt) }, 'остановка: шаг завершён');
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
                    ...(this.currentStage === null ? {} : { stage: this.currentStage }),
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
