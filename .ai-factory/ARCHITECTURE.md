# Архитектура: Layered Architecture (библиотека «подпути по слоям»)

## Обзор

`@verdeect/kit` — библиотека инфраструктуры, а не сервис. Своих модулей домена, таблиц, HTTP-сервера и процесса у неё нет. Поэтому выбран самый простой паттерн, как в `verdeect-platform-client` и `verdeect-auth`, — **слоистая архитектура**. Слои совпадают с подпутями пакета (`exports`, G1). Внизу `config` и внутренние функции `internal`, над ними `observability`, затем `http` и `database`, выше — `idempotency`, `messaging`, `redis`. Сбоку стоят `crypto` (зависит только от низа) и `testing` с CLI: им можно импортировать всех, а их не импортирует никто. Зависимости направлены только вниз.

Внутри подпути — файлы одного слоя, а не отдельные слои. Портов и абстракций с единственной реализацией нет. Nest-модули (`Kit*Module.forRoot`) — тонкая обёртка: они собирают провайдеры из функций и классов того же подпути.

Из `nestjs-specialist` действуют общие правила:
- TypeScript `strict` и `noUncheckedIndexedAccess`;
- ESM с суффиксом `.js`;
- именование (§10);
- стиль, Prettier, ESLint;
- Vitest и `unplugin-swc`;
- ID критериев в именах тестов;
- формат ошибок API `{error: {code, message, details}}`;
- транзакционная тройка «изменение + outbox в одной транзакции» (§5);
- тенант только из контекста, идемпотентность потребителей по `event.id`;
- работа с внешними пакетами через обёртку.

Пакет **реализует** эту инфраструктуру для сервисов (`Db`, `OutboxStore`, inbox, RLS, `nestjs-pino`, `@prometheus-io/client`, Sentry).

**Не действуют** слои сервиса: `modules/`, `*-service/`, `contracts/`, `use-cases/`, `actions/`, `repositories/`, `schema/` домена, `RequestContext` сервиса (пакет даёт только интерфейс `DbContext`, N1), i18n, Docker. Тексты для людей (`message` кодов `kitErrors`, отказы запуска) — константы на русском (NFR-9). Это исключение из запрета «отображаемый текст в коде». Компоненты создаются через `nestjs-code generic <path>` с обоснованием «компонент библиотеки, не сервиса».

## Обоснование выбора

- **Тип проекта:** публичная npm-библиотека. Потребители — Identity, BFF, Platform, Orchestrator, затем Files, Media. Контракт задан PRD `requirements/0000-kit/prd.md` (§3 — API по подпутям, §7 — NFR, §8 — структура).
- **Стек:** TypeScript (ESM, Node ≥ 22.12), NestJS 12, Fastify 5, Drizzle 0.45.4, zod 4. Обязательные и опциональные peer — по NFR-3. Vitest, Testcontainers, pnpm.
- **Ключевой фактор:** граница между слоями — это граница **установки и загрузки**, а не только кода:
  - `/config`, `/observability`, `/http`, `/crypto`, `/redis` импортируются без `pg`;
  - `/messaging` импортируется без `pg`, а требует его только `forRoot` с outbox или inbox (AC-1.2);
  - `/testing` не разрешается без условия `development` (NFR-4);
  - экземпляры Nest, zod, Drizzle, pino и Sentry общие с сервисом, поэтому это peer (G3).

  Нужна жёсткая однонаправленность импортов и контроль загрузки опциональных peer, а не доменная модель.
- **Отвергнуто:**
  - Structured Modules и Explicit Architecture: домена нет, порты для пула, брокера и Redis добавили бы церемонии без второй реализации;
  - отдельные пакеты на подпуть: одна версия и один CHANGELOG — решение G1;
  - корневая точка входа `.`: каждый импорт явно называет подпуть, лишний код не грузится.

## Структура каталогов

