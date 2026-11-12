// DI-токены ядра HTTP (prd.md §3.5; KT-11): метрики пакета, реестр метрик (публичный KIT_METRICS, §3.2) и логгер pino экземпляра приложения; внутренние токены /redis
// (§3.7, E8). Классы KitLifecycle и HealthRegistry — сами себе токены. Внутренний модуль: из подпутей не реэкспортируется, кроме
// KIT_METRICS — его реэкспортирует /observability.

/** @internal Токен `KitMetrics` экземпляра приложения (метрики пакета). Наружу не реэкспортируется. */
export const KIT_PACKAGE_METRICS = Symbol('KIT_PACKAGE_METRICS');

/**
 * Реестр метрик экземпляра приложения (`Registry` `@prometheus-io/client`) — тот же, что отдаёт `/metrics` на
 * `METRICS_PORT` (§3.2, AC-2.14). Метрики домена регистрируются только в нём (`registers: [registry]`); метку `service`
 * ставит реестр.
 */
export const KIT_METRICS = Symbol('KIT_METRICS');

/** Токен логгера pino экземпляра приложения. */
export const KIT_LOGGER = Symbol('KIT_LOGGER');

/** @internal Префикс ключей и каналов Redis сервиса (`<svc>:`; в тестах — префикс воркера). Наружу не реэкспортируется. */
export const KIT_REDIS_PREFIX = Symbol('KIT_REDIS_PREFIX');

/** @internal Подписочное соединение Redis (`KitRedisModule.forRoot({subscriber: true})`). Наружу не реэкспортируется. */
export const KIT_REDIS_SUBSCRIBER = Symbol('KIT_REDIS_SUBSCRIBER');

/** @internal Логгер фоновых операций /redis (pino экземпляра или адаптер Nest). Наружу не реэкспортируется. */
export const KIT_REDIS_LOG = Symbol('KIT_REDIS_LOG');
