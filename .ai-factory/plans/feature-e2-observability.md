# План реализации: E2 Наблюдаемость (`@verdeect/kit/observability`)

Mode: full
Branch: feature/e2-observability
Created: 2026-11-10

## Original Request
Реализуй этап roadmap «E2 Наблюдаемость» по пакету требований requirements/0000-kit/ (ревизия r6, PRD v1.11).

Скоуп этапа: AC-2.1–AC-2.13; prd.md §3.2 целиком (KitRedaction и SENSITIVE_KEYS, createLoggerOptions, sanitizeError и registerErrorSanitizer, initSentry для instrument.ts, captureError и captureThrottled, HealthRegistry, MetricsServer, kitMetrics, alerts/verdeect-kit.rules.yml, failStartup, KitLifecycle с участниками шагов 2–5 и сторожем срока); NFR-4, NFR-8, NFR-9; подпуть ./observability в exports и в проверках AC-1.1, AC-1.2; проект-потребитель (AC-9.1) — /ok, /health, /metrics и остановка по сигналу без HTTP-приложения (bootstrapService — E3); README и CHANGELOG [Unreleased] (AC-9.3). Перенос кода — по requirements/0000-kit/files/inventory.md: эталон O (sanitize-error, sentry-scrubber, instrument, metrics-server, health-registry, get-ok, observability.module, fail-startup, остановка), тесты эквивалентности — из таблицы §2 (I/P/O ac-10-3-log-redaction, sanitize-error.spec, fail-startup.spec, P ac-6-6-shutdown-deadline, O or-106-health-stopping-first). Репозитории сервисов — только чтение. AC уровня T — в test/timing. bootstrapService и createHttpApp — не в этом этапе (E3). Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION; код сервиса, расходящийся с prd.md, не переносится как есть (P0). Уже реализованный этап E1 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня.

## Settings
- Testing: yes (обязательно по правилу «Mandatory Test Phases»; уровни — по столбцу «Уровень» AC в prd.md §5).
- Logging: verbose с ограничением (ответ пользователя):
  - `debug` — шаги остановки `KitLifecycle`: начало и конец шага, участник, длительность в мс;
  - пробы здоровья — лог только при смене состояния пробы (up → down — `warn`, down → up — `info`), не на каждый запрос `/health` и `/metrics`;
  - остальное — как Standard: `fatal` у `failStartup`, `error` у сторожа срока и у упавшего участника, `info` — начало и конец остановки.
  - Все логи — только через `pino` (`console.*` в `src/**` запрещён, NFR-8). Поля `service` и `replica` берутся из `base` логгера, который строит `createLoggerOptions`.
- Docs: no — только `WARN [docs]`. README и CHANGELOG всё равно пишутся: их требует AC-9.3 (задачи 22–23).

## Roadmap Linkage
Milestone: "E2 Наблюдаемость"
Rationale: план реализует ровно скоуп вехи E2 из `.ai-factory/ROADMAP.md` и `requirements/0000-kit/README.md` (AC-2.1–AC-2.13, §3.2).

## Requirements Reconciliation

Authority (запрос пользователя, skill-context «Requirements Package Authority»). Решения чата kit по плану — сообщения KT-10 (п. 1–5) и KT-11 (сторож только при сигнале) от 10.11.2026, внесены в таблицу ниже:
1. `requirements/0000-kit/prd.md` v1.11 (ревизия r6);
2. `requirements/0000-kit/files/inventory.md`;
3. `.ai-factory/ROADMAP.md`, `.ai-factory/DESCRIPTION.md`, `.ai-factory/ARCHITECTURE.md`.

Milestone scope (только эти ID):
- критерии: AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-2.5, AC-2.6, AC-2.7, AC-2.8, AC-2.9, AC-2.10, AC-2.11, AC-2.12, AC-2.13;
- растущие сквозные: AC-1.1 и AC-1.2 (добавляется `/observability`), AC-9.1 (часть E2), AC-9.3 (API `/observability`);
- NFR: NFR-4, NFR-8, NFR-9;
- API: prd.md §3.2 целиком;
- UC (часть E2): UC-3, UC-4, UC-8, UC-13.

Вне скоупа: `bootstrapService`, `createHttpApp`, `/ok` (всё — E3, §3.5); AC-3.x–AC-8.x; AC-9.4 не меняется (правило lint E1 уже покрывает `src/**`); AC-9.5 — с E4.

| Решение | Источник | Проверка |
|---|---|---|
| `/ok` — в E3, вместе с `createHttpApp` (§3.5). В E2 потребитель проверяет `/health`, `/metrics` и остановку по сигналу. Запрос называл `/ok`, но в §3.2 его нет; решено пользователем при планировании | prd §3.2, §3.5, UC-13; ответ пользователя | задача 21 |
| Метрики — `prom-client` (обязательный peer NFR-3). У эталона O — `@prometheus-io/client`, не переносится | prd §3.2, NFR-3, P0 | задачи 1, 8, 17 |
| Реестр — свой у каждого экземпляра приложения: `new Registry()`, `setDefaultLabels({service})`, `collectDefaultMetrics({register})`. Глобального реестра нет. У O нет меток по умолчанию и метрик процесса — берём PRD | prd §3.2, AC-2.8, ARCHITECTURE «Антипаттерны» | задачи 8, 17 |
| Стоп-флаг — в `HealthRegistry` (`markStopping()`), а не в `MetricsServer`, как у O | prd §3.2 «HealthRegistry… с начала остановки — 503» | задачи 7, 17, 18 |
| Ветки `sanitizeError`: pg/Drizzle — эталон O; ioredis — эталон B (`verdeect-bff/apps/bff/src/shared/observability/sanitize-error.ts`). SMTP (I) в пакет не идёт: Identity подключает её через `registerErrorSanitizer` (§10) | prd §3.2, §10 Identity; inventory §1 | задачи 3, 14 |
| Ошибка Drizzle распознаётся по форме (`name`/`type === 'DrizzleQueryError'`), без `instanceof` и импорта `drizzle-orm`. У O — `instanceof DrizzleQueryError` | prd §3.2 «без импорта библиотек» | задачи 3, 14 |
| Цепочка `cause`: обход не глубже 10 звеньев; у результата цепочка тоже обрезается на 10-м звене (глубже не уходит ни в лог, ни в GlitchTip); цикл `cause` не зацикливает | prd §3.2, AC-2.3 | задачи 3, 14 |
| `SENSITIVE_KEYS` — ровно список §3.2; ключи O, I, P, B вне списка (`text`, `prompt`, `csrfToken`, `stepToken` …) — в `KitRedaction.sensitiveKeys` своего сервиса. Пустой `sensitiveKeys` базовый список не отключает | prd §3.2 (GAP-8), P0 | задачи 2, 13 |
| Имя разворачивается на уровни 0–2: `k`, `*.k`, `*.*.k`. Имя с символом вне `[A-Za-z0-9_]` — в скобках: `*.*["set-cookie"]`. `body.code` → `body.code`, `*.body.code`, `*.*.body.code` | prd §3.2 | задачи 2, 13 |
| Один список имён для логов и GlitchTip: скраббер событий сравнивает имена без учёта регистра, имя с точкой (`body.code`) — по паре «родитель.ключ». Голый `code` не скрывается | prd §3.2 (O1, O3, GAP-6) | задачи 2, 5, 15 |
| Опции `createLoggerOptions` дополнены параметром `env: Pick<KitBaseEnv, 'REPLICA_ID' \| 'LOG_LEVEL'>`. Модули пакета читают ключи через типы `KitBaseEnv` (§3.1). Своего `process.env` в пакете нет, кроме `initSentry`. В E3 `bootstrapService` передаст сюда разобранное окружение (KT-10 п. 1) | prd §3.1, §3.2; KT-10 | задачи 4, 13, 21 |
| `createLoggerOptions` возвращает `Params` `nestjs-pino`, где `pinoHttp` — кортеж `[options, stream]`: HTTP — `process.stdout`, CLI — `process.stderr`. Логгер вне Nest получают так: `pino(...params.pinoHttp)` (так делают `failStartup` и потребитель) | prd §3.2; эталон O `httpLoggerOptions` | задачи 4, 21 |
| `quietRoutes` — массив префиксов пути. Успешный ответ такого маршрута пишется на `debug`, ошибка или статус ≥ 500 — на `info`, как обычно. Эталоны: P — `/v1/authz/`, O — `/internal/v1/llm/` | prd §3.2, AC-2.12 | задачи 4, 13 |
| Новый trace-id — 32 hex (`randomBytes(16)`), по W3C, как у B. У O — `randomUUID()` | prd §3.2, AC-2.2 | задачи 4, 13 |
| `initSentry` возвращает `boolean` (включён ли). `process.env` разбирает через `envSentry` и `safeParse`: при ошибке Sentry выключен, без исключения и без лога (до Nest логгера нет, `console` запрещён) DSN неверной формы отсекается до `Sentry.init`: SDK сам печатает `Invalid Sentry Dsn: <значение>` (NFR-4) | prd §3.2, AC-2.4, NFR-4 | задачи 5, 15 |
| `captureError` помечает исходный объект ошибки в `WeakSet`. Повторный вызов с той же ошибкой ничего не отправляет. `captureThrottled` учитывает пометку и шлёт одно событие за окно на ключ в процессе | prd §3.2, AC-2.6 | задачи 5, 15 |
| `failStartup(raw, logger): Promise<never>` — ветки `InvalidEnvironmentError`, `StartupFailure` (распознаётся по форме: `startupCode` — строка, `startupDetails` — функция) и прочее (`sanitizeError`). Затем `Sentry.flush(2000)` и `process.exit(1)`. Доменная ветка O `ModelCatalogError` не переносится | prd §3.2, AC-2.9 | задачи 6, 16 |
| `KitLifecycle` — явная регистрация `register(participant, {step})`. Участники шага работают параллельно, следующий шаг начинается после завершения предыдущего. Два режима (KT-11): **по сигналу ОС** (`SIGTERM`, `SIGINT` через `listen()`) — сторож, ошибка участника → `error` + `captureError`, остановка продолжается; **программное закрытие** `close()` (`app.close()` в тестах сервисов, хуки Nest не по сигналу, CLI) — те же шаг 1 (`/health` 503, пауза `SHUTDOWN_DRAIN_MS`) и шаги 2–5 в том же порядке, но без сторожа, без `unref()`-таймера и без `exit`; ошибка участника → `error`-лог, остальные шаги выполняются, затем `close()` отклоняется этой ошибкой (несколько — `AggregateError`) | prd §3.2 (шаги 1–5), AC-2.10; KT-11 | задачи 10, 17, 19 |
| Код сторожа — `SHUTDOWN_TIMEOUT` (не `SHUTDOWN_DEADLINE`); шаг 1 (`/health` 503 и пауза `SHUTDOWN_DRAIN_MS`) одинаков в режиме сигнала и в `close()` — подтверждено чатом kit после KT-11 | KT-11, ответ чата kit | задачи 10, 17, 19 |
| Только в режиме сигнала (KT-11). Успешная остановка не вызывает `process.exit` (в том числе `exit(0)`). Сторож не снимается, а переводится в `unref()`: без открытых дескрипторов процесс завершается сам с кодом 0 (UC-8 п. 6). Если процесс не завершился к сроку `SHUTDOWN_TIMEOUT_MS` от сигнала (утёк таймер или сокет), сторож пишет `error` «процесс не завершился после остановки» (код `SHUTDOWN_NOT_EXITED`), отправляет событие GlitchTip и вызывает `exit(1)`. `process.exit(1)` — только у сторожа и `failStartup` (KT-10 п. 4) | prd §3.2, UC-8; KT-10 | задачи 10, 17, 19, 21 |
| Сторож срока — только при остановке по сигналу ОС (KT-11): таймер `SHUTDOWN_TIMEOUT_MS` от сигнала (пауза входит). Сигнал во время программного `close()` взводит сторож от момента сигнала и присоединяется к уже идущей остановке. По сроку: `error`-лог с кодом `SHUTDOWN_TIMEOUT`, шагом и незавершёнными участниками, событие GlitchTip, `Sentry.flush(2000)`, `exit(1)` | prd §3.2 (CE-7), AC-2.10 | задачи 10, 19 |
| Ошибка прослушивания `MetricsServer` (например, `EADDRINUSE`) — отказ `listen()`, вызывающий отправит её в `failStartup`; у O запуск идёт дальше без метрик (принято, KT-10 п. 2). `METRICS_PORT=0` — порт выбирает ОС, а не выключение сервера: `address()` возвращает выбранный порт | prd §3.2 (молчит); эталон O; KT-10 | задачи 9, 18 |
| `alertRulesTemplate` — экспорт `/observability`: абсолютный путь к `alerts/verdeect-kit.rules.yml` внутри установленного пакета. Каталог `alerts` входит в `files`, присутствие файла в архиве проверяет `pack-check` (принято, KT-10 п. 3) | prd §3.2 «`alertRulesTemplate` (файл …)», ARCHITECTURE «Сборка и загрузка» | задачи 1, 8, 21 |
| Пороги алертов по умолчанию (пороги правил P, ответ пользователя): `verdeect_outbox_lag_seconds` > 5 за 1m; `verdeect_outbox_pending` > 1000 за 5m; `increase(verdeect_events_consumed_total{result="dlq"}[15m])` > 0; `increase(verdeect_db_pool_wait_timeouts_total[5m])` > 0; `increase(verdeect_rate_limit_unavailable_total[5m])` > 0. Переопределение — recording-правило сервиса `verdeect_kit_threshold:<метрика>` с меткой `service` | prd §3.2, AC-2.11 | задачи 12, 20 |
| Шаблона «порог + переопределение по `service`» нет ни в одном сервисе: пороги вшиты в `expr`. Шаблон пишется по PRD, а не переносится | разведка O/P/B | задача 12 |
| Эталона сторожа срока с `exit(1)` нет: у P и O только общий срок `shutdownDeadline()` без `exit`. P `ac-6-6-shutdown-deadline` — образец общего срока от первого вызова; тест AC-2.10 по PRD — на поддельных участниках | разведка P/O; prd AC-2.10 | задача 19 |
| `[OPEN]` §11 п. 2 `SHUTDOWN_DRAIN_MS` — значение по замеру. Пакет не задаёт значение: умолчание 0 уже есть в `envBase` (E1), AC-2.13 проверяет механизм на 500 мс | prd §11 | — |