Каталоги и файлы появляются в своём этапе (столбец «Этап» в §3.8, §9). Пустые заранее не заводятся. Имена файлов ниже — ориентир плана, при переносе сохраняется разбиение эталона из `inventory.md` §1. Если файл получается меньше ~30 строк, его содержимое остаётся в соседнем.

```
verdeect-kit/
├── src/
│   ├── internal/                      # без точки входа; только node:* и zod
│   │   ├── peer.ts                    #   loadPeer(name, subpath): динамический import() + текст ошибки AC-1.2
│   │   ├── service-name.ts            #   формат ^[a-z][a-z0-9-]{1,31}$ (bootstrapService, createCipher, модули)
│   │   ├── pg-errors.ts               #   isUniqueViolation, isConnectionError, isPoolTimeout — по форме, без pg (эталон I)
│   │   ├── preparsed-env.ts           #   окружение bootstrapService → KitConfigModule без повторного разбора (E3)
│   │   ├── tokens.ts                  #   KIT_METRICS, KIT_LOGGER — токены ядра HTTP (E3)
│   │   ├── ids.ts                     #   ulid, newId (эталон O); реэкспорт — /database
│   │   └── metadata.ts                #   ключи метаданных декораторов (Idempotent → @Api) без цикла http ↔ idempotency
│   ├── config/                        # "./config" — E1 (§3.1); zod, @nestjs/common, @nestjs/config
│   │   ├── index.ts
│   │   ├── fragments.ts               #   envBase, envDatabase, envMessaging, envRedis, envSentry, envCrypto, envServiceUrls
│   │   ├── helpers.ts                 #   port, positiveInt, optionalText, booleanFlag, jsonValue, httpUrl, uniqueBy
│   │   ├── define-env.ts              #   defineEnv, withBaseChecks
│   │   ├── parse-env.ts               #   parseEnv, InvalidEnvironmentError (пути через точку, без значений)
│   │   ├── cli-schemas.ts             #   migrateEnvSchema, prepareEnvSchema
│   │   └── kit-config.module.ts       #   KitConfigModule.forRoot — разбор env при сборке каждого контекста (load)
│   ├── observability/                 # "./observability" — E2 (§3.2); nestjs-pino, pino, @prometheus-io/client, @sentry/nestjs
│   │   ├── redaction.ts               #   SENSITIVE_KEYS, KitRedaction, развёртка на уровни 0–2
│   │   ├── sanitize-error.ts          #   sanitizeError, registerErrorSanitizer (эталон O)
│   │   ├── logger-options.ts          #   createLoggerOptions
│   │   ├── sentry.ts                  #   initSentry, scrubEvent/scrubBreadcrumb, captureError, captureThrottled
│   │   ├── fail-startup.ts            #   failStartup, StartupFailure
│   │   ├── health-registry.ts         #   HealthRegistry
│   │   ├── metrics.ts                 #   kitMetrics (реестр на экземпляр приложения)
│   │   ├── metrics-server.ts          #   MetricsServer: /health, /metrics на node:http
│   │   └── lifecycle.ts               #   KitLifecycle: шаги 1–5, общий срок, сторож
│   ├── http/                          # "./http" — E3 (§3.5); @nestjs/platform-fastify, fastify, @verdeect/auth
│   │   ├── index.ts
│   │   ├── bootstrap-service.ts       #   parseEnv → логгер → createHttpApp → метрики (шаг 5) → listen()
│   │   ├── create-http-app.ts         #   Fastify, заголовки безопасности API, traceId, участники http (2) и nest (3)
│   │   ├── kit-http-core.module.ts    #   внутренний глобальный модуль: логгер, HealthRegistry, KitLifecycle, метрики, фильтр, /ok
│   │   ├── errors.ts                  #   kitErrors, defineErrors, DomainError
│   │   ├── zod-validation.pipe.ts
│   │   ├── kit-exception.filter.ts    #   эталон O
│   │   ├── pagination.ts              #   keyset (эталон I)
│   │   └── api/                       #   api.decorator.ts (@Api), openapi-document.ts (OpenAPI 3.1, z.toJSONSchema)
│   ├── database/                      # "./database" — E4 (§3.3); pg: requirePeer при загрузке, import() при вызове; drizzle-orm
│   │   ├── kit-database.module.ts     #   пулы основной и чтения, DRIZZLE, DRIZZLE_READ, пробы, шаг 4
│   │   ├── db.ts                      #   Db.transaction/read/readGlobal/afterCommit/setLocal (эталон O)
│   │   ├── tenant.ts                  #   tenantColumn, tenantPolicy, DbContext
│   │   ├── prepare-database.ts        #   роли <svc>_owner/_app/_directory, схема (эталон O)
│   │   ├── migrations.ts              #   runMigrations, журнал <schema>.__migrations
│   │   ├── run-exclusive.ts · batches.ts · if-newer.ts
│   ├── idempotency/                   # "./idempotency" — E4 (§3.3а); pg: requirePeer при загрузке
│   │   ├── table.ts · kit-idempotency.module.ts · idempotent.decorator.ts · idempotency.interceptor.ts
│   ├── messaging/                     # "./messaging" — E5 (§3.4); amqplib + amqp-connection-manager через loadPeer
│   │   ├── define-event.ts · envelope.ts · tables.ts
│   │   ├── outbox-store.ts · outbox-relay.ts     # эталон O
│   │   ├── rabbit-connection.ts       #   RabbitConnection, ManagedChannel (эталон O)
│   │   ├── subscriber.ts · topology.ts · inbox.ts · cleanup.ts
│   │   └── kit-messaging.module.ts    #   pg — динамически только при outbox или dedupe: 'inbox'
│   ├── crypto/                        # "./crypto" — E7 (§3.6); только node:crypto
│   │   └── cipher.ts                  #   createCipher, DecryptError, generateSecret (эталон B + HKDF из O)
│   ├── redis/                         # "./redis" — E8 (§3.7); ioredis через loadPeer
│   │   ├── kit-redis.module.ts · rate-limiter.ts (эталон I)
│   ├── testing/                       # "./testing" — только условие development; testcontainers, vitest через loadPeer
│   │   ├── images.ts                  #   TEST_IMAGES
│   │   ├── start-test-stack.ts        #   startTestStack (растёт E1 → E4 → E5 → E8)
│   │   ├── tcp-proxy.ts · timing-guard.ts · timeout-scale.ts · worker-scope.ts (E4)
│   │   ├── repo-files.ts              #   поиск и разбор compose, env_file, CI, Dockerfile, package.json, redaction.ts
│   │   ├── repo-conventions.ts        #   assertRepoConventions — все правила с E1
│   │   ├── create-test-app.ts         #   createTestApp — @nestjs/testing через loadPeer при вызове (E3)
│   │   ├── expect-problem.ts · expect-matches-api.ts   # E3; ajv — только здесь
│   │   └── …                          #   assertStrictTenantIsolation, expectOutbox — по этапам
│   └── cli/                           # bin verdeect-kit
│       ├── main.ts                    #   разбор команды → динамический import() обработчика
│       └── commands/                  #   openapi.ts (E3); db.ts, rabbitmq.ts, crypto.ts, redis.ts — по этапам
├── test/
│   ├── unit/<подпуть>/                # U: без сети и Docker
│   ├── integration/<подпуть>/         # I: Testcontainers через собственный startTestStack
│   │   └── global-setup.ts
│   ├── timing/<подпуть>/              # T: timingGuard, тихая машина
│   ├── fixtures/                      # репозитории-фикстуры для assertRepoConventions (AC-1.8), нарушение lint (AC-9.4)
│   ├── package/                       # R: состав архива, exports, publint/attw, README/CHANGELOG (AC-9.3)
│   └── consumer/                      # C: проект-потребитель NestJS на упакованном архиве (AC-9.1)
├── alerts/verdeect-kit.rules.yml      # шаблон vmalert (E2), входит в архив
├── docs/                              # releasing.md, testing.md, deployment.md
├── scripts/publish.mjs                # тег = version, версии нет в npm (AC-1.10)
├── .github/workflows/ci.yml           # lint ∥ test → timing ∥ package → publish (тег v*)
├── package.json                       # exports подпутей, bin, files: dist, alerts, README, CHANGELOG
├── tsconfig.json / tsconfig.build.json
├── vitest.config.ts / vitest.integration.config.ts / vitest.timing.config.ts / vitest.package.config.ts
├── eslint.config.js / .prettierrc.json
├── Makefile                           # install, lint, analyse, build, pack-check, test-package, test, test-module,
│                                      # test-integration, test-timing, test-load, test-full, ci, clean
└── README.md / CHANGELOG.md / requirements/ / .ai-factory/ / AGENTS.md
```

