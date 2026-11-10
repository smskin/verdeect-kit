# План реализации: E3 HTTP-каркас (`@verdeect/kit/http`)

Mode: full
Branch: feature/e3-http-framework
Created: 2026-11-10

## Original Request
Реализуй этап roadmap «E3 HTTP-каркас» по пакету требований requirements/0000-kit/ (ревизия r7, PRD v1.12).

Скоуп этапа: AC-3.1–AC-3.13; prd.md §3.5 целиком (createHttpApp, bootstrapService с разбором окружения до создания приложения и HTTP-сервером участником шага 2 KitLifecycle, kitErrors и defineErrors, DomainError, ZodValidationPipe с 400/413/415/422, KitExceptionFilter, keyset-пагинация, @Api и CLI verdeect-kit openapi); §3.8 — строки с этапом E3 (createTestApp, expectProblem, expectMatchesApi); внутренняя проверка имени сервиса ^[a-z][a-z0-9-]{1,31}$ (её же использует /messaging в E5); распознавание ошибок PostgreSQL по форме (isPoolTimeout, isConnectionError, isUniqueViolation) — во внутреннем модуле без pg, фильтр использует его напрямую (§3.3); CLI verdeect-kit (bin) с командой openapi; подпуть ./http в exports и в проверках AC-1.1, AC-1.2; проект-потребитель (AC-9.1, AC-3.8) стартует через bootstrapService и проверяет снимок contracts/openapi.json; README и CHANGELOG [Unreleased] (AC-9.3). Перенос кода — по requirements/0000-kit/files/inventory.md: эталон O (app-exception-filter, domain-error, validation-failed, zod-validation.pipe, pool-timeout-reporter), пагинация — I, заголовки безопасности — P/O; тесты эквивалентности — из таблицы §2 (request-errors P/O, I app-exception-filter.spec, pagination.spec, ac-8-3-security-headers, O ac-10-8-shutdown, or-106-health-stopping-first). Репозитории сервисов — только чтение. AC уровня T — в test/timing. Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION; код сервиса, расходящийся с prd.md, не переносится как есть (P0). Решения E2, которые касаются E3: /ok отдаёт createHttpApp (перенесён из E2); bootstrapService передаёт разобранное окружение в createLoggerOptions({env}) и запускает KitLifecycle.listen() (сторож срока и exit — только при сигнале ОС), а createTestApp и app.close() — программное закрытие без сторожа и exit (KT-11); в middleware Fastify путь запроса — req.originalUrl ?? req.url (RULES.md); метрики — @prometheus-io/client. Уже реализованные этапы E1–E2 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5): U — `test/unit/http`, `test/unit/internal`, `test/unit/config`, `test/unit/testing`, `test/unit/cli`; I — `test/integration/http` (AC-3.6); T — `test/timing/http` (AC-3.9); C — `test/consumer/minimal` (AC-3.8, AC-9.1); R — `test/package`, `test/unit/package`
- Logging: verbose (KT-14) — `debug` на шагах `bootstrapService` и при регистрации участника шага 2 (`http`) в `KitLifecycle`; ошибки — как Standard: `warn` — `DomainError`, ожидаемые 4xx и `SENTRY_NOT_PRELOADED`; `error` — 500 и сбои участников; только через `pino`/`nestjs-pino`, без `console.*` (NFR-8, AC-9.4)
- Docs: no — `WARN [docs]` без обязательного чекпоинта `/aif-docs`. README и CHANGELOG всё равно обновляются задачей 22: этого требуют AC-9.3 и правило «Library Package Scope» (7)

## Roadmap Linkage
Milestone: "E3 HTTP-каркас"
Rationale: план реализует ровно скоуп вехи E3 из `.ai-factory/ROADMAP.md` (`/http` §3.5, помощники `/testing` этапа E3, AC-3.1–AC-3.13).

## Requirements Reconciliation

Иерархия источников (запрос пользователя, skill-context «Requirements Package Authority»): `requirements/0000-kit/prd.md` **v1.13 (ревизия r8, коммит `529f8f5` — первый в ветке; решения вопросов планирования E3, KT-14)** > `requirements/0000-kit/files/inventory.md` > `.ai-factory/ROADMAP.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`, `rules/base.md`. Код сервиса, расходящийся с PRD, не переносится как есть (P0).

**Milestone scope:** AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, AC-3.7, AC-3.8, AC-3.9, AC-3.10, AC-3.11, AC-3.12, AC-3.13; §3.5 целиком; строки §3.8 с этапом E3 (`createTestApp`, `expectProblem`, `expectMatchesApi`); части UC-1, UC-3, UC-4, UC-8, UC-14, относящиеся к `/http`; растущие AC-1.1, AC-1.2 (подпуть `./http`, поле `bin`); сквозные AC-9.1 (потребитель стартует через `bootstrapService`), AC-9.3 (README, CHANGELOG), AC-9.4 (правило lint на новый код без изменений).

Вне скоупа: `/database`, `/idempotency` (E4, в том числе заголовки идемпотентности в OpenAPI и `internal/metadata.ts`), `/messaging` (E5), `/crypto` (E7), `/redis` (E8, `throwRateLimited`); AC-4.x–AC-8.x; AC-9.5 (с E4). В AC-9.1 этапа E3 потребитель стартует с PostgreSQL из `startTestStack` (RabbitMQ и Redis появятся в E5 и E8).

Решения (источник → задача). Решения плана вне формулировок PRD согласованы чатом kit в сообщении KT-15 от 10.11.2026; PRD v1.13 при этом не меняется:

| Решение | Источник | Задачи |
|---|---|---|
| `createTestApp` — `createHttpApp` на модуле из `Test.createTestingModule`, `overrides` подменяют провайдеры. `@nestjs/testing` — **опциональный peer** `/testing` (`^12.1.0`, как `@nestjs/core`; в `devDependencies` уже точная 12.1.3). Загружается `loadPeer('@nestjs/testing', 'testing')` внутри `createTestApp`, а не при импорте `/testing`. Статический импорт запрещён правилом lint, как для `testcontainers`. AC-1.2 для `/testing` проверяется в потребителе: без `@nestjs/testing` `createTestApp` падает с текстом AC-1.2 | PRD v1.13 NFR-3, §3.8; KT-14 п. 3 | 1, 13, 20 |
| CLI: `verdeect-kit openapi --out <файл> [--module <файл>#<экспорт>]`. Умолчание `--module dist/app.module.js#AppModule` берётся относительно cwd. Документ собирается обходом метаданных модулей и контроллеров: приложение не создаётся, окружение не нужно. Нет файла или экспорта — JSON `{error}` и выход 1 | PRD v1.13 §3.5, AC-3.7; ARCHITECTURE «CLI» | 12, 17 |
| Словарь кодов регистрирует `defineErrors(...)` на процесс (как `registerErrorSanitizer`). Повторный вызов объединяет словари; тот же код с другим статусом — ошибка при определении. `kitErrors` зарегистрирован всегда. `DomainError` с незарегистрированным кодом — ошибка разработчика: 500 `INTERNAL_ERROR`, `error`-лог, GlitchTip ровно раз. Общий русский текст «Ошибка запроса» — у `errorMessage(code)` для неизвестного кода | PRD v1.13 §3.5, AC-3.2 | 4, 6 |
| `KitConfigModule.forRoot` разбирает окружение **при сборке контекста** — в фабрике провайдера (`ConfigModule.forRoot({isGlobal, ignoreEnvFile, skipProcessEnv: true, load: [factory]})`), а не в `validate` при импорте `AppModule`. Сейчас `validate` @nestjs/config 12.0.1 выполняется синхронно в `forRoot`, то есть при импорте `AppModule`, ещё до `bootstrapService`. Фабрика сначала забирает окружение, разобранное `bootstrapService`, через внутренний `takePreparsedEnv(schema)`, иначе вызывает `parseEnv(schema, process.env)`. `process.env` не меняется. Тест E1 AC-1.7 «forRoot отклоняется» становится «сборка контекста отклоняется»; тест «умолчания дописываются в process.env» заменяется проверкой «`process.env` после сборки не изменён» | PRD v1.13 §3.1, AC-1.7, AC-3.13 | 3 |
| Жизненный цикл (KT-11). `createHttpApp` создаёт `HealthRegistry`, `KitLifecycle`, `kitMetrics` и логгер pino экземпляра и отдаёт их провайдерами глобального внутреннего модуля `KitHttpCoreModule` (токены — классы `KitLifecycle`, `HealthRegistry` и символы `KIT_METRICS`, `KIT_LOGGER` из `src/internal/tokens.ts`). Регистрируются два участника: **шаг 2** `http` — `server.close()` Fastify (новые соединения не принимаются, начатые запросы дорабатывают, простаивающие keep-alive закрываются) и **шаг 3** `nest` — исходный `app.close()` Nest (хуки модулей сервиса, освобождение адаптера). `app.close()` экземпляра подменяется на `lifecycle.close()`: программное закрытие, без сторожа и `exit`. Так `close()` не уходит в рекурсию, а порядок «HTTP закрыт до хуков сервиса» сохраняется. `bootstrapService` вызывает `lifecycle.listen()` и регистрирует `MetricsServer` на шаге 5; `enableShutdownHooks()` не вызывается, иначе Nest сам ловил бы `SIGTERM`. Решения KT-15 п. 1: участники шага 2 — `http` и участники сервиса (поток SSE = «`onStopAccepting`» §3.2) — работают **параллельно**: так уже делает `KitLifecycle.runStep` E2 через `Promise.allSettled`. `server.close()` ждёт закрытия открытых соединений, а участник сервиса закрывает свой поток в то же время. Шаг 3 `nest` — исходный `app.close()`: хуки модулей идут в порядке Nest (`onModuleDestroy` → `beforeApplicationShutdown` → освобождение адаптера → `onApplicationShutdown`). **Правило для E4–E8:** модули kit используют `beforeApplicationShutdown` как шаг 3 и `onApplicationShutdown` как шаг 4 (§3.2), запись — в README и ARCHITECTURE «Жизненный цикл» (задача 22). Повторное закрытие Fastify внутри `app.close()` Nest после шага 2 не даёт ошибки (unit-тест). `SIGTERM` обрабатывает только `KitLifecycle.listen()` и один раз (unit-тест) | §3.2 шаги 1–5; §3.5; KT-11; KT-15 п. 1; разведка O `main.ts`/`instance-shutdown` | 8, 9, 15, 16, 19, 22 |
| `/ok`: контроллер ядра `GET /ok` → 200 `{status: 'ok'}`, `Cache-Control: no-store` (эталон O `get-ok.controller.ts`). В журнал доступа не пишется (E2 `autoLogging.ignore`), в OpenAPI не попадает | §3.5; решение E2 | 8, 11 |
| Окружение `createHttpApp` берёт из `ConfigService` модуля сервиса. Модуль сервиса обязан импортировать `KitConfigModule.forRoot({schema})` (UC-1 п. 2–3; README). Без него сборка падает с `Error` «модуль сервиса не импортирует KitConfigModule.forRoot({schema})»: фабрика ядра получает `ConfigService` через `@Optional()` и проверяет его. В `bootstrapService` эта ошибка идёт через `failStartup` (KT-15 п. 2). Логгер собирается `LoggerModule.forRootAsync` из `nestjs-pino` фабрикой на `createLoggerOptions({service, entry: 'http', env, …logger, redaction})`. Генератор trace-id адаптеру — `new FastifyAdapter({genReqId, bodyLimit})` | §3.5; E2 `createLoggerOptions` TSDoc | 8 |
| Публичная сигнатура `createHttpApp` — как в §3.5. `bootstrapService` и `createTestApp` используют внутреннюю `buildHttpApp(options & {logger?, redaction?, compile?})` из того же файла: «тот же `createHttpApp`» (§3.8) | §3.5, §3.8 | 8, 9, 15 |
| `createTestApp({module, service, overrides?})`: `service` обязателен, как у `createHttpApp`, — без него нет `base.service` и метки метрик. Формат и проверка — та же `assertServiceName`, что у `bootstrapService` (AC-3.10). Это уточнение типа без изменения смысла (§3 «точные типы уточняет реализация») | §3, §3.8; KT-15 п. 3 | 13, 15 |
| `expectMatchesApi(res, route)`: `route` — кортеж `[Controller, 'method']`. Схема ответа строится тем же построителем, что и документ CLI, по метаданным `@Api`. Ответ проверяется Ajv 2020 по JSON Schema `z.toJSONSchema(response, {io: 'output'})`; конверт — по `envelope` (`page` → `{items, nextCursor}`, `items` → `{items}`, `array` → массив) | §3.8; AC-3.7 | 14 |
| `ajv` 8.20.0 (как у сервисов, inventory §3) — в `dependencies`, точная версия без `^`, импортируется только из `src/testing/**` (внутренняя деталь, как `yaml`). Импорт вне `testing` — ошибка lint (запрет на всё `src/**` с исключением `src/testing/**`) и проверка `pack-check`: `dist/**` вне `dist/testing` не загружает `ajv`. Валидатор документа OpenAPI 3.1 для AC-3.7 — `@seriousme/openapi-schema-validator` 2.11.0 в `devDependencies`, точная версия | NFR-3; AC-3.7; KT-15 п. 4 | 1, 14, 17, 21 |
| Отображение HTTP-ошибок без своего тела (Nest `FastifyAdapter.mapException` превращает `FastifyError` в `HttpException(message, statusCode)`; KT-15 п. 8): 400 → `BAD_REQUEST`, 401 → `UNAUTHENTICATED`, 403 → `FORBIDDEN`, 404 → `ROUTE_NOT_FOUND`, 413 → `PAYLOAD_TOO_LARGE`, 415 → `UNSUPPORTED_MEDIA_TYPE`, 429 → `RATE_LIMITED`; все они — `warn`, без GlitchTip. **Прочие 4xx без своего тела** (405, 409, 410 и т. п. из `HttpException`) **и любые ≥ 500** → 500 `INTERNAL_ERROR`, `error`-лог, GlitchTip ровно раз. Это ошибка разработчика, как незарегистрированный код `DomainError`: доменные 4xx сервис выражает только через `DomainError`. Тело `{error}` guard'ов проходит без изменений (AC-3.3). Коды по путям O (`JOURNAL_TOO_LARGE` и т. п.) не переносятся (N1) | §3.5 (H1); KT-15 п. 7–8; разведка O/B | 6 |
| Тело `{error: {code, message, details}}` из `HttpException` (guard'ы `@verdeect/auth`, `@verdeect/platform-client`) проходит без изменений — проверка `libraryBody` эталона O/I/P. 5xx с таким телом: `PLATFORM_UNAVAILABLE` (503) — `warn` без GlitchTip (эталон O), прочие — GlitchTip | §3.5; AC-3.3; эталон O | 6 |
| Срок пула: `isPoolTimeout` по цепочке `cause` (в том числе внутри `DomainError`) → 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1`, `kitMetrics.dbPoolWaitTimeouts.inc({pool: 'unknown'})`, `captureThrottled('db-pool-timeout', err)`. Метку `pool` фильтр не знает. `ponytail:` метка `unknown` до E4: там `Db` пометит ошибку именем пула. Тип метки — тот же `Counter<'pool'>` из `kitMetrics`; новых значений, кроме `unknown`, нет (KT-15 п. 6) | §3.3, §3.5; эталон O `pool-timeout-reporter` | 6 |
| `isPoolTimeout`, `isConnectionError`, `isUniqueViolation` распознают ошибку **по форме**: обход `cause` до 10 уровней, как `sanitizeError`; без `pg` и `drizzle-orm`. `isPoolTimeout` сравнивает сообщения эталона O. `isConnectionError` (KT-15 п. 9): SQLSTATE `08xxx`, `57P01`–`57P03`; системные коды `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENOTFOUND`; сообщения pg, начинающиеся с «Connection terminated» и «terminating connection». Без `instanceof` и без импорта `pg`/`drizzle-orm`. У эталонов I/O проверка через `instanceof DrizzleQueryError` — по PRD она заменяется распознаванием по форме. Проверка с `tcpProxy` — AC-4.10 в E4 | §3.3 «по форме, без импорта `pg`»; rules/base.md | 2 |
| Безопасность в OpenAPI: маршрут защищён, если на обработчике или классе есть `VerdeectAuthGuard` в `@UseGuards` (`GUARDS_METADATA` из `@nestjs/common/constants`) или метаданные `Require*` из `@verdeect/auth/nest`. Ключи `Require*` пакет не экспортирует (`dist/nest/decorators.d.ts`: «не экспортируется из пакета»), поэтому они читаются строковыми константами с указанием источника: `'verdeect-auth:require-scopes'`, `'verdeect-auth:require-user'`, `'verdeect-auth:require-service'`, `'verdeect-auth:require-tenant'` (`@verdeect/auth` 1.0.1 `dist/nest/decorators.js`). Схема: `RequireService` → `serviceToken`, `RequireUser` → `userToken`, ни того, ни другого → обе схемы как альтернативы; области — из `RequireScope`. Тогда в документе `security` и стандартные 401/403. Защиту через `APP_GUARD` по метаданным не видно — README советует `@UseGuards` на контроллере. Схемы безопасности: `serviceToken` (client credentials, области из `RequireScope`) и `userToken` (эталон I `openapi-document.ts`) | §3.5; эталон I | 11 |
| `DomainError(code, details?, options?: ErrorOptions)`: третий аргумент — стандартный `{cause}`. Он нужен, чтобы находить срок пула в `cause` (AC-3.3, эталон O). Заголовков в `DomainError` нет: `Retry-After` для 429 добавит E8 | §3.5; эталон O | 4 |
| `ValidationFailedError` отдельным экспортом не делается (в §3.5 его нет). Пайп бросает `DomainError('VALIDATION_FAILED', {issues})`, курсор — `DomainError('VALIDATION_FAILED', {issues: [{path: 'cursor', code: 'invalid'}]})` | §3.5; P0 | 5, 7 |
| Заголовки безопасности API — набор P/O: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; ставятся в хуке `onRequest` на `reply.raw` и поэтому есть на ошибках, `/ok` и 404. HSTS, CSP и `no-store` для HTML — сервис (I, Traefik) | §3.5; inventory §1 `security-headers` P/O | 8 |
| `afterCursor(cols, cursor, dir)` строит условие Drizzle `(c1, …, cn) > / < (v1, …, vn)` как ИЛИ-цепочку. Последний столбец должен быть `primary` или `isUnique`, иначе `Error` (AC-3.6 «ошибка помощника»). `limit` по умолчанию 100 (у I — 50, по PRD — 100), максимум 200 | §3.5; AC-3.6; эталон I `pagination.ts` | 7 |
| `[OPEN]` §11 п. 1–3 к E3 не относятся | prd §11 | — |

Сочетания режимов:

| Вход | Сочетание | Результат | Проверка |
|---|---|---|---|
| запуск × окружение | `bootstrapService`, неверное | `failStartup` до создания приложения: модуль не инициализирован, порт не открыт, выход 1 | AC-3.13 |
| | `bootstrapService`, верное | `KitConfigModule` берёт разобранное, `parseEnv` вызван 1 раз | AC-3.13 |
| | `createTestApp` / контекст без `bootstrapService` | `KitConfigModule` разбирает сам; неверное → `InvalidEnvironmentError` при сборке | задача 3, AC-1.7 |
| `service` | `bff-app` / `Bff_App`, пусто, 33 символа | запуск / отказ запуска с текстом формата | AC-3.10 |
| Sentry × `instrument.ts` | DSN + `production`, не подключён | `warn` `SENTRY_NOT_PRELOADED`, запуск продолжается | AC-3.11 |
| | подключён, или DSN пуст, или не `production` | предупреждения нет | AC-3.11 |
| опции роли | `trustTraceparent: false` / умолчание | новый trace-id / из `traceparent` | AC-3.12 |
| | `quietRoutes` | успешный — `debug`, ошибка — `info` | AC-3.12 |
| | `http.bodyLimit` / умолчание | больше лимита → 413 / лимит Fastify 1 MiB | AC-3.12, AC-3.1 |
| | `redaction.sensitiveKeys` (`[]`, свои имена) | свои и базовые имена скрыты и в логе, и в событии | AC-3.12 |
| ошибка × фильтр | `DomainError` из словаря | статус словаря, `warn`, без GlitchTip | AC-3.3 |
| | `DomainError` с неизвестным кодом | 500 `INTERNAL_ERROR`, `error`, GlitchTip 1 раз | AC-3.3, задача 6 |
| | `HttpException` с `{error}` (guard) | тело и статус без изменений; 4xx — `warn` | AC-3.3 |
| | `PLATFORM_UNAVAILABLE` 503 с `{error}` | без изменений, `warn`, без GlitchTip | AC-3.3 |
| | срок пула (в т. ч. в `cause`) | 503 `SERVICE_UNAVAILABLE`, `Retry-After: 1`, метрика, `captureThrottled` | AC-3.3 |
| | неразобранный JSON / `Content-Type` / размер / маршрут | 400 `BAD_REQUEST` / 415 / 413 / 404 `ROUTE_NOT_FOUND`, без GlitchTip | AC-3.1, AC-3.4, AC-3.12 |
| | `HttpException` без тела: 401 / 403 / 429 | `UNAUTHENTICATED` / `FORBIDDEN` / `RATE_LIMITED`, `warn` | задача 6 |
| | `HttpException` без тела: 405, 409, 410, любые ≥ 500 | 500 `INTERNAL_ERROR`, `error`, GlitchTip ровно раз | задача 6 (KT-15 п. 8) |
| | прочее | 500 `INTERNAL_ERROR`, GlitchTip ровно раз, без текста, стека, SQL | AC-3.3 |
| остановка | сигнал ОС (`bootstrapService`) | шаг 1 `/health` 503 → шаг 2 HTTP закрыт, начатый запрос 200 → шаг 3 хуки Nest → шаг 5 метрики, выход 0 | AC-3.9, AC-9.1 |
| | `app.close()` (`createTestApp`, тест) | те же шаги без сторожа и `exit`, повторный вызов — тот же промис | задача 16 |
| пагинация | без курсора / с курсором / вставка между страницами / `limit` 201 / неверный курсор / неуникальный последний столбец | первая страница / следующая / без дублей и пропусков / 422 / 422 `path: cursor` / ошибка помощника | AC-3.6 |

Опорный реальный артефакт: проект-потребитель `test/consumer/minimal` на упакованном архиве. Его сервис (TypeScript, собирается `tsc`) стартует по форме production `node --import ./dist/service/instrument.js dist/service/main.js` через `bootstrapService`, отвечает на `/ok`, `/health`, `/metrics` и останавливается по `SIGTERM`. Снимок `contracts/openapi.json` проверяет тест потребителя (задача 20).

## Architecture and Decisions
- Подпуть `src/http/` по `.ai-factory/ARCHITECTURE.md`: импортирует `observability`, `config`, `internal`, `@verdeect/auth` и обязательные peer (`@nestjs/*`, `fastify`, `nestjs-pino`, `zod`, `drizzle-orm` — только `sql`-построитель в `pagination.ts`). `pg` запрещён, ошибки pg — `internal/pg-errors.ts`. Опциональных peer нет, `loadPeer` не нужен.
- Файлы: `src/http/{index.ts, errors.ts, zod-validation.pipe.ts, kit-exception.filter.ts, pagination.ts, security-headers.ts, kit-http-core.module.ts, create-http-app.ts, bootstrap-service.ts, api/api.decorator.ts, api/openapi-document.ts}`; `src/internal/{pg-errors.ts, preparsed-env.ts, tokens.ts}`; `src/cli/{main.ts, commands/openapi.ts}`; `src/testing/{create-test-app.ts, expect-problem.ts, expect-matches-api.ts}`. Файл короче ~30 строк остаётся в соседнем (ARCHITECTURE «Структура каталогов»). Поэтому `/ok` — в `kit-http-core.module.ts`, а `security-headers.ts` выделяется только при объёме ≥ 30 строк.
- `index.ts` `/http` экспортирует ровно §3.5: `createHttpApp`, `bootstrapService`, `kitErrors`, `defineErrors`, `DomainError`, `ZodValidationPipe`, `KitExceptionFilter`, `PageQuerySchema`, `pageOf`, `afterCursor`, `encodeCursor`, `decodeCursor`, `Api`; типы `KitHttpAppOptions`, `KitBootstrapOptions`, `KitErrorDictionary`, `KitErrorEntry`, `Page`, `KitApiOptions`. `buildHttpApp`, `buildOpenApiDocument`, `errorMessage` и токены — внутренние.
- `/testing` добавляет `createTestApp`, `expectProblem`, `expectMatchesApi` (§3.8, E3). `@nestjs/testing` грузится `loadPeer` внутри `createTestApp`; утверждения — `node:assert/strict`, без peer `vitest`.
- Шапка каждого файла: назначение, ID требований, эталон `inventory.md` §1 и что взято из других копий (rules/base.md).
- Внешние API сверяются в Context7 перед кодом (skill-context `/aif-implement`, CLAUDE.md): `@nestjs/platform-fastify` 12 (`FastifyAdapter` опции `genReqId`, `bodyLimit`; `mapException`; `getInstance().server`), `fastify` 5 (`addHook('onRequest')`, `server.close`, `closeIdleConnections`, `inject`), `nestjs-pino` 5.3 (`LoggerModule.forRootAsync`, `Logger`, `bufferLogs`), `@nestjs/config` 12 (`load`, `skipProcessEnv`), `@nestjs/testing` 12 (`overrideProvider`, `createNestApplication(adapter)`), `zod` 4 (`z.toJSONSchema` с `io`), `drizzle-orm` 0.45 (`sql`, `and`, `or`, `gt`, `lt`, `eq`, свойства столбца `primary`/`isUnique`), `@sentry/nestjs` 11 (`getClient`), `ajv` 8 (`Ajv2020`), `@seriousme/openapi-schema-validator` 2.
- Слоёв сервиса из `nestjs-specialist` нет. Компоненты — `nestjs-code generic <path>`, тесты — `nestjs-code test <unit|integration> <target>`, обоснование — «компонент библиотеки, не сервиса». CLAUDE.md модулей не генерируются: в библиотеке нет `src/modules/` (skill-context «Library Package Scope»).
- Правило RULES.md: в middleware Fastify путь запроса — `req.originalUrl ?? req.url`. Хук `onRequest` получает `request.url` Fastify; в pino-http уже используется `requestPath` из E2.

## Tasks

### Фаза 1: Манифест, границы, внутренние модули

- [ ] **Task 1: `package.json`, ESLint и тест манифеста для `/http` и `bin`** — AC-1.1, AC-1.2, NFR-3
  - **Skill:** none — манифест и конфиг lint; тест — `nestjs-code test unit package package-manifest (MODIFY)`
  - Файлы: `package.json`, `pnpm-lock.yaml`, `eslint.config.js`, `test/unit/package/package-manifest.spec.ts`.
  - `exports`: `"./http": {"types": "./dist/http/index.d.ts", "default": "./dist/http/index.js"}` между `./config` и `./observability`, остальное не менять. `"bin": {"verdeect-kit": "./dist/cli/main.js"}` (ARCHITECTURE «Сборка и загрузка»).
  - `peerDependencies`: `"@nestjs/testing": "^12.1.0"` (от проверенной минорной, как `@nestjs/core`) + `peerDependenciesMeta` `optional: true` (PRD v1.13 NFR-3). В `devDependencies` остаётся точная `12.1.3`.
  - `dependencies`: `"ajv": "8.20.0"` (только для `src/testing`).
  - `devDependencies` (точные): `@verdeect/auth` 1.0.1 и `drizzle-orm` 0.45.4 (оба сейчас стоят только как авто-peer, а задачи 7, 11, 18 их импортируют), `@seriousme/openapi-schema-validator` 2.11.0. `@nestjs/testing` 12.1.3 уже есть. `pnpm install` обновляет lockfile.
  - `eslint.config.js`: `'@nestjs/testing'` — в группу опциональных peer `COMMON_PATTERNS` (`allowTypeImports: true`). Блок `src/http/**/*.ts`: `restrictedImports([{group: ['../testing/*', '../database/*', '../idempotency/*', '../messaging/*', '../redis/*', '../crypto/*', '../cli/*', 'shell-quote', 'ajv', 'ajv/*'], message: 'http импортирует только observability, config и internal (ARCHITECTURE.md).'}])`. Блок `src/cli/**/*.ts`: подпути — только динамическим `import()`. Запрет статических импортов — через `restrictedImports` с `allowTypeImports: true`; шаблоны покрывают оба уровня вложенности (`../http/*` и `../../http/*`, или `**/http/*` и т. п. для `config`, `observability`, `testing`). Так же — в блоке `src/http/**`: запрет `../testing/*` дополнить `../../testing/*` и т. д. для файлов `src/http/api/*.ts`. `'ajv'`, `'ajv/*'` — в `COMMON_PATTERNS` (запрет на всё `src/**`, сообщение «ajv — только в src/testing (NFR-3, KT-15)»). Для `src/testing/**/*.ts` — свой блок `restrictedImports` без этой группы: блок с тем же правилом, идущий позже, заменяет общий. В блоки `src/config`, `src/observability`, `src/internal` добавить `'../cli/*'`.
  - Тест манифеста — MODIFY существующих случаев E1:
    - «AC-1.1: нет bin и корневого "." в E1» (`expect(manifest.bin).toBeUndefined()`) → «AC-1.1: bin — ровно {verdeect-kit: ./dist/cli/main.js}, нет main и корневого "."»;
    - случай списка `exports` → «AC-1.1: exports — ровно ./config, ./http, ./observability, ./testing, ./package.json»;
    - «NFR-3: … dependencies — только semver, shell-quote и yaml» → добавить `ajv: '8.20.0'`;
    - случай опциональных peer и `OPTIONAL_PEERS` → добавить `@nestjs/testing`.

    Новый случай: «AC-1.1: ./http — {types, default} на dist/http/index.*».
  - Логи: нет.
  - Готово, когда: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm exec vitest run test/unit/package` зелёные.

- [ ] **Task 2: `src/internal/pg-errors.ts` — распознавание ошибок PostgreSQL по форме** — §3.3 (строка `isUniqueViolation…`), AC-3.3 (основа) (depends on 1)
  - **Skill:** nestjs-code generic src/internal/pg-errors.ts (CREATE)
  - Шапка: `// isUniqueViolation, isConnectionError, isPoolTimeout — по форме объекта, обход cause, без pg и drizzle-orm (prd.md §3.3; rules/base.md). Эталоны: isUniqueViolation — I pg-errors.ts; isPoolTimeout — O pool-client.ts (сообщения); isConnectionError — по PRD (у I/O — instanceof DrizzleQueryError, не переносится).`
  - API: `isUniqueViolation(err: unknown, constraint?: string): boolean` (первый узел с `code === '23505'` → `constraint === undefined || node.constraint === constraint`); `isConnectionError(err: unknown): boolean`; `isPoolTimeout(err: unknown): boolean`. Внутренний `causeChain(err)` — до 10 уровней, только объекты (`typeof === 'object' && !== null`), защита от циклов (`Set`). Коды и сообщения — константы с источником (см. Reconciliation).
  - Тест `test/unit/internal/pg-errors.spec.ts` (`nestjs-code test unit internal pg-errors`): перенос I `pg-errors.spec.ts`, переписанного на объекты по форме. Случаи: `23505` с и без `constraint`; `23505` во 2-м `cause`; цикл `cause` не зацикливает; `isPoolTimeout` на двух сообщениях O, внутри `DomainError`-подобного `cause` и на 11-м уровне (`false`); `isConnectionError` — по случаю на каждую форму (KT-15 п. 9): `08006`, `08001`, `57P01`, `57P02`, `57P03`, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`, `ENOTFOUND`, «Connection terminated unexpectedly», «terminating connection due to administrator command», форма во 2-м `cause`, форма на 11-м уровне (`false`); `false` для `23505`, `57014` и обычной `Error`. Названия — `§3.3: …`.
  - Логи: нет (чистые функции).

- [ ] **Task 3: `KitConfigModule` — ленивый разбор и окружение из `bootstrapService`** — §3.1, AC-1.7, AC-3.13 (depends on 1)
  - **Skill:** nestjs-code generic src/config/kit-config.module.ts (MODIFY); nestjs-code generic src/internal/preparsed-env.ts (CREATE)
  - `src/internal/preparsed-env.ts`: `WeakMap<object, Record<string, unknown>>`; `setPreparsedEnv(schema, env)` — пишет `bootstrapService`; `takePreparsedEnv(schema)` — возвращает значение и удаляет его: окружение отдаётся одной сборке контекста, следующая сборка в том же процессе (AC-1.7) разбирает сама. Ключ — объект схемы (тот же `env`, что в `bootstrapService({env})` и `KitConfigModule.forRoot({schema})`).
  - `kit-config.module.ts`: `forRoot` по-прежнему возвращает `Promise<DynamicModule>`, но больше не разбирает окружение синхронно. Новый вызов: `ConfigModule.forRoot({isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => takePreparsedEnv(schema) ?? parseEnv(schema, process.env)]})`. Нужно проверить в Context7 и в `node_modules/@nestjs/config/dist`, что фабрика `load` выполняется при сборке каждого контекста (провайдер DI), а `ConfigService.get('PORT')` с `skipProcessEnv` возвращает разобранное число. Если `load` кладёт значения не в корень, использовать собственный провайдер `ConfigService` с `useFactory` (`new ConfigService(env)`) — решение записать в шапке. Обновить TSDoc: «при запуске через `bootstrapService` окружение не разбирается повторно; иначе — разбор при сборке контекста; `.env` не читается, в `process.env` ничего не пишется».
  - Тест `test/unit/config/ac-1-7-kit-config-module.spec.ts` (MODIFY; PRD v1.13 AC-1.7): «AC-1.7: два контекста с разным process.env получают разные значения» — без изменений; «AC-1.7: неверное окружение → сборка контекста отклоняется `InvalidEnvironmentError` с путём `METRICS_PORT`, `forRoot` сам не отклоняется»; «AC-1.7: process.env после сборки не изменён» (снимок `{...process.env}` до и после `compile()` при незаданных `METRICS_PORT`, `REPLICA_ID`, `SHUTDOWN_*` — `toEqual`) вместо удалённого «§3.1: KitConfigModule дописывает умолчания … в process.env»; добавить «§3.1: разобранное окружение `setPreparsedEnv` отдаётся контексту без `parseEnv`» — `vi.spyOn` на модуль `parse-env` невозможен в ESM, поэтому проверка по значению: в `process.env` неверный `PORT`, а сборка с подставленным окружением успешна; «§3.1: вторая сборка после подстановки разбирает `process.env`».
  - Логи: нет (модуль конфигурации; ошибки — `InvalidEnvironmentError`).

### Фаза 2: Ошибки и проверка ввода

- [ ] **Task 4: `src/http/errors.ts` — `kitErrors`, `defineErrors`, `DomainError`** — §3.5, AC-3.2 (depends on 1)
  - **Skill:** nestjs-code generic src/http/errors.ts (CREATE)
  - Шапка: эталон O `domain-error.ts` + `error-messages.ts` (форма словаря `код → текст`, `FALLBACK_MESSAGE`); по PRD — запись `{status, message}`, глобальный реестр, коды §3.5.
  - API:
    ```ts
    export interface KitErrorEntry { readonly status: number; readonly message: string }
    export type KitErrorDictionary = Readonly<Record<string, KitErrorEntry>>;
    export const kitErrors = { UNAUTHENTICATED: {status: 401, message: 'Требуется вход'}, FORBIDDEN: {status: 403, …}, VALIDATION_FAILED: 422, BAD_REQUEST: 400, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, ROUTE_NOT_FOUND: 404 ('Адрес не найден'), VERSION_CONFLICT: 409, RATE_LIMITED: 429, INTERNAL_ERROR: 500 ('Внутренняя ошибка сервиса'), SERVICE_UNAVAILABLE: 503, SERVICE_STOPPING: 503, PLATFORM_UNAVAILABLE: 503, IDEMPOTENCY_KEY_REUSED: 422, IDEMPOTENCY_IN_PROGRESS: 409, IDEMPOTENCY_KEY_REQUIRED: 400 } as const satisfies KitErrorDictionary;
    export function defineErrors<const D extends KitErrorDictionary>(dict: D & KitCodesKeepStatus<D>): D; // регистрирует в реестре процесса
    export class DomainError extends Error { readonly code; readonly status; readonly details; constructor(code: string, details?: Readonly<Record<string, unknown>>, options?: ErrorOptions) }
    export function errorMessage(code: string): string; // внутренняя; неизвестный код → 'Ошибка запроса'
    export function errorStatus(code: string): number | undefined; // внутренняя
    ```
  - Тексты `message` — по-русски, совпадают с O `error-messages.ts` и guard'ом `@verdeect/auth` (`UNAUTHENTICATED` «Требуется вход», `FORBIDDEN` «Доступ запрещён»). Тип `KitCodesKeepStatus<D>`: для каждого ключа `kitErrors` в `D` статус обязан совпадать (`D[K]['status'] extends (typeof kitErrors)[K]['status']`, иначе `never`). Повторный вызов `defineErrors` объединяет словари реестра процесса; тот же код с тем же статусом — без ошибки, с другим статусом — `Error` при определении (ошибка разработчика). `DomainError`: `name = new.target.name`; `status` берётся из реестра в конструкторе, неизвестный код → 500 и флаг `unknownCode` (внутренний) для фильтра; `message` — `errorMessage(code)`; `toBody()` → `{error: {code, message, details}}`; `details` по умолчанию `{}`.
  - Тесты: `test/unit/http/ac-3-2-define-errors.test-d.ts` — «AC-3.2: код пакета с другим статусом — ошибка компиляции» (`// @ts-expect-error` на `defineErrors({...kitErrors, FORBIDDEN: {status: 401, message: 'x'}})`, без ошибки — свой код и `kitErrors` как есть); `test/unit/http/ac-3-2-error-dictionary.spec.ts` — «AC-3.2: неизвестный код — общий русский текст «Ошибка запроса»», «§3.5: DomainError берёт статус из словаря», «AC-3.2: повторный defineErrors объединяет словари — коды обоих вызовов дают свои статусы», «AC-3.2: тот же код с другим статусом во втором defineErrors — ошибка при определении», «AC-3.2: DomainError с незарегистрированным кодом — статус 500» (ответ, лог и GlitchTip — в тесте фильтра, задача 6), «§3.5: все коды §3.5 и их статусы в kitErrors» (таблица из PRD).
  - Логи: нет (типы и реестр).

