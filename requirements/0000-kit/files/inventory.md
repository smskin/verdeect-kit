# `@verdeect/kit` — инвентаризация общего кода

> Копия `kit/inventory.md` проекта Claude «Verdeect v2» на 2026-11-09. Справочник для переноса кода: столбец «Эталон» и тесты эквивалентности. §4 — расхождения на момент инвентаризации; решения по ним приняты в `../prd.md` (P0: без режимов совместимости — в том числе для шифра, п. 8) — при расхождении действует `prd.md`.
>
> Чат kit, 09.11.2026. Снимок — копия Windows `Documents\wsl-projects\verdeect2` (через `psync`, без `.git`: хеши коммитов не сняты, возможна задержка относительно WSL). Сравнение — `diff` по файлам `apps/<svc>/src/shared/**`. **I** — Identity, **B** — BFF, **P** — Platform-лайт, **O** — Orchestrator. «Δn» — число изменённых строк относительно I; «+n» — файл есть только в этом сервисе (n строк); «—» — нет. Пути в WSL: `/home/administrator/projects/verdeect2/verdeect-<svc>/apps/<svc>/src/shared/**`.

## 1. Сводка по модулям

| Модуль | I | B | P | O | Эталон | Только в одном сервисе |
|---|---|---|---|---|---|---|
| **messaging/rabbit-connection** (`RabbitConnection`, `ManagedChannel`) | 459 | своя упрощённая, 155 (ChannelWrapper без `ManagedChannel`) | Δ263 | Δ280 (P↔O Δ35) | **O** | O: `cancelConsumers()`; P,O: `topologyReady()`, `shutdownDeadline()` (общий срок остановки), `markOpened/isCurrent` (доставка со старого канала после переподключения) |
| **messaging/rabbit-subscriber**, `topology`, `redelivery` | 273 / 55 / 30 | своя, 476: типизированные обработчики Identity, фильтр устаревших (`isStaleEvent`), ajv-контракт, **без inbox** | Δ267 | Δ303 (P↔O Δ110) | **O** + опции из P и B | O: остановка `stopping` → снять потребителей → дождаться доставок → закрыть канал, этапы в warn; P: очередь реплики `platform.authz.<id>` (exclusive, auto-delete, без inbox/DLQ), метрика `*_events_consumed_total`; P,O: `ExpectedMessageError` (warn + retry), `DeliveryResult`, `InvalidMessageError` → сразу DLQ; B: `retryCount(headers, queue)` |
| **outbox**: схема, `OutboxStore`, `OutboxRelay`, метрики | 42 / 102 / 284 / 70 | — | Δ18 / Δ8 / Δ29 / Δ47 | Δ19 / Δ60 / Δ96 / Δ47 | relay — **O**; запись — оба способа | I: `tenant` nullable (события аккаунта без компании), P,O: `NOT NULL` + индекс; I,P: строки пишут **SQL-триггеры** через `<schema>.outbox_emit()` + `outbox_actor()` (читает `app.*`); O: **из кода** `OutboxStore.add(tx, event)` (триггеров нет); O: `BATCH_CONFIRM_DEADLINE_MS` 5 с на пачку, опрос 200 мс (I,P — 1000 мс); P: гонка `stop()` со `shutdownDeadline` |
| outbox SQL | `0004_outbox_triggers.sql` (176), `0006` `seq` | — | `0002_outbox_functions.sql` (55) | `0002_functions.sql` (`new_ulid`) | функции I/P | `new_ulid()` одинаков в трёх схемах; порядок публикации — `seq` (I — с `0006`, P,O — с начала) |
| **messaging/inbox-guard**, `messaging-cleanup.job`, `database/batches` | 43 / 71 / 39 | — | Δ6 / Δ72 / Δ26 | Δ6 / Δ74 / Δ30 | **O** | P,O: очистка — `beforeApplicationShutdown`, `run(now)` → счётчики; O: `shouldContinue()` — пачка дорабатывает при остановке |
| **messaging/event-envelope** (zod конверта `01` §7.1) | 60 | `event-contract.ts` (ajv по JSON Schema) | Δ11 | Δ11 | I/P/O + проверка ajv из B | I: `tenant` nullable |
| Порядок по `occurredAt` | в обработчиках (`organization.subtitle_occurred_at`) | `isStaleEvent` (возраст) | в обработчиках (`apply-company-disabled`, `apply-account-disabled-state`) | в обработчиках модулей | — | **В `shared` нет ни у кого** — это правило обработчика, а не подписчика |
| Права RabbitMQ (`amq.default`) | — | — | `docs/deployment.md` | `docs/messaging.md` + тест `or-119-rabbit-permissions.int-spec.ts` (регулярки читаются из docs, настоящий брокер) | **O** | только O проверяет тестом |
| **database/db** (`Db.transaction/read`) | 236 | — | Δ172 | Δ139 (P↔O Δ81) | **O** + настраиваемые `app.*` | I: 6 GUC (`tenant`, `actor_client_id`, `actor_account_id`, `on_behalf_of`, `channel`, `trace_id`) + `app.reason`, `app.invitation_id` для триггеров; P: 3 GUC; O: только `app.tenant`, `setTenant()`, `afterCommit()`, `withPoolClient` (клиент возвращается в пул при обрыве до `BEGIN` — Drizzle 0.45.4), `isPoolTimeout` |
| read-пул без транзакции (урок 9) | есть (E10) | — | есть | есть | общий | одинаково во всех трёх |
| `drizzle.provider`, `database.module`, `pool-options`, `migrator`, `tx` | 88 / 71 / 7 / 55 / 7 | — | Δ45 / Δ28 / Δ7 / Δ24 / Δ4 | Δ53 / Δ14 / Δ7 / Δ18 / Δ4 | O | P: `owner-db.ts` (транзакции под владельцем схемы для CLI) |
| `prepare-database` (роли `*_owner`, `*_app`, `*_directory`, схема; одна функция для CLI и `globalSetup`) | — (в CLI/тестах иначе) | — | +86 | +88 | **O** | — |
| `ids` (ULID с префиксом), `pg-errors`, `columns`, `schema` | 28 / 35 / 16 / 22 | — | — / — / Δ21 / Δ30 | Δ39 / — / Δ30 / Δ37 | `ids` — O, `pg-errors` — I | `columns`, `schema` — привязка к схеме сервиса, в пакет не идут |
| **context/request-context**, `ctx.decorator` | 108 / 52 | — | Δ90 / Δ63 | Δ121 / Δ102 | — | поля актора различаются по сервисам (доменное) |
| **http/app-exception-filter** | 119 | своя, 215 (Back-Channel Logout, сессии) | Δ35 | Δ111 | **O** | O: тело `{error}` guard'ов `@verdeect/auth` **и** `@verdeect/platform-client`, 503 `PLATFORM_UNAVAILABLE` без GlitchTip, срок пула БД → 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1` (`PoolTimeoutReporter`) |
| `errors/domain-error`, `validation-failed`, `zod-validation.pipe` | 41 / 15 / 30 | — | Δ0 / +14 / Δ17 | Δ4 / +19 / Δ17 | O | `error-messages.ts` — словарь кодов сервиса, доменный |
| **http/idempotency** (interceptor + store + cleanup) | 149 / 133 / 55 | — | — | Δ201 / +147 / Δ82 | решено в `prd.md` §3.3а | **Расходятся по контракту:** I — несовпадение тела → 409 `IDEMPOTENCY_MISMATCH`, ключ в пределах клиента; O — 422 `IDEMPOTENCY_KEY_REUSED`, запрос ещё идёт → 409 `IDEMPOTENCY_IN_PROGRESS`, ключ в пределах (tenant, участник), `@Idempotent({required, tenantFromBody})`, брошенная `in_progress` переиспользуется через 5 мин |
| **http/pagination** | keyset, курсор base64url JSON ключей (66) | — | — | `offset-cursor` (26, помечен ponytail) | **I** | — |
| `security-headers` | 85 (HTML, CSP) | своя | 17, API | =P | P/O | — |
| `configure-http-server` | 51 | Δ85 | Δ44 | Δ126 | — | у каждого свои пределы тела и хуки; общий только каркас |
| `csrf` (double-submit страниц) | I | `request-origin` | — | — | — | **не в пакет** — один потребитель каждого варианта |
| `sse-writer` | — | — | — | +86 | — | один потребитель |
| **security/rate-limiter** (Redis, фиксированное окно, fail-open, `peek`) | 92 | Δ74 | — | — | I | два потребителя |
| `redis.provider` | 58 | Δ24 | — | `shared/redis` (112) | O | три потребителя |
| `trusted-proxies` | 137 | Δ44 | — | — | I | два потребителя (оба — граница браузера) |
| `password-hasher` | I | — | — | — | — | один потребитель, не в пакет |
| **observability**: `sanitize-error` | 179 | 109 | Δ62 | Δ62 (P↔O Δ2) | **O** | — |
| `sentry-scrubber`, `instrument` | 130 / 43 | Δ80 / Δ17 | Δ24 / Δ26 | Δ65 / Δ33 | O | O: `code` не фильтруется |
| `metrics-server` (`/metrics`, `/health` на `METRICS_PORT`), `health-registry`, `get-ok` | 138 / 77 / 20 | Δ26 / Δ8 / Δ6 | Δ17 / Δ8 / Δ5 | Δ31 / Δ16 / Δ5 | O | — |
| `observability.module` (pino: stdout HTTP / stderr CLI, редактирование) | 147 | Δ180 | Δ122 | Δ181 | O | — |
| `fail-startup` (fatal + GlitchTip с ожиданием + exit 1) | — | — | — | +32 | O | один потребитель, но нужен всем |
| `pool-timeout-reporter` | — | — | — | +49 | O | один потребитель, связан с `Db` |
| `instance-shutdown`, `mask-path` | — | — | — | +162, +8 | — | доменные (ретранслятор, «Поделиться») |
| `trace-context` (BFF создаёт trace-id) | — | +32 | — | — | — | доменное для BFF |
| `*-metrics.ts` | I | B | P | O | — | имена метрик сервиса (`identity_`, `platform_`, `orch_`) |
| **config**: `env.schema`, `app-config.module` | 186 / 20 | Δ300 / Δ2 | Δ227 / Δ0 | Δ354 / Δ0 | общий каркас | общие ключи у всех четырёх: `NODE_ENV`, `LOG_LEVEL`, `METRICS_PORT`, `RABBITMQ_URL`, `SENTRY_DSN/ENVIRONMENT/RELEASE`; у I,P,O ещё `DATABASE_URL`, `RABBITMQ_RETRY_SECONDS`; `SERVICE_URLS` — I (пусто), B (JSON `{имя: URL}`, `identity` и `web` обязательны), O (JSON); `REPLICA_ID` — P,O (по умолчанию `hostname()`); `DB_POOL_MAX`, `DB_POOL_ACQUIRE_TIMEOUT_MS` — только O; путь ошибки: I — первый сегмент, B/O — через точку (`SERVICE_URLS.identity`); помощники `positiveInt`, `optionalText`, `booleanFlag`, `jsonValue`, `uniqueBy`, `httpUrl`, `port` — копии с вариациями |
| **crypto** (AES-256-GCM `<версия>:<iv>:<ct>:<tag>`) | `registries/client-service/domain/client-secret.ts` (секрет клиента, `v1`, один ключ, base64); `oidc/jwks-service/domain/private-jwk-cipher.ts` (закрытый JWK, `v1`, HKDF-SHA256 от `IDENTITY_SECRETS`, при расшифровке перебор секретов) | `packages/identity-client/src/crypto/session-cipher.ts` (запись сессии, `v<N>` — **версия ключа**, AAD `<instance>:<id>`, `SESSION_ENC_KEYS`, неудача → `null`) | — | `agent-token/domain/private-key-cipher.ts` (закрытый ключ подписи, версия ключа — строка, HKDF-SHA256, base64url, `SIGNING_KEY_ENCRYPTION_KEYS`; образец — I `private-jwk-cipher`) | **B** (версия ключа, AAD) + HKDF из O | **три потребителя, четыре копии**; различаются кодировкой (base64 / base64url), смыслом версии (формат у I, ключ у B и O), AAD (только B), выводом ключа (HKDF у I-jwks и O) |
| **testing** (`test/support`) | `broker.ts` 333, `global-setup` 177 | `broker.ts` 309 | `broker.ts` 166, `database.ts` 287 | `broker.ts` 166, `images.ts`, `tcp-proxy.ts`, `shutdown-clock.ts` | O | vhost на воркер через management API (все), `tcp-proxy` для обрывов (B,P,O), `timing-guard`, `timeout-scale` (все) |
| Unit на чистом checkout | — | условие `development` → `src/` | — | `vitest.aliases.ts` | B-вариант для пакета | — |

