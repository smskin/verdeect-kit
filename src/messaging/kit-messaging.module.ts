// KitMessagingModule.forRoot (prd.md §3.4, AC-1.2, AC-5.15, AC-5.20; П1, П5, П11). Эталон — O messaging.module.ts
// (проба rabbitmq некритичная, соединение — шаг 4). pg — requirePeer только при outbox или dedupe: 'inbox', значения
// database — динамическим import() здесь же (/messaging грузится без pg). Остановка — хуки Nest: соединение —
// onApplicationShutdown (шаг 4), relay, подписчик, очистка — beforeApplicationShutdown (шаг 3); KitLifecycle не нужен.
import {
    Inject,
    Injectable,
    Module,
    Optional,
    type DynamicModule,
    type Provider,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Logger as PinoLogger } from 'pino';
import type * as Database from '../database/index.js';
import { requirePeer } from '../internal/peer.js';
import { assertServiceName } from '../internal/service-name.js';
import { requireKitCore } from '../internal/kit-core-required.js';
import { KIT_LOGGER, KIT_PACKAGE_METRICS } from '../internal/tokens.js';
import { HealthRegistry } from '../observability/health-registry.js';
import type { KitMetrics } from '../observability/metrics.js';
import type { KitEvent } from './define-event.js';
import { MessagingCleanup } from './cleanup.js';
import { MessagingStartupError } from './errors.js';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxStore } from './outbox-store.js';
import { KitSubscriber } from './subscriber.js';
import { RabbitConnection, nestLog, type MessagingLog } from './rabbit-connection.js';
import { outboxTenantNullable, type KitInboxTable, type KitOutboxTable } from './tables.js';
import { handlersDeadlineMs } from './topology.js';
import {
    KIT_MESSAGING_ENV,
    KIT_MESSAGING_LOG,
    KIT_MESSAGING_OPTIONS,
    KIT_RABBIT_CONNECTION,
    type KitMessagingConfig,
    type KitMessagingRuntimeEnv,
} from './config.js';

/** Опции `KitMessagingModule.forRoot`. */
export interface KitMessagingModuleOptions {
    /** Имя экземпляра (`^[a-z][a-z0-9-]{1,31}$`): очереди `<svc>`, `<svc>.retry`, `<svc>.dlq`. */
    readonly service: string;
    /**
     * Прослушивание брокера (умолч. `true`). `false` — режим CLI сервиса (§3.4 v1.25): без соединения с брокером,
     * подписчика, relay и очистки; `OutboxStore.add` пишет строки (публикует relay реплики API), `subscriber.on`
     * принимается и не выполняется — общий модуль сервиса подходит API и CLI.
     */
    readonly listen?: boolean;
    /**
     * Outbox: таблица `createOutboxTable(schema, {tenantNullable})` и все события, которые сервис публикует
     * (`OutboxStore.add` события вне списка — `TypeError`). `tenantNullable` читается из таблицы.
     */
    readonly outbox?: { readonly table: KitOutboxTable; readonly events: readonly KitEvent[] };
    /**
     * Подписчик; не задан — подписчика нет. `dedupe` по умолчанию `'inbox'` и требует `inbox: createInboxTable(schema)`;
     * `'none'` — без БД и inbox (роль BFF).
     */
    readonly subscriber?: {
        /** Защита от повторов подписчика. */
        readonly dedupe?: 'inbox' | 'none';
        /** Таблица inbox. */
        readonly inbox?: KitInboxTable;
    };
}

function messagingEnv(config: ConfigService | undefined): KitMessagingRuntimeEnv {
    if (config === undefined) {
        throw new Error(
            'KitMessagingModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envBase и envMessaging',
        );
    }

    return {
        RABBITMQ_URL: config.getOrThrow<string>('RABBITMQ_URL'),
        RABBITMQ_RETRY_SECONDS: config.getOrThrow<number>('RABBITMQ_RETRY_SECONDS'),
        REPLICA_ID: config.getOrThrow<string>('REPLICA_ID'),
        SHUTDOWN_TIMEOUT_MS: config.getOrThrow<number>('SHUTDOWN_TIMEOUT_MS'),
        SHUTDOWN_DRAIN_MS: config.getOrThrow<number>('SHUTDOWN_DRAIN_MS'),
    };
}