## Правила зависимостей

```
   ┌──────────────── testing ─────────────────┐   ┌──────── cli ────────┐
   │ (может импортировать любой подпуть)      │   │ динамически по      │
   └──────────────────────────────────────────┘   │ команде             │
                                                  └─────────────────────┘
   ┌────────────┐  ┌──────────────┐  ┌────────┐
   │ messaging  │  │ idempotency  │  │ redis  │
   └─────┬──────┘  └──────┬───────┘  └───┬────┘
         │ type-only      │              │
         ▼                ▼              ▼
   ┌────────────┐  ┌────────────────────────┐
   │ database   │  │ http                   │      ┌────────┐
   └─────┬──────┘  └───────────┬────────────┘      │ crypto │
         ▼                     ▼                   └───┬────┘
   ┌──────────────────────────────────────┐            │
   │ observability                        │            │
   └──────────────────┬───────────────────┘            │
                      ▼                                ▼
   ┌──────────────────────────────────────────────────────────┐
   │ config  ·  internal  (zod, node:*)                        │
   └──────────────────────────────────────────────────────────┘
```

| Подпуть | Может импортировать (значения) | Только `import type` | Опциональный peer |
|---|---|---|---|
| `internal` | `node:*`, `zod` | — | — |
| `config` | `internal`, `zod`, `@nestjs/common`, `@nestjs/config` | — | — |
| `observability` | `config`, `internal` | — | — |
| `http` | `observability`, `config`, `internal`, `@verdeect/auth` | — | — (`pg` запрещён, ошибки pg — `internal/pg-errors`) |
| `database` | `observability`, `config`, `internal` | — | `pg` |
| `idempotency` | `database`, `http`, `observability`, `config`, `internal` | — | `pg` |
| `messaging` | `observability`, `config`, `internal` | `database` (`Db`, `DbContext`) | `amqplib`, `amqp-connection-manager`; `pg` — только в `forRoot` |
| `crypto` | `config`, `internal`, `node:crypto` | — | — |
| `redis` | `http` (`DomainError`), `observability`, `config`, `internal` | — | `ioredis` |
| `testing` | любой подпуть; `yaml`, `semver`, `shell-quote`, `ajv` (только `testing`) | — | `testcontainers`, `vitest`, `@nestjs/testing` |
| `cli` | любой подпуть или внутренний модуль пакета (`http/api/openapi-document`) через динамический `import()` в обработчике команды | — | по команде |