## 2. Тесты, покрывающие модули (основа эквивалентности)

| Модуль | I | B | P | O |
|---|---|---|---|---|
| messaging | `integration/messaging/ac-6-1-outbox-transaction`, `ac-6-4-outbox-no-op`, `ac-6-4a-cleanup`, `ac-6-7-session-terminated`, `fr-72-outbox-relay`, `fr-72-outbox-seq`, `fr-76-subscriber`, `fr-76-subscriber-reconnect`, `outbox-event-payloads`; `http/messaging/ac-6-2-broker-outage`, `ac-6-3-message-contract`, `ac-9-1a-channel-setup` | `http/events/events-subscriber` | `integration/messaging/{channel-setup,cleanup,inbox-guard,outbox-relay,subscriber,topology}`, `integration/database/{outbox-policy,outbox-triggers}`, `timing/messaging/channel-restore` | `integration/messaging/{cleanup,inbox-guard,or-119-rabbit-permissions,outbox,subscriber,topology}`, `integration/outbox/outbox-atomicity`, `timing/messaging/outbox-confirm` |
| database | `integration/database/{rls,read-pool,autocommit,after-commit,connection-lost,migrations}`, `http/database/ac-9-1b-shutdown` | — | `integration/database/{ac-3-13-rls,db,schema-constraints}`, `http/observability/ac-6-5-pool-shutdown` | `integration/database/{ac-10-2-rls,db,fr-21-roles,ac-10-8-migrate,schema-11-1}`, `http/database/ac-10-8-shutdown`, `timing/database/*` |
| http | `app-exception-filter.spec`, `pagination.spec`, `zod-validation.pipe.spec`, `http/api/service-api`, `http/security/ac-8-3-security-headers` | `http/shared/request-errors`, `integration/shared/rate-limiter` | `http/errors/request-errors` | `http/errors/request-errors`, `http/shared/idempotency`, `integration/shared/idempotency-cleanup`, `http/observability/or-119-db-pool*` |
| observability | `sanitize-error.spec` (210), `sentry-scrubber.spec`, `http/observability/{ac-9-1-health,ac-9-1-metrics,ac-9-1a-db-blackhole}` | `observability.module.spec`, `trace-context.spec` | `http/observability/ac-6-2-*`, `timing/observability/{ac-6-6-shutdown-deadline,fr-13-db-blackhole}` | `ac-10-3-log-redaction.spec`, `fail-startup.spec`, `http/observability/{ac-10-4-*,or-106-health-stopping-first}`, `http/database/ac-10-8-metrics-shutdown` |
| config | `env.schema.spec` | `env.schema.spec` | `env.schema.spec`, `ac-6-1-production-compose.spec`, `http/config/ac-6-1-startup` | `env.schema.spec`, `test/support/compose-env.spec` |
| crypto | `client-secret.spec`, тесты jwks | тесты `identity-client` (session-cipher) | — | тесты `agent-token` (AC-7.2) |