Сочетания режимов (поведение с независимыми входами):

| Вход | Сочетание | Результат | Проверка |
|---|---|---|---|
| `entry` × `trustTraceparent` | `http` + умолч. | trace-id из `traceparent`, иначе новый | AC-2.2 |
| | `http` + `false` | всегда новый trace-id | AC-2.2 |
| | `cli` | stderr, журнала доступа нет (`autoLogging: false`) | задача 13 «§3.2: entry cli» |
| `quietRoutes` × исход | префикс + 2xx | `debug` | AC-2.12 |
| | префикс + ошибка или ≥ 500 | `info` | AC-2.12 |
| | `/ok` | вне журнала доступа | AC-2.1 |
| `SENTRY_DSN` × `NODE_ENV` | пусто × любое | выключен | AC-2.4 |
| | задан × ≠ `production` | выключен | AC-2.4 |
| | задан × `production` или не задан | включён | AC-2.4 |
| | неверный `SENTRY_*` | выключен, без исключения | AC-2.4 |
| пробы × остановка | все up | 200 `ok` | AC-2.7 |
| | некритичная down | 200 `degraded` | AC-2.7 |
| | критичная down или дольше 2 с | 503 `unavailable` | AC-2.7 |
| | после начала остановки (сигнал или `close()`) | 503 `unavailable` | AC-2.7 |
| остановка | программная `close()` | шаги 1–5 по порядку, `/health` 503, сторожа и `exit` нет; ошибка участника — проброс из `close()` | задача 17 (KT-11) |
| | сигнал, в срок, без утечек | шаги 1–5 по порядку, сторож unref, выход 0 сам | AC-2.10, AC-9.1 |
| | сигнал, в срок, утёк таймер или сокет | к сроку `error` «процесс не завершился после остановки», GlitchTip, выход 1 | AC-2.10 (KT-10) |
| | сигнал, пауза + шаги > срока | `error`, GlitchTip, выход 1 | AC-2.10 |
| | `SHUTDOWN_DRAIN_MS = 500` | шаг 2 не раньше, чем через 500 мс после шага 1 | AC-2.13 |

Опорный реальный артефакт: проект-потребитель `test/consumer/minimal` ставит упакованный архив и запускает процесс сервиса по форме production: `node --import ./service/instrument.mjs service/main.mjs`. Затем он проверяет `/health`, `/metrics` и остановку по `SIGTERM` (задача 21).

## Architecture and Decisions
- Подпуть `src/observability/` по `.ai-factory/ARCHITECTURE.md`: импортирует только `config`, `internal` и peer (`nestjs-pino`, `pino`, `prom-client`, `@sentry/nestjs`). Опциональных peer нет, поэтому `loadPeer` не нужен. Подпуть грузится без `pg` и `testcontainers` (AC-1.2).
- Nest-модуля в §3.2 нет, его и не делаем. `HealthRegistry`, `MetricsServer`, `KitLifecycle` — обычные классы с объектом опций в конструкторе. В E3 их соберёт `bootstrapService`.
- Логгер в опциях классов — `pino.Logger` (тип из `pino`, обязательный peer).
- Типы опций и параметров (`KitLoggerOptions`, `KitLoggerParams`, `KitSentryOptions`, `HealthProbe`, `HealthReport`, `KitMetrics`, `KitShutdownParticipant`, `KitShutdownStep`) экспортируются через `export type`: они нужны в `.d.ts` сигнатур §3.2. `scrubEvent`, `scrubBreadcrumb`, `sanitizeLogObject`, `serializeError`, `redactPaths` — внутренние, из `index.ts` не экспортируются.
- Каждый файл начинается с шапки: назначение, ID требований, эталон (`inventory.md` §1) и что взято из других копий (rules/base.md).
- Внешние API (`nestjs-pino` 5.3 `Params`, `pino-http` 11 `customLogLevel`/`genReqId`/`autoLogging`, `prom-client` 15 `Registry`/`collectDefaultMetrics`/`setDefaultLabels`, `@sentry/nestjs` 11 `init`/`dataCollection`/`flush`/транспорт для тестов, vmalert `-dryRun`) сверяются через Context7 перед кодом (skill-context `/aif-implement`).
- Слоёв сервиса из `nestjs-specialist` нет. Компоненты — `nestjs-code generic <path>`, тесты — `nestjs-code test <unit|integration> <target>`, обоснование — «компонент библиотеки, не сервиса». CLAUDE.md модулей не генерируются: в библиотеке нет `src/modules/`.

## Tasks

### Фаза 1: Манифест и границы подпути