- [ ] **Task 5: `src/http/zod-validation.pipe.ts` — 422 `VALIDATION_FAILED`** — §3.5, AC-3.1 (depends on 4)
  - **Skill:** nestjs-code generic src/http/zod-validation.pipe.ts (CREATE)
  - Эталон O `zod-validation.pipe.ts` (P — идентичен) + O `validation-failed.error.ts` (форма `issues`). `@Injectable() export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform { constructor(readonly schema: T) }` — `schema` публичное: его читает построитель OpenAPI (эталон I). `transform`: `safeParse`; ошибка → `DomainError('VALIDATION_FAILED', {issues: issues.map(i => ({path: i.path.map(String).join('.') || '(body)', code: i.code}))})`; успех — `result.data`. 400/413/415 пайп не порождает: их даёт парсер тела Fastify до пайпа, а отображает фильтр (задача 6).
  - Тест `test/unit/http/zod-validation.pipe.spec.ts`: перенос O `zod-validation.pipe.spec.ts` и I `zod-validation.pipe.spec.ts` (обобщены): «AC-3.1: верный ввод возвращает данные с умолчаниями», «AC-3.1: 422 с путями `title` и `tags.0` через точку, значений в теле нет (подстрока MARK_SECRET)», «AC-3.1: `(body)` для `unrecognized_keys` у strict-схемы».
  - Логи: `debug` `{issues: ['path:code']}` «запрос отклонён схемой» — только пути и коды, без значений (эталон O); логгер — `new Logger(ZodValidationPipe.name)` из `@nestjs/common` (уходит в nestjs-pino через `useLogger`).