function schemaOf(
    tables: readonly (KitOutboxTable | KitInboxTable | undefined)[],
): string | undefined {
    const schemas = new Set<string | undefined>();
    for (const table of tables) {
        if (table !== undefined) {
            schemas.add(getTableConfig(table).schema);
        }
    }
    if (schemas.size === 0) {
        return undefined;
    }
    const [schema] = [...schemas];
    if (schemas.size > 1 || schema === undefined) {
        throw new TypeError(
            'KitMessagingModule: таблицы outbox и inbox — одной схемы сервиса (createOutboxTable(pgSchema(…)))',
        );
    }
    assertServiceName(schema, 'KitMessagingModule');

    return schema;
}

function eventsOf(
    options: KitMessagingModuleOptions,
    schema: string | undefined,
): Map<string, KitEvent> {
    const events = new Map<string, KitEvent>();
    const outbox = options.outbox;
    if (outbox === undefined) {
        return events;
    }
    const nullable = outboxTenantNullable(outbox.table);
    for (const event of outbox.events) {
        if (events.has(event.type)) {
            throw new TypeError(`KitMessagingModule: событие ${event.type} указано дважды`);
        }
        if (event.tenant === 'none' && !nullable) {
            throw new MessagingStartupError(
                'MESSAGING_TENANT_NOT_NULLABLE',
                `KitMessagingModule: событие ${event.type} без компании (tenant: 'none') требует createOutboxTable(схема, {tenantNullable: true})`,
                { event: event.type, table: `${schema ?? ''}.outbox` },
            );
        }
        events.set(event.type, event);
    }

    return events;
}

/** Старт соединения, проба `/health` и шаг 4 остановки (внутренний). */
@Injectable()
class MessagingLifecycle implements OnModuleInit, OnApplicationShutdown {
    private readonly health: HealthRegistry;

    constructor(
        @Inject(KIT_RABBIT_CONNECTION) private readonly connection: RabbitConnection,
        @Inject(KIT_MESSAGING_OPTIONS) private readonly config: KitMessagingConfig,
        @Inject(KIT_MESSAGING_LOG) private readonly log: MessagingLog,
        @Optional() health?: HealthRegistry,
    ) {
        this.health = requireKitCore(health, 'KitMessagingModule');
    }

    /** Соединение в фоне; проба `rabbitmq` некритичная (П11). */
    async onModuleInit(): Promise<void> {
        await this.connection.start();
        this.health.register(
            'rabbitmq',
            () => Promise.resolve(this.connection.isConnected() && this.connection.topologyReady()),
            { critical: false },
        );
        this.log.debug(
            {
                service: this.config.service,
                outbox: this.config.outbox !== undefined,
                subscriber: this.config.subscriber ? this.config.dedupe : 'off',
            },
            'messaging: модуль собран',
        );
    }

    /** Шаг 4 остановки: соединение после relay и подписчика. */
    async onApplicationShutdown(): Promise<void> {
        await this.connection.onApplicationShutdown();
    }
}

/** Relay и `OutboxStore` при `outbox`: один объект — фабрика relay строит store, store будит relay. */
function outboxProviders(config: KitMessagingConfig): Provider[] {
    const { outbox, database } = config;
    if (outbox === undefined || database === undefined) {
        return [];
    }

    return [
        {
            provide: OutboxRelay,
            useFactory: (
                db: Database.Db,
                connection: RabbitConnection,
                log: MessagingLog,
                metrics?: KitMetrics,
            ): OutboxRelay => {
                const store = new OutboxStore({
                    db,
                    table: outbox,
                    events: config.events,
                    wake: () => {
                        relay.wake();
                    },
                    log,
                });
                const relay = new OutboxRelay({
                    db,
                    store,
                    connection,
                    events: config.events,
                    metrics: requireKitCore(metrics, 'KitMessagingModule'),
                    log,
                });
                relayStores.set(relay, store);

                return relay;
            },
            inject: [
                database.Db,
                KIT_RABBIT_CONNECTION,
                KIT_MESSAGING_LOG,
                { token: KIT_PACKAGE_METRICS, optional: true },
            ],
        },
        {
            provide: OutboxStore,
            useFactory: (relay: OutboxRelay): OutboxStore => {
                const store = relayStores.get(relay);
                if (store === undefined) {
                    throw new Error('KitMessagingModule: OutboxStore без relay');
                }

                return store;
            },
            inject: [OutboxRelay],
        },
    ];
}