- [x] **Task 1: `package.json`, ESLint и тест манифеста для `/observability`** — AC-1.1, NFR-3
  - **Skill:** none — манифест и конфиг lint (не код); тест — `nestjs-code test unit package package-manifest (MODIFY)`
  - Файлы: `package.json`, `pnpm-lock.yaml`, `eslint.config.js`, `test/unit/package/package-manifest.spec.ts`.
  - `exports`: добавить `"./observability": {"types": "./dist/observability/index.d.ts", "default": "./dist/observability/index.js"}` между `./config` и `./testing`. Остальные записи не менять.
  - `files`: добавить `"alerts"` (каталог шаблона, prd §3.2).
  - `devDependencies` (точные версии по inventory §3; тест «NFR-3: devDependencies — точные версии»): `nestjs-pino` 5.3.1, `pino` 10.4.0, `pino-http` 11.0.0, `prom-client` 15.1.3, `@sentry/nestjs` 11.7.0, `@nestjs/platform-fastify` 12.1.3, `fastify` 5.12.5 (два последних — для Nest + Fastify в тесте AC-2.1). Если поддельный транспорт Sentry требует `createTransport` из `@sentry/core` и `@sentry/nestjs` его не реэкспортирует (проверить в Context7), добавить `@sentry/core` той же версии, что и у `@sentry/nestjs`. `pnpm install` обновляет lockfile. Peer не менять.
  - `eslint.config.js`: блок `files: ['src/observability/**/*.ts']` с `restrictedImports([{group: ['../testing/*', '../http/*', '../database/*', '../idempotency/*', '../messaging/*', '../redis/*', '../crypto/*', 'shell-quote'], message: 'observability импортирует только config и internal (ARCHITECTURE.md).'}])`.
  - Тест манифеста: `AC-1.1: exports — ровно ./config, ./observability, ./testing, ./package.json`; новый случай `AC-1.1: ./observability — {types, default} на dist/observability/index.*`; новый случай `§3.2: files содержит alerts`.
  - Логи: нет (манифест).
  - Готово, когда: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm exec vitest run test/unit/package` зелёные.

### Фаза 2: Редактирование, ошибки, логи, GlitchTip

- [x] **Task 2: `redaction.ts` — `SENSITIVE_KEYS`, `KitRedaction`, развёртка путей** — §3.2, NFR-4 (depends on 1)
  - **Skill:** nestjs-code generic src/observability/redaction.ts (CREATE)
  - Шапка: `// Список чувствительных имён и KitRedaction (prd.md §3.2, O1, O3, GAP-6, GAP-8; NFR-4). Эталон — REDACT_PATHS O observability.module.ts; имена — по PRD, ключи сервисов (O ORCHESTRATOR_KEYS, I csrfToken/stepToken) — в KitRedaction сервиса.`
  - API:
    ```ts
    export const SENSITIVE_KEYS: readonly string[] = Object.freeze([
        'authorization', 'cookie', 'set-cookie', 'idempotency-key',
        'password', 'newPassword', 'currentPassword', 'secret', 'clientSecret', 'token', 'access_token',
        'refresh_token', 'id_token', 'logout_token', 'accessToken', 'code_verifier', 'nonce',
        'email', 'givenName', 'familyName', 'middleName', 'body.code', 'body.state',
    ]);
    export interface KitRedaction { readonly sensitiveKeys?: readonly string[]; readonly maskPath?: (path: string) => string; }
    export function sensitiveNames(redaction?: KitRedaction): readonly string[]; // SENSITIVE_KEYS ∪ sensitiveKeys без дублей; базовый список всегда
    export function redactPaths(redaction?: KitRedaction): string[];            // пути pino: k, *.k, *.*.k; сегмент вне [A-Za-z0-9_] → ["…"]
    export function maskPathOf(redaction?: KitRedaction): (path: string) => string; // умолч. — тождество
    ```
  - TSDoc у каждого экспорта; у `KitRedaction` — правило «`src/redaction.ts` сервиса импортирует только типы из `@verdeect/kit/observability`» (GAP-9).
  - Логи: нет (чистые функции).

- [x] **Task 3: `sanitize-error.ts` — `sanitizeError`, `registerErrorSanitizer`** — §3.2, AC-2.3, NFR-4 (depends on 1)
  - **Skill:** nestjs-code generic src/observability/sanitize-error.ts (CREATE)
  - Эталон: `/home/administrator/projects/verdeect2/verdeect-orchestrator/apps/orchestrator/src/shared/observability/sanitize-error.ts` (123 строки): `SanitizedDbError`, проверка pg по форме (`code` ~ `/^[\dA-Z]{5}$/` + строковый `severity`), сообщение `Failed query` / `Failed query (<code>)`, стек без первой строки, `sanitizeLogObject`, `serializeError`. Ветка ioredis — из `/home/administrator/projects/verdeect2/verdeect-bff/apps/bff/src/shared/observability/sanitize-error.ts` (`SanitizedRedisError`: `name`, `code`, имя команды, без `args`).
  - Отличия от эталона по PRD: Drizzle — по форме (`name === 'DrizzleQueryError'` или `type === 'DrizzleQueryError'`), без импорта `drizzle-orm`; `pino` — только `stdSerializers` (обязательный peer).
  - API:
    ```ts
    export function sanitizeError(error: unknown): unknown;
    export function registerErrorSanitizer(match: (error: unknown) => boolean, sanitize: (error: unknown) => Error): void;
    // внутренние (не в index.ts): sanitizeLogObject (pino formatters.log), serializeError (serializers.err), MAX_CAUSE_DEPTH = 10
    ```
  - Порядок: уже очищенная ошибка (`SanitizedDbError`, `SanitizedRedisError`, результат зарегистрированной ветки — пометка в `WeakSet`) возвращается как есть. Иначе применяются ветки pg/Drizzle, ioredis, затем зарегистрированные в порядке регистрации; срабатывает первая. Каждая ветка смотрит цепочку `cause` до 10 звеньев. Ветки нет → исходная ошибка; если цепочка `cause` глубже 10, возвращается копия с обрезанной цепочкой. Цикл `cause` не зацикливает.
  - `registerErrorSanitizer` — глобально на процесс; повторная регистрация того же `match` игнорируется.
  - Логи: нет.

- [x] **Task 4: `logger-options.ts` — `createLoggerOptions`** — §3.2, AC-2.1, AC-2.2, AC-2.12, NFR-4, NFR-8 (depends on 2, 3)
  - **Skill:** nestjs-code generic src/observability/logger-options.ts (CREATE)
  - Эталон: O `observability.module.ts` (`requestId`, `serializeRequest`, `pinoOptions`, `accessLogLevel`, `httpLoggerOptions`, потоки stdout/stderr); `trustTraceparent: false` — B `observability.module.ts` (`randomBytes(16).toString('hex')`); `quietRoutes` — P `accessLogLevel` (`QUIET_ACCESS_PREFIX`).
  - API:
    ```ts
    export interface KitLoggerOptions {
        readonly service: string; readonly entry: 'http' | 'cli';
        readonly env: Pick<KitBaseEnv, 'REPLICA_ID' | 'LOG_LEVEL'>; readonly trustTraceparent?: boolean;
        readonly quietRoutes?: readonly string[]; readonly extraBase?: Readonly<Record<string, unknown>>;
        readonly redaction?: KitRedaction;
    }
    type PinoHttpOptions = Extract<NonNullable<Params['pinoHttp']>, readonly unknown[]>[0];
    export type KitLoggerParams = Params & {
        readonly pinoHttp: [PinoHttpOptions & { genReqId: (req: IncomingMessage) => string }, DestinationStream];
    };
    // genReqId реализуется как (req: IncomingMessage) => string: подходит и GenReqId pino-http ((req, res) => ReqId),
    // и genReqId Fastify ((req) => string). Без сужения new FastifyAdapter({genReqId: …}) даёт TS2322.
    export function createLoggerOptions(options: KitLoggerOptions): KitLoggerParams; // кортеж [options, stream]: в nestjs-pino 5.3 Params['pinoHttp'] — союз, без сужения pino(...params.pinoHttp) не типизируется
    ```
  - Состав: `level: env.LOG_LEVEL`; `base: {service, entry, replica: env.REPLICA_ID, ...extraBase}`; `redact: {paths: redactPaths(redaction), censor: '[Filtered]'}`; `formatters.log: sanitizeLogObject`; `serializers: {err: serializeError, req: ({id, method, url}) → {id, method, url: maskPath(url без query)}}`; `genReqId` — trace-id из `traceparent` (`/^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/`) при `trustTraceparent !== false`, иначе `randomBytes(16).toString('hex')`; `customProps: (req) => ({traceId: req.id})`; `customLogLevel`: ошибка или статус ≥ 500 → `info` (4xx — `info`, как у эталонов), успешный ответ маршрута с префиксом из `quietRoutes` → `debug`, иначе `info`; `autoLogging` — для `http` `{ignore: (req) => path === '/ok'}`, для `cli` — `false`; поток — `process.stdout` (http) или `process.stderr` (cli).
  - `assertServiceName(service, 'createLoggerOptions')` из `src/internal/service-name.ts` (не дублировать).
  - TSDoc `createLoggerOptions`: на Fastify `genReqId` из `pinoHttp` не вызывается. Fastify ставит свой `request.id`, а pino-http оставляет уже заданный (`req.id = req.id || genReqId(…)`, pino-http 11 `logger.js`; README nestjs-pino: «pass the generator to the adapter»). Поэтому HTTP-адаптер получает тот же генератор: `new FastifyAdapter({genReqId: params.pinoHttp[0].genReqId})`. Так делают O, P и B в `main.ts`; в E3 это подключит `createHttpApp`.
  - Логи: нет (фабрика опций).

- [x] **Task 5: `sentry.ts` — `initSentry`, скраббер, `captureError`, `captureThrottled`** — §3.2, AC-2.4, AC-2.5, AC-2.6, AC-2.12, NFR-4 (depends on 2, 3)
  - **Skill:** nestjs-code generic src/observability/sentry.ts (CREATE)
  - Эталоны: O `instrument.ts` (`NO_PERSONAL_DATA`, условие включения, `tracesSampleRate: 0`, `beforeSend`/`beforeBreadcrumb`); O `sentry-scrubber.ts` (`scrubValue` с `[Filtered]`, глубина 8 → `[Truncated]`, заголовки, `user` → `{id}`, `PARAMS_TAIL = /\nparams:[\s\S]*$/`, `KEY_VALUE = /Key \([^)]*\)=\([^)]*\)/g` → `Key [Filtered]`, запасной путь при исключении); троттлинг — O `pool-timeout-reporter.ts` (окно 60 с, `performance.now()`, начальное `-Infinity`).
  - Отличия по PRD: имена — `sensitiveNames(redaction)` вместо `SCRUBBED_KEYS` O (без доменных `text`, `prompt` …, без `dsn` — он в PRD не назван); query удаляется целиком — и `request.query_string`, и хвост `?…` в `request.url` (у O — только скраб значений); `request.url` проходит через `maskPath`; `request.data` и `cookies` удаляются; заголовки `authorization`, `cookie`, `set-cookie`, `x-forwarded-for` удаляются.
  - API:
    ```ts
    export interface KitSentryOptions { readonly service: string; readonly redaction?: KitRedaction; }
    export function initSentry(options: KitSentryOptions): boolean;
    export function captureError(error: unknown, context?: { readonly tags?: Readonly<Record<string, string>>; readonly extra?: Readonly<Record<string, unknown>> }): void;
    export function captureThrottled(key: string, error: unknown, options?: { readonly windowMs?: number }): boolean; // true — событие отправлено
    // внутренние: scrubEvent(event, originalException, redaction), scrubBreadcrumb(crumb, redaction), NO_PERSONAL_DATA
    ```
  - `initSentry`: `z.object(envSentry).safeParse(process.env)` (`envSentry` — из `../config/fragments.js`, не из `../config/index.js`: индекс реэкспортирует `KitConfigModule`, а тот как значение импортирует `@nestjs/config` → `@nestjs/common`, и `instrument.ts` загрузил бы Nest до `Sentry.init`, против ранней инициализации §3.2, LE-5). Неуспех, пустой DSN, DSN неверной формы или `NODE_ENV ≠ production` → `false`, `Sentry.init` не вызывается, исключения и лога нет. Форма DSN проверяется до `Sentry.init` по сырой строке — тем же выражением, что `DSN_REGEX` в `@sentry/core` `utils/dsn.js`: `/^(?:(\w+):)\/\/(?:(\w+)(?::(\w+)?)?@)((?:\[[:.%\w]+\]|[\w.-]+))(?::(\d+))?\/(.+)/`, плюс протокол `http|https` и последний сегмент пути `^\d+$`. `URL.canParse` мягче: `https://pub-key@example.invalid/1` он принимает, а SDK — нет. Иначе `@sentry/core` (`utils/dsn.js` `dsnFromString`) сам печатает `Invalid Sentry Dsn: <значение>` через `console.error` (NFR-4) и создаёт клиента без DSN, а `initSentry` вернул бы `true`. Иначе `Sentry.init({dsn, environment: SENTRY_ENVIRONMENT ?? 'production', release?, dataCollection: NO_PERSONAL_DATA, tracesSampleRate: 0, initialScope: {tags: {service}}, beforeSend: (e, hint) => scrubEvent(e, hint.originalException, redaction), beforeBreadcrumb: (c) => scrubBreadcrumb(c, redaction)})` → `true`.
  - `captureError`: ошибка уже в `WeakSet` отправленных — выход; иначе `Sentry.captureException(sanitizeError(error), context)` и пометка исходного объекта. Не-объект — без пометки.
  - `captureThrottled`: `Map<string, number>` на процесс; в окне `windowMs` (умолч. 60 000) — `false` без отправки; иначе `captureError` → `true`. Уже отправленная ошибка — `false`.
  - Логи: нет (до Nest логгера нет; события — в GlitchTip).

