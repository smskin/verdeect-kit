// defineEnv и withBaseChecks (prd.md §3.1, AC-1.4, AC-1.6). Проверки между ключами пакета — эталон O superRefine.
import { z } from 'zod';
import type {
    envBase,
    envCrypto,
    envDatabase,
    envMessaging,
    envRedis,
    envSentry,
    envServiceUrls,
} from './fragments.js';

type KitShape = typeof envBase &
    typeof envDatabase &
    typeof envMessaging &
    typeof envRedis &
    typeof envSentry &
    typeof envCrypto &
    ReturnType<typeof envServiceUrls>;

type KitKeyOutput = { [K in keyof KitShape]: z.output<KitShape[K]> };

/** Ключ пакета в shape сервиса обязан давать тот же выходной тип (AC-1.6). */
export type CompatibleShape<S extends z.ZodRawShape> = {
    [K in keyof S]: K extends keyof KitKeyOutput ? z.ZodType<KitKeyOutput[K]> : S[K];
};

/** Число из разобранного окружения или undefined: проверки идут, только если ключи есть в схеме. */
function numberAt(env: Readonly<Record<string, unknown>>, key: string): number | undefined {
    const value = env[key];

    return typeof value === 'number' ? value : undefined;
}

/**
 * Проверки между ключами пакета (§3.1, AC-1.4): PORT ≠ METRICS_PORT (кроме 0 — порт выбирает ОС),
 * SHUTDOWN_DRAIN_MS < SHUTDOWN_TIMEOUT_MS. Ключей нет в схеме — проверки нет. Форма схемы сохраняется.
 */
export function withBaseChecks<T extends z.ZodObject>(schema: T): T {
    return schema.superRefine((env: Readonly<Record<string, unknown>>, ctx) => {
        const appPort = numberAt(env, 'PORT');
        const metricsPort = numberAt(env, 'METRICS_PORT');
        if (appPort !== undefined && appPort === metricsPort && appPort !== 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['METRICS_PORT'],
                message: 'PORT и METRICS_PORT совпадают',
                input: '',
            });
        }
        const drain = numberAt(env, 'SHUTDOWN_DRAIN_MS');
        const timeout = numberAt(env, 'SHUTDOWN_TIMEOUT_MS');
        if (drain !== undefined && timeout !== undefined && drain >= timeout) {
            ctx.addIssue({
                code: 'custom',
                path: ['SHUTDOWN_DRAIN_MS'],
                message: 'пауза не меньше общего срока остановки',
                input: '',
            });
        }
    });
}

/**
 * Схема окружения сервиса (§3.1): распаковка фрагментов пакета + свои ключи, проверки withBaseChecks
 * и необязательная своя проверка `refine`. Лишние переменные процесса отбрасываются.
 */
export function defineEnv<S extends z.ZodRawShape>(
    shape: S & CompatibleShape<S>,
    refine?: (env: z.output<z.ZodObject<S>>, ctx: z.RefinementCtx) => void,
): z.ZodObject<S> {
    const schema = withBaseChecks(z.object(shape as S));

    return refine === undefined ? schema : schema.superRefine(refine);
}
