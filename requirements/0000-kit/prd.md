# PRD: `@verdeect/kit` — общий инфраструктурный пакет сервисов Вердикт 2.0

> Версия 1.10 от 10.11.2026. История: 1.0 — первая редакция; **1.10** — `assertRepoConventions`: перечень поддерживаемых форм команды запуска (вход `main`/`main.{js,mjs,cjs,ts}`, обёртки `exec`, `tini --`, `dumb-init`, `env`, `sh`/`bash -c` с любыми флагами, наследование `ENTRYPOINT`/`CMD` по правилам Docker и Compose, `${VAR:-умолчание}`); запуск через раннер (`pnpm start` и подобные), `gosu`/`su-exec`, подстановка команд, переменная без умолчания, нераспознанный вход `main.*` — нарушение «команда не распознана»; `--import` через `NODE_OPTIONS` не принимается (§3.8, AC-1.8); **1.9** — `assertRepoConventions`: одноразовые задания (`command:` без команды запуска приложения) не проверяются правилами `stop_grace_period` и `--import`, остальные правила к ним применяются (§3.8, AC-1.8); **1.8** — выпуски: промежуточных версий по этапам нет; после E8 — `1.0.0-rc.N` (метка `next`), на них переходят готовые сервисы, ломающие правки допустимы; `1.0.0` — после перехода последнего сервиса (G14, G15, §3.8, §3.9, UC-2, UC-16, AC-1.10, NFR-5, NFR-6, §9, §10); **1.7** — вопросы планирования E1: `@nestjs/config` — обязательный peer (NFR-3; `KitConfigModule` — обёртка над `ConfigModule`); умолчания `NODE_ENV`, `LOG_LEVEL`, `METRICS_PORT` (§3.1, AC-1.5); `assertRepoConventions` — признаки приложения и явный список старых ключей (§3.8, AC-1.8); **1.6** — `/aif-prompts` r1: список мажорных изменений перенесён из журнала решений в G14 и NFR-5; инвентаризация копий — файлом пакета `files/inventory.md` (ссылки §0, NFR-1, §8); бандл skill-context — правила библиотеки kit (§8); **1.5** — `@verdeect/events` выделен в отдельный PRD `kit/events-prd.md` (`requirements/0000-events/` в `verdeect-events`): §3.9 — ссылка, UC-15 и AC-6.x перенесены, этап E6 — вне пакета kit; **1.4 — по `/prd-review` r4**: `createCipher({service, …})` и формат `purpose` (GAP-10); `bootstrapService({env})` — разбор окружения до создания приложения, AC-3.13 (GAP-11); E8 после E3 (CE-11); **1.3 — по `/prd-review` r3**: AC-9.4 — правило lint по AST вместо поиска подстрок (LE-6); `redaction.sensitiveKeys` дополняет базовый список (GAP-8); `--import` проверяется во всех местах команды запуска, `redaction.ts` без импортов приложения (GAP-9); очистка идемпотентности в AC-9.5 (CE-10); косметика §3.2/§9 (CE-9); **1.2 — по `/prd-review` r2**: `initSentry` — в `instrument.ts` через `node --import`, правило в `assertRepoConventions`, AC-3.11 (LE-5); опции роли в `bootstrapService` и общий `KitRedaction`, AC-3.12 (GAP-6); коды 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`; AC-3.10 только `bootstrapService`, AC-5.20 (CE-6); пауза `SHUTDOWN_DRAIN_MS` — в общем сроке, проверка в `withBaseChecks` (CE-7); столбец «Этап» в §3.8, подготовка БД в тестах — E4 (AC-1.9 → AC-4.18, AC-1.13) (CE-8); AC-9.4, AC-9.5 для NFR (GAP-7); **1.1 — по `/prd-review` r1**: подпуть `/idempotency` (LE-1), `pg` у `/messaging` — только для outbox/inbox (LE-2), `bootstrapService` → `/http`, E2 без HTTP (LE-3), префикс Redis воркера `<svc>:w<N>:` (LE-4), все правила `assertRepoConventions` — в E1 (CE-1), секрет шифра — base64url (CE-2), имя сервиса = имя экземпляра, BFF — `bff-app`/`bff-admin` (CE-3), `workerScope` не пишет в таблицы (CE-4), без `DATABASE_READ_URL` (CE-5), признак `tenant` в `defineEvent` (GAP-1), механизм покрытия outbox (GAP-2), AC для API без проверок (GAP-3), `tenantFromBody` (GAP-4), TTL `.retry` из `RABBITMQ_RETRY_SECONDS` (GAP-5), UC в полной форме — 16 сценариев (RD-1), столбец UC и форма Given/When/Then в AC (RD-2). Проработка — чат «`@verdeect/kit`» (префикс KT, журнал `handoffs/kit.md`). Решение о выносе — координатор 09.11 (CO-43): копии инфраструктурного кода уже в четырёх сервисах; вынос до Files, Media и оболочки `app.`.
>
> Репозиторий — `verdeect2/verdeect-kit` (WSL: `/home/administrator/projects/verdeect2/verdeect-kit`), пакет требований `requirements/0000-kit/`. Пакет `@verdeect/events` (`verdeect2/verdeect-events`) — отдельный PRD `kit/events-prd.md`, свой пакет требований `requirements/0000-events/` и свой прогон `/aif-prompts`.
>
> Формат — для AI Factory. Идентификаторы: P, C, O, D, M, H, S, R, T, G (решения — журнал чата), UC, AC, NFR. `[OPEN]`, `[ASSUMPTION]`. Полный текст решений с обоснованием и следствиями для каждого сервиса — `kit/decisions-log.md`, `-2`, `-3`, `-4` проекта Claude; в этом PRD — проверяемая выжимка.
>
> **Источники копий** (только чтение, WSL `/home/administrator/projects/verdeect2/…`): `verdeect-identity/apps/identity/src/shared/**` (I), `verdeect-bff/apps/bff/src/shared/**` и `packages/identity-client/src/crypto/` (B), `verdeect-platform/apps/platform/src/shared/**` (P), `verdeect-orchestrator/apps/orchestrator/src/shared/**` (O); тесты — `test/{unit,integration,http,timing}/**` и `test/support/**` тех же репозиториев. Таблица модулей × сервисов и тестов эквивалентности — `files/inventory.md` этого пакета (в проекте Claude — `kit/inventory.md`; при расхождении с этим PRD действует PRD). **Образец репозитория пакета** (структура, CI, выпуск, подпуть `testing`, `pack:check`) — `verdeect-platform-client` и `verdeect-auth`.

---

## 0. Правило P0 и решения верхнего уровня

| # | Решение |
|---|---|
| **P0** | **Опция в пакете допустима только для различия по роли сервиса** (следует из `01` или назначения сервиса: BFF — граница с браузером, без БД; у Identity — события без компании и таблицы `oidc-provider`; пороги алертов). **Исторические различия устраняются переходом сервисов на один способ, без режимов совместимости** — production не было ни у кого. Каждое отклонение от этого правила в плане реализации — дефект |
| G1 | Один пакет `@verdeect/kit` с подпутями `/config`, `/observability`, `/database`, `/idempotency`, `/messaging`, `/http`, `/crypto`, `/redis`, `/testing`; одна версия. Каталог событий — отдельный пакет `@verdeect/events` (M4). `/idempotency` — отдельный подпуть, потому что механизм стоит на стыке HTTP и БД: сервис без БД (BFF) его не импортирует, `/http` от `pg` не зависит (ревью r1, LE-1) |
| G3 | Экземпляр, тип или глобальное состояние библиотеки пересекает границу пакет ↔ сервис → `peerDependencies`; внутренняя деталь → `dependencies` (§7, NFR-3) |
| G13 | Репозиторий и выпуск — как `@verdeect/platform-client`; интеграционные тесты и проект-потребитель — в CI до публикации |
| G14 | **Выпуски.** Промежуточных версий по этапам нет: E1–E8 копятся в `[Unreleased]` CHANGELOG, проверка каждого этапа — проект-потребитель на упакованном архиве (AC-9.1). После E8 — предварительная версия `1.0.0-rc.1` (вручную, затем `npm trust`), далее `1.0.0-rc.N` по тегу через CI с меткой npm `next`; на `rc` переходят готовые сервисы (§10), ломающие правки между `rc` допустимы без мажора — перешедшие сервисы обновляют точный пин до следующего `rc` в своих планах. **`1.0.0`** (метка `latest`) — после перехода последнего сервиса (Identity); с неё действуют правила ниже, поддерживается только последний мажор (NFR-5). **Мажор:** удаление или переименование экспорта, смена сигнатуры или смысла существующего экспорта, новая обязательная переменная `envBase`, новое правило `assertRepoConventions` (валит сервис, который раньше проходил), мажорная смена образа в `TEST_IMAGES`, повышение минимума peer-зависимости на мажор, смена драйвера AMQP (§11 п. 4). **Минор:** новый подпуть, новые экспорты и опции с безопасным умолчанием. **Патч:** исправления без изменения контракта. Исправления, в том числе безопасности, — только патчем последнего мажора, без бэкпортов |
| G15 | Подпуть — этап (§9); переход готовых сервисов — после E8 на `1.0.0-rc.N`: BFF → Platform → Orchestrator → Identity; Files и Media — после переходов, на `@verdeect/kit 1.0.0` и `@verdeect/events 1.0.0` |

## 1. Цели

1. Один проверенный экземпляр инфраструктурного кода вместо четырёх копий: конфигурация, логи и GlitchTip, здоровье и метрики, запуск и остановка, БД с RLS, outbox/inbox и RabbitMQ, HTTP-каркас и ошибки, шифр секретов, Redis, тестовый контур.
2. Новые сервисы (Files, Media, далее все) получают одинаковое поведение с первого коммита, без копирования.
3. Сквозные правила `01` (§4 инварианты, §7 события, §8 API, §10 данные, §11 эксплуатация) исполняются кодом пакета и проверяются его тестовыми помощниками в каждом сервисе.
4. Готовые сервисы (I, B, P, O) переходят на пакет каждый своим планом, их integration-тесты проходят без изменения поведения, кроме перечисленных в §10 выравниваний.

## 2. Не-цели

| # | Что не входит | Где живёт |
|---|---|---|
| N1 | Доменная логика сервисов, словари их кодов ошибок, `RequestContext` сервиса (пакет даёт интерфейс `DbContext`) | сервис |
| N2 | Привязка к схеме БД сервиса: таблицы домена, `pgSchema`, миграции сервиса, фабрики тестовых данных и сиды | сервис |
| N3 | Проверка JWT, guard'ы аутентификации, тестовый издатель токенов | `@verdeect/auth` (и `/testing` там) |
| N4 | Клиент `authz`, `@RequirePermission`, подписка на `platform.policy.changed` для кэша прав | `@verdeect/platform-client` |
| N5 | UI | `@verdeect/ui` |
| N6 | Таймеры с арендой, журнал внешних отправок `sending → unknown`, запечатанные секреты коннекторов | первый коннектор; в kit — когда понадобится второму |
| N7 | Модули с одним потребителем: `sse-writer` (O), CSRF страниц (I), `request-origin` (B), `RedisBus` (O), `password-hasher` (I), `trace-context` (B), `instance-shutdown` (O), `autocommit` (I) | сервис-владелец; пересмотр — по правилу выноса (≥ 2 потребителя) |
| N8 | Клиент S3 | Files/Media; ветка санитайзера S3 — в kit со вторым потребителем (O2) |
| N9 | Режимы совместимости со старыми форматами, псевдонимы старых ключей окружения, чтение значений старых форматов шифра | не делаются (P0) |
| N10 | Каталог событий (определения) | `@verdeect/events` |

## 3. Публичный API по подпутям

Сигнатуры — контракт для плана; точные типы уточняет реализация без изменения смысла. Всё, что не перечислено, — не экспортируется.

### 3.1. `@verdeect/kit/config` (C0–C6)

| Экспорт | Контракт |
|---|---|
| `envBase` | форма zod: `NODE_ENV` (`development`\|`test`\|`production`, умолч. `production`), `LOG_LEVEL` (`fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent`, умолч. `info`), `PORT` (`port()`, умолч. 3000), `METRICS_PORT` (`port()`, умолч. 9100), `REPLICA_ID` (умолч. `hostname()`, `^[A-Za-z0-9._-]{1,128}$`), `SHUTDOWN_TIMEOUT_MS` (умолч. 10 000), `SHUTDOWN_DRAIN_MS` (умолч. 0) |
| `envDatabase` | `DATABASE_URL`, `DB_POOL_MAX` (умолч. 10), `DB_POOL_ACQUIRE_TIMEOUT_MS` (умолч. 5000, мин. 1) |
| `envMessaging` | `RABBITMQ_URL`; `RABBITMQ_RETRY_SECONDS` (умолч. 30, целое ≥ 1) — TTL очереди `<svc>.retry`; в тестах — 1 (GAP-5 ревью r1) |
| `envRedis` | `REDIS_URL` |
| `envSentry` | `SENTRY_DSN?`, `SENTRY_ENVIRONMENT?`, `SENTRY_RELEASE?`, `NODE_ENV` |
| `envCrypto` | `ENCRYPTION_KEYS` (JSON `[{version, secret}]`, §3.6) |
| `envServiceUrls(required: string[])` | `SERVICE_URLS` — JSON `{имя: URL}`, перечисленные имена обязательны (единственный фрагмент-функция: список имён — различие по роли) |
| `defineEnv(shape, refine?)` | `withBaseChecks(z.object(shape))` + `superRefine` сервиса; `shape` = распаковка фрагментов + свои ключи; своё умолчание — переопределение ключа |
| `withBaseChecks(schema)` | проверки между ключами пакета: `PORT ≠ METRICS_PORT` (если оба ≠ 0), ошибка с путём `METRICS_PORT`; `SHUTDOWN_DRAIN_MS < SHUTDOWN_TIMEOUT_MS`, ошибка с путём `SHUTDOWN_DRAIN_MS` |
| `parseEnv(schema, env)` | результат или `InvalidEnvironmentError {code: 'INVALID_ENVIRONMENT', keys: string[]}`; путь ключа — полный, через точку (`SERVICE_URLS.files`, `NODES.2.host`), без пути — `(root)`; значения в ошибке — никогда |
| `migrateEnvSchema`, `prepareEnvSchema` | схемы CLI пакета: `DATABASE_MIGRATOR_URL`, `LOG_LEVEL`; `DATABASE_ADMIN_URL`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` |
| помощники | `port()`, `positiveInt()`, `optionalText()`, `booleanFlag()`, `jsonValue(schema)`, `httpUrl()`, `uniqueBy(key)` |
| `KitConfigModule.forRoot({schema})` | обёртка над `ConfigModule` из `@nestjs/config` (сервис внедряет `ConfigService`); асинхронный, `ignoreEnvFile`, окружение перечитывается при каждой сборке контекста Nest; при запуске через `bootstrapService` получает уже разобранное окружение и не разбирает его повторно; сам разбирает — в CLI сервиса и тестах без `bootstrapService` |
| типы `KitBaseEnv`, `KitDatabaseEnv`, `KitMessagingEnv`, `KitRedisEnv`, `KitCryptoEnv` | модули пакета читают ключи через них; несовместимое переопределение ключа ловит компилятор |

Ключи, которые определяет пакет, называются одинаково во всех сервисах; переименование — без псевдонима (C0).

### 3.2. `@verdeect/kit/observability` (O1–O6)

| Экспорт | Контракт |
|---|---|
| `type KitRedaction` | `{sensitiveKeys?: string[], maskPath?: (path) => string}` (`maskPath` — умолч. без изменений, общая для пути в логе доступа и в GlitchTip) — один объект на сервис (константа `src/redaction.ts`); `sensitiveKeys` **добавляются** к `SENSITIVE_KEYS` (объединение без дублей), базовый список не отключается ни опцией, ни пустым массивом (GAP-8 ревью r3); `src/redaction.ts` загружается в `instrument.ts` до Sentry, поэтому не импортирует ничего, кроме типов из `@verdeect/kit/observability` (проверка — `assertRepoConventions`; GAP-9 ревью r3); передаётся и в `createLoggerOptions`/`bootstrapService`, и в `initSentry`: список имён и маскирование пути для логов и GlitchTip совпадают по построению (O1, O3; GAP-6 ревью r2) |
| `createLoggerOptions({service, entry: 'http'\|'cli', trustTraceparent?, quietRoutes?, extraBase?, redaction?})` | опции `nestjs-pino`: HTTP — stdout, CLI — stderr; `base: {service, entry, replica}`; `genReqId` из `traceparent` (`trustTraceparent: false` — новый trace-id, роль BFF); `traceId` в `customProps`; `/ok` вне журнала доступа; `quietRoutes` — `debug` без ошибки; сериализаторы `err` (через `sanitizeError`) и `req` (путь без query, `maskPath`) |
| `SENSITIVE_KEYS` | базовый список: заголовки `authorization`, `cookie`, `set-cookie`, `idempotency-key`; `password`, `newPassword`, `currentPassword`, `secret`, `clientSecret`, `token`, `access_token`, `refresh_token`, `id_token`, `logout_token`, `accessToken`, `code_verifier`, `nonce`; ПДн `email`, `givenName`, `familyName`, `middleName`; `body.code`, `body.state`. Каждое имя разворачивается на уровни 0–2 (`k`, `*.k`, `*.*.k`). `err.code` не скрывается |
| `sanitizeError(err)`, `registerErrorSanitizer(match, sanitize)` | цепочка `cause` до 10 уровней; встроенные ветки по форме объекта (без импорта библиотек): PostgreSQL/Drizzle (остаются `code`, `constraint`, `table`, `column`, `severity`; сообщение «Failed query» + code), ioredis (`name`, `code`, имя команды; без `args`); регистрация — глобально, один раз на процесс |
| `initSentry({service, redaction?})` | вызывается в `instrument.ts` сервиса, файл подключается `node --import` до загрузки приложения (интеграции `@sentry/nestjs` требуют ранней инициализации; LE-5 ревью r2); включается только при непустом `SENTRY_DSN` **и** `NODE_ENV = production`; `dataCollection: NO_PERSONAL_DATA`, `tracesSampleRate: 0`; разбирает `envSentry` и не падает (неверное значение — Sentry выключен); `scrubEvent`/`scrubBreadcrumb`: query удаляется целиком (и из `request.url`), `request.data` удаляется, `user` → только `id`, `extra`/`contexts`/breadcrumbs — по именам, хвост `params:` Drizzle и `Key (…)=(…)` pg вычищаются из текста исключения |
| `captureError(err, ctx)`, `captureThrottled(key, err, {windowMs = 60_000})` | ровно одно событие на ошибку (ошибка помечается отправленной); всплеск однотипной — одно событие за окно на экземпляр |
| `HealthRegistry` | `register(name, probe, {critical})`; срок пробы 2 с; критичная down → 503 `unavailable`, некритичная → 200 `degraded`; формат `{status, checks}`; с начала остановки — 503 |
| `MetricsServer` | `/health` и `/metrics` на `METRICS_PORT`, `node:http` вне Nest; закрывается последним |
| `kitMetrics` | реестр на экземпляр приложения, `setDefaultLabels({service})`, метрики процесса Node; `verdeect_outbox_pending`, `verdeect_outbox_lag_seconds`, `verdeect_events_consumed_total{type, result: handled\|duplicate\|retry\|dlq}`, `verdeect_db_pool_wait_timeouts_total{pool}`, `verdeect_rate_limit_unavailable_total`; метрики домена — префикс `<service>_` |
| `alertRulesTemplate` (файл `alerts/verdeect-kit.rules.yml` в пакете) | правила vmalert для метрик пакета: порог по умолчанию + переопределение по `service` |
| `failStartup(raw, logger)` | `fatal`-лог, событие GlitchTip с `flush` 2 с, `exit(1)`; `InvalidEnvironmentError` — код и имена ключей; ошибки сервиса — интерфейс `StartupFailure {startupCode; startupDetails()}` |
| `KitLifecycle` | механизм участников остановки: `register(participant, {step: 2 \| 3 \| 4 \| 5})`; порядок: (1) сигнал → `/health` 503, флаг «останавливаемся»; пауза `SHUTDOWN_DRAIN_MS`; (2) приём новых соединений прекращается, начатые дорабатывают (участник — HTTP-сервер из `/http`; потоки SSE закрывает хук сервиса `onStopAccepting`); (3) `beforeApplicationShutdown`: подписчики, relay, очистка; (4) `onApplicationShutdown`: пулы БД, RabbitMQ, Redis; (5) сервер метрик. Пауза `SHUTDOWN_DRAIN_MS` и шаги 2–5 — в общем сроке `SHUTDOWN_TIMEOUT_MS`, отсчёт от сигнала (CE-7 ревью r2); сторож: срок вышел → `error`-лог, событие GlitchTip с ожиданием, `exit(1)`. `bootstrapService` — в `/http` (§3.5; LE-3 ревью r1) |

### 3.3. `@verdeect/kit/database` (D1–D5, M5)

| Экспорт | Контракт |
|---|---|
| `KitDatabaseModule.forRoot({schema})` | пулы: основной и чтения — оба на `DATABASE_URL` (отдельного адреса чтения нет до профиля, который его требует, C2); у пула чтения `default_transaction_read_only=on`, `statement_timeout` 5 с; `max = DB_POOL_MAX`, `connectionTimeoutMillis = DB_POOL_ACQUIRE_TIMEOUT_MS`; токены `DRIZZLE`, `DRIZZLE_READ`; пробы здоровья обоих пулов (критичные); закрытие — шаг 4 |
| `interface DbContext` | `{tenant: string \| null; traceId: string; actor: {clientId?, accountId?, memberId?, onBehalfOf?, channel}}` — поля `actor` конверта `01` §7.1 |
| `Db.transaction(ctx, fn)` | выделенный клиент основного пула: `BEGIN` → `set_config('app.tenant', tenant ?? '', true)` → `fn(tx)` → `COMMIT`; клиент возвращается в пул при обрыве до `BEGIN` (`withPoolClient`) |
| `Db.read(ctx, fn)` | то же, `read only`; без тенанта — ошибка `TenantRequiredError` |
| `Db.readGlobal(fn)` | read-пул без транзакции и `set_config` |
| `Db.afterCommit(tx, task)` | задача после `COMMIT`; в read-only транзакции — ошибка `AfterCommitInReadOnlyError`; README: только для того, что можно потерять |
| `Db.setLocal(tx, name, value)` | имя `^app\.[a-z_]{1,48}$`, значение параметром |
| `tenantColumn()`, `tenantPolicy(column)` | колонка тенанта и `pgPolicy` строгой модели: `tenant = current_setting('app.tenant', true)`; SQL генерирует `drizzle-kit`; `FORCE ROW LEVEL SECURITY` — SQL-миграцией сервиса |
| `prepareDatabase({service, adminUrl, ownerPassword, appPassword})` | идемпотентно: схема `<svc>`, роли `<svc>_owner` (LOGIN, владелец схемы), `<svc>_app` (LOGIN, `NOBYPASSRLS`), `<svc>_directory` (NOLOGIN, `BYPASSRLS`, владелец функций `SECURITY DEFINER`); роли не создаются в миграциях |
| `runMigrations({url, folder, schema})` | журнал — `<schema>.__migrations`; папка — явно от сервиса |
| CLI `verdeect-kit db prepare`, `verdeect-kit db migrate --folder <путь> --schema <svc>`, `verdeect-kit db move-journal --from drizzle --to <svc>` | разбирают только свои ключи (`prepareEnvSchema`, `migrateEnvSchema`); результат — JSON в stdout, ошибка — JSON и выход 1 |
| `newId(prefix)`, `ulid(now?)` | ULID с префиксом `^[a-z]{2,5}$`, `<prefix>_<ulid>`; без монотонности внутри миллисекунды; реестр префиксов — таблица README |
| `isUniqueViolation(err, constraint?)`, `isConnectionError(err)`, `isPoolTimeout(err)` | обход `cause`, распознавание по форме, без импорта `pg`; реализованы во внутреннем модуле пакета (не подпуть), `/database` их реэкспортирует, фильтр `/http` использует напрямую |
| `deleteInBatches({db, sql, batchSize, maxBatches, shouldContinue})` | пачки; `Db` отслеживает идущие пачки для остановки |
| `runExclusive(db, key, fn)` | `pg_try_advisory_lock` на выделенном соединении; не взят — `{ran: false}` без ожидания; освобождение в `finally` |
| `occurredAtColumn(name)`, `ifNewer(column, occurredAt)` | условие `column IS NULL OR column < $occurredAt`; `updated: 0` — нормальный итог |
| метрика | `verdeect_db_pool_wait_timeouts_total{pool}`; срок пула — `captureThrottled` |

### 3.3а. `@verdeect/kit/idempotency` (H2; этап E4; требует `pg`)

| Экспорт | Контракт |
|---|---|
| `createIdempotencyTable(pgSchema)` | таблица под RLS с политикой `tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')` (запись компании — только под ней, без компании — только без тенанта) |
| `KitIdempotencyModule.forRoot({table})` | хранилище на `Db` (§3.3), очистка записей старше 24 ч через `runExclusive` |
| `@Idempotent({required?, tenantFromBody?: string})` + интерсептор | повтор с тем же ключом и телом — сохранённый ответ (статус, тело, `Location`) + `Idempotent-Replayed: true`; другое тело — 422 `IDEMPOTENCY_KEY_REUSED`; первый ещё идёт — 409 `IDEMPOTENCY_IN_PROGRESS`; обязателен и нет — 400 `IDEMPOTENCY_KEY_REQUIRED`; область — пользователь/агент → (`tenant`, `sub`), сервис → `client_id`, а при `tenantFromBody` (путь поля через точку) и непустом поле — (`client_id`, значение поля); поле отсутствует или пустое — только `client_id`, без ошибки; для пользователя и агента опция игнорируется (тенант — из токена; GAP-4 ревью r1); отпечаток — метод + путь + SHA-256 канонического JSON тела; брошенная `in_progress` переиспользуется через 5 мин; коды — из словаря `/http` |

### 3.4. `@verdeect/kit/messaging` (M1–M5)

| Экспорт | Контракт |
|---|---|
| имя сервиса | `service` в модулях пакета — **имя экземпляра** (`^[a-z][a-z0-9-]{1,31}$`): от него очереди `<svc>`, `<svc>.retry`, `<svc>.dlq`, пользователь RabbitMQ и ACL Redis, префикс `<svc>:`, метка `service`. BFF — два экземпляра `bff-app` и `bff-admin` (`bff/prd.md` D1); пример — README (CE-3 ревью r1) |
| `defineEvent({type, version, subject, tenant: 'required' \| 'none', data})` | определение события; `tenant` — по умолчанию `'required'`; `'none'` — событие без компании (каталог `01` §7.2 называет такие явно); `optional` нет; `data` — zod без `.strict()`; `type` — по каталогу `01` §7.2 (GAP-1 ревью r1) |
| `EnvelopeSchema`, `type Envelope<E>` | конверт `01` §7.1; `tenant: null` — только у событий `'none'` |
| `createOutboxTable(pgSchema, {tenantNullable = false})`, `createInboxTable(pgSchema)` | фабрики схемы Drizzle; SQL — `drizzle-kit`; `outbox` — единственная таблица, где пустой тенант видит все строки (исключение строгой модели) |
| `OutboxStore.add(tx, Event, {subjectId, data})` | проверка `data` до записи (ошибка → откат транзакции); `id = newId('evt')`; `tenant`, `actor`, `traceId` — из `DbContext`; регистрирует `afterCommit(() => relay.wake())`; `'required'` без тенанта в контексте и `'none'` с тенантом — ошибка и откат транзакции |
| `KitMessagingModule.forRoot({service, outbox?: {tenantNullable}, subscriber?: {dedupe: 'inbox'\|'none'}})` | с `outbox` или `dedupe: 'inbox'` требует `pg` (проверка здесь, не при импорте; LE-2 ревью r1); соединение (основа — O `RabbitConnection`/`ManagedChannel`: `topologyReady`, `shutdownDeadline`, `markOpened/isCurrent`, `cancelConsumers`), relay, подписчик, очистка; exchange `verdeect.events` проверяется **пассивно**; событие `'none'` в списке публикуемых при `tenantNullable: false` — отказ запуска |
| relay | пачка ≤ 100 по `seq`, `FOR UPDATE SKIP LOCKED`, подтверждения брокера, срок пачки 5 с, persistent, `messageId = id`, `type`, `timestamp`; первая неудача прерывает пачку; пауза 1 с → 5 мин с удвоением; 5 неудач строки — `error` + GlitchTip; опрос 1000 мс; без соединения/канала БД не опрашивается; метрики `verdeect_outbox_*` |
| `subscriber.on(Event, (event, tx) => …)` | очереди `<svc>` (durable, DLX → `<svc>.retry`), `<svc>.retry` (TTL `RABBITMQ_RETRY_SECONDS`, умолч. 30 с → `<svc>`; очередь, уже объявленная с другим TTL, — отказ запуска с текстом «очередь `<svc>.retry` объявлена с другим TTL — пересоздайте очередь», порядок смены — README), `<svc>.dlq`; 5 повторов по `x-death`; `prefetch` 10; inbox занимается в той же транзакции до обработчика, повтор `id` → `duplicate` без вызова; сразу в DLQ с заголовком `x-dlq-reason` — не JSON, неверный конверт, неподписанный тип, `InvalidMessageError`; `ExpectedMessageError` — `warn` + повтор; `dedupe: 'none'` — без БД и inbox (роль BFF); конверт с `tenant: null` у события `'required'` (или с тенантом у `'none'`) — сразу в DLQ, `x-dlq-reason: tenant` |
| `subscriber.onReplica(Event, handler)` | очередь `<svc>.replica.<REPLICA_ID>` (exclusive, auto-delete, не durable, без inbox и DLQ) |
| очистка | опубликованный outbox и inbox — старше 7 дней; раз в час, пачки по 1000, ≤ 100 пачек, `runExclusive`, остановка по `KitLifecycle` |
| CLI `verdeect-kit rabbitmq definitions --services <svc,…> [--out <файл>]` | `definitions.json`: exchange `verdeect.events` (topic, durable), пользователь на сервис (хеш пароля — из окружения при развёртывании), права: `configure` — `^<svc>(\..*)?$`, `write` — `verdeect.events`, `amq.default` и свои очереди, `read` — `verdeect.events` и свои очереди |
| `ExpectedMessageError`, `InvalidMessageError` | классы ошибок обработчика |

### 3.5. `@verdeect/kit/http` (H1–H4)

| Экспорт | Контракт |
|---|---|
| `createHttpApp({module, service, bodyLimit?, securityHeaders?: 'api'})` | Fastify-приложение Nest: заголовки безопасности API (`nosniff`, `Referrer-Policy: no-referrer`, …), `traceId`, `/ok`, zod-pipe, фильтр ошибок, `ROUTE_NOT_FOUND`; пределы тела маршрутов — `route.bodyLimit` в сервисе; CSP и `no-store` для HTML — сервис (Identity) |
| `bootstrapService({module, service, env: schema, logger?: {trustTraceparent?, quietRoutes?, extraBase?}, http?: {bodyLimit?}, redaction?: KitRedaction})` | точка входа `main.ts`: `parseEnv(env, process.env)` **до создания приложения** (ошибка → `failStartup`, порт не открывается; разобранное окружение передаётся в `KitConfigModule` того же процесса без повторного разбора; GAP-11 ревью r4) → логгер (Sentry уже инициализирован в `instrument.ts`; если нет, а DSN задан и `NODE_ENV = production` — `warn` `SENTRY_NOT_PRELOADED`, запуск продолжается) → `createHttpApp` → регистрация HTTP-сервера участником шага 2 `KitLifecycle` → прослушивание `PORT`; отказ на любом шаге — `failStartup`; `service` вне формата `^[a-z][a-z0-9-]{1,31}$` — отказ запуска; опции по роли сервиса (BFF — `trustTraceparent: false`; P, O — `quietRoutes`; O — `redaction`), умолчания: доверять `traceparent`, тихих маршрутов нет, лимит тела Fastify по умолчанию |
| `kitErrors`, `defineErrors({...kitErrors, …})` | общие коды: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `VALIDATION_FAILED` 422, `BAD_REQUEST` 400, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `ROUTE_NOT_FOUND` 404, `VERSION_CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503, `SERVICE_STOPPING` 503, `PLATFORM_UNAVAILABLE` 503, `IDEMPOTENCY_KEY_REUSED` 422, `IDEMPOTENCY_IN_PROGRESS` 409, `IDEMPOTENCY_KEY_REQUIRED` 400; повтор кода пакета с другим статусом — ошибка компиляции; `message` по-русски, неизвестный код — общий текст |
| `DomainError(code, details?)` | ошибка домена со статусом из словаря |
| `ZodValidationPipe` | ошибка → 422 `VALIDATION_FAILED`, `details.issues: [{path, code}]` (`path` через точку, без значений); неразобранное тело → 400 `BAD_REQUEST`; тело больше лимита → 413 `PAYLOAD_TOO_LARGE`; неподдерживаемый `Content-Type` → 415 `UNSUPPORTED_MEDIA_TYPE` (код однозначно задаёт статус, H1; ревью r2) |
| `KitExceptionFilter` | `DomainError` → свой статус, `warn`, без GlitchTip; тело `{error}` guard'ов `@verdeect/auth` и `@verdeect/platform-client` — без изменений; срок пула БД (в т. ч. в `cause`) → 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1`, метрика, `captureThrottled`; прочее ≥ 500 → 500 `INTERNAL_ERROR`, `error`, GlitchTip ровно раз; текст исходной ошибки, стек, SQL — не в ответе. BFF собирает свой фильтр на `DomainError` и словаре (различие по роли) |
| `PageQuerySchema`, `pageOf(rows, limit, keyOf)`, `afterCursor(cols, cursor, dir)`, `encodeCursor`/`decodeCursor` | keyset: курсор base64url от JSON ключей последней строки, не подписан; `limit` умолч. 100, макс. 200; читается `limit + 1`; последний ключ сортировки — уникальный (проверка помощника); ответ `{items, nextCursor}`; неверный курсор — 422 `VALIDATION_FAILED` `path: cursor`; смещения нет |
| `@Api({summary, response?, envelope?: 'page'\|'items'\|'array', errors?, extra?})`, CLI `verdeect-kit openapi --out contracts/openapi.json` | OpenAPI 3.1 из кода: тело/query/path — из zod pipe, ответ — `response`, ошибки — `defineErrors` + стандартные 400/401/403/422/429, аутентификация — декораторы `@verdeect/auth`, заголовки идемпотентности — `@Idempotent`; JSON Schema — `z.toJSONSchema`; `extra` и `contracts/openapi.extra.json` — для того, что генерация не выражает (SSE, сырой прокси) |

### 3.6. `@verdeect/kit/crypto` (S1)

| Экспорт | Контракт |
|---|---|
| `createCipher({service, keys, purpose})` | `service` — формат и проверка, как у `bootstrapService` (одна внутренняя функция); `purpose` — `^[a-z][a-z0-9-]{1,31}$`; вне формата — ошибка при создании (GAP-10 ревью r4); `keys` — `ENCRYPTION_KEYS` (первый — текущий; `secret` — base64url без `=`, ≥ 32 байт после декодирования; CE-2 ревью r1); ключ шифра — HKDF-SHA256 от секрета версии, `info = verdeect-<svc>:<purpose>` |
| `cipher.encrypt(plaintext, {aad})` | AES-256-GCM, IV 12 случайных байт; значение `v<N>:<iv>:<ct>:<tag>` (base64url, `N` — версия ключа); `aad` обязателен (`<purpose>:<id записи>`) |
| `cipher.decrypt(value, {aad})` | ключ по версии из значения, без перебора; ошибка — `DecryptError {reason: 'format'\|'unknown_version'\|'auth'}` без открытого текста и ключей |
| `cipher.needsReencrypt(value)` | `true`, если версия значения ≠ текущей |
| `generateSecret(bytes = 32)` | base64url |
| CLI `verdeect-kit crypto generate-secret [--bytes 32]` | печатает секрет в том же формате; README — единственный рекомендуемый способ получить секрет |

### 3.7. `@verdeect/kit/redis` (R1)

| Экспорт | Контракт |
|---|---|
| `KitRedisModule.forRoot({service, subscriber?: true})` | `lazyConnect`, `maxRetriesPerRequest: 1`, `commandTimeout: 500`; `keyPrefix: '<svc>:'`; второе соединение для подписки — только по `subscriber: true` (срок команд 5 с, префикс к каналам ставит обёртка); некритичная проба `/health`; закрытие — шаг 4 |
| `RateLimiter.hit(key, {limit, windowMs})`, `.peek(key, …)` | `INCR` + `PEXPIRE` в `MULTI`, `PTTL`; `{allowed, remaining, retryAfterMs}`; Redis недоступен → `allowed: true` + `verdeect_rate_limit_unavailable_total` (+ алерт шаблона) |
| `throwRateLimited(result)` | 429 `RATE_LIMITED` + `Retry-After` |
| CLI `verdeect-kit redis acl --services <svc,…>` | `aclfile`: `user <svc> on ><пароль> ~<svc>:* &<svc>:* +@all -@dangerous` |

### 3.8. `@verdeect/kit/testing` (T1, T2; только по условию `development`)

Столбец «Этап» — когда экспорт или его часть появляется; поле следующего этапа отсутствует в типе, а не заглушено (CE-8 ревью r2); до `1.0.0` тип меняется без правил версий G14.

| Экспорт | Этап | Контракт |
|---|---|---|
| `TEST_IMAGES` | E1 | `postgres:17.11-alpine3.24`, `redis:7.4.11-alpine`, `rabbitmq:4.3.6-management-alpine`, `axllent/mailpit:v1.31.6`, `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` |
| `startTestStack({postgres?, rabbitmq?, redis?, mailpit?, minio?, service, migrations?, outboxEvents?})` | `postgres` (контейнер), `mailpit`, `minio` — E1; подготовка БД и `migrations` — E4; `rabbitmq` + `definitions.json`, `outboxEvents` — E5; `redis` + ACL — E8 | для `globalSetup` Vitest: контейнеры раз на прогон; RabbitMQ — `definitions.json`; Redis — ACL; `prepareDatabase` + миграции (с E4); адреса — `provide`; создаёт каталог прогона для покрытия outbox (путь — `provide`) |
| `workerScope()` | `tenant` — E4; `rabbitmq` — E5; `redisPrefix` — E8 | на воркер возвращает значения изоляции `{tenant, rabbitmq: {vhost, url}, redisPrefix}`: `tenant` — случайный идентификатор тенанта для `DbContext` и тестовых токенов (`[ASSUMPTION]` формат — как `tenant_id` в `01` §5.2, уточняется в плане E4), vhost RabbitMQ с пользователем по правам M3 (удаляется в конце), префикс Redis `<svc>:w<N>:`; **записей в таблицы сервиса не создаёт** — строку компании, если нужна, создаёт фабрика сервиса по `scope.tenant` (N2; CE-4 ревью r1) |
| `createScratchDatabase()` | E4 | пустая мигрированная БД из шаблона (`CREATE DATABASE … TEMPLATE`) |
| `tcpProxy(target)`, `timingGuard`, `TEST_TIMEOUT_SCALE` | E1 | обрывы и задержки; проверки времени |
| `createTestApp({module, overrides?})` | E3 | тот же `createHttpApp`, `inject` Fastify без порта |
| `expectProblem(res, {status, code, issues?})`, `expectMatchesApi(res, route)` | E3 | формат ошибки; соответствие ответа схеме `@Api` |
| `countQueries(pool, fn)` | E4 | число запросов к БД |
| `assertStrictTenantIsolation(db, {schema, except?})` | E4 | по `pg_policies` и `relforcerowsecurity`: каждая таблица с колонкой тенанта под RLS и форсирована; под ролью приложения с пустым тенантом — 0 строк; знает `outbox` и политику идемпотентности |
| `assertAppRoleIsNotOwner(db)` | E4 | роль приложения не владеет схемой и без `BYPASSRLS` |
| `expectOutbox(tx, Event, {subjectId?, data?})`, `assertOutboxCoverage(events)` | E5 | `expectOutbox` проверяет запись события в транзакции и **после успешной проверки** дописывает `<type>.v<version>` в файл своего воркера в каталоге прогона; `teardown` `globalSetup` при `KIT_OUTBOX_COVERAGE=1` (задаётся в `make test-integration` и CI) вызывает `assertOutboxCoverage(outboxEvents)`: объединяет файлы воркеров и падает со списком непокрытых типов; без переменной (частичный прогон) проверка не выполняется (GAP-2 ревью r1) |
| `publishTestEvent(Event, data, opts?)`, `waitForInbox(id, {timeoutMs})` | E5 | конверт `01` §7.1 в exchange; ожидание обработки без `sleep` |
| `assertRepoConventions({root})` | E1 | один тест репозитория сервиса: образы `compose*.yml` и CI = `TEST_IMAGES`; `REPLICA_ID` не задан в compose; `stop_grace_period` > `SHUTDOWN_TIMEOUT_MS`; `PORT` и ключи окружения пакета — по `envBase`, без старых имён — явный список: `IDENTITY_PORT`, `BFF_PORT` → `PORT`; `DATABASE_MIGRATION_URL` → `DATABASE_MIGRATOR_URL`; `SESSION_ENC_KEYS`, `SIGNING_KEY_ENCRYPTION_KEYS`, `CLIENT_SECRET_KEY`, `IDENTITY_SECRETS` → `ENCRYPTION_KEYS` (сообщение называет новое имя; расширение списка после `1.0.0` — мажор, G14); точные версии peer-зависимостей сервиса входят в peer-диапазоны пакета; каждая команда запуска приложения (Dockerfile `CMD`/`ENTRYPOINT`, скрипт `start` в `package.json`, `command:` в `compose*.yml`) содержит `--import` с `instrument` (LE-5 ревью r2, GAP-9 ревью r3); **приложение** для правил `stop_grace_period`, ключей окружения и `--import` — сервис `compose*.yml`, у которого в `environment:` или в файлах `env_file:` есть хотя бы один ключ `envBase`; **команда запуска приложения** — команда `node`, у которой файл входа (первый аргумент после опций `node`) называется `main`, `main.js`, `main.mjs`, `main.cjs` или `main.ts` (в `command:` и `entrypoint:` compose, Dockerfile `CMD`/`ENTRYPOINT`, скрипте `start`); `--import` должен стоять в аргументах этой команды, `NODE_OPTIONS` не учитывается; **поддерживаемые формы команды**: exec- и shell-форма; перед `node` или `sh -c` — обёртки без аргументов `exec`, `tini --`, `dumb-init`, `env` (с `VAR=…`); `sh`/`bash`/`ash`/`dash` с любыми флагами до `-c` (в том числе склеенными: `-ec`, `-eo pipefail`); несколько команд через перевод строки, `;`, `&&`, `||`, `|`, `&`, подоболочку; `${VAR:-умолчание}` раскрывается по умолчанию; итоговая команда собирается по правилам Docker (`ENTRYPOINT` + `CMD`, shell-форма `ENTRYPOINT` отбрасывает `CMD`, наследование от стадии `FROM <стадия>`, продолжение строки `\`) и Compose (`entrypoint:` + `command:`, слияние с базовым файлом, `!reset`); **команда не распознана** — нарушение для сервиса или стадии Dockerfile, если команда содержит: запуск через раннер (`pnpm`/`npm`/`yarn` `start*` или `run start*`, `node --run start*`, `nest start`, `tsx`, `ts-node`, `pm2*`, `nodemon`), обёртку с аргументами (`gosu`, `su-exec`), подстановку команд (`$(…)`, обратные кавычки), `eval`, переменную без умолчания, или `node`, среди аргументов которого есть `main.*`, не распознанный как файл входа (например, `node --max-old-space-size 512 dist/main.js`); сообщение называет форму и требует `node --import ./dist/instrument.js dist/main.js`; инфраструктурные сервисы и подделки вида `*.main.ts` (например, `fake-services.main.ts`) этими правилами не проверяются; **одноразовое задание** — сервис `compose*.yml`, у которого есть `command:` (своя или унаследованная из базового `compose.yml`) без команды запуска приложения (например, `pnpm db:migrate`, `node dist/cli.js migrate`) и без формы «команда не распознана»: правила `stop_grace_period` и `--import` к нему не применяются, правила образов, `REPLICA_ID` и ключей окружения — применяются; сервис без `command:` запускается командой Dockerfile и считается приложением; `src/redaction.ts` импортирует только типы из `@verdeect/kit/observability` |

### 3.9. `@verdeect/events` — отдельный PRD

Определения событий каталога `01` §7.2 — пакет `@verdeect/events`, репозиторий `verdeect-events`, PRD `kit/events-prd.md` (v1.1). Зависимость только `events → kit` (`/messaging`, `peerDependencies` `@verdeect/kit ^1.0.0-rc.1` — диапазон принимает и `rc`, и все `1.x`); выпуски `events` идут тем же порядком: `1.0.0-rc.N` после `@verdeect/kit 1.0.0-rc.1`, `1.0.0` — вместе с `@verdeect/kit 1.0.0`. Владение — `decisions/kit.md` K.2а.

## 4. Сценарии (UC)

Акторы: **разработчик сервиса** (подключает пакет, пишет код и тесты сервиса), **сервис в работе** (процесс сервиса на пакете), **инфраструктура** (развёртывание: compose, CI, production), **CI пакета**, **мейнтейнер** (выпуск версий). Альтернативы ссылаются на AC; новых требований в разделе нет (ревью r1, RD-1).

### UC-1. Новый сервис подключает пакет
| | |
|---|---|
| Актор | Разработчик сервиса |
| Предусловие | Репозиторий сервиса по бандлу 02.11; выпущены нужные версии kit и `@verdeect/events` |
| Основной поток | 1. Ставит `@verdeect/kit` и `@verdeect/events` точными версиями и peer-зависимости своих подпутей. 2. Схема окружения — `defineEnv({...envBase, ...envDatabase, ...envMessaging, …свои})`. 3. `instrument.ts` с `initSentry` подключается `node --import`; `main.ts` — `bootstrapService({module, service, env})` из `/http`. 4. Таблицы компании — `tenantColumn()`/`tenantPolicy()` + `FORCE RLS`; outbox/inbox — фабрики. 5. `db prepare` и `db migrate` из CLI пакета. 6. Тесты — `startTestStack` в `globalSetup`, `assertRepoConventions`, `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner` |
| Альтернативы | А1. Нет опционального peer нужного подпути → ошибка импорта с именем библиотеки (AC-1.2). А2. Ключ пакета переопределён несовместимым типом → ошибка компиляции (AC-1.6). А3. Нет обязательного имени в `SERVICE_URLS` → отказ запуска (AC-1.11). А4. `service` вне формата → отказ запуска (AC-3.10). А5. Таблица компании без политики или без `FORCE` → падает тест изоляции (AC-4.8). А6. Образ в compose не из `TEST_IMAGES`, `REPLICA_ID` в compose, `stop_grace_period` мал → падает `assertRepoConventions` (AC-1.8) |
| Результат | Сервис стартует, проходит общие проверки; своих копий инфраструктуры нет |
| AC | AC-1.1, 1.2, 1.5, 1.6, 1.8, 1.11, 3.10, 4.6, 4.7, 4.8, 9.1, 9.3 |

### UC-2. Готовый сервис переходит на пакет
| | |
|---|---|
| Актор | Разработчик сервиса (чат сервиса) |
| Предусловие | Выпущены `@verdeect/kit 1.0.0-rc.N` (после E8) и `@verdeect/events 1.0.0-rc.N`; план перехода сервиса по §10 |
| Основной поток | 1. Заменяет `shared/**` импортами пакета по подпутям. 2. Выполняет выравнивания своей строки §10. 3. Прогоняет свои integration-тесты. 4. Обновляет ожидания только из §10. 5. Подключает `assertRepoConventions`, `assertStrictTenantIsolation`, `assertOutboxCoverage` |
| Альтернативы | А1. Тест сервиса падает на ожидании, которого нет в §10 → дефект пакета (issue в `verdeect-kit`) или дефект сервиса, решение — в чате kit. А2. `assertOutboxCoverage` находит непокрытое событие → тест дописывается в плане перехода |
| Результат | Сервис на пакете, поведение — прежнее, кроме выравниваний §10 |
| AC | §10 (критерий перехода), AC-1.8, 5.13 |

### UC-3. Неверное окружение при запуске
| | |
|---|---|
| Актор | Сервис в работе |
| Предусловие | `main.ts` вызывает `bootstrapService({env})`; схема — `defineEnv` |
| Основной поток | 1. Процесс стартует. 2. `parseEnv` находит неверный ключ. 3. `failStartup` пишет `fatal`-лог с путями ключей без значений. 4. Отправляет событие GlitchTip и ждёт отправки до 2 с. 5. Выход с кодом 1 |
| Альтернативы | А1. Неверный только `SENTRY_*` → Sentry выключен, запуск продолжается (AC-2.4). А2. GlitchTip недоступен → после 2 с выход 1, лог записан (AC-2.9). А3. Нет опционального peer → ошибка импорта до шага 2 (AC-1.2). А4. `service` вне формата → отказ на шаге 1 (AC-3.10). А5. `PORT = METRICS_PORT` → ошибка с путём `METRICS_PORT` (AC-1.4) |
| Результат | Один понятный отказ без значений секретов; контейнер перезапускает оркестратор |
| AC | AC-1.3, 1.4, 1.7, 2.4, 2.9, 1.2, 3.10, 3.11, 3.13 |

### UC-4. Обработка HTTP-запроса
| | |
|---|---|
| Актор | Сервис в работе |
| Предусловие | Приложение из `createHttpApp`; маршрут с zod-схемой и `@Api` |
| Основной поток | 1. Запрос получает `traceId` (из `traceparent` или новый). 2. Тело проверяется схемой. 3. Use-case читает данные под тенантом (`Db.read`) или пишет (`Db.transaction`). 4. Ответ — со стандартными заголовками безопасности; списки — keyset `{items, nextCursor}`. 5. Лог доступа без секретов и query |
| Альтернативы | А1. Неверное тело → 422 `VALIDATION_FAILED` с `issues` (AC-3.1). А2. Не JSON → 400 `BAD_REQUEST`, неподдерживаемый `Content-Type` → 415, тело больше лимита → 413 (AC-3.1, 3.12). А3. `DomainError` → статус словаря, без GlitchTip (AC-3.3). А4. Неизвестная ошибка → 500 `INTERNAL_ERROR`, одно событие GlitchTip (AC-3.3, 2.6). А5. Пул БД исчерпан → 503 + `Retry-After: 1` (AC-4.5). А6. Неизвестный маршрут → 404 `ROUTE_NOT_FOUND` (AC-3.4). А7. Неверный курсор или `limit` > 200 → 422 (AC-3.6). А8. Обрыв соединения БД → клиент возвращён в пул, 503 (AC-4.4). А9. Чтение без тенанта через `read` → ошибка разработчика (AC-4.2) |
| Результат | Ответ в формате `01` §8; лог и GlitchTip без ПДн и секретов; ответ соответствует OpenAPI |
| AC | AC-2.1, 2.2, 2.3, 2.5, 2.6, 2.12, 3.1–3.8, 3.12, 4.2, 4.4, 4.5, 4.10, 4.15 |

### UC-5. Изменение данных и публикация события
| | |
|---|---|
| Актор | Сервис в работе |
| Предусловие | Событие описано в `@verdeect/events`; таблица outbox сервиса |
| Основной поток | 1. Use-case открывает `Db.transaction(ctx)` — один `set_config('app.tenant')`. 2. Меняет данные; id — `newId`. 3. `OutboxStore.add` проверяет `data` и признак `tenant`, пишет строку с `actor`, `traceId`. 4. `COMMIT`; `afterCommit` будит relay. 5. Relay публикует пачку с подтверждением, помечает строки |
| Альтернативы | А1. `data` не по схеме → откат всей транзакции (AC-5.1). А2. Признак `tenant` нарушен → откат (AC-5.15). А3. Брокер недоступен → строки ждут, после восстановления уходят по `seq` (AC-5.4). А4. Строка не публикуется 5 раз → `error` + GlitchTip, паузы до 5 мин (AC-5.16). А5. Две реплики relay → каждая строка один раз (AC-5.5). А6. Строка вставлена другим процессом → не позже опроса 1 с (AC-5.3). А7. Своя переменная `app.*` → `setLocal` (AC-4.16) |
| Результат | Данные и событие атомарны; событие у брокера через миллисекунды после `COMMIT` |
| AC | AC-4.1, 4.3, 4.9, 4.16, 5.1–5.5, 5.15, 5.16 |

### UC-6. Приём события
| | |
|---|---|
| Актор | Сервис в работе (потребитель) |
| Предусловие | `subscriber.on(Event, handler)`; очереди и права из `definitions.json` |
| Основной поток | 1. Сообщение приходит в `<svc>` (`prefetch` 10). 2. Конверт и `data` проверяются по определению. 3. В транзакции занимается inbox по `id`. 4. Обработчик применяет изменение (`ifNewer` по `occurredAt`, где важен порядок). 5. `COMMIT`, подтверждение |
| Альтернативы | А1. Повтор `id` → `duplicate`, обработчик не вызван (AC-5.6). А2. Не JSON / неверный конверт / неподписанный тип / `InvalidMessageError` / нарушен признак `tenant` → сразу DLQ с `x-dlq-reason` (AC-5.7, 5.15). А3. `ExpectedMessageError` → повтор через `.retry` до 5 раз, затем DLQ (AC-5.7). А4. Событие старее сохранённого → `updated: 0` (AC-4.13). А5. BFF без БД — `dedupe: 'none'` (AC-5.8). А6. Кэш на реплике — `onReplica` (AC-5.9). А7. `.retry` объявлена с другим TTL → отказ запуска (AC-5.19) |
| Результат | Каждое событие обработано не более одного раза по смыслу; неразбираемое — в DLQ с причиной |
| AC | AC-4.13, 5.6–5.9, 5.15, 5.17, 5.19 |

### UC-7. Повтор запроса с `Idempotency-Key`
| | |
|---|---|
| Актор | Клиент API (SPA, сервис) через сервис в работе |
| Предусловие | Маршрут с `@Idempotent`; таблица идемпотентности |
| Основной поток | 1. Первый POST с ключом выполняется, ответ сохраняется. 2. Повтор с тем же ключом и телом получает сохранённый ответ и `Idempotent-Replayed: true` |
| Альтернативы | А1. Другое тело → 422 `IDEMPOTENCY_KEY_REUSED`. А2. Первый ещё идёт → 409 `IDEMPOTENCY_IN_PROGRESS`. А3. Ключ обязателен и не передан → 400 `IDEMPOTENCY_KEY_REQUIRED`. А4. Брошенная `in_progress` старше 5 мин → переиспользуется. А5. Сервисный вызов с `tenantFromBody` → область по компании из тела (все — AC-4.14) |
| Результат | Повтор не создаёт второй записи; область ключа не пересекается между субъектами и компаниями |
| AC | AC-4.14 |

### UC-8. Остановка реплики под нагрузкой
| | |
|---|---|
| Актор | Сервис в работе; инфраструктура (сигнал `SIGTERM`) |
| Предусловие | `bootstrapService`; `stop_grace_period: 15s` > `SHUTDOWN_TIMEOUT_MS` |
| Основной поток | 1. Сигнал → `/health` 503, флаг остановки. 2. Пауза `SHUTDOWN_DRAIN_MS`. 3. HTTP не принимает новые соединения, начатые запросы дорабатывают. 4. Подписчики снимают потребителей, relay дорабатывает пачку, очистка не начинает новую. 5. Закрываются пулы БД, RabbitMQ, Redis. 6. Закрывается сервер метрик, выход 0 |
| Альтернативы | А1. Пауза и шаги 2–5 дольше `SHUTDOWN_TIMEOUT_MS` (от сигнала) → сторож: `error`-лог, GlitchTip, выход 1 (AC-2.10). А2. Пачка `deleteInBatches` идёт → дорабатывает текущую (AC-4.11) |
| Результат | Ни одного оборванного начатого запроса и доставки в пределах срока |
| AC | AC-2.7, 2.10, 2.13, 3.9, 4.11, 5.11 |

### UC-9. Задача «одна на кластер»
| | |
|---|---|
| Актор | Сервис в работе (несколько реплик) |
| Предусловие | Задача обёрнута `runExclusive(db, key, fn)` (очистка outbox/inbox, идемпотентности, перешифровка) |
| Основной поток | 1. По расписанию реплики пытаются взять advisory lock. 2. Одна берёт и выполняет пачками. 3. Остальные получают `{ran: false}` без ожидания |
| Альтернативы | А1. Исключение в `fn` → блокировка снята (AC-4.12). А2. Остановка во время прохода → пачка дорабатывает, новая не начинается (AC-4.11, 5.12) |
| Результат | Задача выполняется ровно одной репликой |
| AC | AC-4.11, 4.12, 5.12 |

### UC-10. Ротация ключа шифра
| | |
|---|---|
| Актор | Инфраструктура; сервис в работе |
| Предусловие | Секреты в БД/Redis зашифрованы `/crypto` |
| Основной поток | 1. Новый секрет — `verdeect-kit crypto generate-secret`. 2. Новая версия первой в `ENCRYPTION_KEYS`, старая остаётся. 3. Перезапуск: новые значения — новой версией, старые читаются. 4. Задача сервиса (`runExclusive`) перешифровывает значения с `needsReencrypt`. 5. Старая версия убирается |
| Альтернативы | А1. Значение подменено между записями → `DecryptError('auth')` (AC-7.2). А2. Версии нет в ключах → `'unknown_version'` (AC-7.2). А3. Секрет короче 32 байт или не base64url → отказ запуска (AC-7.5) |
| Результат | Все значения на новой версии, старая версия удалена без потери данных |
| AC | AC-7.1–7.5 |

### UC-11. Redis недоступен
| | |
|---|---|
| Актор | Сервис в работе |
| Предусловие | `KitRedisModule`; лимитер на входе |
| Основной поток | 1. Команда Redis завершается ошибкой не позже ~0,5 с. 2. Лимитер пропускает запрос (fail-open), метрика растёт. 3. `/health` — `degraded` (200). 4. Алерт по метрике |
| Альтернативы | А1. Redis доступен, лимит превышен → 429 `RATE_LIMITED` + `Retry-After` (AC-8.3, 8.4) |
| Результат | Вход работает без Redis; недоступность видна в метриках |
| AC | AC-8.2, 8.3, 8.4 |

### UC-12. Развёртывание инфраструктуры
| | |
|---|---|
| Актор | Инфраструктура |
| Предусловие | Список сервисов контура |
| Основной поток | 1. `verdeect-kit rabbitmq definitions --services …` → `definitions.json`, брокер грузит при старте. 2. `verdeect-kit redis acl --services …` → `aclfile`. 3. `verdeect-kit db prepare` на каждый сервис. 4. Сервисы стартуют, exchange проверяют пассивно |
| Альтернативы | А1. Сервис пытается объявить чужую очередь или читать чужую → `ACCESS_REFUSED` (AC-5.10). А2. Сервис обращается к чужому ключу Redis → `NOPERM` (AC-8.1). А3. Ошибка CLI → JSON `{error}` без паролей, выход 1 (AC-4.17) |
| Результат | Права у каждого сервиса — только на своё; порядок запуска сервисов не важен |
| AC | AC-4.6, 4.17, 5.10, 8.1, 8.6 |

### UC-13. Наблюдение за сервисом
| | |
|---|---|
| Актор | Инфраструктура (балансировщик, VictoriaMetrics, vmalert) |
| Предусловие | `METRICS_PORT` не опубликован наружу |
| Основной поток | 1. Docker проверяет `/ok` (живость). 2. Балансировщик — `/health` (готовность). 3. Скрейп `/metrics` с меткой `service`. 4. Правила алертов из шаблона пакета |
| Альтернативы | А1. Критичная проба down → 503, реплика выводится из балансировки (AC-2.7). А2. Некритичная down → 200 `degraded` (AC-2.7) |
| Результат | Одинаковые адреса, метрики и алерты у всех сервисов |
| AC | AC-2.7, 2.8, 2.11 |

### UC-14. Тесты сервиса на контуре пакета
| | |
|---|---|
| Актор | Разработчик сервиса |
| Предусловие | `startTestStack` в `globalSetup` |
| Основной поток | 1. Контейнеры поднимаются раз на прогон. 2. Каждый воркер получает `workerScope()` (тенант, vhost, префикс Redis). 3. Тесты используют `createTestApp`, `expectProblem`, `expectMatchesApi`, `expectOutbox`, `publishTestEvent`, `waitForInbox`, `countQueries`. 4. Пустая БД — `createScratchDatabase()`. 5. При `KIT_OUTBOX_COVERAGE=1` — проверка покрытия событий |
| Альтернативы | А1. Событие без теста → `teardown` падает со списком (AC-5.13). А2. Нужны mailpit/minio → флаги `startTestStack` (AC-1.12) |
| Результат | Параллельные воркеры не мешают друг другу; после прогона в брокере не остаётся vhost |
| AC | AC-1.12, 1.13, 4.18, 3.7, 3.8, 4.15, 5.13, 5.18, 8.5 |

### ~~UC-15~~. Новое событие в `@verdeect/events`

Перенесён в `kit/events-prd.md` (UC-2) в v1.5.

### UC-16. Выпуск версии пакета
| | |
|---|---|
| Актор | Мейнтейнер; CI пакета |
| Предусловие | Этап слит в `main`; CHANGELOG обновлён |
| Основной поток | 1. Тег `v<версия>` = `version` (`v1.0.0-rc.N` или `v1.0.0` и далее). 2. CI: lint → test (Node 22, 24; U + I) → build + `pack:check` → проект-потребитель на архиве. 3. Публикация через Trusted Publishing с provenance: версия с `-rc.N` — с меткой `next`, без суффикса — с меткой `latest` |
| Альтернативы | А1. Версия уже есть в npm или тег ≠ `version` → публикация не выполняется (AC-1.10). А2. Ломающая правка между `rc` → следующий `rc`, сообщения KT-NN перешедшим сервисам (G14). А3. Мажор после `1.0.0` → CHANGELOG «Как перейти», сообщения KT-NN чатам-потребителям (NFR-5) |
| Результат | Версия в npm, совместимость — в таблице README |
| AC | AC-1.1, 1.10, 2.11, 9.1, 9.3 |

## 5. Критерии приёмки (AC)

Форма AC (ревью r1, RD-2): строка читается как Given/When/Then — «Дано» — условие до первого действия, «Когда» — действие, «Тогда» — результат после «→» или «—»; где это неочевидно, строка записана явно «Дано: … Когда: … Тогда: …». Столбец «UC» — сценарии §4, которые критерий проверяет; «NFR» — критерий нефункционального требования. Уровни тестов: **U** — unit (без контейнеров), **I** — integration (Testcontainers на `TEST_IMAGES`), **T** — timing (проверки времени через `timingGuard`), **C** — проект-потребитель `test/consumer` на упакованном архиве, **R** — проверка репозитория/архива. Тесты называются по номеру AC. Источник образца — в скобках; «эквивалентность» — тест сервиса, который должен проходить после перехода.

### 5.1. Каркас и `/config` (E1)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-1.1 | UC-1, UC-16 | Дано: собранный архив пакета. Когда: запускаются `publint --strict` и `attw --profile esm-only`, импортируются все подпути §3.1–3.8 и §3.3а. Тогда: замечаний нет; `/testing` разрешается только с условием `development`, без условия — ошибка разрешения модуля | R |
| AC-1.2 | UC-1, UC-3 | Импорт подпути без установленного опционального peer падает при импорте с текстом «`@verdeect/kit/<подпуть>` требует `<библиотека>` — добавьте в зависимости сервиса»; без `pg` импорт `/config`, `/observability`, `/http`, `/crypto`, `/redis` проходит, импорт `/database` и `/idempotency` — эта ошибка; `/messaging` без `pg` импортируется, а `KitMessagingModule.forRoot` с `outbox` или `dedupe: 'inbox'` (умолчание) без `pg` — та же ошибка при сборке модуля, до прослушивания порта (тест растёт с этапами: подпуть добавляется в проверку в своём этапе) | U |
| AC-1.3 | UC-3 | `parseEnv` с неверным вложенным значением возвращает `InvalidEnvironmentError` с путём `SERVICE_URLS.files` / `NODES.2.host`; без пути — `(root)`; значение в тексте ошибки отсутствует (проверка подстроки секрета) (B/O `issueKeys`) | U |
| AC-1.4 | UC-3 | `PORT = METRICS_PORT ≠ 0` → ошибка с путём `METRICS_PORT`; оба 0 — допустимо; `SHUTDOWN_DRAIN_MS ≥ SHUTDOWN_TIMEOUT_MS` → ошибка с путём `SHUTDOWN_DRAIN_MS` | U |
| AC-1.5 | UC-1 | `DB_POOL_ACQUIRE_TIMEOUT_MS = 0` → ошибка; умолчания `NODE_ENV = production`, `LOG_LEVEL = info`, `METRICS_PORT = 9100`, `DB_POOL_MAX = 10`, `DB_POOL_ACQUIRE_TIMEOUT_MS = 5000`, `PORT = 3000`, `SHUTDOWN_TIMEOUT_MS = 10000`, `REPLICA_ID = hostname()` | U |
| AC-1.6 | UC-1 | Переопределение ключа пакета несовместимым типом в `defineEnv` — ошибка компиляции (тест типов `expectTypeOf`/`tsd`) | U |
| AC-1.7 | UC-3 | `KitConfigModule.forRoot` перечитывает окружение при каждой сборке контекста Nest (два контекста в одном процессе с разным `process.env` получают разные значения) | U |
| AC-1.8 | UC-1, UC-2 | Дано: фикстуры репозитория сервиса — эталонная и по одной с нарушением (образ не из `TEST_IMAGES` в compose и в CI; `REPLICA_ID` в compose; `stop_grace_period ≤ SHUTDOWN_TIMEOUT_MS`; ключ `IDENTITY_PORT`/`BFF_PORT`; версия peer вне диапазона; команда запуска без `--import …instrument` в Dockerfile, в `start` и в `command:` compose; `redaction.ts` импортирует модуль приложения; инфраструктурный сервис и подделка `fake-services.main.ts` без `--import` — не нарушение; ключ из `env_file:` делает сервис приложением; одноразовое задание `command: pnpm db:migrate` с ключами `envBase` без `stop_grace_period` — не нарушение, то же задание с ключом `IDENTITY_PORT` — нарушение ключей окружения; `bash -eo pipefail -c "node dist/main.js"`, `ENTRYPOINT ["sh","-c","node dist/main.js"]`, `tini -- sh -c "node dist/main"`, `entrypoint: ["node"]` + `command: ["dist/main.js"]`, `ENTRYPOINT ["node"]` стадии `base` + `CMD ["dist/main.js"]` стадии `FROM base` без `--import` — нарушение `--import`; `pnpm start`, `npm run start:prod`, `gosu node node dist/main.js`, `node --max-old-space-size 512 dist/main.js` — нарушение «команда не распознана»; `NODE_OPTIONS="--import ./dist/instrument.js" node dist/main.js` — нарушение `--import`). Когда: запускается `assertRepoConventions`. Тогда: эталонная проходит, каждая с нарушением падает с названием нарушенного правила | U |
| AC-1.9 | — | ~~`createScratchDatabase`~~ — перенесён в AC-4.18 (ревью r2) | — |
| AC-1.10 | UC-16 | Дано: push в ветку и тег `v*`. Когда: выполняется CI. Тогда: на ветке — lint → test (Node 22 и 24, U + I) → build + `pack:check` → проект-потребитель на упакованном архиве, без публикации; на теге — то же и публикация, только если версия тега = `version` и такой версии ещё нет в npm; тег `v<x.y.z>-rc.<N>` публикуется с меткой `next`, тег без суффикса — с меткой `latest`; другой суффикс — отказ публикации | R, C |
| AC-1.11 | UC-1 | `envServiceUrls(['identity'])`: нет `identity` → ошибка с путём `SERVICE_URLS.identity`; не URL → та же ошибка; лишние имена допустимы | U |
| AC-1.12 | UC-14 | `startTestStack` с `mailpit: true` и `minio: true` поднимает образы `TEST_IMAGES` и передаёт адреса через `provide`; без флагов эти контейнеры не стартуют (флаги RabbitMQ и Redis добавляются в E5 и E8) | I |
| AC-1.13 | UC-14 | `startTestStack({postgres: true})` поднимает `TEST_IMAGES.postgres` и передаёт адрес через `provide`; без флага контейнер не стартует; подготовки БД и миграций в E1 нет | I |

### 5.2. `/observability` (E2)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-2.1 | UC-4 | Лог HTTP-запроса с телом, содержащим каждое имя `SENSITIVE_KEYS` на уровнях 0–2 и в заголовках, не содержит их значений; `err.code` виден; путь без query (I/P/O `ac-10-3-log-redaction`) | U |
| AC-2.2 | UC-4 | `trustTraceparent: false` — входящий `traceparent` игнорируется, создаётся новый trace-id; иначе — берётся из заголовка | U |
| AC-2.3 | UC-4 | `sanitizeError` для ошибки Drizzle с `params` и ошибки pg с `Key (…)=(…)` оставляет только `code`, `constraint`, `table`, `column`, `severity`; для ошибки ioredis — `name`, `code`, имя команды без аргументов; цепочка `cause` глубже 10 — обрезается; зарегистрированная ветка сервиса применяется (эквивалентность — `sanitize-error.spec` I/P/O) | U |
| AC-2.4 | UC-3 | `initSentry` не отправляет событий при `NODE_ENV ≠ production` или пустом DSN; неверный `SENTRY_*` не роняет процесс | U |
| AC-2.5 | UC-4 | Событие GlitchTip: без query (в т. ч. в `request.url`), без `request.data`, `user` только с `id`, без хвоста `params:` и `Key (…)=(…)` в тексте исключения | U |
| AC-2.6 | UC-4 | `captureThrottled`: 100 однотипных ошибок за 60 с — одно событие; ошибка, отправленная границей, повторно не отправляется | U |
| AC-2.7 | UC-8, UC-13 | `/health`: критичная проба down → 503 `unavailable`; некритичная → 200 `degraded`; проба дольше 2 с — down; после сигнала остановки — 503 (O `or-106-health-stopping-first`) | I |
| AC-2.8 | UC-13 | `/metrics` содержит метрики процесса Node и метрики пакета с меткой `service`; второй экземпляр приложения в том же процессе — свой реестр | U |
| AC-2.9 | UC-3 | `failStartup`: `fatal`-лог, событие GlitchTip отправлено до выхода (поддельный транспорт с задержкой 500 мс), код 1; `InvalidEnvironmentError` — только имена ключей; `StartupFailure` — `startupCode` и `startupDetails()` (O `fail-startup.spec`) | U |
| AC-2.10 | UC-8 | Остановка на поддельных участниках шагов 2–5 (без HTTP): порядок шагов соблюдён (журнал вызовов), участник шага 3 вызывается после завершения шага 2; пауза и шаги 2–5 дольше `SHUTDOWN_TIMEOUT_MS`, отсчитанного от сигнала, → `error`-лог, событие GlitchTip, выход 1 (P `ac-6-6-shutdown-deadline`) | T |
| AC-2.11 | UC-13, UC-16 | Дано: файл `alerts/verdeect-kit.rules.yml`. Когда: проверяется `vmalert -dryRun` (или схемой правил). Тогда: файл валиден и содержит правило на каждую метрику пакета с переопределением порога по `service` | R |
| AC-2.12 | UC-4 | `quietRoutes`: успешный запрос маршрута пишется на `debug`, ошибочный — как обычно; `maskPath` применяется к пути в логе доступа и в `request.url` события GlitchTip | U |
| AC-2.13 | UC-8 | `SHUTDOWN_DRAIN_MS = 500`: между шагом 1 (`/health` 503) и шагом 2 проходит ≥ 500 мс; пауза входит в `SHUTDOWN_TIMEOUT_MS` (поддельные участники) | T |

### 5.3. `/http` (E3)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-3.1 | UC-4 | Неверное тело по zod-схеме → 422 `VALIDATION_FAILED`, `details.issues: [{path, code}]`, `path` через точку, значений в ответе нет; не JSON → 400 `BAD_REQUEST`; неподдерживаемый `Content-Type` → 415 `UNSUPPORTED_MEDIA_TYPE` | U (`createTestApp`) |
| AC-3.2 | UC-4 | `defineErrors` с кодом пакета и другим статусом — ошибка компиляции; неизвестный код — общий русский текст | U |
| AC-3.3 | UC-4 | Фильтр: `DomainError` → статус словаря, `warn`, без GlitchTip; ответ guard'а `@verdeect/auth` и `@verdeect/platform-client` (`{error}`) проходит без изменений; неизвестная ошибка → 500 `INTERNAL_ERROR`, GlitchTip ровно раз, без текста исходной ошибки, стека и SQL в теле | U |
| AC-3.4 | UC-4 | Неизвестный маршрут → 404 `ROUTE_NOT_FOUND` | U |
| AC-3.5 | UC-4 | Заголовки безопасности API на каждом ответе, в т. ч. на ошибках и `/ok` (I `ac-8-3-security-headers`, P/O набор) | U |
| AC-3.6 | UC-4 | Keyset: `limit` умолч. 100, 201 → 422; неверный курсор → 422 `path: cursor`; вставка строк между страницами не даёт дублей и пропусков; сортировка без уникального последнего ключа — ошибка помощника | I |
| AC-3.7 | UC-4, UC-14 | `@Api` + CLI `openapi`: документ проходит валидатор OpenAPI 3.1; содержит схемы тела/query/ответа, коды ошибок маршрута и стандартные, схему безопасности `@verdeect/auth`; `expectMatchesApi` падает на ответе вне схемы | U |
| AC-3.8 | UC-4, UC-14 | Тест-снимок `contracts/openapi.json` проекта-потребителя падает при изменении маршрута без `make openapi` | C |
| AC-3.9 | UC-8 | Сервис из `bootstrapService` под нагрузкой получает сигнал остановки: `/health` отвечает 503 раньше, чем HTTP перестаёт принимать соединения; долгий запрос, начатый до сигнала, дорабатывает с 200; новый запрос после шага 2 — отказ соединения; процесс завершается с кодом 0 в пределах `SHUTDOWN_TIMEOUT_MS` (O `ac-10-8-shutdown`, `or-106-health-stopping-first`) | T |
| AC-3.10 | UC-1, UC-3 | `bootstrapService` с `service` вне `^[a-z][a-z0-9-]{1,31}$` (`Bff_App`, пусто, 33 символа) — отказ запуска с понятным текстом; `bff-app` проходит; проверка — одна внутренняя функция пакета (её же использует `/messaging`, AC-5.20; CE-6 ревью r2) | U |
| AC-3.11 | UC-3 | Дано: DSN задан, `NODE_ENV = production`, `instrument.ts` не подключён. Когда: вызывается `bootstrapService`. Тогда: `warn` с кодом `SENTRY_NOT_PRELOADED`, запуск продолжается; при подключённом `instrument.ts` предупреждения нет | U |
| AC-3.12 | UC-4 | `bootstrapService` с `logger.trustTraceparent: false` игнорирует входящий `traceparent`; с `logger.quietRoutes` пишет успешный запрос маршрута на `debug`; с `http.bodyLimit` тело больше лимита → 413 `PAYLOAD_TOO_LARGE`; имя из `redaction.sensitiveKeys` отсутствует и в логе, и в событии GlitchTip (тот же объект в `initSentry`); при заданном `redaction.sensitiveKeys` имена `SENSITIVE_KEYS` (`authorization`, `password`, `refresh_token`) по-прежнему скрыты в логе и событии GlitchTip; `redaction.sensitiveKeys: []` базовый список не отключает | U |
| AC-3.13 | UC-3 | Дано: неверное окружение. Когда: вызывается `bootstrapService({env})`. Тогда: `failStartup` до создания приложения — порт не открыт, модули сервиса не инициализированы, выход 1; при верном окружении `KitConfigModule` повторно `parseEnv` не вызывает (счётчик вызовов) | U |

### 5.4. `/database` (E4)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-4.1 | UC-5 | `transaction` ставит ровно один `set_config('app.tenant', …, true)`; значение не переживает транзакцию (следующая транзакция того же соединения видит пустое) (I/P/O `db`) | I |
| AC-4.2 | UC-4 | `read` без тенанта → `TenantRequiredError`; `readGlobal` — без транзакции, запись в нём → ошибка read-only; запрос дольше 5 с → отмена | I |
| AC-4.3 | UC-5 | `afterCommit` выполняется после `COMMIT`, не выполняется после `ROLLBACK`; в read-only транзакции — `AfterCommitInReadOnlyError` | I |
| AC-4.4 | UC-4 | Обрыв соединения до `BEGIN` возвращает клиент в пул (пул не исчерпывается после 2 × `DB_POOL_MAX` обрывов) (O `connection-lost`) | I |
| AC-4.5 | UC-4 | Исчерпание пула → ошибка `isPoolTimeout`, метрика `verdeect_db_pool_wait_timeouts_total{pool}` +1; HTTP → 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1` (O `or-119-db-pool`) | I |
| AC-4.6 | UC-1, UC-12 | `prepareDatabase` повторно — без ошибок и изменений; роли `<svc>_owner`, `<svc>_app` (`NOBYPASSRLS`), `<svc>_directory` (NOLOGIN, `BYPASSRLS`) созданы; `assertAppRoleIsNotOwner` проходит (O `fr-21-roles`) | I |
| AC-4.7 | UC-1 | `runMigrations` пишет журнал в `<svc>.__migrations`, схема `drizzle` не создаётся; `pg_dump -n <svc>` + восстановление в пустую БД + повторный `runMigrations` — без новых миграций; `db move-journal` переносит журнал | I |
| AC-4.8 | UC-1 | Таблица с `tenantPolicy` и `FORCE RLS`: под ролью приложения с пустым тенантом — 0 строк, с чужим — 0 строк; `assertStrictTenantIsolation` падает на таблице без политики, без `FORCE`, с нестрогой политикой (`IS NULL OR …`); исключения `outbox` и таблица идемпотентности проходят | I |
| AC-4.9 | UC-5 | `newId('fil')` — `fil_` + 26 символов Crockford; префикс вне `^[a-z]{2,5}$` → ошибка; совпадает по формату с I/O `ids` | U |
| AC-4.10 | UC-4 | `isUniqueViolation(err, 'constraint')` распознаёт ошибку на глубине `cause` 3; `isConnectionError` — обрыв `tcpProxy` | I |
| AC-4.11 | UC-8, UC-9 | `deleteInBatches` с `shouldContinue = false` после первой пачки — останавливается, пачка дорабатывает | I |
| AC-4.12 | UC-9 | `runExclusive` двумя репликами одновременно — `fn` выполняется ровно раз, вторая получает `{ran: false}` без ожидания; блокировка снимается при исключении в `fn` | I |
| AC-4.13 | UC-6 | `ifNewer`: событие старее сохранённого — `updated: 0`; новее или `NULL` — обновление | I |
| AC-4.14 | UC-7 | Идемпотентность: повтор с тем же ключом и телом — сохранённый статус, тело, `Location` + `Idempotent-Replayed: true`; другое тело — 422 `IDEMPOTENCY_KEY_REUSED`; параллельный первый — 409 `IDEMPOTENCY_IN_PROGRESS`; `required` без ключа — 400 `IDEMPOTENCY_KEY_REQUIRED`; `in_progress` старше 5 мин переиспользуется; ключ одного `sub` не виден другому `sub` и другой компании; сервисный вызов с `tenantFromBody: 'tenant'` — ключ одного `client_id` в двух компаниях не пересекается; вызов пользователя с подложным `tenant` в теле не меняет область; очистка удаляет записи старше 24 ч (эквивалентность — O `http/shared/idempotency`, `ac-2-2-idempotency`, `idempotency-cleanup.int`) | I |
| AC-4.15 | UC-4, UC-14 | `countQueries` считает запросы `fn` точно (включая `BEGIN`/`set_config`/`COMMIT` отдельно от запросов домена) | I |
| AC-4.16 | UC-5 | `Db.setLocal`: имя вне `^app\.[a-z_]{1,48}$` → ошибка; значение передаётся параметром (строка с `'` не ломает запрос) и не переживает транзакцию | I |
| AC-4.17 | UC-12 | CLI `db prepare`, `db migrate`, `db move-journal`: успех — JSON в stdout и код 0; ошибка — JSON `{error: {code}}` без адресов и паролей, код 1 | I |
| AC-4.18 | UC-14 | Дано: `startTestStack({postgres: true, service, migrations})` — БД подготовлена `prepareDatabase` и мигрирована. Когда: вызывается `createScratchDatabase()`. Тогда: пустая мигрированная БД из шаблона создана за < 1 с | I |

### 5.5. `/messaging` (E5)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-5.1 | UC-5 | `OutboxStore.add` с `data`, не прошедшим схему, — ошибка и откат всей транзакции (строки домена нет) (O `outbox-atomicity`) | I |
| AC-5.2 | UC-5 | Строка outbox содержит `tenant`, `actor`, `traceId` из `DbContext`, `id` с префиксом `evt`; конверт relay совпадает с `01` §7.1 (проверка `EnvelopeSchema`) | I |
| AC-5.3 | UC-5 | Публикация < 100 мс после `COMMIT` без ожидания опроса; строка, вставленная другим процессом, — не позже 1000 мс + пачка | T |
| AC-5.4 | UC-5 | Брокер недоступен 10 с — события копятся, после восстановления публикуются по `seq` без потерь и повторов внутри реплики; `verdeect_outbox_lag_seconds` растёт и падает (I `ac-6-2-broker-outage`, O `outbox-confirm`) | T |
| AC-5.5 | UC-5 | Две реплики relay — каждая строка публикуется один раз (`SKIP LOCKED`) | I |
| AC-5.6 | UC-6 | Повтор сообщения с тем же `id` → `duplicate`, обработчик не вызван, `verdeect_events_consumed_total{result="duplicate"}` +1 | I |
| AC-5.7 | UC-6 | Не JSON, неверный конверт, неподписанный тип, `InvalidMessageError` → `<svc>.dlq` с `x-dlq-reason`; `ExpectedMessageError` → повтор через `.retry` (в тесте `RABBITMQ_RETRY_SECONDS=1`) до 5 раз, затем DLQ | I |
| AC-5.8 | UC-6 | `dedupe: 'none'` — подписчик работает без БД; модуль не требует `pg` | I |
| AC-5.9 | UC-6 | `onReplica`: очередь `<svc>.replica.<REPLICA_ID>` exclusive, auto-delete, удаляется при остановке реплики | I |
| AC-5.10 | UC-12 | `definitions.json` из CLI: с этими правами операции relay и подписчика проходят; объявление чужой очереди и чтение чужой — `ACCESS_REFUSED`; exchange пассивной проверкой виден, сервис его не объявляет (обобщение O `or-119-rabbit-permissions`) | I |
| AC-5.11 | UC-8 | Остановка: подписчик снимает потребителей и дожидается начатых доставок, relay дорабатывает пачку, очистка не начинает новую — в общем сроке (O `subscriber`, P `channel-restore`) | T |
| AC-5.12 | UC-9 | Очистка: опубликованные outbox и inbox старше 7 дней удаляются пачками по 1000, ≤ 100 пачек за проход, одна реплика за раз | I |
| AC-5.13 | UC-2, UC-14 | Проект-потребитель: при `KIT_OUTBOX_COVERAGE=1` событие из `outboxEvents` без успешного `expectOutbox` роняет `teardown` со списком типов; упавший `expectOutbox` покрытия не даёт; без переменной прогон не падает; `publishTestEvent` + `waitForInbox` проверяют обработчик без `sleep` | C |
| AC-5.14 | — | ~~`tenantNullable`~~ — заменён AC-5.15 (ревью r1) | — |
| AC-5.15 | UC-5, UC-6 | `OutboxStore.add` события `'required'` без тенанта в `DbContext` — ошибка и откат (строки домена нет); `'none'` с тенантом — ошибка и откат; `'none'` при `createOutboxTable({tenantNullable: false})` — отказ `forRoot`; подписчик получает `'required'` с `tenant: null` — DLQ с `x-dlq-reason: tenant` | I |
| AC-5.16 | UC-5 | Relay: строка, не опубликованная 5 раз подряд, — `error`-лог и событие GlitchTip с `id` и `type`, без `data`; паузы между попытками 1 → 2 → 4 с … до 5 мин (часы подменяются) | T |
| AC-5.17 | UC-6 | `prefetch 10`: при 20 сообщениях и блокирующем обработчике одновременно не больше 10 неподтверждённых | I |
| AC-5.18 | UC-14 | `workerScope`: vhost воркера и его пользователь удаляются по завершении воркера; после прогона в брокере нет vhost с префиксом теста | I |
| AC-5.19 | UC-6 | Очередь `<svc>.retry` уже объявлена с другим TTL → `forRoot` завершается отказом запуска с текстом «очередь `<svc>.retry` объявлена с другим TTL — пересоздайте очередь», без цикла переподключений | I |
| AC-5.20 | UC-1, UC-6 | `KitMessagingModule.forRoot` с `service` вне `^[a-z][a-z0-9-]{1,31}$` — отказ запуска с тем же текстом, что AC-3.10; `bff-app` проходит | U |

### 5.6. ~~`@verdeect/events` (E6)~~

AC-6.1–6.3 перенесены в `kit/events-prd.md` (AC-1.1–1.3) в v1.5; номера AC-6.x в этом PRD не используются.

### 5.7. `/crypto` (E7)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-7.1 | UC-10 | `encrypt` → `decrypt` возвращает исходное; значение — `v<N>:` + три части base64url; два шифрования одного текста различаются (IV) | U |
| AC-7.2 | UC-10 | Подмена значения между записями (другой `aad`) → `DecryptError('auth')`; изменённый байт → `'auth'`; неизвестная версия → `'unknown_version'`; неверный формат → `'format'`; в тексте ошибки нет открытого текста и ключей | U |
| AC-7.3 | UC-10 | Ключи разных `purpose` от одного секрета различаются (значение одного назначения не расшифровывается другим); один секрет и одно `purpose`, разные `service` — значение одного не расшифровывается другим; `service` или `purpose` вне формата — ошибка при создании | U |
| AC-7.4 | UC-10 | Ротация: значение версии 1 читается после добавления версии 2 первой; `needsReencrypt` — `true`; после перешифровки — `false` | U |
| AC-7.5 | UC-10 | `ENCRYPTION_KEYS` с секретом < 32 байт, повтором версии или секретом в base64 с `+`, `/`, `=` — ошибка разбора с путём ключа; секрет из `generateSecret()` и CLI `crypto generate-secret` принимается | U |

### 5.8. `/redis` (E8)

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-8.1 | UC-12 | Ключи и каналы получают префикс `<svc>:`; под ACL из CLI доступ к чужому ключу → `NOPERM` (обобщение B `redis-acl.http-spec`) | I |
| AC-8.2 | UC-11 | Недоступный Redis: команда завершается ошибкой не позже ~0,5 с (`commandTimeout`), проба `/health` — `degraded` | T |
| AC-8.3 | UC-11 | Лимитер: `limit` попыток в окне — `allowed`, следующая — `allowed: false`, `retryAfterMs` = `PTTL`; `peek` не увеличивает счётчик; Redis недоступен — `allowed: true` и метрика +1 (I/B `rate-limiter`) | I |
| AC-8.4 | UC-11 | `throwRateLimited` → 429 `RATE_LIMITED` + `Retry-After` в секундах (вверх) | U |
| AC-8.5 | UC-14 | Изоляция воркеров `/testing`: префикс `<svc>:w<N>:`; параллельные воркеры не видят ключей и каналов друг друга; под ACL сервиса из CLI команды воркера проходят (LE-4 ревью r1) | I |
| AC-8.6 | UC-12 | `KitRedisModule({subscriber: true})`: публикация в канал `x` приходит подписчику по каналу `<svc>:x`; срок команд подписочного соединения 5 с; без `subscriber` второго соединения нет | I |

### 5.9. Сквозные

| AC | UC | Критерий | Уровень |
|---|---|---|---|
| AC-9.1 | UC-1, UC-16 | Проект-потребитель (NestJS, все подпути) ставит упакованный архив, стартует через `bootstrapService` с PostgreSQL, RabbitMQ, Redis из `startTestStack`, публикует и потребляет событие, отвечает на `/ok`, `/health`, `/metrics`, останавливается по сигналу в срок, проходит `assertRepoConventions` и `assertStrictTenantIsolation` | C |
| AC-9.2 | — | ~~Сервис на пакете проходит свои integration-тесты~~ — перенесён в §10 как критерий перехода (ревью r1) | — |
| AC-9.3 | UC-1, UC-16 | Дано: выпуск этапа. Когда: проверяется README и CHANGELOG. Тогда: README содержит API каждого выпущенного подпути, правила развёртывания (порт метрик не наружу, `REPLICA_ID` не задавать, `stop_grace_period: 15s`, формула `2 × DB_POOL_MAX × реплики`, DLQ — разбор в 7 дней, порядок смены ключа шифра и TTL `.retry`), реестр префиксов id, таблицу совместимости; CHANGELOG — по Keep a Changelog с разделом версии | R |
| AC-9.4 | NFR | Дано: исходники пакета. Когда: выполняется lint. Тогда: без нарушений — `no-console` на `src/**`; `no-restricted-syntax` на `src/**`: нет вызова `pgSchema` с литералом и нет строковых литералов вида `<svc>.<имя>` для `identity`, `platform`, `orchestrator`, `bff`, `files`, `media` (комментарии и спецификаторы импорта не проверяются; `test/**` и `test/consumer` исключены); тест конфига lint на фикстуре нарушения падает (NFR-2, NFR-8; LE-6 ревью r3) | R |
| AC-9.5 | NFR | Каждая фоновая операция пакета (очистка идемпотентности — с E4; relay, подписчик, очистка outbox/inbox — с E5; лимитер — с E8; CE-10 ревью r3) при работе пишет метрику с меткой `service` и лог с полями `service`, `replica` — проверка по реестру метрик и перехвату лога в проекте-потребителе (NFR-8) | I |

## 6. Модель данных

Пакет не владеет таблицами: он даёт фабрики схемы Drizzle, таблицы создаются миграциями сервиса в его схеме.

| Фабрика | Таблица в схеме сервиса | RLS |
|---|---|---|
| `createOutboxTable(pgSchema, {tenantNullable})` | `outbox`: `id`, `seq` (bigserial, порядок), `tenant`, `type`, `version`, `subject_id`, `actor` (jsonb), `trace_id`, `data` (jsonb), `occurred_at`, `published_at?`, `attempts`, `last_error?`; индекс неопубликованных по `seq` | исключение: пустой тенант → все строки (relay, очистка) |
| `createInboxTable(pgSchema)` | `inbox`: `id` (PK, id события), `type`, `received_at` | служебная, без тенанта |
| `createIdempotencyTable(pgSchema)` | `idempotency_key`: область (`tenant?`, `subject`), `key`, отпечаток, состояние `in_progress\|done`, ответ (статус, тело, `Location`), `created_at`; PK по области и ключу | `tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')` |
| `__migrations` | журнал миграций в схеме сервиса | — |

Роли — §3.3 `prepareDatabase`. `[ASSUMPTION]` Перечень колонок выше — по схеме O; точный состав outbox/inbox/идемпотентности — в планах E4–E5 по таблицам O (эталон) плюс nullable `tenant` из I; колонка, которой нет у O, добавляется только с требованием (CE-5 ревью r1).

## 7. Нефункциональные требования

| NFR | Требование |
|---|---|
| NFR-1 | TypeScript, ESM-only, Node ≥ 22.12 (тесты — Node 22 и 24); NestJS 12, Fastify 5, Drizzle 0.45.4, zod 4 — версии как у сервисов (`files/inventory.md` §3) |
| NFR-2 | Без привязки к схеме сервиса: ни одного имени схемы/таблицы домена в коде пакета (правило lint, AC-9.4) |
| NFR-3 | Зависимости (G3): обязательные peer — `@nestjs/common`, `@nestjs/core`, `@nestjs/config` (`KitConfigModule` — обёртка над `ConfigModule`, сервис внедряет `ConfigService`), `@nestjs/platform-fastify`, `fastify`, `reflect-metadata`, `rxjs`, `zod`, `drizzle-orm`, `nestjs-pino`, `pino`, `prom-client`, `@sentry/nestjs`, `@verdeect/auth`; опциональные peer — `pg` (`/database`, `/idempotency`; `/messaging` — только при outbox или inbox, проверка в `forRoot`, `pg` подключается динамическим `import()` только в ветке с БД), `ioredis` (`/redis`), `amqplib` + `amqp-connection-manager` (`/messaging`), `testcontainers`, `vitest` (`/testing`); peer — диапазон от проверенной минорной; `dependencies` — только внутренние детали (разбор YAML и т. п.), точные версии; `devDependencies` — точные; `minimumReleaseAge` по `rules/base.md` |
| NFR-4 | Безопасность: значения окружения, секреты, ПДн, ключи Redis, параметры SQL не попадают в логи, события GlitchTip и ответы HTTP (AC-1.3, 2.1, 2.3, 2.5, 3.3, 7.2); `/testing` не попадает в production-сборку сервиса (условие `development`) |
| NFR-5 | Версии (G14): semver; до `1.0.0` — только `1.0.0-rc.N`; мажор, минор и патч после `1.0.0` — по списку G14 (§0); CHANGELOG «Как перейти» на каждый мажор; поддерживается только последний мажор; таблица совместимости README `kit` ↔ `@verdeect/events` ↔ `@verdeect/auth` ↔ `@verdeect/platform-client` |
| NFR-6 | Выпуск (G13): GitHub Actions по образцу `verdeect-platform-client`; publish на тег `v<major>.<minor>.<patch>` или `v1.0.0-rc.<N>` (AC-1.10) через npm Trusted Publishing с provenance; `1.0.0-rc.1` — вручную после E8, затем `npm trust` и запрет публикации токенами; дальше — только по тегу; `docs/releasing.md` |
| NFR-7 | Скорость тестов: U — < 30 с; I — контейнеры раз на прогон, изоляция воркеров (§3.8); полный `make ci` пакета — ориентир < 10 мин на раннере GitHub — **ориентир, замеряется, не критерий приёмки** (ревью r2) |
| NFR-8 | Наблюдаемость самого пакета: каждая фоновая операция (relay, подписчик, очистка, лимитер) имеет метрику и лог с `service`, `replica`; никаких `console.*` |
| NFR-9 | Тексты для людей (ошибки HTTP, сообщения отказа запуска) — по-русски; идентификаторы, коды, имена метрик — по-английски |

## 8. Процесс и структура репозитория

- Структура — по образцу `verdeect-platform-client`: `src/<подпуть>/`, `test/{unit,integration,timing}/<подпуть>/`, `test/consumer/` (проект-потребитель), `alerts/`, `docs/` (`releasing.md`, `testing.md`, `deployment.md` — правила развёртывания), `Makefile` (`ci`, `test`, `pack-check`, `test-package`).
- AI Factory: инициализация репозитория, бандл `.ai-factory/skill-context` 02.11 с правилами библиотеки kit («Library Package Targets», «Library Package Pipeline», «Library Package Without Docker», «Library Package Scope», «Public Package Surface», «Library Package Gates»), `/aif-roadmap` по §9, `/aif-plan` на этап (режим — `README.md` пакета).
- Перенос кода: для каждого модуля план этапа указывает файл-эталон (`files/inventory.md` §1, столбец «Эталон») и что взять из других копий по решению этого PRD; тесты эталона переносятся вместе с кодом и обобщаются.

## 9. Этапы

| Этап | Содержание | AC | Выпуск |
|---|---|---|---|
| E1. Каркас и `/config` | репозиторий, CI, `test/consumer` (минимальный), `exports` с `development`, проверки peer; `/config` §3.1; основа `/testing`: `TEST_IMAGES`, `startTestStack` (контейнер PostgreSQL, mailpit, minio), `assertRepoConventions` (образы, `REPLICA_ID`, `stop_grace_period` > `SHUTDOWN_TIMEOUT_MS`, ключи окружения, peer, команда запуска с `--import … instrument` — все известные правила; новое правило после `1.0.0` — мажор, CE-1 ревью r1), `timingGuard`, `TEST_TIMEOUT_SCALE`, `tcpProxy`; README, CHANGELOG `[Unreleased]`, `docs/releasing.md`, `scripts/publish.mjs` (с `-rc.N` и меткой `next`) | AC-1.1–1.13 | — |
| E2. `/observability` | §3.2; шаблон алертов | AC-2.1–2.13 | — |
| E3. `/http` | §3.5 (в т. ч. `bootstrapService`); `createTestApp`, `expectProblem`, `expectMatchesApi`; CLI `openapi` | AC-3.1–3.13 | — |
| E4. `/database` и `/idempotency` | §3.3, §3.3а; `startTestStack` — подготовка БД и миграции, `createScratchDatabase`; `countQueries`, `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner`, `workerScope` (`tenant`); CLI `db` | AC-4.1–4.18 | — |
| E5. `/messaging` | §3.4; `startTestStack` с RabbitMQ и `definitions.json`, vhost на воркер, `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`; CLI `rabbitmq definitions` | AC-5.1–5.20 | — |
| ~~E6~~ | `@verdeect/events` — **вне пакета kit**: отдельный PRD `kit/events-prd.md`, выпуск после `@verdeect/kit 1.0.0-rc.1` | — | — |
| E7. `/crypto` | §3.6 | AC-7.1–7.5 | — |
| E8. `/redis` | §3.7; `startTestStack` с Redis и ACL, префикс на воркер; CLI `redis acl` | AC-8.1–8.6 | `1.0.0-rc.1` вручную, `npm trust` |
| — | Сквозные AC-9.1, 9.3, 9.4 (с E1), 9.5 (с E4, растёт в E5 и E8) — растут с каждым этапом; проверяются в каждом | AC-9.1, 9.3–9.5 | — |

**Зависимости:** E2 после E1; E3 после E2 (`createHttpApp` регистрирует HTTP-сервер участником `KitLifecycle`; `bootstrapService` — в E3); E4 после E3 (интерсептор идемпотентности); E5 после E4; E7 — после E2; E8 — после E3 (`throwRateLimited` использует `DomainError` и словарь `/http`; CE-11 ревью r4); оба можно делать параллельно с E4–E5. **Выпуск** — один: `1.0.0-rc.1` после всех этапов E1–E5, E7, E8 (G14); `@verdeect/events` (отдельный PRD) — после `rc.1`. Затем переходы готовых сервисов на `rc` (§10), `1.0.0` — после перехода Identity; Files и Media — на `1.0.0` (G15).

## 10. Переходы готовых сервисов (сводка; детальный план — в чате сервиса, сообщения KT-NN)

Порядок — после выпуска `1.0.0-rc.1` (E8): **BFF → Platform → Orchestrator → Identity**; сервисы пинят точный `1.0.0-rc.N`, правка пакета по итогам перехода — следующий `rc`; после перехода Identity — выпуск `1.0.0` (G14). Каждый переход — отдельный план в репозитории сервиса; **критерий перехода** (бывший AC-9.2, ревью r1): integration-тесты сервиса проходят, меняются только ожидания из этой таблицы; проверяется в плане сервиса, не в репозитории kit.

| Сервис | Выравнивания (ожидаемые изменения поведения) | Тесты эквивалентности |
|---|---|---|
| **BFF** | экземпляры — сервисы пакета `bff-app` и `bff-admin` (очереди, пользователи RabbitMQ и ACL Redis — по имени экземпляра, как сейчас); повторы сообщений — 5, затем DLQ (вместо бесконечных при недоступном Redis); `x-message-ttl` 7 дней основной очереди убирается (устаревшие события и так подтверждаются по `occurredAt`); `BFF_PORT` → `PORT`; `SESSION_ENC_KEYS` → `ENCRYPTION_KEYS` (сессии пересоздаются); `NOT_FOUND` → `ROUTE_NOT_FOUND`; 413/415 с кодом `BAD_REQUEST` → `PAYLOAD_TOO_LARGE`/`UNSUPPORTED_MEDIA_TYPE`; подписчик из пакета с `dedupe: 'none'`, очереди `bff-app`/`bff-admin` по общему правилу, `x-dlq-reason`; копии JSON Schema событий → `@verdeect/events`; `bff_events_consumed_total` → `verdeect_events_consumed_total`; `/health` 503 с начала остановки; метрики процесса Node; ПДн не в логах; Redis — префикс `bff:` и ACL; лимитер из пакета; брокер грузит `definitions.json`; `main.ts` → `bootstrapService` (`/http`); `instrument.ts` → `initSentry`; документ OpenAPI для `/auth/*` | `http/events/events-subscriber`, `http/shared/request-errors`, `integration/shared/rate-limiter`, тесты `session-cipher`, `redis-acl.http-spec`, `observability.module.spec` |
| **Platform** | триггеры outbox (3–4 / ≈ 6 типов) → `OutboxStore.add` (`actor` событий получает `accountId`/`channel` из контекста — сверить схему конверта); три `set_config` → один; срок пачки relay 5 с; `platform.authz.<id>` → `platform.replica.<id>`; журнал миграций → схема `platform`; `platform_outbox_lag_seconds`, `platform_events_consumed_total` → общие; очистка — одна реплика; свои «если новее» → `ifNewer`; `stop_grace_period: 15s`, сторож; `/health` 503 с начала остановки; брокер — `definitions.json`; копии схем событий → `@verdeect/events` (AC-7.8 → импорт); документ OpenAPI впервые | `outbox-triggers.int`, `outbox-policy.int`, `integration/messaging/*`, `ac-3-13-rls`, `db`, `ac-6-6-shutdown-deadline`, `channel-restore`, `request-errors`, `identity-events` |
| **Orchestrator** | пагинация смещением → keyset (сессии, папки, профили, история; новый тест «вставка между страницами»); `contracts/openapi.yaml` → `@Api` (сравнение после нормализации, отдельный шаг плана); `SIGNING_KEY_ENCRYPTION_KEYS` → `ENCRYPTION_KEYS` (ключи подписи генерируются заново); опрос outbox 200 → 1000 мс (с пробуждением после `COMMIT`); общий срок остановки 8 → 10 с; `orch_*` → `verdeect_*` (механизмы) и `orchestrator_*` (домен); каналы Redis → префикс `orchestrator:`; `job-lock` очистки → `runExclusive`; журнал миграций → схема `orchestrator`; 9 типов событий → `@verdeect/events`; тест «ошибка `S3Objects` в логе без ключа объекта» | `outbox`, `outbox-atomicity`, `outbox-confirm`, `or-119-rabbit-permissions`, `http/shared/idempotency`, `ac-2-2-idempotency`, `idempotency-cleanup.int`, `ac-10-2-rls`, `fr-21-roles`, `ac-10-8-*`, `fail-startup.spec`, `ac-10-3-log-redaction`, AC-7.2 |
| **Identity** | `IDENTITY_PORT` → `PORT`; `DATABASE_MIGRATION_URL` → `DATABASE_MIGRATOR_URL`; Postgres 16.15 → 17.11; 4 триггера / 10 типов → `OutboxStore.add` (`session.terminated` — в адаптере `oidc-provider` `destroy`), `app.reason`/`app.invitation_id` уходят, шесть `set_config` → один; `tenantNullable: true`; Identity перестаёт объявлять exchange; `VALIDATION` + `fields` → `VALIDATION_FAILED` + `issues`, 400 → 422 (и страницы `id.`); `IDEMPOTENCY_MISMATCH` 409 → `IDEMPOTENCY_KEY_REUSED` 422, появляется 409 `IDEMPOTENCY_IN_PROGRESS`, область ключа по субъекту; `limit` 50 → 100; `CLIENT_SECRET_KEY`, `IDENTITY_SECRETS` → `ENCRYPTION_KEYS` (секреты клиентов и JWK пересоздаются в dev/e2e); `identity_outbox_*` → общие; GlitchTip только в production, коды ошибок видны; email/имена не в логах; ошибки Redis без аргументов; SMTP-ветка — `registerErrorSanitizer`; журнал миграций → схема `identity`; роли `identity_owner`, `identity_directory`; чтения без тенанта → `readGlobal`; `autocommit` — обёртка сервиса над `DRIZZLE`; Redis — префикс `identity:`, ACL, лимитер с `PTTL`. **Строгий RLS** (`organization`, `member`, `invitation`) — **отдельная задача до первого production, не в плане перехода** | `outbox-event-payloads.int`, `ac-6-1`, `ac-6-2-broker-outage`, `ac-6-3-message-contract`, `ac-6-4`, `ac-6-4a`, `ac-6-7`, `fr-72-*`, `fr-76-*`, `rls`, `read-pool`, `autocommit`, `after-commit`, `connection-lost`, `migrations`, `ac-9-1*`, `sanitize-error.spec`, `sentry-scrubber.spec`, `client-secret.spec`, `pagination.spec`, `app-exception-filter.spec` |

## 11. Открытые вопросы

1. `[OPEN]` Перенос подписки на `platform.policy.changed` в `@verdeect/platform-client` на подписчика kit (`platform-client/prd.md` §10 п. 1) — решается чатом platform-client после E5; kit предоставляет `subscriber.onReplica`.
2. `[OPEN]` `SHUTDOWN_DRAIN_MS` — значение по замеру на стенде при первом выкате (O6); до замера — 0.
3. `[OPEN]` `BEGIN` + `set_config` одной посылкой — по замеру нагрузки на серверном железе (D2).
4. `[ASSUMPTION]` Драйвер AMQP — `amqplib` 2.2.0 + `amqp-connection-manager` 5.0.1, как у всех сервисов; смена — мажор.