- [x] **Task 6: `fail-startup.ts` — `failStartup`, `StartupFailure`** — §3.2, AC-2.9, UC-3, NFR-9 (depends on 3, 5)
  - **Skill:** nestjs-code generic src/observability/fail-startup.ts (CREATE)
  - Эталон: `/home/administrator/projects/verdeect2/verdeect-orchestrator/apps/orchestrator/src/shared/observability/fail-startup.ts` (32 строки). Доменная ветка `ModelCatalogError` заменяется интерфейсом `StartupFailure`; параметр `exit` эталона не переносится (тесты подменяют `process.exit` через `vi.spyOn`).
  - API:
    ```ts
    export interface StartupFailure { readonly startupCode: string; startupDetails(): Readonly<Record<string, unknown>>; }
    export async function failStartup(raw: unknown, logger: pino.Logger): Promise<never>;
    ```
  - Импорты: `InvalidEnvironmentError` — из `../config/parse-env.js`. Ни один файл `src/observability/**` не импортирует `../config/index.js`. `Params`, `Registry` и `Logger` — через `import type`, где хватает типа.
  - Ветки: `InvalidEnvironmentError` → `logger.fatal({code: raw.code, keys: raw.keys}, 'Неверное окружение — запуск остановлен')`, только имена ключей; `StartupFailure` (по форме) → `fatal({code: startupCode, ...startupDetails()}, 'Отказ запуска')`; прочее → `fatal({err: sanitizeError(raw)}, 'Отказ запуска')`. Затем `captureError(raw, {tags: {code}})`, `await Sentry.flush(2000)`, `process.exit(1)`.
  - Логи: `fatal` — одна строка на отказ (поля `service`, `replica` — из `base` логгера).

### Фаза 3: Здоровье, метрики, остановка, точка входа

- [x] **Task 7: `health-registry.ts` — `HealthRegistry`** — §3.2, AC-2.7, UC-13 (depends on 3)
  - **Skill:** nestjs-code generic src/observability/health-registry.ts (CREATE)
  - Эталон: O `health-registry.ts` (85 строк): параллельные пробы, гонка с 2 с, исключение пробы → down, повторная регистрация имени заменяет пробу. Отличия: имя — `string`, а не союз O `HealthCheckName`; `critical` — в объекте опций; стоп-флаг — здесь (PRD).
  - API:
    ```ts
    export type HealthProbe = () => Promise<boolean>;
    export interface HealthReport { readonly status: 'ok' | 'degraded' | 'unavailable'; readonly checks: Readonly<Record<string, 'up' | 'down'>>; }
    export class HealthRegistry {
        constructor(options: { readonly logger: pino.Logger });
        register(name: string, probe: HealthProbe, options: { readonly critical: boolean }): void;
        markStopping(): void; get isStopping(): boolean;
        evaluate(): Promise<HealthReport>; // при isStopping — {status: 'unavailable', checks: {}} без запуска проб
    }
    ```
  - Срок пробы — `PROBE_TIMEOUT_MS = 2000`, таймер снимается после ответа.
  - Логи: только при смене состояния пробы — `warn({check, critical, err?: sanitizeError(e)}, 'проба здоровья: down')` при up → down (и при первом результате down), `info({check}, 'проба здоровья: up')` при down → up. Первый результат up — без лога. На каждый вызов `evaluate` логов нет.

- [x] **Task 8: `metrics.ts` — `kitMetrics`, `alertRulesTemplate`** — §3.2, AC-2.8, AC-2.11 (depends on 1)
  - **Skill:** nestjs-code generic src/observability/metrics.ts (CREATE)
  - Эталон: O `metrics-server.ts` (`readonly registry = new Registry()` на экземпляр) и O `orch-metrics.ts` (метрики на реестре экземпляра). Отличия: `prom-client`, метки по умолчанию, метрики процесса Node, имена `verdeect_*` (PRD).
  - API:
    ```ts
    export interface KitMetrics {
        readonly registry: Registry;
        readonly outboxPending: Gauge; readonly outboxLagSeconds: Gauge;
        readonly eventsConsumed: Counter<'type' | 'result'>; // result: handled | duplicate | retry | dlq
        readonly dbPoolWaitTimeouts: Counter<'pool'>; readonly rateLimitUnavailable: Counter;
    }
    export function kitMetrics(options: { readonly service: string }): KitMetrics;
    export const alertRulesTemplate: string; // fileURLToPath(new URL('../../alerts/verdeect-kit.rules.yml', import.meta.url))
    ```
  - `new Registry()`, `registry.setDefaultLabels({service})`, `collectDefaultMetrics({register: registry})`; метрики — с `registers: [registry]`, имена ровно по §3.2. Метрики домена — вне пакета.
  - Логи: нет.

- [x] **Task 9: `metrics-server.ts` — `MetricsServer`** — §3.2, AC-2.7, AC-2.8, UC-13 (depends on 5, 7, 8)
  - **Skill:** nestjs-code generic src/observability/metrics-server.ts (CREATE)
  - Эталон: `/home/administrator/projects/verdeect2/verdeect-orchestrator/apps/orchestrator/src/shared/observability/metrics-server.ts` (151 строка): `node:http`, учёт `inflight`, query отбрасывается, `/health` — JSON с `cache-control: no-store`, `/metrics` — `registry.metrics()` с `registry.contentType`, прочее — 404, закрытие `closeAllConnections` + `close` + ожидание `inflight`, `address()` для порта 0. Отличия: без Nest-хуков (закрытие — участник шага 5 `KitLifecycle`); стоп-флаг читается из `HealthRegistry`; ошибка `listen` → отказ (KT-10 п. 2); `port: 0` — порт выбирает ОС, `address()` возвращает его (не выключение).
  - API:
    ```ts
    export class MetricsServer {
        constructor(options: { readonly port: number; readonly registry: Registry; readonly health: HealthRegistry; readonly logger: pino.Logger });
        listen(): Promise<void>; address(): number | null; close(): Promise<void>; // close идемпотентен
    }
    ```
  - Ответы: `/health` — 503 при `unavailable` (в том числе при остановке), иначе 200, тело `HealthReport`; исключение `evaluate` или `metrics()` → 503/500 и `captureError`.
  - Логи: `info({port}, 'сервер метрик слушает')` при старте, `debug('сервер метрик закрыт')` при закрытии. Строк на запрос `/health` и `/metrics` нет (ответ пользователя). Исключение → `error({err: sanitizeError(e)})`.

- [x] **Task 10: `lifecycle.ts` — `KitLifecycle`** — §3.2, AC-2.10, AC-2.13, UC-8, NFR-8 (depends on 5, 7)
  - **Skill:** nestjs-code generic src/observability/lifecycle.ts (CREATE)
  - Эталоны: общий срок от первого вызова — P/O `RabbitConnection.shutdownDeadline()` (`verdeect-platform/apps/platform/src/shared/messaging/rabbit-connection.ts` ≈ стр. 293); флаг остановки первым действием — O `instance-shutdown.ts` `begin()`. Механизм шагов и сторож с `exit(1)` пишутся по PRD: эталона нет.
  - API:
    ```ts
    export type KitShutdownStep = 2 | 3 | 4 | 5;
    export interface KitShutdownParticipant { readonly name: string; stop(): Promise<void> | void; }
    export class KitLifecycle {
        constructor(options: { readonly logger: pino.Logger; readonly health: HealthRegistry;
            readonly env: Pick<KitBaseEnv, 'SHUTDOWN_TIMEOUT_MS' | 'SHUTDOWN_DRAIN_MS'> });
        register(participant: KitShutdownParticipant, options: { readonly step: KitShutdownStep }): void;
        listen(signals?: readonly NodeJS.Signals[]): void; // умолч. ['SIGTERM', 'SIGINT'], process.on (не once): повторный сигнал попадает в тот же идемпотентный обработчик, а не в действие Node по умолчанию (выход 143/130 посреди шагов); обработчик — режим сигнала
        close(): Promise<void>;                            // программное закрытие: без сторожа и exit; ошибки участников — проброс
    }
    // Остановка одна на экземпляр: повторный close() или сигнал возвращают тот же промис шагов.
    ```
  - Режимы (KT-11): сторож и `exit(1)` — только в режиме сигнала (обработчик `listen()`). `close()` выполняет те же шаги без сторожа, без `unref()`-таймера и без `process.exit`. Сигнал, пришедший во время `close()`, взводит сторож от момента сигнала и не запускает шаги повторно.
  - Порядок (номера шагов — в комментариях кода, rules/base.md «Поток управления»): t0 — сигнал (только в режиме сигнала взводится сторож `setTimeout(SHUTDOWN_TIMEOUT_MS)`). Шаг 1 — `health.markStopping()` и пауза `SHUTDOWN_DRAIN_MS`. Шаги 2–5 — участники шага параллельно (`Promise.allSettled`), следующий шаг — после завершения предыдущего. Ошибка участника: в режиме сигнала → `error` + `captureError`, работа продолжается; в режиме `close()` → `error`-лог, остальные шаги выполняются, затем `close()` отклоняется ошибкой участника (несколько — `AggregateError`). Конец в режиме сигнала → сторож переводится в `unref()` (не снимается), `process.exit` не вызывается: без открытых дескрипторов процесс выходит сам с кодом 0 (KT-10 п. 4).
  - Сторож по сроку, пока шаги не завершены: `logger.error({code: 'SHUTDOWN_TIMEOUT', step, pending: [имена], timeoutMs}, 'срок остановки истёк')`, `captureError(new Error('Срок остановки истёк'), {tags: {code: 'SHUTDOWN_TIMEOUT'}})`, `await Sentry.flush(2000)`, `process.exit(1)`.
  - Сторож по сроку после завершения шагов (процесс держит утёкший таймер или сокет): `logger.error({code: 'SHUTDOWN_NOT_EXITED', timeoutMs}, 'процесс не завершился после остановки')`, `captureError(new Error('Процесс не завершился после остановки'), {tags: {code: 'SHUTDOWN_NOT_EXITED'}})`, `await Sentry.flush(2000)`, `process.exit(1)`.
  - `register` после начала остановки → `Error` разработчика (`'KitLifecycle: регистрация после начала остановки'`).
  - Логи: `info({signal | mode: 'close'}, 'остановка: начало')`, `debug({step, participants}, 'остановка: шаг начат')`, `debug({step, participant, durationMs}, 'остановка: участник завершён')`, `debug({step, durationMs}, 'остановка: шаг завершён')`, `info({durationMs}, 'остановка: завершена')`, `error` — участник упал или срок истёк. `service` и `replica` — из `base` логгера (NFR-8).