- ✅ Проверка опционального peer — синхронная, при загрузке модуля подпути: `requirePeer('<lib>', '<подпуть>')` (`src/internal/peer.ts`, `createRequire(import.meta.url).resolve` с текстом AC-1.2). Ошибка возникает при импорте подпути, а не при первом вызове.
- ✅ Сам peer грузится динамическим `import()` при вызове (мемоизированный загрузчик подпути, например `loadPg()`, `loadDrizzle()` в `src/database/pg.ts`). Top-level await в статическом графе подпути нет: `drizzle-kit` загружает схему сервиса (фабрики `/database`, `/idempotency`) через `require`, а `require` ESM с top-level await падает `ERR_REQUIRE_ASYNC_MODULE` (П15, план E4). Статический импорт значения peer запрещён: в ESM отсутствующий пакет падает ещё при связывании, до любого кода, и потребитель видит `ERR_MODULE_NOT_FOUND` вместо текста AC-1.2. Модули E1–E3 с top-level `await loadPeer` (`src/testing/start-test-stack.ts`) не переделываются: `/testing` не загружается через `require`. Исключение — `@nestjs/testing`: он грузится `loadPeer` внутри `createTestApp`, поэтому `/testing` импортируется и без него (PRD v1.13 NFR-3).
- ✅ `import type` из опционального peer допустим, если тип не выходит в публичный `.d.ts` подпути, который должен грузиться без этого peer.
- ✅ `messaging` получает `Db` экземпляром через DI от `KitDatabaseModule`, а не импортом значения. Чистые функции, нужные обоим (`newId`, распознавание ошибок), лежат в `internal`.
- ✅ `@Idempotent` пишет метаданные по ключу из `internal/metadata.ts`, `@Api` их читает. Так `http` не импортирует `idempotency`.
- ✅ Тесты могут импортировать любой подпуть, включая `testing`. Внутри своего подпути — через относительные пути, между подпутями — через `../<подпуть>/index.js`.
- ❌ Импорт вверх или вбок вне таблицы: `config` → `observability`, `http` → `database`/`idempotency`, `database` → `http`, `crypto` → Nest-модулей.
- ❌ Статический `import` значений из `pg`, `ioredis`, `amqplib`, `amqp-connection-manager`, `testcontainers`, `vitest` где-либо в `src/` (peer — только `requirePeer` + `import()` или `loadPeer`).
- ❌ Импорт `testing` из любого другого подпути. `default` у `./testing` в `exports`.
- ❌ Импорт по имени собственного пакета (`@verdeect/kit/...`) внутри `src/` — только относительные пути с `.js`.
- ❌ Перенос peer из NFR-3 в `dependencies` или смена «обязательный ↔ опциональный» без требования.
- ❌ Имена схем и таблиц сервисов, `pgSchema('<литерал>')`, строки `<svc>.<имя>` для известных сервисов в `src/**` (NFR-2, AC-9.4).