- [ ] **Task 6: `src/http/kit-exception.filter.ts` — `KitExceptionFilter`** — §3.5, AC-3.3, AC-3.2, AC-3.1, AC-3.4 (depends on 2, 4)
  - **Skill:** nestjs-code generic src/http/kit-exception.filter.ts (CREATE); nestjs-code generic src/internal/tokens.ts (CREATE)
  - `src/internal/tokens.ts`: `KIT_METRICS = Symbol('KIT_METRICS')`, `KIT_LOGGER = Symbol('KIT_LOGGER')` — создаётся здесь, потому что фильтр внедряет `KIT_METRICS`; задача 8 его использует.
  - Эталон O `app-exception-filter.ts` (182 строки): порядок веток, `libraryBody`, `send()` с `Content-Type: application/json; charset=utf-8`, `reportUnexpected`. Взято из B: ответ при `reply.raw.headersSent` — только `warn`. По PRD: коды статусов — таблица Reconciliation; `codeOf` с путями O, `maskSecretPath` и `instance-shutdown` не переносятся; путь в логе — `maskPathOf(redaction)` не передаётся (фильтр пишет только `method`, `traceId`, `code`, `status`: путь уже есть в строке доступа).
  - `@Catch() @Injectable()`; зависимости через DI: `@Inject(KIT_METRICS) metrics: KitMetrics`. Ветки:
    1. `isPoolTimeout(exception)` → `metrics.dbPoolWaitTimeouts.inc({pool: 'unknown'})`, `captureThrottled('db-pool-timeout', exception)`, `warn`, 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1`.
    2. `DomainError` с известным кодом → `warn {code, status, traceId}`, статус и `toBody()`, без GlitchTip; с неизвестным кодом → как ветка 4.
    3. `HttpException`: `libraryBody(getResponse())` → тело и статус без изменений; ожидаемое — `status < 500 || code === 'PLATFORM_UNAVAILABLE'` (`warn`), прочее — `reportUnexpected`. Без тела библиотеки: статус из таблицы `400, 401, 403, 404, 413, 415, 429` → код таблицы, исходный статус, `warn`; любой другой статус (405, 409, 410 …, ≥ 500) → `reportUnexpected` и 500 `INTERNAL_ERROR` (KT-15 п. 8).
    4. Прочее → `reportUnexpected`: `captureError(exception, {tags: {code: 'INTERNAL_ERROR'}})` (ровно раз: `captureError` помечает отправленные, E2), `error {err: sanitizeError(e), method, traceId}`, 500 `INTERNAL_ERROR`. Текст исходной ошибки, стек и SQL в тело не попадают.
  - Экспорт для BFF (различие по роли, §3.5): фильтр — обычный класс, BFF собирает свой на `DomainError` и словаре; TSDoc об этом.
  - Тест `test/unit/http/ac-3-3-exception-filter.spec.ts`: перенос O `app-exception-filter.spec.ts` (235 строк) и I `app-exception-filter.spec.ts` (обобщены, без `codeOf` и `RateLimitedError`). Мок `host()` и поддельные метрики `{dbPoolWaitTimeouts: {inc: vi.fn()}}`; Sentry — `test/support/fake-sentry.ts` (E2). Случаи с префиксом `AC-3.3:`: срок пула простой, во вложенном `cause`, в `cause` `DomainError` → 503 + `Retry-After: 1` + `SERVICE_UNAVAILABLE`, `inc` ×3, одно событие за окно; `DomainError` 403 → тело словаря, `warn`, без события; тело guard'а `@verdeect/auth` 401/403 `SCOPE_REQUIRED` с `details.required` и 409 `TENANT_REQUIRED` → без изменений; 503 `PLATFORM_UNAVAILABLE` → без изменений, `warn`, без события; `Error('MARK_SECRET … select * from x')` → 500 `INTERNAL_ERROR`, событие ровно одно, в теле нет `MARK_SECRET`, `select` и `at `; «AC-3.2: DomainError с незарегистрированным кодом → 500 `INTERNAL_ERROR`, `error`-лог, GlitchTip ровно раз (повторная обработка той же ошибки события не добавляет)»; `HttpException` 413/415/400 строкой → `PAYLOAD_TOO_LARGE`/`UNSUPPORTED_MEDIA_TYPE`/`BAD_REQUEST` (`AC-3.1:`); `NotFoundException` → 404 `ROUTE_NOT_FOUND` (`AC-3.4:`); `headersSent` → только `warn`. Таблица `it.each` «§3.5: HttpException без тела, статус N → …» — по строке на каждый статус (KT-15 п. 8): 400 `BAD_REQUEST`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `ROUTE_NOT_FOUND`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 429 `RATE_LIMITED` (статус исходный, `warn`, без события); 405, 409, 410, 500, 502, 503 → 500 `INTERNAL_ERROR`, `error`, одно событие.
  - Логи: `warn` — ожидаемые ошибки (`code`, `status`, `traceId`); `error` — неожиданные (`err` через `sanitizeError`, `method`, `traceId`); логгер — `new Logger(KitExceptionFilter.name)`.

### Фаза 3: Пагинация и приложение

- [ ] **Task 7: `src/http/pagination.ts` — keyset** — §3.5, AC-3.6 (U-часть) (depends on 4)
  - **Skill:** nestjs-code generic src/http/pagination.ts (CREATE)
  - Эталон I `pagination.ts` (66 строк): `encodeCursor`, `decodeCursor`, `pageOf`, `PageQuerySchema`. По PRD: `limit` умолчание 100, максимум 200; неверный курсор → `DomainError('VALIDATION_FAILED', {issues: [{path: 'cursor', code: 'invalid'}]})` (у I — 400 `VALIDATION`); значения ключей — JSON-скаляры (`string | number | boolean | null`), а не только строки; новое — `afterCursor`.
  - API: `PageQuerySchema = z.object({cursor: z.string().min(1).max(512).optional(), limit: z.coerce.number().int().min(1).max(200).default(100)})`; `type Page<T> = {items: T[]; nextCursor: string | null}`; `encodeCursor(keys: readonly CursorValue[])`; `decodeCursor(cursor: string | undefined, arity: number): CursorValue[] | null`; `pageOf(rows, limit, keyOf): Page<T>`; `afterCursor(cols: readonly AnyColumn[], cursor: readonly CursorValue[] | null, dir: 'asc' | 'desc'): SQL | undefined` (null → `undefined`; иначе `or(gt(c1,v1), and(eq(c1,v1), gt(c2,v2)), …)`; длина `cols` ≠ длине курсора → ошибка `VALIDATION_FAILED path: cursor`; последний столбец не `primary`/`isUnique` → `Error` «последний ключ сортировки должен быть уникальным»).
  - Тест `test/unit/http/pagination.spec.ts`: перенос I `pagination.spec.ts` (49 строк) с правками PRD. Случаи: «AC-3.6: limit по умолчанию 100, 200 принимается, 0 и 201 — ошибка схемы», «AC-3.6: круговой обмен курсора», «AC-3.6: неверный курсор (`%%%`, другая арность, не массив) → 422 `path: cursor`», «AC-3.6: pageOf — limit+1 строк → курсор последнего, ровно limit → null», «AC-3.6: afterCursor без уникального последнего столбца — ошибка помощника» (таблица `pgTable` в памяти теста, без БД).
  - Логи: нет (чистые функции).

- [ ] **Task 8: `createHttpApp` и ядро — заголовки, `/ok`, фильтр, логгер, участники остановки** — §3.5, AC-3.4, AC-3.5, §3.2 шаг 2 (depends on 3, 5, 6)
  - **Skill:** nestjs-code generic src/http/create-http-app.ts (CREATE); nestjs-code generic src/http/kit-http-core.module.ts (CREATE)
  - Шапка: эталоны — O/P `main.ts` (`NestFactory.create`, `FastifyAdapter({genReqId})`, `bufferLogs`, `useLogger`), P/O `configure-http-server.ts` + `security-headers.ts` (хук `onRequest` на `reply.raw`), O `get-ok.controller.ts`, регистрация фильтра `APP_FILTER` (O/I/P `app.module.ts`). По PRD: участники `KitLifecycle` вместо `enableShutdownHooks`/`InstanceShutdown`, своих парсеров тела нет (лимит — `bodyLimit` адаптера и `route.bodyLimit` сервиса).
  - Токены `KIT_METRICS`, `KIT_LOGGER` — из `src/internal/tokens.ts` (задача 6).
  - `kit-http-core.module.ts` — `KitHttpCoreModule.forRoot({service, logger, redaction})` (`global: true`, внутренний). Провайдер окружения ядра внедряет `@Optional() ConfigService`. Нет его — `Error('createHttpApp: модуль сервиса не импортирует KitConfigModule.forRoot({schema})')` (KT-15 п. 2). Провайдеры через `ConfigService`: `KIT_LOGGER` (`pino(...createLoggerOptions({service, entry: 'http', env, ...logger, redaction}).pinoHttp)`), `HealthRegistry`, `KitLifecycle` (`env` — `SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_DRAIN_MS`), `KIT_METRICS` (`kitMetrics({service})`), `{provide: APP_FILTER, useClass: KitExceptionFilter}`. `exports: [KitLifecycle, HealthRegistry, KIT_METRICS, KIT_LOGGER]`: глобальный модуль отдаёт модулям сервиса только экспортированные провайдеры. Без них сервис не внедрит `KitLifecycle` (участник SSE) и `HealthRegistry` (пробы). Импорт `LoggerModule.forRootAsync` (nestjs-pino) с теми же опциями и экземпляром логгера (`pinoHttp: {logger}` — проверить в Context7). Контроллер `GET /ok` → `{status: 'ok'}`, `@Header('Cache-Control', 'no-store')`.
  - `create-http-app.ts`:
    - `export interface KitHttpAppOptions { readonly module: Type | DynamicModule; readonly service: string; readonly bodyLimit?: number; readonly securityHeaders?: 'api' }`;
    - внутренняя `buildHttpApp(options & {logger?, redaction?, compile?: (root, adapter) => Promise<NestFastifyApplication>})`;
    - публичная `createHttpApp(options)` = `buildHttpApp(options)`.
    - Порядок: `assertServiceName` → корневой модуль `{imports: [options.module, KitHttpCoreModule.forRoot(…)]}` → `new FastifyAdapter({genReqId: traceIdGenerator(trustTraceparent), bodyLimit})` (генератор — экспортировать из `logger-options.ts` как внутренний, без реэкспорта в `index.ts`) → `NestFactory.create(root, adapter, {bufferLogs: true, abortOnError: false})` или `compile`. С умолчанием `abortOnError: true` Nest при ошибке DI сам вызывает `process.exit(1)` через `ExceptionsZone`, минуя `failStartup`; с `false` ошибка выбрасывается наверх → `app.useLogger(app.get(Logger))` → хук `onRequest`: заголовки безопасности на `reply.raw.setHeader`; хуки `onSend` (`Connection: close`) и `onResponse` (`server.closeIdleConnections()`) проверяют флаг `closing` из замыкания `closeServer`. Все хуки регистрируются до `app.init()`; в `closeServer` только выставляется `closing = true`. `addHook` после `listen()` бросает `FST_ERR_INSTANCE_ALREADY_LISTENING` (проверено), и тогда шаг 2 упал бы до `server.close()` → участники `lifecycle.register({name: 'http', stop: () => closeServer(app)}, {step: 2})` и `{name: 'nest', stop: () => NestApplication.prototype.close.call(app)}` на шаге 3 → подмена `Object.defineProperty(app, 'close', {value: () => lifecycle.close(), configurable: true})`. Простое присваивание `app.close = …` на пути NestFactory не работает: `set`-ловушка `createProxy` в `@nestjs/core/nest-factory.js` не сохраняет значение (для существующего метода присваивание молча игнорируется), а ловушки `defineProperty` у прокси нет. Исходный close берётся с прототипа, а не из `app.close`, иначе шаг 3 вызвал бы `lifecycle.close()` и ждал бы сам себя → `await app.init()`; `await app.getHttpAdapter().getInstance().ready()`. Возвращает `NestFastifyApplication`.
    - `closeServer`: если сервер не слушает (`inject`) — сразу. Если слушает: флаг `closing`, `server.close()` с ожиданием и `server.closeIdleConnections()`. Пока `closing`, хук `onSend` ставит `Connection: close`, а хук `onResponse` вызывает `server.closeIdleConnections()`. Одного `closeIdleConnections()` мало: keep-alive соединение, ответ на котором завершается позже (`/slow`, поток SSE, опрос `/ok`), живёт до `keepAliveTimeout` Fastify (72 с), и `server.close()` не завершается до срока (проверено на Fastify 5.12.5 + `fetch`). Участники шага 2 от сервиса (поток SSE) работают параллельно с `http` (`KitLifecycle` E2, `Promise.allSettled`), поэтому незакрытый поток не держит `server.close()` до срока, если его закрывает участник сервиса. Закрывать поток нужно вызовом `reply.raw.end()` или `destroy()`. `onResponse` Fastify срабатывает на `finish` и для `hijack`/`reply.raw`, после чего соединение сразу закрывается. Если просто перестать писать в поток, `server.close()` ждёт до срока (проверено на Fastify 5.12.5). Повторное закрытие Fastify в исходном `app.close()` Nest на шаге 3 безопасно: `FastifyAdapter.close()` (`@nestjs/platform-fastify` 12.1.3) глотает `ERR_SERVER_NOT_RUNNING`, хук `onClose` Fastify 5 (`instance.server.close`) тоже считает его успехом. Подтверждает unit-тест задачи 15.
  - 404 `ROUTE_NOT_FOUND` даёт обработчик Nest (`NotFoundException` → фильтр), своего `setNotFoundHandler` нет.
  - Логи: `debug` «http: приложение собрано» `{service, bodyLimit}`; `debug` «http: участник шага 2 зарегистрирован» `{participant: 'http'}` (KT-14); `debug` «http: приём соединений остановлен» `{durationMs}` в участнике шага 2; `debug` «http: хуки Nest завершены» на шаге 3; ошибки участников логирует `KitLifecycle` (E2).

- [ ] **Task 9: `bootstrapService` — точка входа `main.ts`** — §3.5, AC-3.10, AC-3.11, AC-3.12, AC-3.13, UC-3, UC-8 (depends on 8)
  - **Skill:** nestjs-code generic src/http/bootstrap-service.ts (CREATE)
  - Шапка: эталон O `main.ts` (`failStartup` с запасным логгером, `listen(port, '0.0.0.0')`, лог «слушает»); по PRD — порядок §3.5, шаги пронумерованы в комментариях.
  - `export interface KitBootstrapOptions<S> { module; service; env: S; logger?: {trustTraceparent?, quietRoutes?, extraBase?}; http?: {bodyLimit?}; redaction?: KitRedaction }`; `bootstrapService(options): Promise<NestFastifyApplication>`.
  - Шаги:
    1. Запасной логгер `pino({level: 'info', base: {service, entry: 'http'}, redact: redactPaths(redaction)}, process.stdout)`.
    2. `assertServiceName(service, 'bootstrapService')` → при ошибке `failStartup`.
    3. `parseEnv(env, process.env)` → при ошибке `failStartup` (приложение не создаётся, порт не открывается).
    4. `setPreparsedEnv(env, parsed)`.
    5. Логгер `pino(...createLoggerOptions({service, entry: 'http', env: parsed, ...logger, redaction}).pinoHttp)`.
    6. Окружение Sentry читается так же, как в `initSentry`: `z.object(envSentry).safeParse(process.env)`. Схема сервиса может не содержать `envSentry` (в `envBase` нет `SENTRY_DSN`). Если разбор успешен, DSN не `null`, `NODE_ENV = production` и `Sentry.getClient() === undefined` → `warn {code: 'SENTRY_NOT_PRELOADED'}`.
    7. `buildHttpApp({module, service, bodyLimit: http?.bodyLimit, logger, redaction})`.
    8. `MetricsServer({port: METRICS_PORT, registry, health, logger})` → `listen()` → участник шага 5.
    9. `lifecycle.listen()`.
    10. `app.listen({port: PORT, host: '0.0.0.0'})`.
    11. `info` «сервис слушает» `{port, metricsPort}` — фактически занятые порты (`app.getHttpServer().address().port`, `metricsServer.address()`), а не значения окружения: в тестах `PORT=0`, `METRICS_PORT=0`.

    Отказ на шагах 7–10 → `failStartup(error, logger)`. `enableShutdownHooks` не вызывается.
  - Логи: `debug` на каждом шаге («bootstrap: окружение разобрано», «bootstrap: приложение собрано», «bootstrap: метрики слушают»); `warn` `SENTRY_NOT_PRELOADED`; `info` «сервис слушает»; отказ — `fatal` через `failStartup` (E2).

- [ ] **Task 10: `src/http/index.ts` и проверка импорта без `pg`** — §3.5, AC-1.2 (depends on 7, 9)
  - **Skill:** nestjs-code generic src/http/index.ts (CREATE)
  - Явный список экспортов §3.5 (см. Architecture), кроме `Api`/`KitApiOptions` — их добавляет задача 11. Типы — `export type`.
  - Тест `test/unit/http/ac-1-2-http-without-pg.spec.ts`: «AC-1.2: /http не импортирует pg статически» — граф `import` из `src/http/**` (разбор исходников, как `test/package/ac-1-1-package.spec.ts` для `dist/observability`) не содержит `pg`, `../database`, `../testing`.
  - Логи: нет.

### Фаза 4: OpenAPI и CLI

- [ ] **Task 11: `@Api` и построитель OpenAPI 3.1** — §3.5, AC-3.7 (depends on 4, 5, 7, 10)
  - **Skill:** nestjs-code generic src/http/api/api.decorator.ts (CREATE); nestjs-code generic src/http/api/openapi-document.ts (CREATE); nestjs-code generic src/http/index.ts (MODIFY — экспорт `Api`, `export type KitApiOptions`)
  - Эталон I `open-api.decorator.ts` (22 строки) и `openapi-document.ts` (361 строка). Из I берутся: путь из `PATH_METADATA` (`:x` → `{x}`), статус из `HTTP_CODE_METADATA` (POST 201, иначе 200), тело и query — из `ZodValidationPipe` в `ROUTE_ARGS_METADATA`, `z.toJSONSchema(schema, {io, unrepresentable: 'any'})` без `$schema` (`io: 'input'` для запроса, `'output'` для ответа), `operationId`, `ErrorResponse`, схемы `serviceToken`/`userToken`. По PRD: обход метаданных модулей без создания приложения (`imports`, включая `DynamicModule` и промисы `forRoot`, `forwardRef`; `controllers`); маршруты без `@Api` пропускаются, кроме `/ok` — тоже пропуск; `X-On-Behalf-Of` и `Idempotency-Key` не переносятся (домен I / E4); ошибки — `errors` маршрута (коды → статусы из реестра `defineErrors`) + стандартные 400, 401, 403, 422, 429 (401/403 — только у защищённых маршрутов). Защищённость, ключи `Require*` строками и выбор схемы — по Reconciliation, строка «Безопасность в OpenAPI»; импорта `REQUIRE_*` из `@verdeect/auth` нет; `path` из `@Param` с пайпом — схема параметра; `extra` — глубокое слияние в операцию.
  - API: `Api(options: KitApiOptions): MethodDecorator` (`SetMetadata('verdeect-kit:api', options)`); внутренняя `buildOpenApiDocument(module, {title, version}): Promise<OpenApiDocument>` и `routeResponseSchema([Controller, method])` — для `expectMatchesApi`. Документ детерминирован: пути и коды отсортированы.
  - Логи: `debug` «openapi: собран» `{operations}`; маршрут с `@Api`, но без пути/метода — `Error` с именем `Controller.method`.

- [ ] **Task 12: CLI `verdeect-kit` и команда `openapi`** — §3.5, AC-3.7, AC-3.8 (depends on 11)
  - **Skill:** nestjs-code generic src/cli/main.ts (CREATE); nestjs-code generic src/cli/commands/openapi.ts (CREATE)
  - `main.ts` (`#!/usr/bin/env node`): разбор `process.argv` через `node:util` `parseArgs`; команда → динамический `import('./commands/openapi.js')` (ARCHITECTURE «CLI»). Обработчик команды возвращает код выхода (0/1), `main.ts` ставит `process.exitCode`. `process.exit` не вызывается: ARCHITECTURE разрешает его только `failStartup` и сторожу. Неизвестная команда → JSON `{error: {code: 'UNKNOWN_COMMAND', message}}` в stdout, `exitCode = 1`. Импорт `reflect-metadata` — первым. Правило lint на `src/cli/**` (задача 1) не меняется: подпути в `src/cli/commands/openapi.ts` грузятся динамически, путь от `commands/`: построитель — `await import('../../http/api/openapi-document.js')` (`buildOpenApiDocument` внутренний, в `src/http/index.ts` его нет); `'../../observability/index.js'` (`createLoggerOptions`) и `'../../config/index.js'` (`envBase`); `import type` разрешён. Динамический `import()` правило `no-restricted-imports` не проверяет.
  - `openapi.ts`: `--out <файл>` обязателен, `--module <файл>#<экспорт>` (умолчание `dist/app.module.js#AppModule`), `--title`/`--version` берутся из полей `name`/`version` `package.json` в cwd. Нет файла или поля → JSON `{error: {code: 'INVALID_PACKAGE_JSON'}}`, код 1: `info.version` обязателен в OpenAPI 3.1. Модуль загружается `import(pathToFileURL(resolve(cwd, file)))`; нет файла или экспорта → `{error: {code: 'MODULE_NOT_FOUND', message}}`, выход 1. Документ сливается с `contracts/openapi.extra.json` (рядом с `--out`), если файл есть. Запись — JSON с отступом 2 и `\n` в конце. Результат — `{"written": "<путь>", "operations": N}` в stdout, выход 0. Логгер CLI — `pino(...createLoggerOptions({service: 'verdeect-kit', entry: 'cli', env}).pinoHttp)` → stderr. `env` — результат `z.object({LOG_LEVEL: envBase.LOG_LEVEL, REPLICA_ID: envBase.REPLICA_ID}).safeParse(process.env)` (CLI разбирает только свои ключи, по образцу `cli-schemas.ts`). Неверное значение → JSON `{error: {code: 'INVALID_ENVIRONMENT', keys}}` без значений и код 1.
  - Логи: `debug` «cli: команда» `{command}`; `info` «openapi: записан» `{out, operations}`; ошибка — `error` в stderr + JSON в stdout.

### Фаза 5: Помощники `/testing` этапа E3

- [ ] **Task 13: `createTestApp`** — §3.8 (E3), UC-14 (depends on 8)
  - **Skill:** nestjs-code generic src/testing/create-test-app.ts (CREATE)
  - Эталон O `test/support/app.ts` (67 строк): `Test.createTestingModule` → `overrideProvider(...).useValue(...)` → `compile` → `createNestApplication(adapter)` → `init` → `getInstance().ready()`. По PRD: через `buildHttpApp({…, compile})` — тот же адаптер, хуки, фильтр, участники; `inject` без порта.
  - `createTestApp({module, service, overrides?: readonly {provide, useValue}[], bodyLimit?}): Promise<NestFastifyApplication>`; первым делом `assertServiceName(service, 'createTestApp')` — та же проверка, что у `bootstrapService` (KT-15 п. 3); `import type * as NestTesting from '@nestjs/testing'` и `const {Test} = await loadPeer<typeof NestTesting>('@nestjs/testing', 'testing')` внутри функции. Образец — `start-test-stack.ts`. `typeof import(…)` не проходит `@typescript-eslint/consistent-type-imports`. Закрытие — `app.close()` (= `lifecycle.close()`, без сторожа и `exit`).
  - Экспорт в `src/testing/index.ts`.
  - Логи: `debug` «testing: приложение собрано» `{service, overrides: число}`.

- [ ] **Task 14: `expectProblem` и `expectMatchesApi`** — §3.8 (E3), AC-3.7 (depends on 11, 13)
  - **Skill:** nestjs-code generic src/testing/expect-problem.ts (CREATE); nestjs-code generic src/testing/expect-matches-api.ts (CREATE)
  - Эталона нет: ближайшее — O `test/support/http.ts` (`errorCode`). Пишется по PRD.
  - `expectProblem(res: {statusCode: number; json(): unknown}, {status, code, issues?})`: статус, форма `{error: {code, message: string, details: object}}`, `code`; `issues` — глубокое сравнение `details.issues`. Утверждения — `node:assert/strict` (`strictEqual`, `deepStrictEqual` с понятным текстом); peer `vitest` не загружается (в `/testing` его во время выполнения не грузит ни один модуль).
  - `expectMatchesApi(res, route: readonly [Type, string])`: схема ответа маршрута — `routeResponseSchema(route)` (задача 11), статус совпадает со статусом операции, тело проверяется `Ajv2020` (`allErrors: true`, `strict: false`). Несовпадение → `assert.fail` с путями ошибок Ajv; маршрут без `@Api` → падение с понятным текстом.
  - Экспорт в `src/testing/index.ts`.
  - Логи: нет (утверждения теста).

### Фаза 6: Тесты HTTP

- [ ] **Task 15: U — ошибки запросов, 404, заголовки безопасности на `createTestApp`** — AC-3.1, AC-3.4, AC-3.5 (depends on 10, 14)
  - **Skill:** nestjs-code test unit http request-errors (CREATE)
  - Файлы: `test/unit/http/ac-3-1-request-errors.spec.ts`, `test/unit/http/ac-3-4-route-not-found.spec.ts`, `test/unit/http/ac-3-5-security-headers.spec.ts`, общий `test/unit/http/support.ts` (пробный модуль: `KitConfigModule.forRoot({schema: defineEnv({...envBase})})`, контроллер `POST /probe` с `@Body(new ZodValidationPipe(z.strictObject({title: z.string(), tags: z.array(z.string())})))`, `GET /boom` с `throw new Error('MARK_SECRET')`).
  - Перенос: P/O `test/http/errors/request-errors.http-spec.ts`, B `test/http/shared/request-errors.http-spec.ts` (400/413/415 — с кодами PRD), I `ac-8-3-security-headers.http-spec.ts` (только базовые заголовки API).
  - Случаи:
    - «AC-3.1: неверное тело → 422 VALIDATION_FAILED, issues `title`/`tags.0`, значений нет» (`expectProblem`);
    - «AC-3.1: не JSON → 400 BAD_REQUEST»;
    - «AC-3.1: `Content-Type: application/xml` → 415 UNSUPPORTED_MEDIA_TYPE»;
    - «AC-3.1: тело больше 1 MiB → 413 PAYLOAD_TOO_LARGE»;
    - «AC-3.1: ошибки запроса не отправляются в GlitchTip, `/boom` — ровно одно событие» (`fake-sentry`, правило «Expected Errors Are Not Reported»);
    - «AC-3.4: `GET /nope` → 404 `{ROUTE_NOT_FOUND, 'Адрес не найден', {}}`»;
    - «AC-3.5: `nosniff` и `no-referrer` на 200, 422, 404, 500 и `/ok`»;
    - «§3.5: `/ok` → 200 `{status: 'ok'}`, `no-store`»;
    - «§3.5: `app.close()` — шаги 1–5 без exit, повторный вызов — тот же промис»;
    - «§3.2: шаг 3 `nest` после шага 2 — повторное закрытие Fastify без ошибки, `app.close()` выполняется» — перед `app.close()` приложение слушает порт: `await app.listen({port: 0, host: '127.0.0.1'})`. Без этого `closeServer` сразу возвращается, и путь «закрыт сервер → закрытие Fastify/Nest» не проверяется. Далее — хуки модуля в порядке Nest (`onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`, журнал вызовов)» (KT-15 п. 1);
    - «§3.5: `createHttpApp` (путь NestFactory, не `createTestApp`): `app.close()` — `/health` 503 первым, каждый участник шагов 2–3 вызван один раз, повторный вызов завершается и не запускает шаги снова». Тождество промисов здесь не проверяется: прокси NestFactory (`createAdapterProxy` → `mapToProxy`) возвращает новый промис на каждый вызов. «Тот же промис» проверяется только для `createTestApp`;
    - «§3.5: `createHttpApp` с модулем без `KitConfigModule.forRoot` отклоняется `Error` с этим именем, `process.exit` не вызван» (`abortOnError: false`);
    - «§3.8: `createTestApp` с `service: 'Bff_App'` — ошибка формата» (KT-15 п. 3);
    - «§3.8: `overrides` подменяет провайдер модуля сервиса»;
    - «§3.5: провайдер модуля сервиса внедряет `KitLifecycle` и `HealthRegistry` (экспорт ядра)»;
    - «§3.2: `app.close()` на слушающем приложении с keep-alive клиентом (`fetch` долгого маршрута) завершается не позже ~1 с после ответа» (`listen({port: 0})`).
  - Логи: нет (тесты); логгер приложения — уровень `silent` через `LOG_LEVEL`.

- [ ] **Task 16: U — `bootstrapService`** — AC-3.10, AC-3.11, AC-3.12, AC-3.13 (depends on 15)
  - **Skill:** nestjs-code test unit http bootstrap-service (CREATE)
  - Файлы: `test/unit/http/ac-3-10-service-name.spec.ts`, `ac-3-11-sentry-not-preloaded.spec.ts`, `ac-3-12-role-options.spec.ts`, `ac-3-13-env-before-app.spec.ts`. Общее: `vi.spyOn(process, 'exit')` бросает маркер; `PORT=0`, `METRICS_PORT=0`; перехват stdout логгера (`process.stdout.write` spy) с разбором JSON-строк; после теста — `app.close()` и снятие обработчиков `SIGTERM`/`SIGINT`, добавленных `listen()` (`process.listeners` до/после); `vi.stubEnv` + `vi.unstubAllEnvs`.
  - Случаи:
    - «AC-3.10: `Bff_App`, пусто, 33 символа — отказ запуска (fatal, exit 1, текст формата); `bff-app` проходит».
    - «AC-3.11: DSN + production без `instrument` → warn `SENTRY_NOT_PRELOADED`, запуск продолжается; с `Sentry.init` — предупреждения нет». Схема сервиса в тесте — `defineEnv({...envBase})`, без `envSentry`: DSN берётся из `process.env`. Файл — с собственным `Sentry.init`/`close`, процесс-глобальное состояние.
    - «AC-3.12: `trustTraceparent: false` — trace-id в логе доступа ≠ из `traceparent`».
    - «AC-3.12: `quietRoutes: ['/probe']` — успешный на debug, 422 — info».
    - «AC-3.12: `http.bodyLimit: 1024` → тело 2 KiB → 413 PAYLOAD_TOO_LARGE».
    - «AC-3.12: `redaction.sensitiveKeys: ['projectSecret']` скрыт в логе и в событии GlitchTip; `authorization`, `password`, `refresh_token` тоже скрыты». Событие — через поддельный транспорт: `test/support/fake-sentry.ts` (MODIFY) — `initFakeSentry({redaction?})` передаёт `redaction` в `scrubEvent(event, hint.originalException, redaction)` и добавляет `beforeBreadcrumb: (c) => scrubBreadcrumb(c, redaction)`. Сейчас `initFakeSentry()` вызывает скраббер без `redaction`, а `initSentry` транспорта не принимает. Тест передаёт тот же объект `redaction` и в `initFakeSentry`, и в `bootstrapService`. Существующие вызовы `initFakeSentry()` без аргумента не меняются.
    - «AC-3.12: `sensitiveKeys: []` базовый список не отключает».
    - «AC-3.13: неверное окружение → fatal `INVALID_ENVIRONMENT`, exit 1, `onModuleInit` пробного модуля не вызван, порт не открыт».
    - «AC-3.13: при верном окружении `parseEnv` вызван один раз». Счётчик — схема `defineEnv` с `superRefine`-счётчиком вызовов: refine выполняется при каждом `parseEnv`.
    - «§3.5: модуль без `KitConfigModule.forRoot` → fatal через `failStartup`, текст называет `KitConfigModule.forRoot`, exit 1» (KT-15 п. 2).
    - «§3.2: после `bootstrapService` `SIGTERM` слушает ровно один новый обработчик (`KitLifecycle.listen`), `enableShutdownHooks` не вызван» (`process.listenerCount('SIGTERM')` до/после = +1; KT-15 п. 1).
  - Логи: нет (тесты).

- [ ] **Task 17: U — OpenAPI, `expectMatchesApi`, CLI** — AC-3.7 (depends on 12, 14)
  - **Skill:** nestjs-code test unit http openapi (CREATE)
  - Файлы: `test/unit/http/ac-3-7-openapi.spec.ts`, `test/unit/cli/ac-3-7-openapi-command.spec.ts`, фикстура `test/fixtures/http/api-app.module.ts` (контроллер с `@Api` на `GET /items` (`envelope: 'page'`, query `PageQuerySchema`), `POST /items` (тело, `errors: ['VERSION_CONFLICT']`), `GET /items/:id`; класс под `@UseGuards(VerdeectAuthGuard)` + `@RequireScope('items:read')`; маршрут без защиты).
  - Перенос: I `test/http/api/openapi.http-spec.ts` (схемы компилируются Ajv, безопасность по маршрутам, ответы соответствуют схеме).
  - Случаи:
    - «AC-3.7: документ проходит валидатор OpenAPI 3.1» (`@seriousme/openapi-schema-validator`);
    - «AC-3.7: схемы тела, query и ответа (`{items, nextCursor}`)»;
    - «AC-3.7: ошибки маршрута (409) и стандартные 400/401/403/422/429»;
    - «AC-3.7: схема безопасности `serviceToken` с областью `items:read`; незащищённый маршрут без `security`»;
    - «AC-3.7: `expectMatchesApi` проходит на верном ответе и падает на ответе вне схемы (лишнее поле, неверный тип)»;
    - «AC-3.7: CLI `openapi --out <tmp> --module <fixture>#ApiAppModule` пишет тот же документ, stdout `{written, operations}`»;
    - «AC-3.7: `--module` с несуществующим файлом → JSON `{error: {code: 'MODULE_NOT_FOUND'}}` в stdout, выход 1»;
    - «AC-3.7: cwd с `package.json` без `version` → JSON `{error: {code: 'INVALID_PACKAGE_JSON'}}`, выход 1» (временный каталог);
    - «AC-3.7: `--module <fixture>#NoSuchExport` → JSON `{error}`, выход 1» (оба — вызов обработчика команды в процессе; проверяются возвращённый код выхода и JSON, записанный в stdout; spy на `process.exit` не нужен — CLI его не вызывает).
  - Логи: нет.

- [ ] **Task 18: I — keyset на PostgreSQL** — AC-3.6 (depends on 7)
  - **Skill:** nestjs-code test integration http keyset (CREATE)
  - Файл `test/integration/http/ac-3-6-keyset.spec.ts`. PostgreSQL — из `test/integration/global-setup.ts` (`inject`, E1), `pg` + `drizzle-orm/node-postgres`, своя временная схема с уникальным именем на файл, удаляется в `afterAll`.
  - Случаи:
    - «AC-3.6: обход всех страниц по (`created_at`, `id`) desc с `limit` 3 — все строки по одному разу»;
    - «AC-3.6: вставка строк между страницами не даёт дублей и пропусков» (строки старше курсора попадают в следующие страницы, новее — нет);
    - «AC-3.6: сортировка без уникального последнего ключа — ошибка помощника»;
    - «AC-3.6: `limit` 201 и неверный курсор → 422» (через `PageQuerySchema` и `decodeCursor`).

    Порядок проверяется по уникальному `id`, не по тексту (правило «Deterministic Test Data Order»).
  - Логи: нет.

- [ ] **Task 19: T — остановка HTTP под нагрузкой** — AC-3.9, UC-8 (depends on 9)
  - **Skill:** nestjs-code test integration http shutdown (CREATE)
  - Файлы: `test/timing/http/ac-3-9-shutdown.spec.ts`, дочерний процесс `test/fixtures/http/shutdown-app.mjs`. Он берёт `bootstrapService` из собранного `dist` (как `test/fixtures/observability/shutdown-child.mjs` E2), декораторы применяются функциями (`Module({...})(AppModule)`, `Controller()(…)`, `Get('slow')(…)`). Контур timing `dist` не собирает (`test/timing/global-setup.ts` — только `timingGuard`). Поэтому спек в `beforeAll` собирает `tsc -p tsconfig.build.json --outDir node_modules/.cache/kit-timing-dist` — тот же образец и каталог, что у `ac-2-10-shutdown-exit.spec.ts`; `dist/` не трогается. Каталог передаётся ребёнку аргументом. Маршрут `GET /slow` ждёт 1500 мс; `SHUTDOWN_DRAIN_MS=500`, `SHUTDOWN_TIMEOUT_MS=5000`; порты печатаются первой строкой stdout.
  - Перенос: O `ac-10-8-shutdown.http-spec.ts` (сценарий «долгий запрос до сигнала дорабатывает, `app.close()` в срок») и `or-106-health-stopping-first.http-spec.ts` (`/health` 503 раньше закрытия).
  - Случаи:
    - «AC-3.9: `/health` 503 раньше, чем HTTP перестаёт принимать соединения» (опрос `/health` и `/ok` раз в 25 мс: первый 503 `/health` раньше первого отказа соединения `/ok`);
    - «AC-3.9: долгий запрос, начатый до сигнала, дорабатывает с 200»;
    - «AC-3.9: новый запрос после шага 2 — отказ соединения (`ECONNREFUSED`)»;
    - «AC-3.9: выход 0 в пределах `SHUTDOWN_TIMEOUT_MS`»;
    - «AC-3.9: открытый долгий поток SSE (`GET /stream`, `reply.raw` без завершения) закрывает участник шага 2 сервиса, шаг 2 завершается до `SHUTDOWN_TIMEOUT_MS`, выход 0» (KT-15 п. 1). Участник регистрируется в фикстуре через внедрённый `KitLifecycle` в `onModuleInit`: `register({name: 'sse', stop: () => потоки.forEach((raw) => raw.end())}, {step: 2})`. В `.mjs` нет `emitDecoratorMetadata`, поэтому внедрение задаётся явно: `Inject(KitLifecycle)(SseService, undefined, 0)`. `KitLifecycle` импортируется из той же сборки `kit-timing-dist`, что и `bootstrapService`, — иначе токен-класс не совпадёт. Режим фикстуры выбирается аргументом.

    Перед тестом — `timingGuard` (`test/timing/global-setup.ts`). Тайм-ауты не поднимаются.
  - Логи: нет.

### Фаза 7: Проект-потребитель и проверки пакета

- [ ] **Task 20: Проект-потребитель на `bootstrapService` и снимок OpenAPI** — AC-9.1, AC-3.8, AC-1.1, AC-1.2 (depends on 9, 12, 13)
  - **Skill:** none — проект-потребитель вне `src/` (TypeScript сервиса); тест — `nestjs-code test unit package consumer (MODIFY)`
  - `test/consumer/minimal`:
    - `src/service/{instrument.ts, main.ts, app.module.ts, items.controller.ts}`. `AppModule` импортирует `KitConfigModule.forRoot({schema: envSchema})`; контроллер с `@Api` на `GET /items` (keyset `pageOf` по массиву в памяти).
    - `src/service/env.ts` — `serviceEnvSchema = defineEnv({...envBase, ...envDatabase})` (как в E2 `service/main.mjs`). `envSchema` из `src/env.ts` не подходит: он требует `SERVICE_URLS`, а `startService` его не задаёт. Один объект схемы — в `main.ts` и в `KitConfigModule.forRoot` `AppModule` (иначе `KitConfigModule` разберёт окружение повторно);
    - `main.ts` — `await bootstrapService({module: AppModule, service: 'consumer', env: serviceEnvSchema})`; проба `/health` `database` (TCP) регистрируется в `onModuleInit` через внедрённый `HealthRegistry`.
    - `tsconfig.build.json` (`extends: ./tsconfig.json`, `noEmit: false`, `experimentalDecorators`, `emitDecoratorMetadata`, `rootDir: src`, `outDir: dist`, `include: ["src/service"]`). Выход — `dist/service/{instrument,main,app.module,…}.js`; все пути задачи (`node --import ./dist/service/instrument.js dist/service/main.js`, `--module dist/service/app.module.js#AppModule`) — от него. В `tsconfig.json` тоже `experimentalDecorators` и `emitDecoratorMetadata`: его использует проверка AC-1.1 `tsc -p tsconfig.json` по `src`. `types-check.ts` — проверка типов экспортов `/http` (`KitBootstrapOptions`, `Page`, `DomainError`).
    - Скрипты `package.json`: `build` (`tsc -p tsconfig.build.json`), `openapi` (`verdeect-kit openapi --out contracts/openapi.json --module dist/service/app.module.js#AppModule`).
    - `contracts/openapi.json` — эталонный снимок (генерируется при реализации и коммитится).
    - Удалить `service/main.mjs`, `service/instrument.mjs`.
  - `src/observability.spec.ts` → процесс `node --import ./dist/service/instrument.js dist/service/main.js` (после `pnpm build` в `globalSetup`). Логи сервиса на `bootstrapService` идут в **stdout**: `entry: 'http'`, и запасной логгер задачи 9 тоже пишет в stdout. В E2 `main.mjs` писал в stderr (`entry: 'cli'`). Поэтому `startService` разбирает JSON-строки stdout, порты (`port`, `metricsPort`) берёт из строки «сервис слушает». Случаи «строки остановки содержат service и replica» и «неверный METRICS_PORT → fatal…» проверяют строки stdout, а не `stderrLines`. Новые случаи: «AC-9.1: `/ok` на PORT → 200», «AC-9.1: неверное окружение → fatal без значения, выход 1, порт не открыт». Прежние случаи `/health`, `/metrics`, SIGTERM — без изменений смысла. Порт печатается строкой лога «сервис слушает» (`port`, `metricsPort`).
  - `src/openapi.spec.ts`: «AC-3.8: снимок contracts/openapi.json совпадает с документом из кода» — CLI пишет во временный файл, сравнение с коммитом.
  - `import-check.mjs` и `no-testcontainers/peer-check.mjs`: добавить `http` («AC-1.2: без pg /http импортируется»); ожидаемые строки в `test/package/ac-9-1-consumer.spec.ts` обновить.
  - `test/package/ac-9-1-consumer.spec.ts`: новый случай «AC-3.8: изменение маршрута без `pnpm openapi` валит снимок». Путь в `items.controller.ts` копии проекта меняется на `/goods`, затем `pnpm build` и `vitest run src/openapi.spec.ts` → код ≠ 0. После теста проект пересоздаётся или правка откатывается.
  - `package.json` потребителя: зависимости без изменений (все peer `/http` уже есть); `@nestjs/testing` намеренно не ставится. Добавить `"version": "0.0.0"`: CLI берёт из него `info.version`.
  - `src/testing-peer.spec.ts`: «AC-1.2: createTestApp без @nestjs/testing → «@verdeect/kit/testing требует @nestjs/testing — добавьте в зависимости сервиса»» (PRD v1.13 NFR-3; `/testing` импортируется — `testcontainers` есть, — падает вызов).
  - Логи: нет (код потребителя логирует через пакет).

- [ ] **Task 21: R — архив, `bin`, точки входа документации** — AC-1.1, AC-9.3 (depends on 20)
  - **Skill:** nestjs-code test unit package pack (MODIFY)
  - `test/package/ac-1-1-package.spec.ts`:
    - «AC-1.1: архив содержит `dist/http/index.js`, `dist/cli/main.js`»;
    - «AC-1.1: `dist/cli/main.js` начинается с `#!/usr/bin/env node`»;
    - «AC-1.1: `dist/http` не загружает `pg`, `dist/testing`, `dist/database`» — обход графа, как для `dist/observability`;
    - «NFR-3: `ajv` загружается только из `dist/testing`» — поиск импорта `ajv` во всех `dist/**/*.js` вне `dist/testing` (KT-15 п. 4);
    - список файлов в проверке «без testing» дополнить `http`, `cli`;
    - publint и attw — с `bin`.
  - `test/package/ac-9-3-docs.spec.ts`: `ENTRY_POINTS` дополнить `src/http/index.ts`. Новые экспорты `/testing` попадают в проверку автоматически.
  - Логи: нет.

### Фаза 8: Документация

- [ ] **Task 22: README, CHANGELOG `[Unreleased]`, docs/testing.md** — AC-9.3, «Library Package Scope» (7) (depends on 21)
  - **Skill:** none — документация (Markdown)
  - `README.md`:
    - раздел «HTTP» — `main.ts` с `bootstrapService` и `instrument.ts`, обязательный импорт `KitConfigModule`, опции по роли (BFF `trustTraceparent: false`, P/O `quietRoutes`, O `redaction`), словарь `defineErrors`/`DomainError`, таблица кодов `kitErrors`, пагинация, `@Api` и `verdeect-kit openapi --out … --module …`, `contracts/openapi.extra.json`, `security` — по `@UseGuards(VerdeectAuthGuard)` и `Require*`; `APP_GUARD` генерация не видит, поэтому `@UseGuards` ставится на контроллер, а маршрут без guard'а документируется без `security` (KT-15 п. 5); пример потока SSE, который закрывает участник шага 2 `KitLifecycle` (это «`onStopAccepting`» §3.2): участник вызывает `reply.raw.end()` (или `destroy()`), иначе остановка ждёт до срока; правило остановки для модулей: `beforeApplicationShutdown` = шаг 3, `onApplicationShutdown` = шаг 4, они вызываются внутри участника `nest` (KT-15 п. 1); 4xx домена — только `DomainError` (прочие `HttpException` без тела → 500);
    - «API» → `### @verdeect/kit/http`, все экспорты §3.5;
    - «Тесты сервиса» — `createTestApp`, `expectProblem`, `expectMatchesApi`, `@nestjs/testing`;
    - «Установка» — опциональный peer `@nestjs/testing`.
  - `CHANGELOG.md` `[Unreleased]`:
    - `Added`: подпуть `/http`, CLI `verdeect-kit openapi`, помощники `/testing` этапа E3, опциональный peer `@nestjs/testing`, зависимость `ajv`;
    - `Changed`: `KitConfigModule.forRoot` разбирает окружение при сборке контекста, не пишет умолчания в `process.env`, при `bootstrapService` не разбирает повторно.
  - `docs/testing.md`: уровень T `test/timing/http`; потребитель собирается `tsc`.
  - `.ai-factory/ARCHITECTURE.md`, раздел «Жизненный цикл»: правило для E4–E8 (KT-15 п. 1). Шаг 2 — HTTP-сервер и участники сервиса (SSE) параллельно. Шаг 3 — участник `nest` (`app.close()` Nest): модули kit закрываются в `beforeApplicationShutdown` (шаг 3) и `onApplicationShutdown` (шаг 4). `app.close()` экземпляра = `lifecycle.close()`. В таблице «Правила зависимостей», строка `cli`: «любой подпуть или внутренний модуль пакета (`http/api/openapi-document`) через динамический `import()`». Строка `testing`: `ajv` — среди разрешённых зависимостей («только `testing`»), `@nestjs/testing` — среди опциональных peer. Правило «опциональный peer — только `await loadPeer` на верхнем уровне модуля» дополнить исключением: `@nestjs/testing` грузится внутри `createTestApp`, поэтому `/testing` импортируется и без него (PRD v1.13 NFR-3).
  - Логи: нет.
  - Готово, когда: `pnpm exec vitest run -c vitest.package.config.ts test/package/ac-9-3-docs.spec.ts` зелёный.

