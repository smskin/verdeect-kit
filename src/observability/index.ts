// Публичная поверхность @verdeect/kit/observability (prd.md §3.2). Всё, что не перечислено, — не экспортируется.
export { failStartup } from './fail-startup.js';
export type { StartupFailure } from './fail-startup.js';
export { HealthRegistry } from './health-registry.js';
export type { HealthProbe, HealthReport } from './health-registry.js';
export { KitLifecycle } from './lifecycle.js';
export type { KitShutdownParticipant, KitShutdownStep } from './lifecycle.js';
export { createLoggerOptions } from './logger-options.js';
export type { KitLoggerOptions, KitLoggerParams } from './logger-options.js';
export { KIT_METRICS } from '../internal/tokens.js';
export { MetricsServer } from './metrics-server.js';
export { alertRulesTemplate, kitMetrics } from './metrics.js';
export type { KitMetrics } from './metrics.js';
export { SENSITIVE_KEYS } from './redaction.js';
export type { KitRedaction } from './redaction.js';
export { registerErrorSanitizer, sanitizeError } from './sanitize-error.js';
export { captureError, captureThrottled, initSentry } from './sentry.js';
export type { KitSentryOptions } from './sentry.js';