Правила проверяют:
- lint: `no-restricted-imports` по таблице, `no-console`, `no-restricted-syntax` AC-9.4;
- U-тест AC-1.2 — импорт каждого подпути без каждого опционального peer;
- `test/package` — в `dist/**`, кроме `dist/testing`, нет импорта `testing`; `./testing` без `development` не разрешается.

## Взаимодействие слоёв

- **Публичная поверхность** подпути — его `index.ts` с явным `export { … }` / `export type`. Чего нет в §3 PRD, того нет и в `index.ts`. Тип из следующего этапа отсутствует, заглушки не делаются (§3.8).
- **Сервис → пакет при запуске:**
  1. `instrument.ts` (`node --import`) вызывает `initSentry({service, redaction})`.
  2. `main.ts` вызывает `bootstrapService({module, service, env, redaction})`.
  3. Окружение разбирается `parseEnv` до создания приложения и передаётся в `KitConfigModule` того же процесса без повторного разбора.
  4. Отказ на любом шаге — `failStartup`.
- **Конфигурация → модули пакета:** модули читают ключи через типы `KitBaseEnv`, `KitDatabaseEnv` и т. д. Своих `process.env` в модулях нет, кроме `initSentry` (он работает до Nest) и CLI (свои схемы).
- **Жизненный цикл:** каждый ресурс регистрируется в `KitLifecycle` на своём шаге:
  - шаг 2 — HTTP-сервер (`/http`, участник `http`: `server.close()` Fastify) и участники сервиса (потоки SSE) — параллельно;
  - шаг 3 — участник `nest` (исходный `app.close()` Nest: `onModuleDestroy` → `beforeApplicationShutdown` → адаптер → `onApplicationShutdown`), подписчики, relay, очистки;
  - шаг 4 — пулы БД, RabbitMQ, Redis;
  - шаг 5 — `MetricsServer`.
  - `app.close()` экземпляра = `lifecycle.close()` (программная остановка без сторожа и `exit`); сигналы ОС ловит только `KitLifecycle.listen()` из `bootstrapService`, `enableShutdownHooks()` не вызывается.
  - Правило для модулей kit E4–E8: закрытие в `beforeApplicationShutdown` — шаг 3, в `onApplicationShutdown` — шаг 4; оба вызываются внутри участника `nest`.

  Общий срок и сторож — в `observability`. Подпути не вызывают `process.exit` сами.