/** Подписчик при `subscriber`; `Db` — только при `dedupe: 'inbox'`. */
function subscriberProviders(config: KitMessagingConfig): Provider[] {
    if (!config.subscriber) {
        return [];
    }
    const withDb = config.dedupe === 'inbox' && config.database !== undefined;

    return [
        {
            provide: KitSubscriber,
            useFactory: (
                env: KitMessagingRuntimeEnv,
                connection: RabbitConnection,
                log: MessagingLog,
                metrics?: KitMetrics,
                db?: Database.Db,
            ): KitSubscriber =>
                new KitSubscriber({
                    service: config.service,
                    replica: env.REPLICA_ID,
                    dedupe: config.dedupe,
                    ...(config.inbox === undefined ? {} : { inbox: config.inbox }),
                    ...(db === undefined ? {} : { db }),
                    connection,
                    retrySeconds: env.RABBITMQ_RETRY_SECONDS,
                    metrics: requireKitCore(metrics, 'KitMessagingModule'),
                    log,
                }),
            inject: [
                KIT_MESSAGING_ENV,
                KIT_RABBIT_CONNECTION,
                KIT_MESSAGING_LOG,
                { token: KIT_PACKAGE_METRICS, optional: true },
                ...(withDb && config.database !== undefined ? [config.database.Db] : []),
            ],
        },
    ];
}

/** Очистка при outbox или inbox (BFF без БД — без очистки). */
function cleanupProviders(config: KitMessagingConfig): Provider[] {
    const { database, schema } = config;
    if (database === undefined || schema === undefined) {
        return [];
    }
    if (config.outbox === undefined && config.inbox === undefined) {
        return [];
    }

    return [
        {
            provide: MessagingCleanup,
            useFactory: (db: Database.Db, log: MessagingLog, metrics?: KitMetrics) =>
                new MessagingCleanup({
                    db,
                    database: {
                        runExclusive: database.runExclusive,
                        deleteInBatches: database.deleteInBatches,
                    },
                    schema,
                    tables: {
                        ...(config.outbox === undefined ? {} : { outbox: config.outbox }),
                        ...(config.inbox === undefined ? {} : { inbox: config.inbox }),
                    },
                    metrics: requireKitCore(metrics, 'KitMessagingModule'),
                    log,
                }),
            inject: [
                database.Db,
                KIT_MESSAGING_LOG,
                { token: KIT_PACKAGE_METRICS, optional: true },
            ],
        },
    ];
}

/**
 * Провайдеры режима CLI (`listen: false`): `OutboxStore` без relay (`wake` — пусто) и подписчик без соединения — `on`
 * принимается, `onApplicationBootstrap` ничего не запускает. Окружение брокера не читается.
 */
function cliProviders(config: KitMessagingConfig): Provider[] {
    const { outbox, database } = config;
    const providers: Provider[] = [];
    if (outbox !== undefined && database !== undefined) {
        providers.push({
            provide: OutboxStore,
            useFactory: (db: Database.Db, log: MessagingLog): OutboxStore =>
                new OutboxStore({
                    db,
                    table: outbox,
                    events: config.events,
                    wake: () => undefined,
                    log,
                }),
            inject: [database.Db, KIT_MESSAGING_LOG],
        });
    }
    if (config.subscriber) {
        providers.push({
            provide: KitSubscriber,
            useFactory: (log: MessagingLog, metrics?: KitMetrics): KitSubscriber =>
                new KitSubscriber({
                    service: config.service,
                    replica: '',
                    dedupe: config.dedupe,
                    ...(config.inbox === undefined ? {} : { inbox: config.inbox }),
                    connection: null,
                    retrySeconds: 0,
                    metrics: requireKitCore(metrics, 'KitMessagingModule'),
                    log,
                }),
            inject: [KIT_MESSAGING_LOG, { token: KIT_PACKAGE_METRICS, optional: true }],
        });
    }

    return providers;
}

