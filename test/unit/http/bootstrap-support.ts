// Стенд тестов bootstrapService (prd.md §3.5, AC-3.10–AC-3.13): exit бросает маркер, PORT=0 и METRICS_PORT=0, перехват
// строк stdout (логгер bootstrapService пишет JSON в stdout), снятие обработчиков сигналов KitLifecycle.listen() и
// закрытие приложений после теста.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, beforeEach, vi } from 'vitest';

/** Маркер вызова process.exit. */
export class ExitCalled extends Error {
    constructor(readonly code: number | string | null | undefined) {
        super(`process.exit(${String(code)})`);
    }
}

/** Состояние стенда: разобранные строки stdout и открытые приложения. */
export interface BootstrapStand {
    /** Разобранные JSON-строки stdout. */
    records(): Record<string, unknown>[];
    /** Весь вывод stdout. */
    text(): string;
    /** Приложение закрывается после теста. */
    track(app: NestFastifyApplication): NestFastifyApplication;
}

/** Подключает стенд к файлу теста; env — дополнительные ключи окружения. */
export function useBootstrapStand(env: Readonly<Record<string, string>> = {}): BootstrapStand {
    let chunks: string[] = [];
    const apps: NestFastifyApplication[] = [];
    let signals: Map<string, Set<(...args: unknown[]) => void>> = new Map();

    beforeEach(() => {
        chunks = [];
        vi.stubEnv('PORT', '0');
        vi.stubEnv('METRICS_PORT', '0');
        vi.stubEnv('SHUTDOWN_DRAIN_MS', '0');
        vi.stubEnv('LOG_LEVEL', 'info');
        for (const [key, value] of Object.entries(env)) {
            vi.stubEnv(key, value);
        }
        vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new ExitCalled(code);
        });
        const write = process.stdout.write.bind(process.stdout);
        vi.spyOn(process.stdout, 'write').mockImplementation(
            (chunk: string | Uint8Array, ...rest: unknown[]) => {
                const text =
                    typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
                if (text.startsWith('{')) {
                    chunks.push(text);

                    return true;
                }

                return write(chunk, ...(rest as []));
            },
        );
        signals = new Map(
            (['SIGTERM', 'SIGINT'] as const).map((signal) => [
                signal,
                new Set(process.listeners(signal) as ((...args: unknown[]) => void)[]),
            ]),
        );
    });

    afterEach(async () => {
        await Promise.allSettled(apps.splice(0).map((app) => app.close()));
        for (const [signal, before] of signals) {
            for (const listener of process.listeners(signal as NodeJS.Signals)) {
                if (!before.has(listener as (...args: unknown[]) => void)) {
                    process.off(signal, listener);
                }
            }
        }
        vi.unstubAllEnvs();
    });

    return {
        records: () =>
            chunks
                .join('')
                .split('\n')
                .filter((line) => line.trim().startsWith('{'))
                .map((line) => JSON.parse(line) as Record<string, unknown>),
        text: () => chunks.join(''),
        track: (app) => {
            apps.push(app);

            return app;
        },
    };
}

/** Ожидает отказ запуска: промис отклонён маркером exit(1). */
export async function expectExit(run: Promise<unknown>): Promise<ExitCalled> {
    const error: unknown = await run.then(
        () => new Error('запуск не отклонён'),
        (caught: unknown) => caught,
    );
    if (!(error instanceof ExitCalled)) {
        throw error;
    }

    return error;
}
