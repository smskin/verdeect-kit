# `@verdeect/kit` — общий инфраструктурный пакет сервисов Вердикта 2.0

## Обзор

npm-библиотека для NestJS-сервисов Вердикта 2.0. Она заменяет четыре копии инфраструктурного кода `src/shared/**` в Identity, BFF, Platform и Orchestrator одним проверенным экземпляром. Новые сервисы (Files, Media и следующие) получают одинаковое поведение с первого коммита (prd.md §1).

Это библиотека, а не сервис. У неё нет своего HTTP-сервера, БД, брокера, Docker-образа и проекта в GlitchTip. Пакет реализует `initSentry` и отправку ошибок для сервисов-потребителей, но сам ничего не отправляет. Таблицами пакет не владеет: он даёт фабрики схемы Drizzle, а таблицы создают миграции сервиса в его схеме (§6).

Источник требований — `requirements/0000-kit/prd.md` v1.8: P0 и решения G (§0), API по подпутям (§3), UC-1–UC-16 (§4), AC с уровнем теста (§5), NFR-1–NFR-9 (§7), этапы (§9). Этапы, режим плана и готовность — `requirements/0000-kit/README.md`. Эталон переноса кода — `requirements/0000-kit/files/inventory.md`. При расхождении действует `prd.md`.

**Правило P0.** Опция в пакете допустима только для различия по роли сервиса: BFF — граница с браузером, без БД; Identity — события без компании; пороги алертов. Исторические различия сервисы устраняют переходом на один способ. Режимов совместимости, псевдонимов старых ключей окружения и чтения старых форматов нет (N9).

## Основные возможности

Один пакет, одна версия. Подпути (G1):

- **`/config`** (E1, §3.1) — фрагменты zod-схемы окружения: `envBase`, `envDatabase`, `envMessaging`, `envRedis`, `envSentry`, `envCrypto`, `envServiceUrls`. Функции `defineEnv`, `withBaseChecks`, `parseEnv`: при ошибке — `InvalidEnvironmentError` с полными путями ключей, без значений. `KitConfigModule.forRoot`, помощники `port()`, `positiveInt()`, `jsonValue()` и др.
- **`/observability`** (E2, §3.2):
  - `createLoggerOptions` для `nestjs-pino`;
  - редактирование по `SENSITIVE_KEYS` + `KitRedaction`, `sanitizeError`;
  - `initSentry` в `instrument.ts` через `node --import`, `captureError`, `captureThrottled`, `failStartup`;
  - `HealthRegistry`, `MetricsServer` (`/health`, `/metrics` на `METRICS_PORT`), `kitMetrics`;
  - `KitLifecycle` — пятишаговая остановка в общем сроке `SHUTDOWN_TIMEOUT_MS`, сторож;
  - шаблон алертов `alerts/verdeect-kit.rules.yml`.
- **`/http`** (E3, §3.5):
  - `bootstrapService` разбирает окружение до создания приложения и при ошибке вызывает `failStartup`;
  - `createHttpApp` (Fastify);
  - словарь кодов `kitErrors`/`defineErrors`, `DomainError`, `ZodValidationPipe`, `KitExceptionFilter`;
  - keyset-пагинация;
  - `@Api` и CLI `openapi`.
- **`/database`** (E4, §3.3):
  - `KitDatabaseModule`: основной пул и пул чтения;
  - `Db.transaction/read/readGlobal/afterCommit/setLocal` — один `set_config('app.tenant')`;
  - строгий RLS: `tenantColumn`, `tenantPolicy`;
  - `prepareDatabase` (роли `<svc>_owner`, `<svc>_app`, `<svc>_directory`), `runMigrations`, CLI `db`;
  - `newId`, `runExclusive`, `deleteInBatches`, `ifNewer`.