- [x] **Task 11: `src/observability/index.ts`** — §3.2, AC-1.1 (depends on 2–10)
  - **Skill:** nestjs-code generic src/observability/index.ts (CREATE)
  - Шапка: `// Публичная поверхность @verdeect/kit/observability (prd.md §3.2). Всё, что не перечислено, — не экспортируется.`
  - Только `export { … }` / `export type { … }` (этого требует разбор в `ac-9-3-docs.spec.ts`): `SENSITIVE_KEYS`, `KitRedaction`, `createLoggerOptions`, `KitLoggerOptions`, `KitLoggerParams`, `sanitizeError`, `registerErrorSanitizer`, `initSentry`, `KitSentryOptions`, `captureError`, `captureThrottled`, `HealthRegistry`, `HealthProbe`, `HealthReport`, `MetricsServer`, `kitMetrics`, `KitMetrics`, `alertRulesTemplate`, `failStartup`, `StartupFailure`, `KitLifecycle`, `KitShutdownParticipant`, `KitShutdownStep`.
  - Логи: нет. Готово, когда: `pnpm typecheck`, `pnpm lint`, `pnpm build` зелёные, в `dist/observability/` нет импортов `testing` и `shell-quote`.

- [x] **Task 12: шаблон алертов `alerts/verdeect-kit.rules.yml`** — §3.2, AC-2.11, UC-13 (depends on 8)
  - **Skill:** none — YAML правил vmalert (не код)
  - Формат — как у P `docker/prometheus/platform-alerts.yml`: `groups[].rules[]` с `alert`, `expr`, `for`, `labels.severity`, `annotations.summary/description` (по-русски, NFR-9). Группа `verdeect-kit`.
  - Имя порога — `verdeect_kit_threshold:<имя метрики без verdeect_ и без _total>`. Ровно пять: `verdeect_kit_threshold:outbox_pending`, `verdeect_kit_threshold:outbox_lag_seconds`, `verdeect_kit_threshold:events_consumed` (для `result="dlq"`), `verdeect_kit_threshold:db_pool_wait_timeouts`, `verdeect_kit_threshold:rate_limit_unavailable`.
  - Правило на каждую метрику пакета (имена из задачи 8) с порогом по умолчанию из Requirements Reconciliation и переопределением по `service`, например:
    ```yaml
    - alert: VerdeectOutboxLag
      expr: |
        max by (service) (verdeect_outbox_lag_seconds)
          > on (service) group_left ()
        (
          max by (service) (verdeect_kit_threshold:outbox_lag_seconds)
            or on (service) (max by (service) (verdeect_outbox_lag_seconds) * 0 + 5)
        )
      for: 1m
    ```
    Переопределение — recording-правило в файле сервиса: `record: verdeect_kit_threshold:outbox_lag_seconds`, `expr: vector(30)`, `labels: {service: platform}`. Для счётчиков — `sum by (service) (increase(…[окно]))` в той же форме; у DLQ левая часть — `by (service, type)`. Правая часть каждого правила, включая запасную ветку `or on (service) (…)`, агрегируется `max by (service)`: иначе у DLQ справа окажется несколько рядов на `service` (по одному на `type`), и `on (service) group_left ()` упадёт при вычислении с ошибкой many-to-many.
  - Шапка-комментарий файла: назначение, prd §3.2, AC-2.11, как переопределить порог.

### Фаза 4: Тесты уровня U

- [x] **Task 13: логи — AC-2.1, AC-2.2, AC-2.12 (лог), `SENSITIVE_KEYS`** — NFR-4, NFR-8 (depends on 4, 11)
  - **Skill:** nestjs-code test unit observability logger-options (CREATE)
  - Файлы: `test/unit/observability/ac-2-1-log-redaction.spec.ts`, `ac-2-2-trace-id.spec.ts`, `ac-2-12-quiet-routes.spec.ts`, `redaction.spec.ts`.
  - Перенос и обобщение (эквивалентность, inventory §2): O `apps/orchestrator/src/shared/observability/ac-10-3-log-redaction.spec.ts` (маркеры `MARK_*` отсутствуют в выводе `pino(…, {write})`) и `observability.module.spec.ts`; I `observability.module.spec.ts` («в логе запроса нет query-строки», «AC-1.8: … [Filtered]»); P `observability.module.spec.ts` (строка доступа, `email` и токены → `[Filtered]`); B `observability.module.spec.ts` («err.code остаётся видимым», «traceparent браузера не принимается — новый trace-id»).
  - Стенд: Nest-приложение на `new FastifyAdapter({genReqId: params.pinoHttp[0].genReqId})` + `LoggerModule.forRoot(params)` (без генератора в адаптере случаи AC-2.2 не проходят — см. задачу 4). В кортеже `params.pinoHttp` (тип `KitLoggerParams`) поток подменяется сборщиком строк. Через Context7 проверить, что `pino(options, stream)` принимает объект опций pino-http. Тестовый контроллер возвращает тело или бросает ошибку с `code`; запросы — через `inject` Fastify, без порта.
  - Случаи:
    - `AC-2.1: каждое имя SENSITIVE_KEYS на уровнях 0–2 в теле объекта лога и в заголовках — значений нет` (параметризовано по списку);
    - `AC-2.1: err.code виден`; `AC-2.1: путь без query`; `AC-2.1: /ok вне журнала доступа`;
    - `AC-2.1: KitRedaction.sensitiveKeys дополняет базовый список, пустой массив его не отключает`;
    - `AC-2.1: base содержит service, entry, replica` (NFR-8);
    - `AC-2.2: trustTraceparent: false — входящий traceparent игнорируется, trace-id новый (32 hex)`; `AC-2.2: по умолчанию trace-id из traceparent`; `AC-2.2: неверный traceparent → новый trace-id`;
    - `AC-2.12: quietRoutes — успешный запрос на debug, ошибочный и 5xx — на info`; `AC-2.12: maskPath применяется к пути в логе доступа`;
    - `§3.2: entry cli — поток stderr, autoLogging выключен`.
  - Логи: не применимо (тест).

- [x] **Task 14: `sanitizeError` — AC-2.3** — NFR-4 (depends on 3)
  - **Skill:** nestjs-code test unit observability sanitize-error (CREATE)
  - Файл: `test/unit/observability/ac-2-3-sanitize-error.spec.ts`.
  - Перенос: I `apps/identity/src/shared/observability/sanitize-error.spec.ts` (параметризованный DrizzleQueryError с email и хэшем, «pg без Drizzle, обёрнутая дважды», «стек сохраняет кадры, но не исходное сообщение», «прочие ошибки не меняются», `sanitizeLogObject` под любым ключом), P/O `sanitize-error.spec.ts`; ветка ioredis — по B `sanitize-error.ts`. Ошибка Drizzle — объект формы `DrizzleQueryError` (`name`, `query`, `params`, `cause`), без импорта `drizzle-orm`.
  - Случаи: `AC-2.3: ошибка Drizzle с params → только code, constraint, table, column, severity`; `AC-2.3: ошибка pg с Key (…)=(…) → без значений ключа`; `AC-2.3: ioredis → name, code, имя команды без аргументов`; `AC-2.3: цепочка cause глубже 10 обрезается, цикл не зацикливает`; `AC-2.3: зарегистрированная ветка сервиса применяется`; `AC-2.3: прочие ошибки не меняются`; `AC-2.3: в выводе pino через serializeError нет SQL и параметров`.