- **Здоровье и метрики:** подпути регистрируют пробы в `HealthRegistry` (БД — критичная, Redis — некритичная) и пишут метрики через реестр `kitMetrics` экземпляра приложения. Глобального реестра `@prometheus-io/client` нет.
- **Ошибки:** `observability` даёт `sanitizeError`, `captureError` и `captureThrottled`. `http` переводит исключения в ответ по словарю `kitErrors`. Подпути выше `http` (`idempotency`, `redis`) бросают `DomainError` с кодами словаря. Своих HTTP-ответов они не собирают.
- **БД:**
  - сервис передаёт `DbContext` в `Db.transaction`/`Db.read`; тенант ставится одним `set_config('app.tenant')`;
  - `OutboxStore.add(tx, …)` пишет в той же транзакции и регистрирует `afterCommit(() => relay.wake())`;
  - идемпотентность хранится через `Db` под RLS.
- **Сообщения:** relay и подписчик работают через `RabbitConnection`/`ManagedChannel`. Exchange `verdeect.events` проверяется пассивно. Топологию очередей объявляет подписчик, права выдаёт `definitions.json` из CLI.
- **Testing → пакет:**
  - `startTestStack` поднимает контейнеры `TEST_IMAGES` раз на прогон, вызывает `prepareDatabase` и `runMigrations` пакета и передаёт адреса через `provide`;
  - `createTestApp` использует тот же `createHttpApp`.

  Тестовый контур повторяет production-путь, а не подделывает его.
- **CLI:** `main.ts` разбирает команду и динамически импортирует только её обработчик. `crypto generate-secret` работает без `pg`, `ioredis` и `amqplib`. Результат — JSON в stdout, ошибка — JSON и выход 1.
- **Сборка и загрузка:** `exports` — по записи на подпуть (`types` + `default`). У `./testing` записи `types` + `development` без `default`. Поле `bin` → `dist/cli/main.js` — с первой CLI-командой (E3); в E1 его нет. Архив: `dist`, `alerts`, `README.md`, `CHANGELOG.md`, без `src`, спеков и карт.

## Ключевые принципы

1. **P0 — один способ.** Опция — только для различия по роли сервиса, названного в PRD: BFF — `trustTraceparent: false`, `dedupe: 'none'`, свой фильтр; Identity — `tenantNullable`; P и O — `quietRoutes`. Режимов совместимости, псевдонимов ключей и чтения старых форматов нет.
2. **Перенос, а не написание.** Каждый модуль переносится из эталона `inventory.md` §1 вместе с его тестами. В шапке файла указаны эталон и что взято из других копий. Отличие от эталона — только по решению PRD.
3. **Загрузка без лишних peer.** Подпуть грузится, если установлены его peer. Опциональный peer — синхронная проверка `requirePeer` при загрузке модуля и `import()` при вызове (или `loadPeer` внутри функции), с понятным текстом ошибки (AC-1.2).
4. **Безопасность по построению.** Один объект `KitRedaction` на сервис для логов и GlitchTip. `SENSITIVE_KEYS` не отключается. Значения окружения, секреты, ПДн, ключи Redis и параметры SQL не попадают в логи, события, ответы и тексты ошибок (NFR-4).
5. **Строгий RLS.** Тенант — только из `DbContext`. `Db.read` без тенанта — ошибка. Роль приложения — `NOBYPASSRLS`, не владелец схемы. Исключение строгой модели одно — `outbox` (пустой тенант видит все строки для relay и очистки).
6. **Атомарность и доставка.** Данные и событие пишутся в одной транзакции. Relay публикует с подтверждением брокера по `seq`. Подписчик занимает inbox в транзакции обработчика: повтор `id` → `duplicate`. Неразбираемое уходит в DLQ с `x-dlq-reason`.
7. **Остановка в срок.** Все ресурсы закрываются через `KitLifecycle` по шагам в общем сроке `SHUTDOWN_TIMEOUT_MS`. Фоновая пачка дорабатывает, новая не начинается.
8. **Наблюдаемость пакета.** У каждой фоновой операции есть метрика `verdeect_*` с `service` и лог с `service`, `replica` (NFR-8). `console.*` запрещён.
9. **Без привязки к сервису.** Схему, папку миграций, имя сервиса и словарь кодов домена передаёт сервис (NFR-2).
10. **Контракт стабилен.** Изменение публичной поверхности — TSDoc, README и CHANGELOG в том же плане, версия по G14. TSDoc у каждого экспорта — документация для IDE потребителя.