- **`/idempotency`** (E4, §3.3а) — `createIdempotencyTable`, `KitIdempotencyModule`, `@Idempotent` + интерсептор (`Idempotency-Key`, коды `IDEMPOTENCY_*`).
- **`/messaging`** (E5, §3.4):
  - `defineEvent`, конверт `01` §7.1;
  - `createOutboxTable`/`createInboxTable`, `OutboxStore.add` — запись из кода, без триггеров;
  - relay с подтверждениями брокера;
  - подписчик: inbox, `.retry`/DLQ, `x-dlq-reason`, `onReplica`;
  - очистка;
  - CLI `rabbitmq definitions`.
- **`/crypto`** (E7, §3.6) — `createCipher`: AES-256-GCM, HKDF-SHA256, версии ключей, обязательный AAD, `DecryptError`. Ещё `generateSecret` и CLI `crypto generate-secret`.
- **`/redis`** (E8, §3.7) — `KitRedisModule` (префикс `<svc>:`), лимитер `RateLimiter` с fail-open, `throwRateLimited`, CLI `redis acl`.
- **`/testing`** (E1 → E8, §3.8; только с условием `development`):
  - `TEST_IMAGES`;
  - `startTestStack` для `globalSetup` Vitest;
  - `workerScope`, `createScratchDatabase`;
  - `tcpProxy`, `timingGuard`, `TEST_TIMEOUT_SCALE`;
  - `createTestApp`, `expectProblem`, `expectMatchesApi`;
  - `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner`, `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`, `assertRepoConventions`.
- **CLI `verdeect-kit`** — `db prepare|migrate|move-journal`, `openapi`, `rabbitmq definitions`, `crypto generate-secret`, `redis acl`. Результат — JSON в stdout, ошибка — JSON и выход 1.

Подпуть выходит в своём этапе. Поле типа из следующего этапа отсутствует, заглушки не делаются (§3.8). Этапы E1 → E2 → E3 → E4 → E5 → E7 → E8 версий не выпускают: изменения копятся в `[Unreleased]`; после E8 — `1.0.0-rc.1`, дальше `1.0.0-rc.N` (метка npm `next`), `1.0.0` (`latest`) — после перехода Identity (G14, PRD v1.8). Номер E6 не используется: `@verdeect/events` вынесен в отдельный репозиторий.

## Технологический стек

- **Язык:** TypeScript 5.9.3, `strict` и `noUncheckedIndexedAccess`, ESM-only (`"type": "module"`, `NodeNext`).
- **Рантайм:** Node.js ≥ 22.12, тесты на Node 22 и 24 (NFR-1).
- **Обязательные peer-зависимости** (NFR-3, G3). Их экземпляр, тип или глобальное состояние пересекает границу пакет ↔ сервис. Диапазон — от проверенной минорной:
  - `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify` 12.1.3, `@nestjs/config` 12.0.1 (`KitConfigModule` — обёртка над `ConfigModule`, PRD v1.7);
  - `fastify` 5.12.5, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `zod` 4.6.7, `drizzle-orm` 0.45.4;
  - `nestjs-pino` 5.3.1, `pino` 10.4.0, `@sentry/nestjs` 11.7.0, `@verdeect/auth` 1.0.1;
  - `prom-client` 15.1.3 (диапазон `^15.1.0`).
- **Опциональные peer-зависимости.** Импорт подпути без нужной библиотеки падает с текстом «`@verdeect/kit/<подпуть>` требует `<библиотека>` — добавьте в зависимости сервиса» (AC-1.2):
  - `pg` 8.23.1 — для `/database` и `/idempotency`; в `/messaging` подключается только динамическим `import()` при outbox или inbox;
  - `ioredis` 6.0.0 — `/redis`;
  - `amqplib` 2.2.0 + `amqp-connection-manager` 5.0.1 — `/messaging`;
  - `testcontainers` 12.2.1, `vitest` 5.0.4 — `/testing`.