- [x] **Task 15: GlitchTip — AC-2.4, AC-2.5, AC-2.6, AC-2.12 (GlitchTip)** — NFR-4 (depends on 5)
  - **Skill:** nestjs-code test unit observability sentry (CREATE)
  - Файлы: `test/unit/observability/ac-2-4-init-sentry.spec.ts`, `ac-2-4-init-sentry-sdk.spec.ts`, `ac-2-5-sentry-scrubber.spec.ts`, `ac-2-6-capture-throttled.spec.ts`.
  - Перенос: O `instrument.spec.ts` («выключен при пустом DSN», «выключен при NODE_ENV=test с DSN», «включён в production — tracesSampleRate 0, без сбора ПДн», «NODE_ENV не задан — как production»); I/O `sentry-scrubber.spec.ts` (`[Filtered]` в extra, contexts, breadcrumbs; удаление cookies, data, заголовков; `user` → `id`; глубина 8 без исключения).
  - AC-2.4: `vi.mock('@sentry/nestjs')` + `vi.stubEnv`. Случаи: `AC-2.4: NODE_ENV ≠ production — init не вызывается`, `AC-2.4: пустой DSN — не вызывается`, `AC-2.4: неверный SENTRY_* (NODE_ENV=staging + DSN) — false без исключения, init не вызван` (у `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` в `fragments.ts` — `optionalText()`, `safeParse` может сорвать только `NODE_ENV`), `AC-2.4: неверный SENTRY_DSN в production — false, init не вызван` (с моком), плюс отдельный файл без `vi.mock` — `test/unit/observability/ac-2-4-init-sentry-sdk.spec.ts` (с моком `initSentry` остался бы привязан к подделке, `vi.importActual` настоящий SDK не проверит): `AC-2.4: неверный SENTRY_DSN — значение не попадает в console.error и process.stderr`, `AC-2.4: DSN с ключом вне \w (https://pub-key@example.invalid/1) — false, значения нет в console.error и process.stderr` (шпионы на оба), `AC-2.4: production + DSN — dataCollection NO_PERSONAL_DATA, tracesSampleRate 0`.
  - AC-2.5 (`scrubEvent` напрямую): `AC-2.5: query удалён из request.url и query_string`, `AC-2.5: request.data удалён`, `AC-2.5: user только с id`, `AC-2.5: хвост params: и Key (…)=(…) вычищены из текста исключения`, `AC-2.5: имена SENSITIVE_KEYS и KitRedaction.sensitiveKeys → [Filtered] в extra, contexts, breadcrumbs`; `AC-2.12: maskPath применяется к request.url события`.
  - AC-2.6: `vi.mock('@sentry/nestjs')`, `vi.useFakeTimers({toFake: ['performance', 'Date']})`. Случаи: `AC-2.6: 100 однотипных ошибок за 60 с — одно событие`, `AC-2.6: после окна — следующее событие`, `AC-2.6: ошибка, отправленная границей (captureError), повторно не отправляется`, `§3.2: captureError — ровно одно событие на ошибку`.

- [x] **Task 16: `failStartup` — AC-2.9** — UC-3, NFR-4, NFR-9 (depends on 6)
  - **Skill:** nestjs-code test unit observability fail-startup (CREATE)
  - Файл: `test/unit/observability/ac-2-9-fail-startup.spec.ts`.
  - Перенос: O `apps/orchestrator/src/shared/observability/fail-startup.spec.ts` (`it.each` по веткам; лог в `Writable`; выход только после `flush`).
  - По PRD — настоящий `Sentry.init` с поддельным транспортом: задержка отправки 500 мс, записанные конверты; DSN — `https://public@example.invalid/1`; `beforeSend` — `scrubEvent`. `process.exit` — `vi.spyOn(process, 'exit').mockImplementation(…)`.
  - Случаи: `AC-2.9: InvalidEnvironmentError — fatal (60) только с именами ключей, без значения; событие отправлено до exit(1)`; `AC-2.9: StartupFailure — startupCode и startupDetails() в логе и теге события`; `AC-2.9: прочая ошибка — через sanitizeError, SQL нет`; `AC-2.9: exit(1) не раньше доставки события (транспорт 500 мс)`; `AC-2.9: GlitchTip недоступен (транспорт не отвечает) — exit(1) через ≈ 2 с (flush 2000), fatal-лог записан до выхода` (UC-3 А2; фейковые таймеры); `NFR-9: сообщения fatal по-русски`.

- [x] **Task 17: метрики, здоровье, остановка — AC-2.8 и unit-проверки** — UC-13, NFR-8 (depends on 7, 8, 10, 12)
  - **Skill:** nestjs-code test unit observability metrics (CREATE)
  - Файлы: `test/unit/observability/ac-2-8-metrics.spec.ts`, `health-registry.spec.ts`, `kit-lifecycle.spec.ts`.
  - AC-2.8 (перенос O `orch-metrics.spec.ts` «реестр содержит все метрики» и «метки без sub, tenant»): `AC-2.8: реестр содержит метрики процесса Node и verdeect_* с меткой service`; `AC-2.8: второй экземпляр — свой реестр, значения не смешиваются`; `§3.2: alertRulesTemplate указывает на существующий файл`.
  - `HealthRegistry` (перенос O `health-registry.spec.ts`): «все пробы up → ok», «упавшая критичная → unavailable», «некритичная → degraded», «проба дольше 2 с → down» (фейковые таймеры), «исключение пробы → down»; `§3.2: после markStopping — unavailable без запуска проб`; `Logging: warn только при смене up → down, info — при down → up`.
  - `KitLifecycle` (фейковые таймеры, поддельные участники; KT-11):
    - программное закрытие, `process.exit` подменён `vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)`, проверка — `not.toHaveBeenCalled()`: `§3.2: close() — шаги 1–5 по порядку, /health 503, сторож не взводится: после vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS + 1000) exit не вызван`. Vitest сам заменяет `process.exit` бросающей функцией, поэтому лишний вызов проявился бы необработанной ошибкой в колбэке таймера, приписанной случайному тесту; явная подмена даёт ясную проверку; `§3.2: close() — ошибка участника: error-лог, следующие шаги выполняются, close() отклоняется этой ошибкой`; `§3.2: повторный close() возвращает тот же промис`; `§3.2: регистрация после начала остановки — ошибка`; `NFR-8: строки остановки содержат service и replica`. Дожидаться сторожа в этих тестах не нужно: его нет;
    - имитация сигнала (`listen()` + `process.emit('SIGTERM')`, `process.exit` подменён через `vi.spyOn(...).mockImplementation`): `§3.2: сигнал взводит сторожа; после успешной остановки сторож unref (timer.hasRef() === false), до срока exit не вызван, к сроку — SHUTDOWN_NOT_EXITED и exit(1)` (таймер — из `vi.spyOn(globalThis, 'setTimeout')`, экспорта для тестов нет); `§3.2: ошибка участника по сигналу — error-лог и captureError, следующие шаги выполняются`; `§3.2: повторный сигнал не запускает вторую остановку` (после первого `process.emit('SIGTERM')` обработчик остаётся: `process.listenerCount('SIGTERM') > 0`; второй emit не запускает шаги заново — журнал участников один); `§3.2: сигнал во время close() взводит сторожа`. Только эти тесты в конце проматывают таймеры до срока при подменённом `exit`. Обработчики `listen()` снимаются в `afterEach` (`process.removeListener`). Порядок `afterEach`: сначала `vi.restoreAllMocks()`, затем `vi.useRealTimers()`. Spy на `setTimeout` создан поверх фейковых таймеров, а автоматический `restoreMocks` перед следующим тестом вернул бы на `globalThis` устаревший фейковый `setTimeout`.

### Фаза 5: Тесты уровней I, T, R

- [x] **Task 18: `/health` по HTTP — AC-2.7 (I)** — UC-8, UC-13 (depends on 9, 10)
  - **Skill:** nestjs-code test integration observability health (CREATE)
  - Файл: `test/integration/observability/ac-2-7-health.spec.ts` (проект `shared`: ни `process.env`, ни `vi.mock` не нужны).
  - Перенос: O `test/http/observability/ac-10-4-health.http-spec.ts` (состояния 200/503) и `or-106-health-stopping-first.http-spec.ts`: барьер в участнике, остановка начата, `/health` уже 503.
  - Стенд: `MetricsServer` на порту 0. Критичная проба — TCP-соединение с PostgreSQL по `inject('kitPostgresUrl')` (контейнер из globalSetup пакета); остальные пробы управляемые. Сервер и соединения закрываются в `afterAll`.
  - Случаи: `AC-2.7: все up → 200 ok, checks up`; `AC-2.7: критичная down → 503 unavailable`; `AC-2.7: некритичная down → 200 degraded`; `AC-2.7: проба дольше 2 с — down` (реальное ожидание ≈ 2 с: проверяется драйвер таймера); `AC-2.7: после начала остановки (close(), без сторожа — KT-11), пока участник шага 2 ещё работает, /health → 503`; `AC-2.8: /metrics по HTTP — text/plain, метрики с service`; `§3.2: port 0 — ОС выбирает порт, address() > 0, сервер отвечает (не выключение)`; `§3.2: порт занят — listen() отклоняется с EADDRINUSE`.

