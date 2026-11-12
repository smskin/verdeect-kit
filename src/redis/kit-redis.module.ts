// KitRedisModule (prd.md §3.7, UC-11, AC-8.1, AC-8.2, AC-8.6). Эталон — O shared/redis/redis.provider.ts + redis.module.ts
// (опции, проба, закрытие); префикс — keyPrefix и KitRedisChannels вместо ручных префиксов O. Закрытие —
// onApplicationShutdown (шаг 4), KitLifecycle не нужен.
import {
    Inject,
    Injectable,
    Module,
    Optional,
    type DynamicModule,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import { assertServiceName } from '../internal/service-name.js';
import {
    KIT_LOGGER,
    KIT_REDIS_LOG,
    KIT_REDIS_PREFIX,
    KIT_REDIS_SUBSCRIBER,
} from '../internal/tokens.js';
import { HealthRegistry } from '../observability/health-registry.js';
import { KitRedisChannels } from './channels.js';
import {
    KIT_REDIS,
    closeRedisConnection,
    createRedisConnection,
    redisNestLog,
    type RedisLog,
} from './client.js';
import { RateLimiter } from './rate-limiter.js';

/** Опции `KitRedisModule.forRoot`. */
export interface KitRedisModuleOptions {
    /** Имя сервиса (`^[a-z][a-z0-9-]{1,31}$`): префикс `<svc>:` ключей и каналов, имя клиента Redis. */
    readonly service: string;
    /** Второе соединение для подписок (`KitRedisChannels.subscribe`); без него подписки недоступны. */
    readonly subscriber?: true;
    /**
     * Проба `/health` `redis` критичная: Redis недоступен → 503, как БД (BFF — сессии). По умолчанию `false`:
     * недоступен → `degraded`, 200 (§3.7, AC-8.2).
     */
    readonly critical?: boolean;
}

/** Критичность пробы `redis` (внутренний токен модуля). */
const REDIS_PROBE_CRITICAL = Symbol('KIT_REDIS_PROBE_CRITICAL');

function redisUrl(config: ConfigService | undefined): string {
    if (config === undefined) {
        throw new Error(
            'KitRedisModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envRedis',
        );
    }

    return config.getOrThrow<string>('REDIS_URL');
}

/** Проба `/health` и закрытие соединений на шаге 4 (внутренний). */
@Injectable()
class RedisLifecycle implements OnModuleInit, OnApplicationShutdown {
    constructor(
        @Inject(KIT_REDIS) private readonly redis: Redis,
        @Inject(KIT_REDIS_LOG) private readonly log: RedisLog,
        @Inject(REDIS_PROBE_CRITICAL) private readonly critical: boolean,
        @Optional() @Inject(KIT_REDIS_SUBSCRIBER) private readonly subscriber?: Redis,
        @Optional() private readonly health?: HealthRegistry,
    ) {}

    /** Проба `redis`: некритичная по умолчанию (недоступен → `degraded`), с `critical: true` — 503 (§3.7). */
    onModuleInit(): void {
        this.health?.register('redis', async () => (await this.redis.ping()) === 'PONG', {
            critical: this.critical,
        });
    }

    /** Шаг 4 остановки: закрытие соединений. */
    async onApplicationShutdown(): Promise<void> {
        this.log.debug({}, 'KitRedisModule: закрытие соединений');
        await Promise.all([
            closeRedisConnection(this.redis, 'main', this.log),
            ...(this.subscriber === undefined
                ? []
                : [closeRedisConnection(this.subscriber, 'subscriber', this.log)]),
        ]);
    }
}

/**
 * Redis сервиса (§3.7): основное соединение `KIT_REDIS` с `keyPrefix <svc>:` (срок команды 500 мс), `KitRedisChannels`,
 * `RateLimiter`, проба `/health` `redis` (некритичная; `critical: true` — критичная), закрытие на шаге 4. `subscriber: true` — второе соединение для
 * подписок (срок 5 с); без него второго соединения нет. `keyPrefix` не действует на шаблоны `KEYS`/`SCAN` — префикс в
 * шаблон ставит сервис. `REDIS_URL` — из `KitConfigModule` (`envRedis`).
 */
@Module({})
export class KitRedisModule {
    /** Модуль Redis сервиса; глобальный. */
    static forRoot(options: KitRedisModuleOptions): DynamicModule {
        const { service } = options;
        assertServiceName(service, 'KitRedisModule');
        const subscriber =
            options.subscriber === true
                ? [
                      {
                          provide: KIT_REDIS_SUBSCRIBER,
                          useFactory: (config: ConfigService | undefined, log: RedisLog) =>
                              createRedisConnection({
                                  url: redisUrl(config),
                                  connection: 'subscriber',
                                  service,
                                  log,
                              }),
                          inject: [{ token: ConfigService, optional: true }, KIT_REDIS_LOG],
                      },
                  ]
                : [];

        return {
            module: KitRedisModule,
            global: true,
            providers: [
                {
                    provide: KIT_REDIS_LOG,
                    useFactory: (logger?: PinoLogger): RedisLog =>
                        logger ?? redisNestLog('KitRedis'),
                    inject: [{ token: KIT_LOGGER, optional: true }],
                },
                { provide: KIT_REDIS_PREFIX, useValue: `${service}:` },
                { provide: REDIS_PROBE_CRITICAL, useValue: options.critical === true },
                {
                    provide: KIT_REDIS,
                    useFactory: (
                        config: ConfigService | undefined,
                        prefix: string,
                        log: RedisLog,
                    ) =>
                        createRedisConnection({
                            url: redisUrl(config),
                            connection: 'main',
                            service,
                            keyPrefix: prefix,
                            log,
                        }),
                    inject: [
                        { token: ConfigService, optional: true },
                        KIT_REDIS_PREFIX,
                        KIT_REDIS_LOG,
                    ],
                },
                ...subscriber,
                KitRedisChannels,
                RateLimiter,
                RedisLifecycle,
            ],
            exports: [KIT_REDIS, KitRedisChannels, RateLimiter],
        };
    }
}
