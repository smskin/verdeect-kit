// DI-токены ядра HTTP (prd.md §3.5; KT-11): метрики и логгер pino экземпляра приложения. Классы KitLifecycle и
// HealthRegistry — сами себе токены. Внутренний модуль: из подпутей не реэкспортируется.

/** Токен `KitMetrics` экземпляра приложения. */
export const KIT_METRICS = Symbol('KIT_METRICS');

/** Токен логгера pino экземпляра приложения. */
export const KIT_LOGGER = Symbol('KIT_LOGGER');
