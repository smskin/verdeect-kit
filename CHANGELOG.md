# Changelog

Все заметные изменения `@verdeect/kit`. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/). У мажорной версии есть раздел «Как перейти» (NFR-5).

## [Unreleased]

Первый выпуск: подпути `/config` и `/testing` (этап E1, PRD v1.7), `/observability` (этап E2, PRD v1.11), `/http` и CLI `verdeect-kit` (этап E3, PRD v1.13), `/database`, `/idempotency` и CLI `db` (этап E4, PRD v1.14), `/messaging` и CLI `rabbitmq` (этап E5, PRD v1.14), `/crypto` и CLI `crypto` (этап E7, PRD v1.16), `/redis` и CLI `redis` (этап E8, PRD v1.17).

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
- `/database`: `KitDatabaseModule.forRoot({schema})` и тип `KitDatabaseModuleOptions` — основной пул и пул чтения (`statement_timeout` 5 с), пробы `/health` `database` и `database-read` (критичные), закрытие пулов на шаге 4; срок пула — `verdeect_db_pool_wait_timeouts_total{pool="main"|"read"}` и `captureThrottled` при ошибке получения соединения.
- `/database`: токены `DRIZZLE`, `DRIZZLE_READ` — Drizzle со схемой сервиса для запросов вне `Db`.
- `/database`: `Db` — `transaction`, `read`, `readGlobal`, `afterCommit`, `setLocal`; один `set_config('app.tenant', …, true)` на транзакцию; типы `DbTx`, `DbReader`, `AfterCommitTask`; ошибки `TenantRequiredError` (`read` без тенанта), `AfterCommitInReadOnlyError`.
- `/database`: тип `DbContext` — `{tenant, traceId, actor}`.
- `/database`: `tenantColumn`, `tenantPolicy` — строгий RLS `tenant = current_setting('app.tenant', true)` (P0).
- `/database`: `prepareDatabase` и типы `KitPrepareDatabaseOptions`, `KitPrepareDatabaseResult` — роли `<svc>_owner`, `<svc>_app` (без `CREATE`), `<svc>_directory` и схема сервиса, идемпотентно.
- `/database`: `runMigrations` и тип `KitRunMigrationsOptions` — журнал `<svc>.__migrations`, схема `drizzle` не создаётся.
- `/database`: `deleteInBatches` и типы `KitDeleteInBatchesOptions`, `KitDeleteInBatchesResult` — пачка — транзакция, остановка `Db` ждёт текущую пачку.
- `/database`: `runExclusive` — `pg_try_advisory_lock` без ожидания.
- `/database`: `occurredAtColumn`, `ifNewer` — обновление только событием новее.
- `/database`: `newId`, `ulid` — id `<prefix>_<ulid>`, префикс `^[a-z]{2,5}$`.
- `/database`: `isUniqueViolation`, `isConnectionError`, `isPoolTimeout` — реэкспорт распознавания ошибок pg по форме; `isConnectionError` узнаёт и «Client has encountered a connection error».
- `/idempotency`: `KitIdempotencyModule.forRoot({table})` и тип `KitIdempotencyModuleOptions` — интерсептор, проверка функции `idempotency_purge` при старте (нет — отказ запуска), очистка при старте и раз в час одной репликой.
- `/idempotency`: `Idempotent` и тип `KitIdempotentOptions` — `@Idempotent({required?, tenantFromBody?})`: повтор — сохранённый ответ и `Idempotent-Replayed: true`, коды `IDEMPOTENCY_*`; только с `VerdeectAuthGuard` (без принципала — 500).
- `/idempotency`: `createIdempotencyTable` и тип `KitIdempotencyTable` — таблица `idempotency_key` под RLS `IS NOT DISTINCT FROM`.
- `/idempotency`: `idempotencyPurgeSql` — текст функции очистки `SECURITY DEFINER` для миграции сервиса.
- `/observability`: аннотация алерта `VerdeectEventsDlq` — разбор `<svc>.dlq` по `x-dlq-reason`; у очередей реплики сообщение не сохраняется.
- `/observability`: метрика `verdeect_cleanup_runs_total{table, result}` в `kitMetrics` и правило алерта `VerdeectCleanupFailing` (порог `verdeect_kit_threshold:cleanup_runs`).
- `/http`: OpenAPI — `Idempotency-Key`, `Idempotent-Replayed` и ошибки 409/422/400 по метаданным `@Idempotent`.
- `/testing`: `createScratchDatabase` и тип `KitScratchDatabase` — пустая мигрированная БД из шаблона.
- `/testing`: `workerScope` и тип `KitWorkerScope` — слаг компании воркера `tenant`.
- `/testing`: `countQueries` и тип `KitCountablePool` — запросы пула за время функции.
- `/testing`: `assertStrictTenantIsolation` и тип `KitTenantIsolationOptions` — строгий RLS схемы сервиса и функция очистки.
- `/testing`: `assertAppRoleIsNotOwner` и тип `KitQueryable` — роль приложения не владелец, без `CREATE`.
- `/messaging`: `defineEvent` и типы `KitEvent`, `KitEventTenant` — определение события каталога с признаком тенанта (`'required'` по умолчанию, `'none'`), `data` без `.strict()`.
- `/messaging`: `EnvelopeSchema` и тип `Envelope` — конверт `01` §7.1; `tenant` в типе — по признаку события.
- `/messaging`: `createOutboxTable` (тип `KitOutboxTable`, опции `KitOutboxTableOptions` — `tenantNullable`) и `createInboxTable` (тип `KitInboxTable`) — таблицы outbox (политика-исключение строгой модели) и inbox.
- `/messaging`: `KitMessagingModule.forRoot({service, outbox?, subscriber?})` и тип `KitMessagingModuleOptions` — соединение RabbitMQ (пассивная проверка `verdeect.events`), relay, подписчик, очистка, проба `rabbitmq`; отказ запуска `MESSAGING_TENANT_NOT_NULLABLE` (событие `'none'` при NOT NULL `tenant`) и `MESSAGING_RETRY_TTL_MISMATCH` (другой TTL `<svc>.retry`); `pg` — только при outbox или `dedupe: 'inbox'`.
- `/messaging`: `OutboxStore` — `add(tx, Event, {subjectId, data})`: запись события в транзакции `Db` из кода (без триггеров), проверка `data` и признака тенанта; relay с подтверждениями брокера, пачкой ≤ 100 по `seq`, паузами 1 с → 5 мин, `error` + GlitchTip после 5 неудач строки.
- `/messaging`: `KitSubscriber` и типы `KitEventHandler`, `KitReplicaHandler` — `on(Event, (event, tx) => …)` с inbox в транзакции обработчика, повторами через `<svc>.retry` (5 по `x-death`), DLQ `<svc>.dlq` с `x-dlq-reason`, `prefetch` 10; `onReplica` — очередь реплики без inbox, повтора и DLQ (ошибка — `error`-лог, `captureThrottled`, `result="dlq"`); метрика `verdeect_events_consumed_total{type, result}`.
- `/messaging`: `ExpectedMessageError` (повтор, затем DLQ с кодом, без GlitchTip), `InvalidMessageError` (сразу DLQ с причиной, без GlitchTip) и `MessagingStartupError` — отказ запуска с кодом `MESSAGING_TENANT_NOT_NULLABLE` или `MESSAGING_RETRY_TTL_MISMATCH`.
- `/messaging`: очистка опубликованного outbox и inbox старше 7 дней раз в час одной репликой — метрика `verdeect_cleanup_runs_total{table: outbox|inbox}`.
- `/testing`: `startTestStack({rabbitmq: true})` — RabbitMQ с `definitions.json`, vhost и пользователь на воркер, удаление в teardown; ключи `inject` `kitRabbitmqUrl`, `kitRabbitmqManagementUrl`, `kitRabbitmqWorkers`; `workerScope().rabbitmq` — `{vhost, url}`.
- `/testing`: `startTestStack({outboxEvents})` и ключ `inject` `kitOutboxCoverageDir` — покрытие outbox прогона.
- CLI `verdeect-kit rabbitmq definitions --services <svc,…> [--out <файл>]` — `definitions.json` с хешами паролей из `RABBITMQ_PASSWORD_HASH_<SVC>`; коды ошибок `USAGE`, `INVALID_ENVIRONMENT`.
- `/testing`: `expectOutbox`, `assertOutboxCoverage` — проверка записи события в транзакции и покрытие событий за прогон (`startTestStack({outboxEvents})`, `KIT_OUTBOX_COVERAGE=1`).
- `/testing`: `publishTestEvent`, `waitForInbox` — публикация конверта в vhost воркера и ожидание обработки подписчиком без `sleep`.
- `/testing`: ключи `inject` `kitDatabaseUrl`, `kitDatabaseOwnerUrl`, `kitDatabaseAdminUrl`, `kitDatabaseService`, `kitDatabaseTemplate`.
- CLI `verdeect-kit db`: `prepare --service <svc>`, `migrate --folder <путь> --schema <svc>`, `move-journal --from <схема> --to <svc>`; коды ошибок `USAGE`, `INVALID_ENVIRONMENT`, `DATABASE_UNAVAILABLE`, `DB_COMMAND_FAILED`.
- `/crypto`: `createCipher` и типы `KitCipher`, `KitCipherOptions` — AES-256-GCM, ключ HKDF-SHA256 (`info = verdeect-<svc>:<purpose>`), значение `v<N>:<iv>:<ct>:<tag>` base64url, обязательный `aad`, `needsReencrypt`; `keys` проверяются схемой `ENCRYPTION_KEYS`.
- `/crypto`: `DecryptError` и тип `DecryptErrorReason` — `'format' | 'unknown_version' | 'auth'` без открытого текста и ключей.
- `/crypto`: `generateSecret(bytes = 32)` — секрет base64url без `=` (не меньше 32 байт).
- CLI `verdeect-kit crypto generate-secret [--bytes N]` — `{"secret":"…"}` в stdout; код ошибки `USAGE`.
- `/redis`: `KitRedisModule.forRoot({service, subscriber?: true})` и `KitRedisModuleOptions` — `keyPrefix <svc>:`, подписочное соединение по `subscriber`, проба `redis` (некритичная), закрытие на шаге 4.
- `/redis`: `KIT_REDIS`, `KitRedisChannels` — основное соединение и каналы с префиксом `<svc>:`.
- `/redis`: `RateLimiter.hit/peek`, `RateLimitOptions`, `RateLimitResult` — фиксированное окно (`PEXPIRE … NX`, Redis ≥ 7.0), fail-open и `verdeect_rate_limit_unavailable_total`.
- `/redis`: `throwRateLimited` — 429 `RATE_LIMITED` + `Retry-After` (секунды вверх).
- `/testing`: `startTestStack({redis})` с aclfile пользователя сервиса и администратором теста, `workerScope().redisPrefix`, `redisWorkerOverride`, ключи `provide` `kitRedisUrl`, `kitRedisAdminUrl`, `kitRedisService`.
- CLI `verdeect-kit redis acl --services <svc,…> --out <файл>` — aclfile (`user default off`, хеши sha256 из `REDIS_PASSWORD_HASH_<SVC>`); коды ошибок `USAGE`, `INVALID_ENVIRONMENT`.