- [x] **Task 19: остановка — AC-2.10, AC-2.13 (T)** — UC-8 (depends on 10, 11: дочерний процесс импортирует собранный `observability/index.js`)
  - **Skill:** nestjs-code test unit observability lifecycle-timing (CREATE) — уровень T, каталог `test/timing/observability/`
  - Файлы: `test/timing/observability/ac-2-10-shutdown-deadline.spec.ts`, `ac-2-10-shutdown-exit.spec.ts`, `ac-2-13-shutdown-drain.spec.ts`; ребёнок — `test/fixtures/observability/shutdown-child.mjs` (каталог `test/fixtures/**` уже исключён из ESLint и Prettier: в `eslint.config.js` глобалы Node для `.mjs` заданы только в корне, вне фикстур `no-undef` упал бы на `process`). Реальные таймеры, `globalSetup` — `timingGuard` (уже в `vitest.timing.config.ts`).
  - Образец срока от сигнала: P `test/timing/observability/ac-6-6-shutdown-deadline.timing-spec.ts`, в той части, где срок общий и отсчитывается от первого вызова. Брокер и прокси не нужны: по PRD участники поддельные, без HTTP.
  - Sentry — `Sentry.init` с поддельным транспортом, который записывает события (как в задаче 16). `process.exit` — `vi.spyOn`.
  - Режим (KT-11): журнал порядка — через `close()`, без сторожа. Сценарии срока — через `listen()` + `process.emit('SIGTERM')` при подменённом `process.exit`.
  - AC-2.10: `AC-2.10: шаги 2–5 по порядку (журнал вызовов), участник шага 3 вызывается после завершения шага 2` (`close()`); `AC-2.10: пауза + шаги дольше SHUTDOWN_TIMEOUT_MS от сигнала → error-лог SHUTDOWN_TIMEOUT, событие GlitchTip, exit(1)` (срок 300 мс, пауза 100 мс, участник шага 3 висит); `AC-2.10: в срок — до срока exit не вызывается, к сроку в процессе Vitest (дескрипторы открыты) — SHUTDOWN_NOT_EXITED и exit(1)`. Настоящий выход с кодом 0 проверяет только дочерний процесс (ниже).
  - В `vitest.timing.config.ts` нет `restoreMocks` (он есть только в `vitest.config.ts`). Поэтому каждый файл T вызывает `vi.restoreAllMocks()` в `afterEach` — после того, как сторож сработал.
  - Обработчики сигналов: `listen()` вешает их через `process.on`, а API снятия у `KitLifecycle` нет. Поэтому в `beforeEach` сохраняются `process.listeners('SIGTERM')` и `process.listeners('SIGINT')`. В `afterEach` — после ожидания сторожа и до `vi.restoreAllMocks()` — каждый добавленный обработчик (разница с сохранённым списком) снимается через `process.removeListener`. Висящий участник шага 3 случая `SHUTDOWN_TIMEOUT` освобождается. Иначе `process.emit('SIGTERM')` следующего теста дойдёт до прежнего экземпляра.
  - Уборка в процессе Vitest — только для тестов режима сигнала: после успешной остановки сторож переведён в `unref()`, но в воркере он всё равно сработает. Поэтому каждый такой тест ждёт срабатывания сторожа, пока `process.exit` подменён, и проверяет вызов. Ни один сторож не переживает свой тест: иначе после `vi.restoreAllMocks()` его `exit(1)` попадёт в бросающую заглушку Vitest и всплывёт необработанной ошибкой в чужом тесте.
  - Выход процесса после остановки (KT-10 п. 4), файл `test/timing/observability/ac-2-10-shutdown-exit.spec.ts`. Настоящий дочерний процесс: только так проверяется естественный выход. В `beforeAll` — `tsc -p tsconfig.build.json --outDir node_modules/.cache/kit-timing-dist`: каталог внутри репозитория, чтобы peer разрешались из его `node_modules`, а `dist/` не трогался. Ребёнок запускается `spawn(process.execPath, [<путь к shutdown-child.mjs>, …])` (тот же Node, что у тестов) — `test/fixtures/observability/shutdown-child.mjs`: импортирует `<outDir>/observability/index.js`, инициализирует Sentry с поддельным транспортом (событие → маркер в stderr), регистрирует участников и шлёт себе `SIGTERM`. Случаи: `AC-2.10: остановка без утечек — код 0 раньше SHUTDOWN_TIMEOUT_MS`; `AC-2.10: оставленный таймер после остановки — код 1 к сроку, error «процесс не завершился после остановки», событие GlitchTip`; `AC-2.10: оставленный сервер node:net после остановки — код 1 к сроку, тот же лог`. Срок — 1000 мс. Время отсчитывается не от `spawn`: загрузка `@sentry/nestjs`, `pino` и `prom-client` в ребёнке занимает около секунды. Ребёнок пишет в stderr маркер `{"signal":true}` непосредственно перед `process.kill(process.pid, 'SIGTERM')`, а родитель меряет `performance.now()` от получения маркера до события `exit`. Без утечек — код 0 и меньше 1000 мс после маркера. Утёкший таймер или сервер `node:net` — код 1, не раньше ≈ 1000 мс и меньше 1000 мс + запас.
  - AC-2.13: `AC-2.13: SHUTDOWN_DRAIN_MS = 500 — между /health 503 (шаг 1) и шагом 2 ≥ 500 мс` (`close()`); `AC-2.13: пауза входит в SHUTDOWN_TIMEOUT_MS` (сигнал; срок 700 мс, пауза 500 мс, шаги 300 мс → сторож).

- [x] **Task 20: шаблон алертов — AC-2.11 (R)** — UC-13, UC-16 (depends on 8, 12)
  - **Skill:** nestjs-code test unit package alert-rules (CREATE) — уровень R, `test/package/`
  - Файлы: `test/package/ac-2-11-alert-rules.spec.ts`, `test/fixtures/alerts/service-override.rules.yml` (пример переопределения порога сервисом), `test/fixtures/alerts/verdeect-kit.test.yml` (unittest `vmalert-tool`).
  - Случаи:
    - `AC-2.11: пороги вычисляются — по умолчанию и с переопределением по service` — `vmalert-tool unittest` (образ `victoriametrics/vmalert-tool:<тот же тег>`, константа `VMALERT_TOOL_IMAGE` рядом с `VMALERT_IMAGE`), файл `test/fixtures/alerts/verdeect-kit.test.yml` с `input_series`: сервис `a` на пороге по умолчанию (алерт есть), сервис `b` с рядом `verdeect_kit_threshold:outbox_lag_seconds` выше значения (алерта нет), DLQ с двумя `type` у одного сервиса (оба алерта, без ошибки many-to-many). `-dryRun` только разбирает выражения, а эта проверка исполняет переопределение.
    - `AC-2.11: vmalert -dryRun принимает шаблон и пример переопределения`. Образ — константа `VMALERT_IMAGE = 'victoriametrics/vmalert:<точный тег>'` в этом тест-файле, не в `TEST_IMAGES` (это не образ контура сервиса, KT-10 п. 5). Тег — текущий стабильный на момент реализации, в комментарии — источник. Файлы монтируются только для чтения, запуск — через `runCommand('docker', …)` из `test/package/support/pack.ts`.
    - Уровень с Docker: файл в `test/package/` запускается `make pack-check` (job `package` CI). Unit-уровень (`make test`) Docker не требует: в `test/unit` проверяется только наличие файла (`§3.2: alertRulesTemplate …`, задача 17).
    - `AC-2.11: правило на каждую метрику verdeect_* реестра kitMetrics` (имена из `registry.getMetricsAsJSON()`, кроме метрик процесса).
    - `AC-2.11: у каждого правила переопределение порога и порог по умолчанию`: множество имён `verdeect_kit_threshold:*` в шаблоне ровно равно пяти именам из задачи 12, у каждого — `on (service)`.
    - `NFR-9: summary и description по-русски`.
  - Логи: не применимо.

### Фаза 6: Архив, проект-потребитель, документы

- [x] **Task 21: AC-1.1, AC-1.2 и проект-потребитель — AC-9.1 (часть E2)** — UC-3, UC-8, UC-13, UC-16, NFR-4, NFR-8 (depends on 11, 12)
  - **Skill:** nestjs-code test unit package consumer (MODIFY) — уровни R и C; `.mjs` проекта-потребителя — none (тестовые данные проекта-потребителя, вне `src/`)
  - Файлы: `test/package/ac-1-1-package.spec.ts`, `test/package/ac-9-1-consumer.spec.ts`, `test/consumer/minimal/import-check.mjs`, `test/consumer/no-testcontainers/peer-check.mjs`, `test/consumer/minimal/types-check.ts`, новые `test/consumer/minimal/service/instrument.mjs`, `test/consumer/minimal/service/main.mjs`, `test/consumer/minimal/src/observability.spec.ts`.
  - AC-1.1 (типы на архиве): `types-check.ts` проверяет `.d.ts` `/observability` через `tsc` потребителя. В файл добавляются: `pino(...createLoggerOptions({service: 'consumer', entry: 'cli', env: {REPLICA_ID: 'r', LOG_LEVEL: 'info'}}).pinoHttp)` (кортеж `KitLoggerParams`), `const redaction: KitRedaction = {sensitiveKeys: ['inn']}`, `new KitLifecycle({…}).register({name: 'x', stop() {}}, {step: 3})` и `// @ts-expect-error` на `{step: 1}`, `new FastifyAdapter({genReqId: createLoggerOptions({service: 'consumer', entry: 'http', env: {REPLICA_ID: 'r', LOG_LEVEL: 'info'}}).pinoHttp[0].genReqId})`.
  - AC-1.1:
    - `ALLOWED_ENTRY` дополнить `alerts/verdeect-kit.rules.yml`;
    - состав архива: `package/dist/observability/index.js` и `package/alerts/verdeect-kit.rules.yml`;
    - проверка «dist рабочих подпутей не импортирует testing и shell-quote» — по `['config', 'internal', 'observability']`;
    - новый случай `§3.2: dist/observability не загружает @nestjs/* и config/index.js` — статический обход графа относительных импортов от `dist/observability/index.js` тем же `IMPORT_SPECIFIER`: среди спецификаторов нет `@nestjs/` и `../config/index.js` (ранний `instrument.ts`, LE-5);
    - `import-check.mjs` проверяет и `@verdeect/kit/observability` (`createLoggerOptions`); ожидания: `config:ok observability:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED` и `config:ok observability:ok testing:ok`.
  - AC-1.2 (C): `peer-check.mjs` импортирует `/observability` без `pg` и `testcontainers` → `observability:ok`; название теста дополнить `/observability`.
  - AC-9.1 (E2): `service/instrument.mjs` вызывает `initSentry({service: 'consumer'})`. `service/main.mjs`:
    - разбирает `parseEnv(defineEnv({...envBase, ...envDatabase}), process.env)`. При ошибке (`InvalidEnvironmentError`) env для `createLoggerOptions` нет, поэтому строится запасной логгер `pino({level: 'info', base: {service: 'consumer'}}, process.stderr)` и передаётся в `failStartup`. Это код самого потребителя: в E3 этот путь возьмёт на себя `bootstrapService`;
    - строит логгер `pino(...createLoggerOptions({service: 'consumer', entry: 'cli', env}).pinoHttp)`;
    - собирает `HealthRegistry`: критичная проба — TCP до PostgreSQL из `DATABASE_URL`;
    - собирает `kitMetrics({service: 'consumer'})`, `MetricsServer` на `METRICS_PORT=0` (печатает `{"metricsPort":N}` в stdout) и `KitLifecycle`: поддельный участник шага 3 пишет лог, участник шага 5 — `MetricsServer.close`;
    - вызывает `lifecycle.listen()`.

    Тест `src/observability.spec.ts` запускает процесс `spawn(process.execPath, ['--import', './service/instrument.mjs', 'service/main.mjs'], {cwd: <корень проекта-потребителя>, env})` — без оболочки, тем же бинарником Node, что и тесты: без `PATH` в `env` строка `node` разрешается через системный путь и даёт другой Node или `ENOENT` на раннере setup-node. Окружение ребёнка задаётся явно: `DATABASE_URL` — из `inject('kitPostgresUrl')` (globalSetup потребителя уже поднимает PostgreSQL), `METRICS_PORT=0`, `PORT=0`, `SHUTDOWN_DRAIN_MS=1500`, `SHUTDOWN_TIMEOUT_MS=5000`, `SENTRY_DSN` пуст. Порт метрик читается из первой строки stdout. Живой процесс в `afterEach` получает `SIGKILL`, чтобы не утекали процессы. Случаи:
    - `AC-9.1: /health → 200 ok, проба database up`;
    - `AC-9.1: /metrics — метрики процесса и verdeect_outbox_pending{service="consumer"}`;
    - `AC-9.1: SIGTERM — /health 503 во время паузы, выход 0 в пределах SHUTDOWN_TIMEOUT_MS` (опрос `/health` запускается до отправки `SIGTERM`; проверка — 503 увиден до выхода и код 0);
    - `AC-9.1: строки остановки в stderr содержат service и replica` (NFR-8);
    - `AC-9.1: неверный METRICS_PORT → fatal с именем ключа без значения, выход 1` (UC-3, NFR-4).

    В `ac-9-1-consumer.spec.ts` новых случаев AC-9.1 нет: он уже запускает `vitest run` потребителя. Меняются только две строки ожиданий AC-1.1 (`config:ok observability:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED`, `config:ok observability:ok testing:ok`), название теста AC-1.2 и добавляется `toContain('observability:ok')`.
  - Логи: строки сервиса-потребителя — только через `pino` пакета (в тестовом проекте `console.log` допустим только для печати порта; лучше `process.stdout.write`).
  - Готово, когда: `pnpm pack:check` зелёный.

