// RateLimiter, throwRateLimited (prd.md §3.7, UC-11, AC-8.3, AC-8.4, AC-9.5). Эталон — I shared/security/rate-limiter.ts
// (consume → hit, peek, scope); из B — PTTL и fail-open без GlitchTip. Окно в мс, PEXPIRE NX в одном MULTI.
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { KIT_PACKAGE_METRICS, KIT_REDIS_LOG } from '../internal/tokens.js';
import { requireKitCore } from '../internal/kit-core-required.js';
import type { KitMetrics } from '../observability/metrics.js';
import { sanitizeError } from '../observability/sanitize-error.js';
import { DomainError } from '../http/errors.js';
import { KIT_REDIS, type RedisLog } from './client.js';

/** Не чаще раза в это время на процесс — `warn` о недоступном Redis, мс. */
const UNAVAILABLE_WARN_INTERVAL_MS = 60_000;

/** Опции проверки лимита. */
export interface RateLimitOptions {
    /** Допустимое число попаданий в окне, целое ≥ 1. */
    readonly limit: number;
    /** Окно, мс, целое ≥ 1; отсчитывается от первого попадания. */
    readonly windowMs: number;
}

/** Итог проверки лимита. */
export interface RateLimitResult {
    /** Запрос разрешён. */
    readonly allowed: boolean;
    /** Сколько попаданий осталось в окне. */
    readonly remaining: number;
    /** Через сколько мс окно закончится; `0`, если разрешено. */
    readonly retryAfterMs: number;
}

type ExecResult = [error: Error | null, result: unknown][] | null;

function assertOptions(key: string, options: RateLimitOptions): void {
    if (key.length === 0) {
        throw new TypeError('RateLimiter: key — непустая строка');
    }
    if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new TypeError('RateLimiter: limit — целое ≥ 1');
    }
    if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
        throw new TypeError('RateLimiter: windowMs — целое ≥ 1');
    }
}

/** Значения команд MULTI; ошибка любой команды или `null` (EXEC прерван) — исключение (fail-open выше). */
function valuesOf(result: ExecResult): unknown[] {
    if (result === null) {
        throw new Error('RateLimiter: EXEC прерван');
    }

    return result.map(([error, value]) => {
        if (error !== null) {
            throw error;
        }

        return value;
    });
}

/**
 * Ограничитель частоты (§3.7): фиксированное окно от первого попадания, ключ в Redis — `<svc>:rl:<key>`. `hit` считает
 * попадание, `peek` только читает. Redis недоступен — fail-open: `{allowed: true, remaining: limit}`, метрика
 * `verdeect_rate_limit_unavailable_total` +1 на каждую проверку, `warn` не чаще раза в 60 с (алерт
 * `VerdeectRateLimitUnavailable`).
 *
 * @example
 * const result = await limiter.hit(`login:${ip}`, { limit: 30, windowMs: 60_000 });
 * if (!result.allowed) {
 *     throwRateLimited(result);
 * }
 */
@Injectable()
export class RateLimiter {
    #lastUnavailableWarnAt: number | undefined;
    private readonly metrics: KitMetrics;

    constructor(
        @Inject(KIT_REDIS) private readonly redis: Redis,
        @Inject(KIT_REDIS_LOG) private readonly log: RedisLog,
        @Optional() @Inject(KIT_PACKAGE_METRICS) metrics?: KitMetrics,
    ) {
        this.metrics = requireKitCore(metrics, 'RateLimiter');
    }

    /** Считает попадание: `INCR`, `PEXPIRE … NX`, `PTTL` одним `MULTI`; `allowed = count ≤ limit`. */
    async hit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
        assertOptions(key, options);
        const redisKey = `rl:${key}`;
        try {
            const [count, , pttl] = valuesOf(
                await this.redis
                    .multi()
                    .incr(redisKey)
                    .pexpire(redisKey, options.windowMs, 'NX')
                    .pttl(redisKey)
                    .exec(),
            );

            return this.resultOf(key, Number(count), Number(pttl), options.limit, false);
        } catch (error) {
            return this.failOpen(error, options.limit);
        }
    }

    /** Читает счётчик без изменения: `GET`, `PTTL` одним `MULTI`; `allowed = count < limit`. */
    async peek(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
        assertOptions(key, options);
        const redisKey = `rl:${key}`;
        try {
            const [count, pttl] = valuesOf(
                await this.redis.multi().get(redisKey).pttl(redisKey).exec(),
            );

            return this.resultOf(key, Number(count ?? 0), Number(pttl), options.limit, true);
        } catch (error) {
            return this.failOpen(error, options.limit);
        }
    }

    private resultOf(
        key: string,
        count: number,
        pttl: number,
        limit: number,
        peek: boolean,
    ): RateLimitResult {
        const allowed = peek ? count < limit : count <= limit;
        if (!allowed) {
            // scope — часть ключа до первого «:»; сам ключ (IP, логин) в лог не пишется.
            this.log.debug({ scope: key.split(':', 1)[0] }, 'лимитер: лимит исчерпан');
        }

        return {
            allowed,
            remaining: Math.max(0, limit - count),
            retryAfterMs: allowed ? 0 : Math.max(0, pttl),
        };
    }

    private failOpen(error: unknown, limit: number): RateLimitResult {
        this.metrics.rateLimitUnavailable.inc();
        const now = Date.now();
        // ponytail: один таймер warn на процесс, по ключам — если понадобится разбор по scope.
        if (
            this.#lastUnavailableWarnAt === undefined ||
            now - this.#lastUnavailableWarnAt >= UNAVAILABLE_WARN_INTERVAL_MS
        ) {
            this.#lastUnavailableWarnAt = now;
            this.log.warn(
                { err: sanitizeError(error) },
                'лимитер: Redis недоступен, запрос пропущен',
            );
        }

        return { allowed: true, remaining: limit, retryAfterMs: 0 };
    }
}

/**
 * Бросает `DomainError('RATE_LIMITED', {retryAfterSec})` — 429 и `Retry-After` в секундах вверх (не меньше 1) через
 * `KitExceptionFilter` (§3.5, §3.7). `result.allowed === true` — `TypeError` (ошибка разработчика).
 */
export function throwRateLimited(result: RateLimitResult): never {
    if (result.allowed) {
        throw new TypeError('throwRateLimited: результат allowed — запрос разрешён');
    }
    const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));

    throw new DomainError('RATE_LIMITED', { retryAfterSec });
}
