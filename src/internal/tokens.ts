// DI-токены ядра HTTP (prd.md §3.5; KT-11): метрики и логгер pino экземпляра приложения; внутренние токены /redis
// (§3.7, E8). Классы KitLifecycle и HealthRegistry — сами себе токены. Внутренний модуль: из подпутей не реэкспортируется.

/** Токен `KitMetrics` экземпляра приложения. */
export const KIT_METRICS = Symbol('KIT_METRICS');

/** Токен логгера pino экземпляра приложения. */
export const KIT_LOGGER = Symbol('KIT_LOGGER');

/** @internal Префикс ключей и каналов Redis сервиса (`<svc>:`; в тестах — префикс воркера). Наружу не реэкспортируется. */
export const KIT_REDIS_PREFIX = Symbol('KIT_REDIS_PREFIX');

/** @internal Подписочное соединение Redis (`KitRedisModule.forRoot({subscriber: true})`). Наружу не реэкспортируется. */
export const KIT_REDIS_SUBSCRIBER = Symbol('KIT_REDIS_SUBSCRIBER');

/** @internal Логгер фоновых операций /redis (pino экземпляра или адаптер Nest). Наружу не реэкспортируется. */
export const KIT_REDIS_LOG = Symbol('KIT_REDIS_LOG');