/** Store, построенный фабрикой relay. */
const relayStores = new WeakMap<OutboxRelay, OutboxStore>();

/**
 * Сообщения сервиса (§3.4): соединение RabbitMQ, проба `rabbitmq`, outbox и relay, подписчик с inbox, очистка.
 * Окружение — `envBase` и `envMessaging` из `KitConfigModule`; outbox и inbox требуют `KitDatabaseModule` и `pg`.
 */
@Module({})
export class KitMessagingModule {
    /**
     * Модуль сообщений; отказ — до прослушивания порта (`bootstrapService` → `failStartup`).
     * @throws {TypeError} имя сервиса вне формата, несогласованные опции или таблицы, дубликат события.
     * @throws {MessagingStartupError} событие `tenant: 'none'` при NOT NULL `tenant` (AC-5.15).
     * @throws {Error} outbox или `dedupe: 'inbox'` без `pg` (AC-1.2).
     */
    static async forRoot(options: KitMessagingModuleOptions): Promise<DynamicModule> {
        assertServiceName(options.service, 'KitMessagingModule');
        const dedupe = options.subscriber?.dedupe ?? 'inbox';
        const subscriber = options.subscriber !== undefined;
        const needsDb = options.outbox !== undefined || (subscriber && dedupe === 'inbox');
        if (subscriber && dedupe === 'inbox' && options.subscriber?.inbox === undefined) {
            throw new TypeError(
                "KitMessagingModule: subscriber с dedupe: 'inbox' требует inbox: createInboxTable(schema)",
            );
        }
        if (dedupe === 'none' && options.subscriber?.inbox !== undefined) {
            throw new TypeError("KitMessagingModule: inbox не используется при dedupe: 'none'");
        }
        const listen = options.listen ?? true;
        if (typeof listen !== 'boolean') {
            throw new TypeError('KitMessagingModule: listen — true или false');
        }
        const schema = schemaOf([options.outbox?.table, options.subscriber?.inbox]);
        const events = eventsOf(options, schema);
        let database: typeof Database | undefined;
        if (needsDb) {
            requirePeer('pg', 'messaging');
            database = await import('../database/index.js');
        }
        const config: KitMessagingConfig = {
            service: options.service,
            schema,
            dedupe,
            subscriber,
            events,
            outbox: options.outbox?.table,
            inbox: options.subscriber?.inbox,
            database,
        };
        const log: Provider = {
            provide: KIT_MESSAGING_LOG,
            useFactory: (logger?: PinoLogger): MessagingLog => logger ?? nestLog('KitMessaging'),
            inject: [{ token: KIT_LOGGER, optional: true }],
        };
        if (!listen) {
            const cli = cliProviders(config);

            return {
                module: KitMessagingModule,
                global: true,
                providers: [{ provide: KIT_MESSAGING_OPTIONS, useValue: config }, log, ...cli],
                exports: [
                    ...(config.outbox === undefined ? [] : [OutboxStore]),
                    ...(config.subscriber ? [KitSubscriber] : []),
                ],
            };
        }

        const outbox = outboxProviders(config);
        const subscriberList = subscriberProviders(config);

        return {
            module: KitMessagingModule,
            global: true,
            providers: [
                { provide: KIT_MESSAGING_OPTIONS, useValue: config },
                {
                    provide: KIT_MESSAGING_ENV,
                    useFactory: messagingEnv,
                    inject: [{ token: ConfigService, optional: true }],
                },
                log,
                {
                    provide: KIT_RABBIT_CONNECTION,
                    useFactory: (env: KitMessagingRuntimeEnv, log: MessagingLog) =>
                        new RabbitConnection({
                            url: env.RABBITMQ_URL,
                            retrySeconds: env.RABBITMQ_RETRY_SECONDS,
                            deadlineMs: handlersDeadlineMs(env),
                            log,
                        }),
                    inject: [KIT_MESSAGING_ENV, KIT_MESSAGING_LOG],
                },
                MessagingLifecycle,
                ...outbox,
                ...subscriberList,
                ...cleanupProviders(config),
            ],
            exports: [
                ...(outbox.length > 0 ? [OutboxStore] : []),
                ...(subscriberList.length > 0 ? [KitSubscriber] : []),
            ],
        };
    }
}