### Changed

- `/http`: `KitExceptionFilter` ставит `Retry-After` для `RATE_LIMITED` по `details.retryAfterSec` (E8).
- `/testing`: `countQueries(pool, fn, {onQuery})` и тип `KitCountQueriesOptions` — колбэк на каждый запрос пула (сигнал без пауз в тесте).
- `/database`: `Db` связывает транзакцию с её `DbContext` (для `OutboxStore.add`) — без изменения API.
- `/testing`: `assertStrictTenantIsolation` проверяет политику `outbox` по `createOutboxTable` (раньше — только наличие политики).
- `/testing`: `startTestStack({postgres: true})` готовит БД — `prepareDatabase`, шаблон `<svc>_template`, миграции опции `migrations` (без `postgres` — `TypeError`).
- `/http`: `KitExceptionFilter` больше не считает срок пула — `pool: 'unknown'` удалён; метрику и событие пишет пул `/database` с меткой `main`/`read`, фильтр отвечает 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1`.
- `KitConfigModule.forRoot({schema})` разбирает окружение при сборке контекста, а не при импорте `AppModule`: неверное окружение отклоняет сборку контекста, сам `forRoot` не отклоняется. Умолчания в `process.env` не дописываются, `ConfigService` читает только разобранные значения. При запуске через `bootstrapService` окружение не разбирается повторно.
- Обязательный peer `prom-client` заменён на `@prometheus-io/client` `^0.16.1` (`prom-client` помечен deprecated, преемник — тот же API; PRD v1.12, NFR-3): `kitMetrics` и `MetricsServer` работают на `Registry`, `Counter`, `Gauge` из `@prometheus-io/client`. Сервис ставит `@prometheus-io/client` вместо `prom-client`.

### Fixed

- `/database`: `Db.setLocal` отвергает служебную `app.tenant` (`TypeError`) — тенант задаётся только `DbContext` в `transaction`/`read` (KT-22 п. 1).
- `/database`: `Db.afterCommit` с транзакцией другого `Db` или вложенной — `AfterCommitOutsideTransactionError` вместо молчаливой потери задачи (KT-22 п. 2).
- `/idempotency`: ответ пишет только попытка, захватившая строку, — колонка `attempt` в `createIdempotencyTable`; долгий первый запрос не затирает ответ перехватившего повтора, `warn` без ключа и тела (KT-22 п. 3). Сервису — миграция `drizzle-kit` с новой колонкой.
- `/database`: `runExclusive` передаёт в `fn` соединение блокировки, `deleteInBatches` — опция `connection`; очистка идемпотентности идёт на соединении блокировки и работает при `DB_POOL_MAX = 1` (KT-22 п. 4).
- `/idempotency`: проход очистки, прерванный остановкой, — `verdeect_cleanup_runs_total{result="interrupted"}` вместо `ok`; алерт `VerdeectCleanupFailing` его не учитывает (KT-22 п. 5).
- CLI `db`: `sqlState` ищется по цепочке `cause` (до 10 уровней) — код pg внутри `DrizzleQueryError` больше не теряется; системные коды Node (`EPIPE`) в `sqlState` не попадают (KT-22 п. 6).
- `/testing`: `assertStrictTenantIsolation` проверяет функцию очистки по точной сигнатуре `idempotency_purge(integer)`; другая перегрузка без нужной — «функции нет» (KT-22 п. 7).
- Тесты `/database` и `/idempotency` уровня I — без реальных пауз: сигналы входа в обработчик, события `acquire` пула и шлагбаумы вместо `setTimeout` и опроса (KT-22 п. 8).
- `/testing`: `publishTestEvent` после обрыва соединения или закрытия канала открывает новое соединение при следующем вызове (раньше переиспользовал закрытый канал); неудачное подключение не запоминается.
- `/testing`: `publishTestEvent` закрывает соединение, если после `connect()` не открылся confirm-канал, — повторные неудачные вызовы не копят открытых соединений (KT-24 п. 1).
- `/database`: `runExclusive` сбрасывает сеанс соединения блокировки (`RESET ALL`) перед возвратом в пул; TSDoc запрещает `SET` и `set_config(…, false)` внутри `fn`.
- `/http`: OpenAPI — у маршрутов с `@RequireTenant()` ответ 409 `TENANT_REQUIRED` (тело guard'а `@verdeect/auth`); `expectMatchesApi` проверяет описанные статусы ошибок по схеме `ErrorResponse` и падает на неописанном статусе.
- `/http`: `bootstrapService` — `SENTRY_NOT_PRELOADED` только при верной конфигурации Sentry (верный `SENTRY_DSN`, `NODE_ENV = production`); при неверном `SENTRY_*` предупреждения нет — `initSentry` выключил Sentry намеренно.
- `/testing`: `expectMatchesApi` — скомпилированная схема Ajv кэшируется по маршруту и статусу.
- `/http`: OpenAPI — маршруты с `@Api`, унаследованные от базового контроллера, попадают в документ с путём наследника; переопределённый метод — один маршрут.
