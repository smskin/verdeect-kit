# Changelog

Все заметные изменения `@verdeect/kit`. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/). У мажорной версии есть раздел «Как перейти» (NFR-5).

## [Unreleased]

Первый выпуск: подпути `/config` и `/testing` (этап E1, PRD v1.7), `/observability` (этап E2, PRD v1.11).

### Added

- `/config`: фрагменты окружения `envBase`, `envDatabase`, `envMessaging`, `envRedis`, `envSentry`, `envCrypto`, `envServiceUrls`.
- `/config`: `defineEnv` — схема окружения сервиса; несовместимое переопределение ключа пакета — ошибка компиляции.
- `/config`: `withBaseChecks` — `PORT` ≠ `METRICS_PORT` (кроме 0), `SHUTDOWN_DRAIN_MS` < `SHUTDOWN_TIMEOUT_MS`.
- `/config`: `parseEnv` и `InvalidEnvironmentError` — полные пути ключей через точку, без значений.
- `/config`: `KitConfigModule.forRoot({schema})` — обёртка над `ConfigModule` из `@nestjs/config`.
- `/config`: схемы CLI `migrateEnvSchema`, `prepareEnvSchema`.
- `/config`: помощники `port`, `positiveInt`, `optionalText`, `booleanFlag`, `jsonValue`, `httpUrl`, `uniqueBy`.
- `/config`: типы `KitBaseEnv`, `KitDatabaseEnv`, `KitMessagingEnv`, `KitRedisEnv`, `KitCryptoEnv`.
- `/testing`: `TEST_IMAGES` — PostgreSQL 17.11, Redis 7.4.11, RabbitMQ 4.3.6, mailpit 1.31.6, MinIO RELEASE.2026-08-04.
- `/testing`: `startTestStack` — контейнеры `postgres`, `mailpit`, `minio` раз на прогон, адреса через `provide`.
- `/testing`: `assertRepoConventions` — правила `test-images`, `replica-id`, `stop-grace-period`, `env-keys`, `peer-versions`, `instrument-import`, `command-unrecognized`, `redaction-imports`.
- `/testing`: `assertRepoConventions` — правило команды «на запрет» (PRD v1.11): у приложения обязателен распознанный запуск; `main.*` в аргументах любой команды, вызов оболочки с `-c` без выделенного скрипта, опция `tini`/`dumb-init` вне списка, переменная без умолчания на месте программы, опций `node` или файла входа — `command-unrecognized`; длинные опции и `-O`/`+O` оболочки поддержаны.
- `/testing`: `tcpProxy` и тип `TcpProxy` — обрывы и задержки TCP.
- `/testing`: `timingGuard` — `globalSetup` замеров времени.
- `/testing`: `TEST_TIMEOUT_SCALE` — множитель тайм-аутов тестов.
- `/observability`: `SENSITIVE_KEYS` и тип `KitRedaction` — общий список имён для логов и GlitchTip, `sensitiveKeys` дополняют базовый список, `maskPath` — маска пути.
- `/observability`: `createLoggerOptions` и типы `KitLoggerOptions`, `KitLoggerParams` — опции `nestjs-pino`: `base: {service, entry, replica}`, trace-id из `traceparent` (`trustTraceparent: false` — новый), `/ok` вне журнала доступа, `quietRoutes` на `debug`, путь без query.
- `/observability`: `sanitizeError`, `registerErrorSanitizer` — ветки pg/Drizzle и ioredis по форме объекта, цепочка `cause` до 10, ветки сервиса.
- `/observability`: `initSentry` и тип `KitSentryOptions` — GlitchTip только при `SENTRY_DSN` и `NODE_ENV = production`, `dataCollection: NO_PERSONAL_DATA`, `tracesSampleRate: 0`, скраббер событий; неверный `SENTRY_*` — выключен без исключения.
- `/observability`: `captureError` (одно событие на ошибку), `captureThrottled` (одно событие за окно на ключ).
- `/observability`: `HealthRegistry` и типы `HealthProbe`, `HealthReport` — пробы `/health` со сроком 2 с, `critical`, 503 с начала остановки.
- `/observability`: `MetricsServer` — `/health` и `/metrics` на `METRICS_PORT` (`node:http`); ошибка прослушивания — отказ `listen()`.
- `/observability`: `kitMetrics` и тип `KitMetrics` — реестр на экземпляр с меткой `service`, метрики процесса Node, `verdeect_outbox_pending`, `verdeect_outbox_lag_seconds`, `verdeect_events_consumed_total`, `verdeect_db_pool_wait_timeouts_total`, `verdeect_rate_limit_unavailable_total`.
- `/observability`: `alertRulesTemplate` — путь к шаблону правил vmalert.
- `/observability`: `failStartup` и интерфейс `StartupFailure` — `fatal`-лог, событие GlitchTip с ожиданием до 2 с, `exit(1)`.
- `/observability`: `KitLifecycle` и типы `KitShutdownParticipant`, `KitShutdownStep` — остановка по шагам 1–5; по сигналу — сторож `SHUTDOWN_TIMEOUT_MS` (`SHUTDOWN_TIMEOUT`, `SHUTDOWN_NOT_EXITED`, `exit(1)`), программный `close()` — без сторожа и `exit`.
- Шаблон алертов `alerts/verdeect-kit.rules.yml` (в архиве пакета): правило на каждую метрику пакета, порог по умолчанию и переопределение `verdeect_kit_threshold:<метрика>` по `service`.