- [x] **Task 22: README, CHANGELOG, docs/testing.md, AGENTS.md** — AC-9.3, NFR-9 (depends on 11, 12, 21)
  - **Skill:** none — документы Markdown
  - `README.md`:
    - `## Подпути` — `/observability` выпущен в E2;
    - `## API` → `### @verdeect/kit/observability` — каждый экспорт задачи 11 в обратных кавычках с кратким контрактом (тест AC-9.3 ищет каждое имя);
    - `## Тесты сервиса` (или новый раздел «Наблюдаемость») — `instrument.ts` через `node --import`, общий `KitRedaction` в `src/redaction.ts`, шаги `KitLifecycle` 1–5 и два режима (сигнал ОС — сторож срока и `exit(1)`; программный `close()` — без сторожа и `exit`, безопасен в тестах сервиса, KT-11), `/health` и `/metrics` на `METRICS_PORT`, `alertRulesTemplate` и переопределение порога `verdeect_kit_threshold:<метрика>`;
    - `## Развёртывание` — порт метрик не наружу (уже есть), `/health` 503 с начала остановки, подключение шаблона алертов.
  - `CHANGELOG.md` `[Unreleased]` → `### Added`: строки `/observability: …` с каждым экспортом в обратных кавычках (тест AC-9.3 проверяет все имена `index.ts`) и строка о шаблоне `alerts/verdeect-kit.rules.yml`. Первую строку раздела обновить: этапы E1 и E2.
  - `docs/testing.md` — `test/unit/observability`, `test/integration/observability`, `test/timing/observability`, R-тест алертов (нужен Docker для vmalert).
  - `AGENTS.md` — структура: `src/observability/`, `alerts/`, «Ключевые точки входа» — `src/observability/index.ts`.
  - Логи: не применимо.

- [x] **Task 23: тест документов — AC-9.3 и финальная проверка этапа** — AC-9.3 (depends on 13–22)
  - **Skill:** nestjs-code test unit package docs (MODIFY) — уровень R
  - `test/package/ac-9-3-docs.spec.ts`: `ENTRY_POINTS` дополнить `src/observability/index.ts`. Остальные проверки не менять.
  - Финальная проверка (каждая команда — отдельным вызовом): `make lint`, `make analyse`, `make test`, `make test-integration`, `make test-timing` (на тихой машине), `make pack-check`.
  - Проверить `grep -rn "console\." src/` — пусто. В `src/observability/` нет статического импорта `pg` и `testcontainers`, нет имён схем и таблиц сервисов.
  - В репозиториях сервисов за время этапа выполнялось только чтение (файлы, `git log`/`show`/`diff`); их контуры не запускались.
  - Логи: не применимо.

## Traceability

| Требование | Задачи | Тест (файл / название) |
|---|---|---|
| AC-2.1 | 2, 4, 13 | `test/unit/observability/ac-2-1-log-redaction.spec.ts` «AC-2.1: …» |
| AC-2.2 | 4, 13 | `test/unit/observability/ac-2-2-trace-id.spec.ts` «AC-2.2: …» |
| AC-2.3 | 3, 14 | `test/unit/observability/ac-2-3-sanitize-error.spec.ts` «AC-2.3: …» |
| AC-2.4 | 5, 15 | `test/unit/observability/ac-2-4-init-sentry.spec.ts` «AC-2.4: …»; `ac-2-4-init-sentry-sdk.spec.ts` «AC-2.4: … значения нет в console.error и process.stderr» (настоящий SDK) |
| AC-2.5 | 5, 15 | `test/unit/observability/ac-2-5-sentry-scrubber.spec.ts` «AC-2.5: …» |
| AC-2.6 | 5, 15 | `test/unit/observability/ac-2-6-capture-throttled.spec.ts` «AC-2.6: …» |
| AC-2.7 | 7, 9, 18 | `test/integration/observability/ac-2-7-health.spec.ts` «AC-2.7: …»; `test/unit/observability/health-registry.spec.ts` |
| AC-2.8 | 8, 9, 17, 18 | `test/unit/observability/ac-2-8-metrics.spec.ts` «AC-2.8: …»; `ac-2-7-health.spec.ts` «AC-2.8: /metrics по HTTP …» |
| AC-2.9 | 6, 16 | `test/unit/observability/ac-2-9-fail-startup.spec.ts` «AC-2.9: …» |
| AC-2.10 | 10, 17, 19 | `test/timing/observability/ac-2-10-shutdown-deadline.spec.ts` «AC-2.10: …»; `ac-2-10-shutdown-exit.spec.ts` «AC-2.10: остановка без утечек — код 0 …», «AC-2.10: оставленный таймер/сервер — код 1 …» (KT-10 п. 4) |
| AC-2.11 | 8, 12, 20, 21 | `test/package/ac-2-11-alert-rules.spec.ts` «AC-2.11: …» (Docker, `make pack-check`); `test/package/ac-1-1-package.spec.ts` «AC-1.1: состав архива» (файл в архиве) |
| AC-2.12 | 4, 5, 13, 15 | `test/unit/observability/ac-2-12-quiet-routes.spec.ts` «AC-2.12: …»; `ac-2-5-sentry-scrubber.spec.ts` «AC-2.12: maskPath … события» |
| AC-2.13 | 10, 19 | `test/timing/observability/ac-2-13-shutdown-drain.spec.ts` «AC-2.13: …» |
| AC-1.1 (рост) | 1, 11, 21 | `test/unit/package/package-manifest.spec.ts` «AC-1.1: …/observability …»; `test/package/ac-1-1-package.spec.ts` «AC-1.1: …»; `ac-9-1-consumer.spec.ts` «AC-1.1: …» |
| AC-1.2 (рост) | 21 | `test/package/ac-9-1-consumer.spec.ts` «AC-1.2: без pg и testcontainers /config и /observability импортируются …» |
| AC-9.1 (E2) | 21 | `test/consumer/minimal/src/observability.spec.ts` «AC-9.1: …»; `test/package/ac-9-1-consumer.spec.ts` «AC-9.1: проект-потребитель проходит свои тесты …» |
| AC-9.3 (рост) | 22, 23 | `test/package/ac-9-3-docs.spec.ts` «AC-9.3: …» (с `src/observability/index.ts`) |
| §3.2 (`SENSITIVE_KEYS`, `KitRedaction`, `captureError`, `HealthRegistry`, `KitLifecycle`, `alertRulesTemplate`, `entry: cli`) | 2, 5, 7, 8, 10, 13, 15, 17 | `redaction.spec.ts`, `ac-2-6-capture-throttled.spec.ts`, `health-registry.spec.ts`, `kit-lifecycle.spec.ts`, `ac-2-8-metrics.spec.ts` «§3.2: …» |
| NFR-4 | 2–6, 13–16, 21 | AC-2.1, 2.3, 2.5, 2.9; потребитель «неверный METRICS_PORT → без значения» |
| NFR-8 | 4, 10, 13, 17, 21, 23 | «AC-2.1: base содержит service, entry, replica», «NFR-8: строки остановки …», потребитель «строки остановки … service и replica»; `grep console.` (задача 23) |
| NFR-9 | 6, 10, 12, 16, 20 | «NFR-9: сообщения fatal по-русски» (AC-2.9), «NFR-9: summary и description по-русски» (AC-2.11) |
| UC-3 (часть E2) | 6, 16, 21 | AC-2.4, AC-2.9, потребитель «неверный METRICS_PORT» |
| UC-4 (часть E2) | 2–5, 13–15 | AC-2.1, 2.2, 2.3, 2.5, 2.6, 2.12 |
| UC-8 (часть E2) | 10, 18, 19, 21 | AC-2.7, 2.10, 2.13, потребитель SIGTERM |
| UC-13 | 7–9, 12, 18, 20, 21 | AC-2.7, 2.8, 2.11, потребитель `/health`, `/metrics` |

## Commit Plan
- **Commit 1** (после задач 1–6): `feat(observability): редактирование, sanitizeError, createLoggerOptions, initSentry, failStartup`
- **Commit 2** (после задач 7–12): `feat(observability): HealthRegistry, kitMetrics, MetricsServer, KitLifecycle, шаблон алертов`
- **Commit 3** (после задач 13–17): `test(observability): unit-тесты AC-2.1–AC-2.6, AC-2.8, AC-2.9, AC-2.12`
- **Commit 4** (после задач 18–20): `test(observability): AC-2.7 (I), AC-2.10 и AC-2.13 (T), AC-2.11 (R)`
- **Commit 5** (после задач 21–23): `test(package): /observability в AC-1.1, AC-1.2, AC-9.1; docs: README и CHANGELOG E2`

## Definition of Done
- Каждый AC скоупа имеет зелёный тест из таблицы Traceability.
- Зелёные: `make lint`, `make analyse`, `make test`, `make test-integration`, `make test-timing` (тихая машина), `make pack-check`.
- `package.json`: `exports` — `./config`, `./observability`, `./testing`, `./package.json`; `files` содержит `alerts`; peer не изменены; `version` не меняется (G14: `[Unreleased]`).
- В `src/**` нет `console.*`, глобального реестра `prom-client`, `process.exit` вне `failStartup` и сторожа `KitLifecycle`.
- `bootstrapService`, `createHttpApp`, `/ok` не реализованы (E3).
- Репозитории сервисов не изменены.