- **`dependencies`:** только внутренние детали, точные версии: `semver` 7.8.6 (правило `peer-versions`), `yaml` 2.9.1 (разбор compose в `assertRepoConventions`), `shell-quote` 1.12.0 (разбор команд запуска в `assertRepoConventions`; CommonJS, именованный импорт из ESM; импортируется только из `/testing`).
- **Миграции:** SQL генерирует `drizzle-kit` 0.31.11 в сервисе. Пакет даёт фабрики схемы и `runMigrations`.
- **Тесты (Vitest 5.0.4).** Метаданные декораторов для DI пишет `unplugin-swc`. Уровни (§5):
  - U — `test/unit/<подпуть>`, без контейнеров;
  - I — `test/integration/<подпуть>`, Testcontainers на `TEST_IMAGES` через собственный `startTestStack`;
  - T — `test/timing/<подпуть>`;
  - C — проект-потребитель `test/consumer` на упакованном архиве;
  - R — проверки репозитория и архива.
- **Образы тестов (`TEST_IMAGES`):** `postgres:17.11-alpine3.24`, `redis:7.4.11-alpine`, `rabbitmq:4.3.6-management-alpine`, `axllent/mailpit:v1.31.6`, `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`.
- **Пакетный менеджер:** pnpm. В `devDependencies` версии точные, `minimumReleaseAge` задан.
- **Проверки пакета:** `publint --strict`, `@arethetypeswrong/cli --profile esm-only`, состав `npm pack`, проект-потребитель (AC-1.1, AC-9.1).
- **Линт и формат:** ESLint (flat config, typescript-eslint, TSDoc публичного API, `no-console` и `no-restricted-syntax` по AC-9.4) и Prettier — по образцу `verdeect-platform-client`.
- **CI и выпуск:** Makefile и GitHub Actions (`smskin/verdeect-kit`).
  - Порядок: lint → test (Node 22, 24; U + I) → timing → build + `pack:check` → проект-потребитель → publish.
  - Publish — только по тегу `v<semver>` через npm Trusted Publishing с provenance и `scripts/publish.mjs`.
  - `1.0.0` выпускается вручную, затем включается `npm trust` (G13, NFR-6).
- **Docker:** своих Dockerfile и compose нет. Демон Docker нужен только уровням I, T и C (Testcontainers).

## Интеграции

| Система | Что используется | Как |
|---|---|---|
| Сервисы-потребители (`verdeect-identity`, `-bff`, `-platform`, `-orchestrator`, затем Files, Media) | все подпути | ставят пакет точной версией, переходят по §10 PRD после E8: BFF → Platform → Orchestrator → Identity |
| `@verdeect/auth` | декораторы аутентификации (для `@Api`), тело `{error}` guard'ов | peer-зависимость. JWT пакет не проверяет (N3) |
| `@verdeect/platform-client` | тело `{error}` guard'а, `PLATFORM_UNAVAILABLE` | фильтр `/http` пропускает его без изменений (N4) |
| `@verdeect/events` (`verdeect-events`) | каталог событий на `defineEvent` | отдельный PRD и репозиторий. Зависимость только `events → kit` (`^1.0.0-rc.1`) |
| PostgreSQL 17 | RLS `app.tenant`, роли, advisory lock | драйвер `pg` (опциональный peer) |
| RabbitMQ 4.3 | exchange `verdeect.events` (пассивная проверка), очереди `<svc>`, `<svc>.retry`, `<svc>.dlq` | `amqplib` + `amqp-connection-manager`; `definitions.json` из CLI |
| Redis 7.4 | префикс `<svc>:`, ACL, лимитер | `ioredis` |
| GlitchTip (Sentry-совместимый) | события ошибок сервисов | `@sentry/nestjs`; включается только при непустом `SENTRY_DSN` и `NODE_ENV = production` |
| VictoriaMetrics / vmalert | метрики `verdeect_*`, правила алертов | `prom-client`; файл `alerts/verdeect-kit.rules.yml` |

**Источники копий** — только чтение, без смены веток, `pull`, `fetch` и запуска контуров. Пути — `/home/administrator/projects/verdeect2/`:

- `verdeect-identity/apps/identity/src/shared/**` (I);
- `verdeect-bff/apps/bff/src/shared/**` и `packages/identity-client/src/crypto/` (B);
- `verdeect-platform/apps/platform/src/shared/**` (P);
- `verdeect-orchestrator/apps/orchestrator/src/shared/**` (O) — эталон большинства модулей.

Тесты — `test/{unit,integration,http,timing}/**` и `test/support/**` тех же репозиториев. Для каждого модуля файл-эталон указан в `inventory.md` §1, столбец «Эталон».

**Образцы** пакета, CI, выпуска и подпути `testing`: `/home/administrator/projects/verdeect2/verdeect-platform-client` и `verdeect-auth`.

## Архитектурные заметки

- Точки входа (`exports`): по одной на подпуть, `src/<подпуть>/index.ts` с явным списком реэкспортов. Корня `.` нет.
- `./testing` объявлен с условиями `{types, development}` без `default`. В production-сборке сервиса он не разрешается (NFR-4).
- CLI `verdeect-kit` — поле `bin`, `src/cli/`.
- Внутренние модули без точки входа (`src/internal/`) — общие функции нескольких подпутей. Например, распознавание ошибок pg по форме (`isUniqueViolation`, `isPoolTimeout`): `/database` их реэкспортирует, фильтр `/http` использует напрямую, без зависимости от `pg`. Ещё один пример — проверка формата имени сервиса.
- Направление зависимостей между подпутями задано в `.ai-factory/ARCHITECTURE.md`. `testing` рабочий код не импортирует.
- Слоёв сервиса из `nestjs-specialist` (modules, use-cases, repositories, `*-service/`) здесь нет. Действуют его общие правила: ESM с суффиксом `.js`, именование, стиль, Vitest, ID критериев в именах тестов. Так же сделано в `verdeect-platform-client`.
- Привязки к схеме сервиса нет: имя схемы и папку миграций передаёт сервис (NFR-2, N2).

## Архитектура

Подробные правила — `.ai-factory/ARCHITECTURE.md`.
Паттерн: Layered Architecture (библиотека «подпути по слоям»)

## Нефункциональные требования

- **Безопасность (NFR-4):**
  - значения окружения, секреты, ПДн, ключи Redis и параметры SQL не попадают в логи, события GlitchTip, ответы HTTP и тексты ошибок;
  - `/testing` не попадает в production;
  - публикация — только из CI без токенов.
- **Без привязки к сервису (NFR-2):** имён схем и таблиц сервисов в `src/**` нет. Проверка — lint, AC-9.4.
- **Наблюдаемость самого пакета (NFR-8):** у каждой фоновой операции (relay, подписчик, очистка, лимитер) есть метрика и лог с `service` и `replica`. `console.*` запрещён.
- **Версии (G14, NFR-5):**
  - semver, поддерживается только последний мажор;
  - мажор — удаление или смена смысла экспорта, новая обязательная переменная `envBase`, новое правило `assertRepoConventions`, мажорная смена образа `TEST_IMAGES`, повышение минимума peer на мажор, смена драйвера AMQP;
  - CHANGELOG (Keep a Changelog) с разделом «Как перейти» на каждый мажор;
  - таблица совместимости README: `kit` ↔ `@verdeect/events` ↔ `@verdeect/auth` ↔ `@verdeect/platform-client`.
- **Скорость тестов (NFR-7, ориентир):** U < 30 с; контейнеры уровня I стартуют раз на прогон, воркеры изолированы; `make ci` — < 10 мин.
- **Языки (NFR-9):** тексты для людей (ошибки HTTP, отказ запуска, README, комментарии) — по-русски. Идентификаторы, коды и имена метрик — по-английски.
- **Логи:** `nestjs-pino`, JSON. Для HTTP — stdout, для CLI — stderr. Уровень — `LOG_LEVEL`.