## Организация кода

- **Новый код** следует этому документу. Сейчас репозиторий пуст: код появляется с E1.
- **Порядок по этапам** (§9): E1 — `internal`, `config`, основа `testing`, `test/consumer`, `scripts/publish.mjs`. Дальше E2 `observability` → E3 `http` → E4 `database`, `idempotency` → E5 `messaging`. E7 `crypto` идёт после E2, E8 `redis` — после E3.
- **Внутри этапа:** чистые функции и типы → классы и Nest-модуль → `index.ts` → помощники `testing` этапа → CLI-команда. Тесты U пишутся по ходу, затем I и T, в конце C и R.
- **Компоненты** создаются через `nestjs-code generic <path>`, тесты — через `nestjs-code test <unit|integration> <target>`.

## Примеры кода

### Опциональный peer — через `loadPeer`, не статическим импортом

```ts
// src/internal/peer.ts — загрузка опционального peer с текстом AC-1.2 (prd.md §3, NFR-3)
export async function loadPeer<T>(library: string, subpath: string): Promise<T> {
    try {
        return (await import(library)) as T;
    } catch (error) {
        if (isModuleNotFound(error, library)) {
            throw new Error(
                `@verdeect/kit/${subpath} требует ${library} — добавьте в зависимости сервиса`,
            );
        }
        throw error;
    }
}
```

```ts
// src/database/pg.ts — pg и драйвер Drizzle для /database (prd.md §3.3, AC-1.2; П15)
import type { Pool, PoolConfig } from 'pg'; // ✅ только тип, стирается при сборке
import { requirePeer } from '../internal/peer.js';

requirePeer('pg', 'database'); // ✅ синхронная проверка при загрузке модуля — текст AC-1.2 при импорте подпути

let pg: Promise<typeof import('pg')> | undefined;
export function loadPg(): Promise<typeof import('pg')> {
    pg ??= import('pg'); // ✅ сам peer — динамический import() при вызове
    return pg;
}
// const pg = await loadPeer('pg', 'database'); // ❌ top-level await: drizzle-kit (require) не загрузит схему сервиса
// import pg from 'pg';                         // ❌ ERR_MODULE_NOT_FOUND до любого кода
```

### `messaging` без `pg` до `forRoot`

```ts
// src/messaging/kit-messaging.module.ts — KitMessagingModule (prd.md §3.4, LE-2)
import type { Db } from '../database/index.js'; // ✅ только тип: /messaging грузится без pg
import { newId } from '../internal/ids.js';     // ✅ чистая функция из internal
// import { Db } from '../database/index.js';   // ❌ значение тянет pg при импорте подпути

export class KitMessagingModule {
    static async forRoot(options: KitMessagingOptions): Promise<DynamicModule> {
        const needsDb = options.outbox !== undefined || (options.subscriber?.dedupe ?? 'inbox') === 'inbox';
        if (needsDb) {
            await loadPeer('pg', 'messaging'); // проверка — здесь, до прослушивания порта
        }
        // ...
    }
}
```