## 3. Зависимости (точные пины в `apps/*/package.json`)

Совпадают у всех четырёх: `@nestjs/core` 12.1.3, `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `pg` 8.23.1, `amqplib` 2.2.0, `amqp-connection-manager` 5.0.1, `nestjs-pino` 5.3.1, `pino` 10.4.0, `zod` 4.6.7, `ioredis` 6.0.0, `@sentry/nestjs` 11.7.0, `ajv` 8.20.0, `vitest` 5.0.4, `testcontainers` 12.2.1, `typescript` 5.9.3. Расхождение: `fastify` 5.12.5 (I, P, O) / 5.12.7 (B).

Образы тестов: `postgres:16.15-alpine3.24` (**I**) / `postgres:17.11-alpine3.24` (**P, O**); `redis:7.4.11-alpine`, `rabbitmq:4.3.6-management-alpine` — у всех; `axllent/mailpit:v1.31.6` (I), `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (O). Для пакета — `TEST_IMAGES` из `prd.md` §3.8 (PostgreSQL 17.11 у всех).

## 4. Расхождения на момент инвентаризации (решения — в `prd.md`)

1. **Idempotency-Key:** коды и область ключа у I и O разные (см. таблицу).
2. **Пагинация:** keyset (I) против смещения (O, временно).
3. **Postgres 16 против 17** в тестах.
4. **`outbox.tenant`:** nullable (I) против `NOT NULL` (P, O).
5. **Запись outbox:** триггеры (I, P) против кода (O).
6. **Пауза опроса outbox:** 1000 мс (I, P) против 200 мс (O).
7. **BFF:** своя ранняя ветка messaging (без БД и inbox) — переход крупнее остальных.
8. **Шифрование:** четыре копии в трёх сервисах с разными форматами. Решение `prd.md` (P0, §3.6): один формат, без чтения старых форматов.
9. **Порядок по `occurredAt`:** в `shared` его нет нигде — в пакет может пойти только помощник для обработчиков, не поведение подписчика.
10. **Путь ключа в ошибке конфигурации:** первый сегмент (I, P) против полного пути через точку (B, O).