## Commit Plan
- **Commit 1** (задачи 1–3): `feat(http): манифест ./http и bin, распознавание ошибок pg, ленивый KitConfigModule`
- **Commit 2** (задачи 4–7): `feat(http): словарь ошибок, DomainError, ZodValidationPipe, KitExceptionFilter, keyset-пагинация`
- **Commit 3** (задачи 8–10): `feat(http): createHttpApp и bootstrapService`
- **Commit 4** (задачи 11–14): `feat(http): @Api, CLI openapi, createTestApp, expectProblem, expectMatchesApi`
- **Commit 5** (задачи 15–19): `test(http): AC-3.1–AC-3.13 — U, I, T`
- **Commit 6** (задачи 20–22): `feat: проект-потребитель на bootstrapService, снимок OpenAPI, README и CHANGELOG (E3)`

Перед слиянием: `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check).

## Traceability

| UC/AC | Задачи | Тест-файл / название |
|---|---|---|
| AC-3.1 | 5, 6, 15 | `test/unit/http/zod-validation.pipe.spec.ts`, `ac-3-3-exception-filter.spec.ts` («AC-3.1: HttpException 413/415/400»), `ac-3-1-request-errors.spec.ts` / «AC-3.1: …» |
| AC-3.2 | 4, 6 | `test/unit/http/ac-3-2-define-errors.test-d.ts`, `ac-3-2-error-dictionary.spec.ts`, `ac-3-3-exception-filter.spec.ts` («AC-3.2: DomainError с незарегистрированным кодом …») / «AC-3.2: …» |
| AC-3.3 | 2, 6 | `test/unit/http/ac-3-3-exception-filter.spec.ts`, `test/unit/internal/pg-errors.spec.ts` / «AC-3.3: …», «§3.3: …» |
| AC-3.4 | 6, 8, 15 | `test/unit/http/ac-3-4-route-not-found.spec.ts` / «AC-3.4: GET /nope → 404 ROUTE_NOT_FOUND» |
| AC-3.5 | 8, 15 | `test/unit/http/ac-3-5-security-headers.spec.ts` / «AC-3.5: nosniff и no-referrer на 200, 422, 404, 500 и /ok» |
| AC-3.6 | 7, 18 | `test/unit/http/pagination.spec.ts`, `test/integration/http/ac-3-6-keyset.spec.ts` / «AC-3.6: …» |
| AC-3.7 | 11, 12, 14, 17 | `test/unit/http/ac-3-7-openapi.spec.ts`, `test/unit/cli/ac-3-7-openapi-command.spec.ts` / «AC-3.7: …» |
| AC-3.8 | 12, 20 | `test/consumer/minimal/src/openapi.spec.ts`, `test/package/ac-9-1-consumer.spec.ts` / «AC-3.8: …» |
| AC-3.9 | 8, 9, 19 | `test/timing/http/ac-3-9-shutdown.spec.ts` / «AC-3.9: …» |
| AC-3.10 | 9, 16 | `test/unit/http/ac-3-10-service-name.spec.ts` / «AC-3.10: …» |
| AC-3.11 | 9, 16 | `test/unit/http/ac-3-11-sentry-not-preloaded.spec.ts` / «AC-3.11: …» |
| AC-3.12 | 8, 9, 16 | `test/unit/http/ac-3-12-role-options.spec.ts` / «AC-3.12: …» |
| AC-3.13 | 3, 9, 16 | `test/unit/http/ac-3-13-env-before-app.spec.ts`, `test/unit/config/ac-1-7-kit-config-module.spec.ts` / «AC-3.13: …», «§3.1: …» |
| AC-1.1 (растёт) | 1, 20, 21 | `test/unit/package/package-manifest.spec.ts`, `test/package/ac-1-1-package.spec.ts`, `ac-9-1-consumer.spec.ts` / «AC-1.1: …» |
| AC-1.2 (растёт) | 1, 10, 13, 20 | `test/unit/http/ac-1-2-http-without-pg.spec.ts`, `test/consumer/no-testcontainers/peer-check.mjs`, `test/consumer/minimal/src/testing-peer.spec.ts` / «AC-1.2: …» |
| AC-1.7 (изменён) | 3 | `test/unit/config/ac-1-7-kit-config-module.spec.ts` / «AC-1.7: …» |
| AC-9.1 (растёт) | 20 | `test/consumer/minimal/src/observability.spec.ts`, `test/package/ac-9-1-consumer.spec.ts` / «AC-9.1: …» |
| AC-9.3 (растёт) | 21, 22 | `test/package/ac-9-3-docs.spec.ts` |
| AC-9.4 | 1 | `test/package/ac-9-4-lint-rules.spec.ts` (без изменений; новый `src/**` под правилом) |
| UC-1 | 9, 20 | AC-3.10, AC-9.1 |
| UC-3 | 3, 9, 16 | AC-3.10, AC-3.11, AC-3.13 |
| UC-4 | 4–8, 11, 15–18 | AC-3.1–AC-3.8, AC-3.12 |
| UC-8 | 8, 9, 19 | AC-3.9 |
| UC-14 | 13, 14, 17, 20 | AC-3.7, AC-3.8 |