### Ошибка без значения, путь через точку

```ts
// src/config/parse-env.ts — parseEnv (prd.md §3.1, AC-1.3; эталон O issueKeys)
export function parseEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv): z.output<S> {
    const result = schema.safeParse(env);
    if (result.success) {
        return result.data;
    }
    const keys = result.error.issues.map((issue) =>
        issue.path.length === 0 ? '(root)' : issue.path.join('.'),
    );
    throw new InvalidEnvironmentError([...new Set(keys)]); // ❌ issue.message и input — не в ошибке
}
```

### Подпуть выше `http` бросает `DomainError`, а не собирает ответ

```ts
// src/redis/rate-limiter.ts — throwRateLimited (prd.md §3.7)
import { DomainError } from '../http/index.js'; // ✅ redis → http разрешено таблицей
// import { HttpException } from '@nestjs/common'; // ❌ ответ собирает KitExceptionFilter

export function throwRateLimited(result: RateLimitResult): never {
    throw new DomainError('RATE_LIMITED', { retryAfterMs: result.retryAfterMs });
}
```

### `testing` закрыт для production

```json
"exports": {
    "./config":        { "types": "./dist/config/index.d.ts",        "default": "./dist/config/index.js" },
    "./observability": { "types": "./dist/observability/index.d.ts", "default": "./dist/observability/index.js" },
    "./testing":       { "types": "./dist/testing/index.d.ts",       "development": "./dist/testing/index.js" },
    "./package.json":  "./package.json"
},
"bin": { "verdeect-kit": "./dist/cli/main.js" }
```

Подпути добавляются в `exports` в своём этапе (E1 — только `./config` и `./testing`).

## Антипаттерны

- ❌ Статический импорт `pg`, `ioredis`, `amqplib`, `amqp-connection-manager`, `testcontainers` или `vitest`. Импорт значения `database` из `messaging`. Импорт `pg` в `http`.
- ❌ Импорт `testing` из рабочего кода. `default` у `./testing`.
- ❌ Опция, режим или псевдоним ради исторического различия сервисов (P0). Чтение старого формата шифра или старого имени ключа окружения.
- ❌ Имя схемы или таблицы сервиса, `pgSchema('identity')`, строка `platform.<имя>` в `src/**`.
- ❌ `console.*`. Значение окружения, секрет, ПДн, ключ Redis или параметр SQL в логе, событии GlitchTip, ответе или тексте ошибки. Отключение `SENSITIVE_KEYS`.
- ❌ Глобальный реестр `@prometheus-io/client`. Метрика пакета без префикса `verdeect_` или без метки `service`. Метрика домена в пакете.
- ❌ `process.exit` вне `failStartup` и сторожа `KitLifecycle`. Закрытие ресурса мимо шагов `KitLifecycle`.
- ❌ Несколько `set_config` на транзакцию. Чтение без тенанта через `Db.read` вместо `readGlobal`. Роли БД в миграциях.
- ❌ Публикация в RabbitMQ мимо outbox. Активное объявление exchange `verdeect.events`. Обработчик, вызванный для повторного `id`.
- ❌ Поле типа или экспорт следующего этапа «на будущее». Заглушки.
- ❌ Код, написанный с нуля вместо переноса эталона. Перенос без тестов эталона.
- ❌ Публичный экспорт без TSDoc, README и записи в CHANGELOG. Версия ниже требования G14.
- ❌ Слои сервиса из `nestjs-specialist` (`modules/`, `use-cases/`, `repositories/`, `shared/`), Dockerfile и compose в репозитории пакета (кроме фикстур `test/fixtures/**`).
- ❌ Правка, смена ветки, `pull` или `fetch` в репозиториях сервисов. Запуск их контуров.
- ❌ Jest, CommonJS, `require()`, source map или `src/` в архиве.
