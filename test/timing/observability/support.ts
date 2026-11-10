// Помощники T-тестов остановки (prd.md AC-2.10, AC-2.13): KitLifecycle на поддельных участниках, лог в сборщик,
// process.exit подменён и разрешает промис, обработчики сигналов снимаются после теста. Реальные таймеры.
import { pino } from 'pino';
import { vi } from 'vitest';
import { HealthRegistry, KitLifecycle } from '../../../src/observability/index.js';

/** Записи лога. */
export interface LogSink {
    records(): Record<string, unknown>[];
}

function sink(): LogSink & { write(line: string): void } {
    const lines: string[] = [];

    return {
        write: (line) => void lines.push(line),
        records: () =>
            lines
                .join('')
                .split('\n')
                .filter((line) => line.trim() !== '')
                .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
}

/** Остановка с поддельными участниками: сброс таймеров и сигнальных обработчиков — через release(). */
export function lifecycleStand(env: { SHUTDOWN_TIMEOUT_MS: number; SHUTDOWN_DRAIN_MS: number }) {
    const log = sink();
    const logger = pino({ level: 'trace', base: { service: 'kit-test', replica: 'r1' } }, log);
    const health = new HealthRegistry({ logger });
    const lifecycle = new KitLifecycle({ logger, health, env });
    let exited: (at: number) => void = () => undefined;
    const exitedAt = new Promise<number>((resolve) => {
        exited = resolve;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        exited(performance.now());

        return undefined as never;
    });

    return { log, health, lifecycle, exit, exitedAt };
}

/** Снимает обработчики SIGTERM/SIGINT, добавленные после снимка. */
export function signalSnapshot(): () => void {
    const saved = {
        SIGTERM: process.listeners('SIGTERM'),
        SIGINT: process.listeners('SIGINT'),
    };

    return () => {
        for (const signal of ['SIGTERM', 'SIGINT'] as const) {
            for (const listener of process.listeners(signal)) {
                if (!saved[signal].includes(listener)) {
                    process.removeListener(signal, listener as () => void);
                }
            }
        }
    };
}

/** Пауза реальным таймером. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
