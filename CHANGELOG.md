# Changelog

Все заметные изменения `@verdeect/kit`. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/). У мажорной версии есть раздел «Как перейти» (NFR-5).

## [Unreleased]

Первый выпуск: подпути `/config` и `/testing` (этап E1, PRD v1.7), `/observability` (этап E2, PRD v1.11), `/http` и CLI `verdeect-kit` (этап E3, PRD v1.13).

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
- `/http`: `bootstrapService` и тип `KitBootstrapOptions` — точка входа `main.ts`: окружение до создания приложения (ошибка — `failStartup`, порт не открывается), логгер, `warn` `SENTRY_NOT_PRELOADED`, сервер метрик (шаг 5), `KitLifecycle.listen()`, `PORT` на `0.0.0.0`; опции по роли `logger.trustTraceparent`, `logger.quietRoutes`, `http.bodyLimit`, `redaction`; имя сервиса вне формата — отказ запуска.
- `/http`: `createHttpApp` и тип `KitHttpAppOptions` — Fastify-приложение Nest: `nosniff`, `Referrer-Policy: no-referrer`, trace-id, `GET /ok`, фильтр ошибок, 404 `ROUTE_NOT_FOUND`; участники остановки `http` (шаг 2) и `nest` (шаг 3), `app.close()` = `lifecycle.close()`; модули сервиса внедряют `KitLifecycle` и `HealthRegistry`.
- `/http`: `kitErrors`, `defineErrors` и типы `KitErrorDictionary`, `KitErrorEntry` — словарь кодов на процесс; код пакета с другим статусом — ошибка компиляции, тот же код с другим статусом — ошибка при определении. Коды пакета: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `VALIDATION_FAILED` 422, `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `ROUTE_NOT_FOUND` 404, `VERSION_CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503, `SERVICE_STOPPING` 503, `PLATFORM_UNAVAILABLE` 503, `IDEMPOTENCY_KEY_REUSED` 422, `IDEMPOTENCY_IN_PROGRESS` 409, `IDEMPOTENCY_KEY_REQUIRED` 400.
- `/http`: `DomainError` — ошибка домена со статусом из словаря и `{cause}`; незарегистрированный код — 500 `INTERNAL_ERROR` и событие GlitchTip.
- `/http`: `KitExceptionFilter` — `{error: {code, message, details}}`; тело guard'ов `@verdeect/auth` без изменений; срок пула БД — 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1`, метрика, `captureThrottled`; `HttpException` без тела 400/401/403/404/413/415/429 — код по статусу, прочие — 500.
- `/http`: `ZodValidationPipe` — 422 `VALIDATION_FAILED` с `issues: [{path, code}]` без значений.
- `/http`: keyset-пагинация `PageQuerySchema`, `pageOf`, `afterCursor`, `encodeCursor`, `decodeCursor` и тип `Page` — `limit` 100/200, неверный курсор — 422 `path: cursor`, последний ключ — уникальный.
- `/http`: `Api` и тип `KitApiOptions` — описание маршрута для OpenAPI 3.1.
- CLI `verdeect-kit` (поле `bin`): команда `openapi --out <файл> [--module <файл>#<экспорт>]` — документ по метаданным без запуска приложения, слияние `contracts/openapi.extra.json`, результат `{written, operations}`; ошибки — `{error: {code, message}}` и выход 1, коды `USAGE`, `MODULE_NOT_FOUND`, `INVALID_PACKAGE_JSON`, `INVALID_EXTRA`, `INVALID_ENVIRONMENT`, `OPENAPI_FAILED`, `UNKNOWN_COMMAND`.
- `/testing`: `createTestApp` и типы `KitTestAppOptions`, `KitTestOverride` — тот же `createHttpApp` на `Test.createTestingModule`, `overrides`.
- `/testing`: `expectProblem` и типы `KitExpectedProblem`, `KitTestResponse` — утверждение об ответе-ошибке.
- `/testing`: `expectMatchesApi` — ответ по схеме `@Api` маршрута (Ajv 2020).
- Опциональный peer `@nestjs/testing` `^12.1.0` — только для `createTestApp`, грузится при вызове; зависимость `ajv` 8.20.0 — внутренняя деталь `/testing`.
- Шаблон алертов `alerts/verdeect-kit.rules.yml` (в архиве пакета): правило на каждую метрику пакета, порог по умолчанию и переопределение `verdeect_kit_threshold:<метрика>` по `service`.

### Changed

- `KitConfigModule.forRoot({schema})` разбирает окружение при сборке контекста, а не при импорте `AppModule`: неверное окружение отклоняет сборку контекста, сам `forRoot` не отклоняется. Умолчания в `process.env` не дописываются, `ConfigService` читает только разобранные значения. При запуске через `bootstrapService` окружение не разбирается повторно.

- Обязательный peer `prom-client` заменён на `@prometheus-io/client` `^0.16.1` (`prom-client` помечен deprecated, преемник — тот же API; PRD v1.12, NFR-3): `kitMetrics` и `MetricsServer` работают на `Registry`, `Counter`, `Gauge` из `@prometheus-io/client`. Сервис ставит `@prometheus-io/client` вместо `prom-client`.

### Fixed

- `/http`: OpenAPI — у маршрутов с `@RequireTenant()` ответ 409 `TENANT_REQUIRED` (тело guard'а `@verdeect/auth`); `expectMatchesApi` проверяет описанные статусы ошибок по схеме `ErrorResponse` и падает на неописанном статусе.
- `/http`: `bootstrapService` — `SENTRY_NOT_PRELOADED` только при верной конфигурации Sentry (верный `SENTRY_DSN`, `NODE_ENV = production`); при неверном `SENTRY_*` предупреждения нет — `initSentry` выключил Sentry намеренно.
- `/testing`: `expectMatchesApi` — скомпилированная схема Ajv кэшируется по маршруту и статусу.
- `/http`: OpenAPI — маршруты с `@Api`, унаследованные от базового контроллера, попадают в документ с путём наследника; переопределённый метод — один маршрут.
