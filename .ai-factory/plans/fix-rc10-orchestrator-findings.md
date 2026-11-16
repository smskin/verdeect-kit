# План реализации: выпуск `1.0.0-rc.10` — итоги перехода Orchestrator (r26, PRD v1.31)

Mode: full
Branch: fix/rc10-orchestrator-findings
Created: 2026-11-16

## Original Request
Реализуй выпуск 1.0.0-rc.10 по пакету требований requirements/0000-kit/ (ревизия r26, PRD v1.31).

Скоуп — изменения v1.31 относительно v1.30:
- /http: keyset — проверка значения ключа курсора по типу столбца до запроса (timestamptz — строгий ISO 8601 с зоной, uuid, целое, boolean, строка; now/infinity) → 422 path: cursor без GlitchTip (AC-3.6); OpenAPI — путь Fastify посегментно (:: → :, regex отбрасывается, :from-:to, file.:ext, * → {wildcard}, :id? → ошибка генерации) и параметры пути по тем же правилам; слияние extra/openapi.extra.json — parameters по (name, in), прочие массивы заменяются; @Api({status: number | null}), чтение @Redirect; errors — код или {code, status} из объявленных; expectMatchesApi — те же статусы (AC-3.7, AC-3.15).
- /observability и /database: failStartup — isConnectionError/isPoolTimeout (в т. ч. cause) → DATABASE_UNAVAILABLE, тег code, без SQL, событие не дублируется; KitDatabaseModule при запуске службы — select 1 основного пула со сроком DB_POOL_ACQUIRE_TIMEOUT_MS до прослушивания порта, одинаково с KitIdempotencyModule и без (AC-4.20).
- /idempotency: поздняя попытка — warn и verdeect_idempotency_late_completions_total{scope} (шаблон маршрута), метрика в kitMetrics и правило шаблона алертов (AC-4.14, AC-2.11).
- /messaging: очистка outbox/inbox и идемпотентности — при {ran: false} следующая попытка через 5 мин + случайно до 1 мин, после прохода — раз в час (AC-5.12); срок остановки модуля сообщений запоминается только после начала остановки KitLifecycle.
- /redis: KitRedisChannels — в логах только вид канала, без полного имени (NFR-4, AC-8.6).
- /testing: deliverTestEvent(app, Event, data, opts?) и waitForDelivery(app, messageId, {timeoutMs}) (AC-5.13); createTestApp({backgroundLoops}) и stopBackgroundLoops(app) (AC-5.12); startTestStack({labels}) и timingGuard({onE2e: 'fail' | 'warn'}) (AC-1.12).
- README: CLI сервиса — createApplicationContext с abortOnError: false и try/catch с failStartup (исправить пример; проверка в проекте-потребителе, AC-2.15); «Остановка» — WebSocket 1001 в примере шага 2; configureFastify — preParsing для лимита после аутентификации; @Inject(HealthRegistry) при @Optional и типе | null; Db — только query builder; connectionTimeoutMillis = DB_POOL_ACQUIRE_TIMEOUT_MS; captureThrottled против captureError; слияние extra; хуки остановки вручную не вызывать.
- CHANGELOG [1.0.0-rc.10] с «Как перейти» (отказ запуска при недоступной БД теперь у всех сервисов с KitDatabaseModule; новые экспорты /testing; OpenAPI — пути и статусы могут измениться в снимке), version 1.0.0-rc.10.

Источник истины — requirements/0000-kit/prd.md. На каждый пункт — тест с ID AC, где возможно — сначала падающий на старом коде. Тесты без реальных пауз (кроме проверяемых сроков уровня T), часы подменять, сроки не поднимать. Уже реализованный код не переделывать без требования. Соседние репозитории — только чтение. Перед make test-full — free -h, uptime и отсутствие чужих verdeect-*-e2e: available ≥ 3 ГБ, load < 5. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes. Уровни тестов — по столбцу AC в `prd.md` §5:
  - AC-3.6, AC-4.14, AC-4.20, AC-5.12, AC-8.6, AC-1.12 — I (`test/integration/<подпуть>`);
  - AC-3.7, AC-3.15 — U;
  - AC-5.13 — C (`test/consumer/minimal`);
  - AC-2.11 — R;
  - AC-2.15 — C (`test/consumer/minimal/src/cli.spec.ts`, по запросу пользователя; в PRD — I);
  - AC-5.11 — U (логика запоминания срока без реальных пауз; реальные сроки — существующий `test/timing/messaging/ac-5-11-shutdown.spec.ts`; в PRD — T).
  - Каждый тест пишется первым и запускается на старом коде. Падение (ошибка импорта, типа или поведения) фиксируется в отчёте реализации.
  - Часы подменяются: расписание очистки — через внутренний объект таймеров (задача 9), не `vi.useFakeTimers` поверх `pg`.
  - Реальные паузы — только для проверяемого срока (`DB_POOL_ACQUIRE_TIMEOUT_MS`, срок остановки). Сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino`/`Logger` Nest, без `console.*` (NFR-8, AC-9.4). Конкретные строки — в задачах.
- Docs: no — обязательного чекпоинта `/aif-docs` нет (`WARN [docs]`). README, CHANGELOG и версию обновляют задачи 18–19 («Library Package Scope» (7), AC-9.3).
- Настройки — как в rc.9, ответ пользователя от 16.11.2026.

## Roadmap Linkage
Milestone: "none"
Rationale: вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по находкам перехода Orchestrator (OR-199, OR-205, OR-207, KT-103; G14); отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.32 (r27; v1.31 r26 + уточнения по verify rc.10: §3.2, §3.3, §3.8, AC-4.20) > ответы пользователя на вопросы плана (16.11.2026) > текст запроса > `ARCHITECTURE.md` / `DESCRIPTION.md`.

Скоуп — изменения v1.31 относительно v1.30:
- §3.2: `failStartup`, `kitMetrics`, `KitCoreModule` (README CLI);
- §3.3: `KitDatabaseModule.forRoot`, `Db.transaction` (README);
- §3.3а: `@Idempotent`, поздняя попытка;
- §3.4: очистка;
- §3.5: keyset, `@Api`, CLI `openapi`;
- §3.7: `KitRedisChannels`;
- §3.8: `startTestStack`, `deliverTestEvent`/`waitForDelivery`, `stopBackgroundLoops`, `timingGuard`, `createTestApp`;
- NFR-4;
- AC-1.12, AC-3.6, AC-3.7, AC-3.15, AC-4.14, AC-4.20, AC-5.12, AC-5.13, AC-8.6; AC-2.11 и AC-2.15 — сопутствующие проверки.

N7 (хранилище идемпотентности не экспортируется) — кода не требует. Код rc.9 — существующий: расширять, не переписывать.

| # | Решение | Источник | Задачи |
|---|---|---|---|
| R1 | Курсор проверяется в `afterCursor` по `columnType` столбца Drizzle до построения SQL. Типы проверки: `timestamptz` (`PgTimestamp`/`PgTimestampString` с `withTimezone`) — строгая строка ISO 8601 с зоной (`z.iso.datetime({offset: true})`; `now`, `infinity`, `42`, `"abc"` не проходят); `PgUUID` — строка 8-4-4-4-12 hex; целые (`PgInteger`, `PgSmallInt`, `PgSerial`, `PgSmallSerial`, `PgBigInt53`, `PgBigSerial53`) — `Number.isSafeInteger`; `PgBoolean` — boolean; строки (`PgText`, `PgVarchar`, `PgChar`) — string. Несовпадение — `invalidCursor()` (422 `VALIDATION_FAILED` `path: cursor`, `DomainError`: `warn` без GlitchTip). Типы вне списка (например, `timestamp` без зоны) не проверяются: в PRD их нет. Следствие строгого ISO: курсор из столбца `timestamptz` в `mode: 'string'` без `cursorTimestamp` (Drizzle отдаёт текст PostgreSQL `2026-11-10 10:04:00+00`) теперь даёт 422. Ключ такого столбца берётся через `cursorTimestamp(col)` (`pagination.ts:95`); существующий `page()` спеки AC-3.6 переводится на него, в CHANGELOG — «Как перейти» | §3.5 стр. 148, AC-3.6 | 1, 19 |
| R2 | Путь Fastify → шаблон OpenAPI: один разборщик для пути и параметров. Регулярное выражение `(...)` после имени отбрасывается целиком, со вложенными скобками и `/` внутри. `::` — буквальный `:`. Имя параметра — `[A-Za-z0-9_]+`, дальше литерал (`-`, `.`). `*` → `{wildcard}`. `:name?` → `Error('openapi: <Controller>.<method> — необязательный параметр :name? не поддерживается')` → CLI `OPENAPI_FAILED`, выход 1 | §3.5 стр. 149, AC-3.7 | 2 |
| R3 | Слияние `extra` — одно правило в `deepMerge` для `@Api({extra})` и файла `contracts/openapi.extra.json`. Объекты сливаются глубоко. Ключ `parameters` с массивами с обеих сторон сливается по паре (`name`, `in`): элемент `extra` с той же парой глубоко сливается поверх, новый добавляется в конец, остальные элементы генерации остаются. Прочие массивы (`security`, `tags`, …) заменяются | §3.5, AC-3.7 | 3 |
| R4 | Успешный статус: `@Api({status})` → `@HttpCode` → `@Redirect` (`statusCode`, умолчание Nest 302; ответ без тела) → 201 у POST, 200 у остальных. `status: null` — успешного ответа в документе нет, `expectMatchesApi` отклоняет любой не-ошибочный статус. Тип: `status?: number \| null` | §3.5, AC-3.7 | 4 |
| R5 | Элемент `errors` — `string \| {readonly code: string; readonly status: number}`. Строка даёт все объявленные статусы кода. Объект даёт только `status`; если статус не объявлен для кода — `Error('openapi: C.h — статус 500 не объявлен для кода PLAN_LIMIT')`. `expectMatchesApi` берёт те же статусы из `routeResponseSchema` | §3.5, AC-3.7, AC-3.15 | 4 |
| R6 | **Изменено пользователем 16.11.2026 (до verify):** `DATABASE_UNAVAILABLE` — только отказ проверки соединения `KitDatabaseModule`: ошибка соединения или срок пула при `select 1` → внутренний `StartupFailure` (`startupCode: 'DATABASE_UNAVAILABLE'`, `startupDetails: {cause}`, без `cause`-ошибки) — одно событие с тегом `code`, без SQL и адреса. `failStartup` не меняется: произвольная ошибка с `isConnectionError`/`isPoolTimeout` — `STARTUP_FAILED`. Тест сборки модуля БД с ядром AC-2.15 — на уровне I (`test/integration/observability/ac-2-15-kit-core.spec.ts`, настоящий `createApplicationContext` на БД стенда). Текст ниже — первоначальная редакция | PRD v1.32 (r27) §3.2 стр. 85, §3.3 стр. 93, AC-4.20; ответ пользователя KT-106 | 5, 6 |
| R6 | `failStartup`: если ошибка не `InvalidEnvironmentError` и не `StartupFailure`, а `isConnectionError(raw) \|\| isPoolTimeout(raw)` (с обходом `cause`), то код `DATABASE_UNAVAILABLE`. Лог — `fatal({code, cause: <код узла: errno (ECONNREFUSED…) или SQLSTATE, иначе 'timeout'>}, 'База данных недоступна — запуск остановлен')`: без `err`, адреса, пароля и SQL. В GlitchTip уходит не исходная ошибка, а внутренняя `DatabaseUnavailableError` (`name`, сообщение «База данных недоступна при запуске», без `cause`) с `tags: {code}`. Если исходная ошибка уже отправлена (`wasSent`, в том числе узел цепочки `cause`), повторного события нет, а `fatal`-лог с `code` есть | §3.2 стр. 85 | 5 |
| R7 | Проверка соединения — при сборке `KitDatabaseModule` (асинхронная фабрика токена `KIT_PG_POOLS`; пользователь выбрал «`onModuleInit` везде» — смысл выбора: в любом контексте), в любом контексте (`bootstrapService` до `listen`, `createApplicationContext` CLI, `createTestApp`). Это `select 1` на основном пуле в сроке `DB_POOL_ACQUIRE_TIMEOUT_MS` на всю проверку (подключение и запрос). Событие пула при сроке ожидания для этой проверки не отправляется: метрика `verdeect_db_pool_wait_timeouts_total{pool="main"}` растёт, `warn` пишется (в пути `createTestApp`; в `bootstrapService` и CLI при отказе буфер логов Nest с `autoFlushLogs: false` не выводится, единственная запись — `fatal` от `failStartup`), событие — одно, от `failStartup` с тегом. Отказ фабрики идёт внутри зоны исключений `NestFactory.create`: в `defaultCompile` (`src/http/create-http-app.ts:130–135`) нужен `autoFlushLogs: false`, иначе `ExceptionHandler` выведет ошибку с адресом БД в stderr до `failStartup` (то же основание, что R17). С `autoFlushLogs: false` Nest сам буфер не сбрасывает (`NestFactory.create` не вызывает `flushLogsOnOverride`, `init()`/`listen` сбрасывают только при `autoFlushLogs ?? true` — `nest-application-context.js:184`), поэтому `buildHttpApp` сразу после `app.useLogger(app.get(NestPinoLogger))` (стр. 241) вызывает `app.flushLogs()` — иначе все записи Nest `Logger` сервиса молча копятся в буфере. Проверка идёт раньше `to_regprocedure` `KitIdempotencyModule`: `IdempotencyCleanup` внедряет `Db` и создаётся только после фабрики (порядок `onModuleInit` не важен) | ответ пользователя 16.11.2026; §3.3 стр. 93; AC-4.20 | 6 |
| R8 | Поздняя попытка: `taken(rowCount)` в `completeWithRetry` пишет `warn` (как сейчас, плюс поле `scope`) и делает `lateCompletions.inc({scope})`. `scope` — `request.routeOptions.url` Fastify (шаблон с префиксами, `/items/:id`), без значений параметров. Метрика — `verdeect_idempotency_late_completions_total{scope}` в `kitMetrics`, поле `idempotencyLateCompletions`. Правило — `VerdeectIdempotencyLateCompletions`, `increase(...[15m])` с порогом по умолчанию 0 и переопределением `verdeect_kit_threshold:idempotency_late_completions` (общий вид правил шаблона, тест AC-2.11) | §3.2 стр. 83, §3.3а, AC-4.14, AC-2.11 | 7, 8 |
| R9 | Расписание обеих очисток — цепочка `setTimeout` вместо `setInterval`. Первый проход — сразу (как сейчас). После выполненного прохода (`ran: true`) и после ошибки — `CLEANUP_INTERVAL_MS` (1 ч). После `{ran: false}` из-за занятого замка — `5 мин + random() × 1 мин`. Ошибка не равна занятому замку: в PRD сказано «из-за занятого замка». Таймеры и `random` — через внутренний объект `cleanupClock` (`src/internal/cleanup-schedule.ts`), тест подменяет его методы | §3.4 стр. 133, AC-5.12 | 9 |
| R10 | Срок обработчиков `RabbitConnection.shutdownDeadline()` запоминается, только если остановка `KitLifecycle` началась (`shutdownRemainingMs(core) !== undefined`). Иначе каждый вызов получает новый срок без запоминания | §3.8 стр. 191 | 10 |
| R11 | Логи `KitRedisChannels` (`debug` и `error`): поле `channelKind` = сегмент канала до первого `:` (канал без `:` — весь канал); поля `channel` нет. GlitchTip — как сейчас, без имени канала | §3.7 стр. 171, NFR-4, AC-8.6 | 11 |
| R12 | `createTestApp({backgroundLoops: false})`: внутренний глобальный токен `KIT_BACKGROUND_LOOPS = false` в `KitTestExtrasModule`. Relay не стартует цикл и канал, `wake()` ничего не делает; обе очистки не планируются. `OutboxStore.add` и подписчик работают. Умолчание — `true` | §3.8 стр. 193 | 12 |
| R13 | `stopBackgroundLoops(app)`: у relay, `MessagingCleanup`, `IdempotencyCleanup` (что есть в приложении, `app.get(…, {strict: false})`) вызывается внутренний `stopLoops()`. Он останавливает цикл, ждёт текущий проход без срока, не трогает `shutdownDeadline`, канал relay, подписчик и соединения. Повтор — без действия, возобновления нет. Последующий `beforeApplicationShutdown` relay закрывает канал и при остановленном цикле | §3.8 стр. 191 | 12 |
| R14 | `deliverTestEvent(app, Event, data, opts?)` строит конверт так же, как `publishTestEvent` (опции — `KitPublishTestEventOptions`, тенант по умолчанию тот же). Затем вызывает внутренний `KitSubscriber.deliverForTest(bytes)`: тот же путь, что `handle()` — разбор, выбор по (`type`, `version`), проверка `data`, inbox и транзакция `Db`, классификация ошибки обработчика, лог и `verdeect_events_consumed_total`. Без ack/nack и без отправки в DLQ. Итог — `{result: 'handled' \| 'duplicate' \| 'skipped' \| 'retry' \| 'dlq', reason?: string}` (`reason` — значение `x-dlq-reason` при `dlq`). Ошибка обработчика вне `InvalidMessageError` — `retry` (повторы не моделируются, GlitchTip «после 5 попыток» не вызывается) | §3.8 стр. 190, AC-5.13 | 13 |
| R15 | Журнал итогов для `waitForDelivery` пишется, только если загружен `/testing`: подпуть при импорте ставит `globalThis[Symbol.for('verdeect-kit.delivery-log')] = true`, подписчик проверяет флаг при каждой записи итога. Флаг ставит модуль `src/testing/delivery.ts`, его импортирует `src/testing/index.ts`. Production-сборка `/testing` не грузит (NFR-4), журнала там нет. Журнал — `Map<id, {result, reason?}>` у экземпляра `KitSubscriber`, только для очереди `<svc>`. Хранится первый итог `id`. `waitForDelivery` возвращает его сразу или ждёт; срок × `TEST_TIMEOUT_SCALE`, по сроку — `Error` с `id`. Итог — `{result: 'handled' \| 'retry' \| 'dlq' \| 'skipped', reason?}` | ответы пользователя 16.11.2026; §3.8 стр. 190 | 14 |
| R16 | `startTestStack({labels})`: метки контейнеров = базовые + `labels`. Ключ `verdeect.kit.service` в `labels` — синхронный `TypeError` при вызове `startTestStack`, до контейнеров. При адресах уже поднятых сервисов метки не применяются (контейнера нет). `timingGuard({onE2e = 'fail'})`: при `'warn'` найденный контур даёт строку в stderr (`deps.write`), исключения нет, замеры идут | §3.8 стр. 185, 192, AC-1.12 | 15 |
| R17 | CLI сервиса в README и проекте-потребителе: `NestFactory.createApplicationContext(CliModule, {bufferLogs: true, abortOnError: false, autoFlushLogs: false})` в `try/catch`. `catch` → `failStartup(error, pino({level: 'info'}, pino.destination(2)))`. `autoFlushLogs: false` обязателен: иначе зона исключений Nest пишет ошибку через `ExceptionHandler` в буфер и сбрасывает его в консоль до нашего `catch` (`@nestjs/core/errors/exceptions-zone.js:23–25`, умолчание `autoFlushLogs ?? true` — `nest-factory.js:166`), и в stderr попадает текст Nest. **Решено (ответ пользователя 16.11.2026): вариант (а) — `createApplicationContext(CliModule, {logger: false, abortOnError: false})` без `bufferLogs`, `autoFlushLogs` и `flushLogs()`.** Записи Nest `Logger` модулей пакета в CLI: успешный `init()` контекста буфер не сбрасывает (`nest-application-context.js:118–123`), а `ctx.flushLogs()` без `useLogger` вывел бы буфер через `ConsoleLogger` текстом в stdout (`console-logger.service.js:96, 114, 124`; в `src` логгер Nest подменяет только `create-http-app.ts:241`, адаптера над `KIT_LOGGER` нет) — против §3.2 («`cli` — stderr») и NFR-8. Варианты: (а) `createApplicationContext(CliModule, {logger: false, abortOnError: false})` без `bufferLogs`, `autoFlushLogs` и `flushLogs()` — статический логгер Nest `undefined` (`nest-factory.js:153–156`, `logger.service.js:143–159`), `ExceptionHandler` ничего не пишет, буфер не растёт, записи Nest `Logger` в CLI явно отбрасываются (сейчас они тоже не выводятся), тест AC-2.15 не меняется, нового API нет; (б) адаптер Nest `LoggerService` над `KIT_LOGGER` и `ctx.useLogger(...)` — новый экспорт вне скоупа v1.31. Опцию сверить через Context7. Проверка — в проекте-потребителе, отдельным процессом с неверным окружением: выход 1, JSON-строка `fatal` с `code: 'INVALID_ENVIRONMENT'` в stderr, без текста ошибки Nest | §3.2 стр. 86, AC-2.15 | 17 |

Комбинации расписания очистки (R9):

| Итог прохода | Следующий запуск |
|---|---|
| `ran: true` (`ok`, `partial`, `interrupted`) | через `CLEANUP_INTERVAL_MS` |
| `ran: false`, замок занят | через `300_000 + random() × 60_000` мс, окно [5, 6] мин |
| исключение | через `CLEANUP_INTERVAL_MS` |
| `stopped` / `stopLoops()` | не планируется |
| `backgroundLoops: false` | первый проход и расписание не создаются |

Комбинации итога `deliverTestEvent` (R14):

| Вход | Итог |
|---|---|
| подписанные (`type`, `version`), `dedupe: 'inbox'`, первый `id` | `handled`, строка inbox |
| тот же `id` повторно | `duplicate` |
| `data` вне схемы | `dlq`, `reason: 'data'` |
| неподписанная версия, `unknownVersion: 'skip'` | `skipped` |
| неподписанная версия, `'dlq'` | `dlq`, `reason: 'version'` |
| `type` не подписан | `dlq`, `reason: 'unsubscribed'` |
| `InvalidMessageError` | `dlq`, `reason: error.reason` |
| прочая ошибка / `ExpectedMessageError` | `retry` |

## Commit Plan
- **Commit 1** (после 1–4): `fix(http): курсор по типу столбца, пути Fastify, слияние extra, status и errors в OpenAPI (AC-3.6, AC-3.7, AC-3.15)`
- **Commit 2** (после 5–8): `fix(database): DATABASE_UNAVAILABLE при запуске, метрика поздних попыток идемпотентности (AC-4.20, AC-4.14, AC-2.11)`
- **Commit 3** (после 9–11): `fix(messaging): повтор очистки при занятом замке, срок остановки после начала KitLifecycle; redis: вид канала в логах (AC-5.12, AC-8.6)`
- **Commit 4** (после 12–17): `feat(testing): backgroundLoops, stopBackgroundLoops, deliverTestEvent, waitForDelivery, labels, timingGuard onE2e (AC-5.12, AC-5.13, AC-1.12, AC-2.15)`
- **Commit 5** (после 18): `docs: README и AGENTS.md — rc.10`
- **Commit 6** (после 19): `chore(release): 1.0.0-rc.10` (только `CHANGELOG.md` и `package.json`, как 1b8777d и `docs/releasing.md:30`)

## Tasks

### Фаза 1: `/http`

- [x] **Task 1: keyset — проверка значения курсора по типу столбца** — §3.5, AC-3.6, R1
  - **Skill:** nestjs-code test integration http ac-3-6-keyset (MODIFY) → `test/integration/http/ac-3-6-keyset.spec.ts`; nestjs-code generic src/http/pagination.ts (MODIFY)
  - Тест (сначала, на старом коде). Добавить в таблицу `items` столбец `uuid('ref')`; DDL в `beforeAll` — тоже. Новый `it`: `AC-3.6: курсор с ключом timestamptz = 42, "abc", "now" и ключом uuid = "x" → 422 path: cursor, без события GlitchTip и запроса к БД`.
    - Курсоры — `encodeCursor([42, 'id-1'])`, `encodeCursor(['abc', 'id-1'])`, `encodeCursor(['now', 'id-1'])` для (`createdAt`, `id`). Для маршрута или функции по (`ref`, `id`) — `encodeCursor(['x', 'id-1'])`. `ref` нужно сделать уникальным последним ключом или поставить перед `id`.
    - Ожидание: `DomainError` `VALIDATION_FAILED` с `issues[0].path === 'cursor'` (422).
    - Запросов к БД 0: `countQueries` (`src/testing/count-queries.ts`) на пуле стенда.
    - «Без события GlitchTip» на уровне функции следует из `DomainError` (уровень `warn` без GlitchTip — покрыто тестами фильтра `test/unit/http/ac-3-3-exception-filter.spec.ts`). `initFakeSentry` в этот общий файл не добавлять: спека вызывает `afterCursor` напрямую на пуле, фильтра нет, а Sentry потребовал бы переноса файла в `isolated`.
    - Существующий `page()` спеки (стр. 73–81) строит курсор из `row.createdAt` столбца `mode: 'string'` — текст PostgreSQL, строгий ISO его отклонит. Перевести `page()` на ключ `cursorTimestamp(items.createdAt)` в `select` (как во втором блоке спеки, стр. 165); правку — в отчёт («было → стало, основание R1, AC-3.6»).
    - На старом коде: `42`/`"abc"` уходят в БД (`::timestamptz`) → ошибка pg; `uuid "x"` → 22P02. Падение зафиксировать в отчёте.
  - Unit (`test/unit/http/pagination.spec.ts`, Skill: nestjs-code test unit http pagination (MODIFY)). Существующий тест «AC-3.6: afterCursor строит ИЛИ-цепочку» (стр. 75: `afterCursor([items.createdAt, items.id], ['2026-11-10', 'b'], 'desc')`, столбец `mode: 'string'` с зоной — стр. 17) по R1 получит `DomainError`: значение заменить на `'2026-11-10T00:00:00Z'`, снимок SQL (стр. 81–82) не меняется, ожидаемые `query.params` (стр. 83) — `['2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z', 'b']`; в отчёт «было → стало, основание R1». Новые проверки: `afterCursor` с `boolean`, `integer`, `text` — верный тип проходит (снимок SQL прежний), неверный — `DomainError`. `"2026-11-10T00:00:00Z"` и `"2026-11-10T00:00:00.123456+03:00"` проходят, `"2026-11-10"`, `"infinity"` — нет.
  - Код `pagination.ts`: функция `assertCursorTypes(cols, cursor)` вызывается в `afterCursor` после проверки длины и `null` (стр. 124–125), до построения SQL. Таблица `columnType` → проверка — по R1. Ветка `timestamptz` — через существующую `timestampColumn(col)?.withTimezone === true` (стр. 77, её же используют `afterCursor` и `cursorTimestamp`), без своей проверки `columnType`; `timestamp` без зоны не проверяется. TSDoc `afterCursor` и `decodeCursor`: значение ключа проверяется по типу столбца, вне списка — без проверки. Схему ISO взять из zod 4 (`z.iso.datetime({offset: true})`, API сверить через Context7).
  - Логи: нет (422 логирует фильтр, `warn`).

- [x] **Task 2: OpenAPI — путь Fastify и параметры пути** — §3.5, AC-3.7, R2
  - **Skill:** nestjs-code test unit fixtures http optional-param-app.module (CREATE) → `test/fixtures/http/optional-param-app.module.ts`; nestjs-code test unit http ac-3-7-openapi (MODIFY) → `test/unit/http/ac-3-7-openapi.spec.ts`; nestjs-code generic src/http/api/openapi-document.ts (MODIFY); nestjs-code test unit cli ac-3-7-openapi-command (MODIFY) → `test/unit/cli/ac-3-7-openapi-command.spec.ts`
  - Тест (сначала). Контроллер фикстуры теста — маршруты `@Get('items::batch')`, `@Get(':id(^\\d+)')`, `@Get(':from-:to')`, `@Get('file.:ext')`, `@Get('*')`, у каждого `@Api`. `it('AC-3.7: маршруты items::batch, :id(^\\d+), :from-:to, file.:ext, * → пути /items:batch, /{id}, /{from}-{to}, /file.{ext}, /{wildcard} с параметрами пути, документ проходит валидатор')`. Префикс контроллера учесть.
    - Проверяются ключи `paths`.
    - Проверяются `parameters` с `in: 'path'` и `required: true`: `id`, `from`, `to`, `ext`, `wildcard`. У `items:batch` параметров нет.
    - Документ проходит существующий валидатор.
  - CLI (`ac-3-7-openapi-command.spec.ts`). Отдельная фикстура-модуль с `@Get(':id?')` — `test/fixtures/http/optional-param-app.module.ts`, рядом с `test/fixtures/http/api-app.module.ts`; импортируется в спеке статически, как `api-app.module.js` (комментарий стр. 10–12: холодная загрузка `.ts` превышает `testTimeout`). `it('AC-3.7: :id? → JSON-ошибка CLI с именем маршрута, выход 1')`: код 1, `error.code === 'OPENAPI_FAILED'`, `message` содержит `<Controller>.<method>`.
  - Код: `joinPath` (стр. 121–129) и сбор имён (стр. 359–368) заменить одним разборщиком `fastifyPathToOpenApi(path, routeName): {path, params}`. Из `parametersOf` имена брать из его результата, а не регуляркой по `{}`. Правила — R2. `apiRouteOf` вызывает и `routeResponseSchema` (стр. 487), поэтому `expectMatchesApi` на маршруте с `:id?` тоже бросит ту же ошибку `openapi: …` — это ожидаемо, указать в TSDoc `expectMatchesApi` и в README (задача 18). Шапку файла дополнить ссылкой на v1.31.
  - На старом коде: `{id(^\d+)}`, `{from-:to}`, `/*` в путях. Зафиксировать.
  - Логи: нет.

- [x] **Task 3: OpenAPI — слияние `extra` по (`name`, `in`)** — §3.5, AC-3.7, R3 (depends on 2)
  - **Skill:** nestjs-code test unit http ac-3-7-openapi-idempotency (MODIFY) → `test/unit/http/ac-3-7-openapi-idempotency.spec.ts`; nestjs-code test unit cli ac-3-7-openapi-command (MODIFY) → `test/unit/cli/ac-3-7-openapi-command.spec.ts`; nestjs-code generic src/http/api/openapi-document.ts (MODIFY)
  - Тест (сначала):
    - `AC-3.7: маршрут с @Idempotent, параметром пути и extra.parameters: [{name: 'X-Trace', in: 'header'}] → в документе путь, Idempotency-Key и X-Trace`;
    - `AC-3.7: параметр extra с парой (id, path) заменяет описание, не дублирует` — `extra.parameters: [{name: 'id', in: 'path', description: 'Идентификатор'}]` → ровно один `id` с `description` и прежней `schema`;
    - `AC-3.7: security и tags extra заменяются целиком`.
  - В `test/unit/cli/ac-3-7-openapi-command.spec.ts` (тест слияния файла, стр. 59) добавить: `parameters` в `openapi.extra.json` на операции сливается по паре, а не заменяет.
  - Код: `deepMerge` (стр. 144–152) — ветка для ключа `parameters` с массивами с обеих сторон, по R3. CLI (`src/cli/commands/openapi.ts:147`) берёт тот же `deepMerge`: правка одна.
  - На старом коде: `parameters` заменяется целиком, `Idempotency-Key` пропадает. Зафиксировать.
  - Логи: нет.

- [x] **Task 4: `@Api({status})`, `@Redirect`, `errors` с `{code, status}`, `expectMatchesApi`** — §3.5, AC-3.7, AC-3.15, R4, R5 (depends on 3)
  - **Skill:** nestjs-code generic src/http/api/api.decorator.ts (MODIFY); nestjs-code generic src/http/api/openapi-document.ts (MODIFY); nestjs-code generic src/testing/expect-matches-api.ts (MODIFY); nestjs-code test unit http ac-3-7-openapi (MODIFY); nestjs-code test unit http ac-3-15-domain-error-options (MODIFY)
  - Тесты (сначала):
    - `ac-3-7-openapi.spec.ts`:
      - `AC-3.7: @Api({status: 200}) у POST → 200, а не 201`;
      - `AC-3.7: @Api({status: null}) → только ошибки` — в `responses` нет 2xx/3xx; `expectMatchesApi` на ответе 200 падает;
      - `AC-3.7: @Redirect(url, 302) → ответ 302 без тела` — `responses['302']` без `content`; `expectMatchesApi` на 302 проходит.
    - `ac-3-15-domain-error-options.spec.ts` (код `{status: [403, 429]}` уже есть в файле, стр. 164):
      - `AC-3.15: errors: [{code: 'PLAN_LIMIT', status: 429}] у кода {status: [403, 429]} → в документе только 429`; `expectMatchesApi` на 403 падает, на 429 проходит;
      - `AC-3.15: status: 500 → ошибка генерации с именем кода`. Маршрут с `{code: 'PLAN_LIMIT', status: 500}` — в отдельном контроллере и модуле внутри спеки (`PlanBadStatusController`/`PlanBadStatusModule`), не в `PlanController`: иначе `buildOpenApiDocument(PlanModule, …)` существующего теста (стр. 166) бросит. Проверка — `await expect(buildOpenApiDocument(PlanBadStatusModule, …)).rejects.toThrow('openapi: PlanBadStatusController.<метод> — статус 500 не объявлен для кода PLAN_LIMIT')`. Маршрут с `{code: 'PLAN_LIMIT', status: 429}` остаётся в `PlanController`.
    - `test/unit/http/ac-3-7-api-options.test-d.ts` (CREATE, Skill: nestjs-code test unit http ac-3-7-api-options): `errors: [{code: 'X', status: 429}]` и `status: null` компилируются, `status: '200'` — `@ts-expect-error`.
  - Код:
    - `KitApiOptions`: `status?: number | null`; `errors?: readonly (string | {readonly code: string; readonly status: number})[]`. TSDoc полей.
    - `apiRouteOf` (стр. 469–471): статус по R4. `REDIRECT_METADATA` и `HTTP_CODE_METADATA` — из `@nestjs/common/constants`.
    - Документ при `status === null`: успешного ответа нет. При `@Redirect`: `{description: 'редирект'}` без `content`.
    - `errorsOf` (стр. 309–320): элемент-объект → один статус с проверкой по `errorStatuses(code)`.
    - `routeResponseSchema` (стр. 480–499): `status: number | null`.
    - `expectMatchesApi`: `status === null` → любой статус вне `errorStatuses` — `assert.fail`. Тело ответа редиректа не проверяется.
  - Снимки:
    - `test/fixtures/http/api-app.openapi.json` правится вручную, только если поменялся вывод фикстуры (комментарий спеки, стр. 17);
    - снимок потребителя `test/consumer/minimal/contracts/openapi.json` пересобрать (`pnpm build` + `pnpm openapi` в копии проекта, как в `test/package/support/consumer-project.ts`), если `make test-package` показывает расхождение. Каждое изменение снимка — в отчёт: путь → что поменялось.
  - Логи: нет.

### Фаза 2: запуск с БД, идемпотентность

- [x] **Task 5: `failStartup` — `DATABASE_UNAVAILABLE`** — §3.2 стр. 85, R6
  - **Skill:** nestjs-code test unit observability ac-2-9-fail-startup (MODIFY) → `test/unit/observability/ac-2-9-fail-startup.spec.ts`; nestjs-code test unit internal pg-errors (MODIFY) → `test/unit/internal/pg-errors.spec.ts`; nestjs-code generic src/observability/fail-startup.ts (MODIFY); nestjs-code generic src/observability/sentry.ts (MODIFY)
  - Тесты (сначала), `describe` файла, `initFakeSentry`:
    - `AC-4.20: ошибка соединения (ECONNREFUSED в cause DrizzleQueryError с текстом SQL) → fatal DATABASE_UNAVAILABLE, одно событие с тегом code, без SQL и адреса`. Ошибка — `new Error('Failed query: select to_regprocedure($1)', {cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {code: 'ECONNREFUSED'})})`. Проверки: лог `level 60`, `code: 'DATABASE_UNAVAILABLE'`, `cause: 'ECONNREFUSED'`; в JSON лога и тела события нет `select`, `to_regprocedure`, `10.0.0.5`; `delivered[0].tags.code === 'DATABASE_UNAVAILABLE'`; `exit(1)`;
    - `AC-4.20: срок пула ('timeout exceeded when trying to connect') → DATABASE_UNAVAILABLE`;
    - `AC-4.20: ошибка, уже отправленная captureError, — повторного события нет, fatal с code есть`;
    - прежние случаи (`InvalidEnvironmentError`, `StartupFailure`, pg `23505` → `STARTUP_FAILED`) не меняются.
  - Код:
    - `logFailure`: ветка по R6 после `StartupFailure`, `isConnectionError`/`isPoolTimeout` — из `src/internal/pg-errors.ts`. Код узла — новая внутренняя `connectionCodeOf(error): string | null` в `src/internal/pg-errors.ts` по образцу `sqlStateOf` (стр. 144): первый узел цепочки `cause` со строковым `code` (`causeChain`, стр. 45, не экспортирован). Skill: nestjs-code generic src/internal/pg-errors.ts (MODIFY); unit-случай в `test/unit/internal/pg-errors.spec.ts`.
    - `failStartup`: при `DATABASE_UNAVAILABLE` — `captureError(new DatabaseUnavailableError(), {tags: {code}})`, только если ни исходная ошибка, ни узлы её цепочки не отправлены.
    - `sentry.ts`: внутренняя `wasSent(error)` (стр. 262) — `@internal`, импорт из файла; в `index.ts` не добавлять. `DatabaseUnavailableError` — внутренний класс в `fail-startup.ts`, не экспортируется.
    - TSDoc `failStartup` — новый код.
  - Логи: `fatal` по R6; адресов и текста ошибки нет.

- [x] **Task 6: `KitDatabaseModule` — проверка соединения при запуске** — §3.3 стр. 93, AC-4.20, R7 (depends on 5)
  - **Skill:** nestjs-code test integration database ac-4-20-database-unavailable (CREATE) → `test/integration/database/ac-4-20-database-unavailable.spec.ts`; nestjs-code generic src/database/kit-database.module.ts (MODIFY); nestjs-code generic src/database/pools.ts (MODIFY); nestjs-code generic src/internal/tokens.ts (MODIFY); nestjs-code generic src/http/create-http-app.ts (MODIFY)
  - Тест (сначала). Стенд — `useBootstrapStand()` и `expectExit` из `test/unit/http/bootstrap-support.ts`, по образцу `test/integration/idempotency/ac-4-14-missing-purge-function.spec.ts`, плюс `initFakeSentry`. Окружение — `vi.stubEnv('DATABASE_URL', <адрес>)`, `DB_POOL_ACQUIRE_TIMEOUT_MS: String(1000 × TEST_TIMEOUT_SCALE)`. Тесты:
    - `AC-4.20: bootstrapService с KitDatabaseModule при БД за tcpProxy без ответа — порт не открыт, выход 1, fatal DATABASE_UNAVAILABLE, одно событие с тегом code, без select, to_regprocedure и адреса БД`. `tcpProxy(target).blackhole()`, модуль — `KitDatabaseModule` + `KitIdempotencyModule` (как `standModule` в `test/integration/idempotency/support.ts`). Проверки: `ExitCalled(1)`; записи с «слушает» нет; запись `level 60` с `code: 'DATABASE_UNAVAILABLE'`; `Sentry.flush`, `delivered` длины 1 с тегом; в теле события и логах нет `select`, `to_regprocedure`, хоста и порта прокси; шпион на `process.stderr.write` (стенд перехватывает только JSON-строки stdout, `bootstrap-support.ts:43–55`) — в stderr нет хоста и порта прокси и нет `ExceptionHandler`. Срок — проверяемый: реальное ожидание ≈ `DB_POOL_ACQUIRE_TIMEOUT_MS`;
    - `AC-4.20: то же без KitIdempotencyModule — закрытый порт` (адрес свободного порта, `ECONNREFUSED`);
    - `AC-4.20: без KitIdempotencyModule — tcpProxy без ответа`;
    - `AC-4.20: bootstrapService с рабочей БД — сервис слушает, запись Nest Logger модуля сервиса есть в логах`. Провайдер модуля стенда в `onModuleInit` пишет `new Logger('probe').warn('probe: nest logger')`; запись есть в `stand.records()` (без `app.flushLogs()` в `buildHttpApp` тест падает). Заодно — успешный путь проверки соединения.
  - На старом коде: без модуля идемпотентности приложение слушает порт (проверки нет); с модулем — `STARTUP_FAILED` и `Failed query` / два события. Зафиксировать.
  - Код:
    - `kit-database.module.ts`: проверка — в фабрике токена `KIT_PG_POOLS` (стр. 110–115; сейчас не `async`, возвращает промис `createPools`) — сделать `async`: `const pools = await createPools(…); await checkConnection(pools.main, env.DB_POOL_ACQUIRE_TIMEOUT_MS)` (не в фабрике `Db`, стр. 126–131: подмена `KIT_PG_POOLS` в unit-тесте ниже обходит её целиком).
    - `create-http-app.ts`, `buildHttpApp`: сразу после `app.useLogger(app.get(NestPinoLogger))` (стр. 241) вызвать `app.flushLogs()` — с `autoFlushLogs: false` Nest сам буфер не сбрасывает (R7).
    - `create-http-app.ts`, `defaultCompile` (стр. 130–135): добавить `autoFlushLogs: false` (R7, основание — как R17: иначе зона исключений `NestFactory.create` сбрасывает буфер с текстом ошибки и адресом БД в stderr через `ConsoleLogger` до `failStartup`). Nest создаёт всех зависимых от `Db` (в том числе `IdempotencyCleanup` с его `to_regprocedure`) только после разрешения фабрики — порядок `onModuleInit` не важен, правка `kit-idempotency.module.ts` и общий промис у `Db` не нужны. Фабрика работает в любом контексте (`bootstrapService` до `listen`, `createApplicationContext` CLI, `createTestApp`) — выбор пользователя «везде» сохраняется. Отказ фабрики `bootstrapService` передаёт в `failStartup` (`bootstrap-service.ts:162`). При отказе пулы закрываются (`end()`), чтобы процесс не держали сокеты.
    - Проверка — `select 1` через `pool.connect()` + `query` + `release()`, общий срок на подключение и запрос — `setTimeout` с `unref`. По сроку — ошибка с сообщением `timeout exceeded when trying to connect` (её распознаёт `isPoolTimeout`), клиент, если успел появиться, освобождается.
    - `pools.ts`, `instrumentPoolTimeouts`: срок истекает внутри `pool.connect()` до появления клиента, поэтому пометка клиентов (`WeakSet`) не работает. Подавление привязано к конкретному вызову: внутренний вызов обёрнутого `connect` с параметром «без отчёта» — его `.catch` не вызывает `captureThrottled`, когда бы ни пришёл отказ; метрика `verdeect_db_pool_wait_timeouts_total{pool="main"}` и `warn` остаются. Флаг на время проверки не годится: свой срок равен `connectionTimeoutMillis` пула (`pools.ts:97`), и поздний отказ `pool.connect()` после снятия флага дал бы второе событие (`pools.ts:66`).
    - Токен `KIT_PG_POOLS` сейчас локальный (`kit-database.module.ts:32`: `const KIT_PG_POOLS = Symbol('KIT_PG_POOLS');`, не экспортирован) — перенести в `src/internal/tokens.ts` (`@internal`, рядом с `KIT_REDIS_LOG`), импортировать оттуда в модуле и в спеке ac-2-15; в `src/database/index.ts` не добавлять.
    - TSDoc `KitDatabaseModule.forRoot`.
    - TSDoc `createHttpApp` (тоже идёт через `defaultCompile`, `create-http-app.ts:273–275`): при ошибке сборки (DI, фабрики, недоступная БД) Nest больше не печатает текст ошибки и буфер логов — ошибка приходит отклонённым промисом (`rethrow`, `nest-factory.js:101, 119`), обрабатывайте её (`try/catch` + `failStartup`).
  - Существующий unit-тест `test/unit/observability/ac-2-15-kit-core.spec.ts` (стр. 37: `vi.stubEnv('DATABASE_URL', 'postgres://kit_app:x@127.0.0.1:1/kit')`, стр. 84: `await ctx.init()`) соберёт `KitDatabaseModule` без БД и упадёт на проверке (ECONNREFUSED). Skill: nestjs-code test unit observability ac-2-15-kit-core (MODIFY). Отказ будет уже при создании контекста (фабрики выполняются в `context()`, стр. 26), а не на `ctx.init()`. У `NestFactory.createApplicationContext` нет `overrideProvider`, поэтому правка: тест «модуль пакета с ядром собирается» переводится на `Test.createTestingModule({imports}).overrideProvider(KIT_PG_POOLS).useValue({main, read})` с поддельными пулами — `query` (пробы здоровья) и `end` (`onApplicationShutdown`, `kit-database.module.ts:158`); проверка соединения в фабрике `KIT_PG_POOLS` при подмене не выполняется. Шапку файла («Соединений нет: пул pg ленивый») обновить. Тест «без ядра» не меняется: `requireKitCore` в фабрике `KIT_PG_POOLS` срабатывает раньше проверки. Отчёт: «было → стало, основание AC-4.20, R7».
  - Изоляция: `vitest.integration.config.ts` (MODIFY, без skill) — `'test/integration/database/ac-4-20-database-unavailable.spec.ts'` (полный путь, как у соседних элементов `ISOLATED`, стр. 11–31) в список `isolated` с причиной «vi.stubEnv, подмена process.exit, initFakeSentry» (по образцу `ac-4-14-missing-purge-function`, `ac-4-5-pool-timeout`).
  - Прогнать `test/unit`, `test/integration/database`, `test/integration/idempotency`, `test/integration/messaging`: проверка не должна ломать стенды с рабочей БД. Если ещё какой-то тест собирает приложение при недоступной БД — сообщить пользователю, тест не менять.
  - Логи: `debug` `{pool: 'main', ms}` «БД: соединение проверено»; по ошибке своего лога нет — лог пишет `failStartup`.

- [x] **Task 7: поздняя попытка идемпотентности — `warn` и метрика** — §3.3а, §3.2 стр. 83, AC-4.14, R8
  - **Skill:** nestjs-code test integration idempotency ac-4-14-late-completion (CREATE) → `test/integration/idempotency/ac-4-14-late-completion.spec.ts`; nestjs-code test integration idempotency support (MODIFY) → `test/integration/idempotency/support.ts`; nestjs-code generic src/observability/metrics.ts (MODIFY); nestjs-code generic src/idempotency/idempotency.interceptor.ts (MODIFY); nestjs-code test unit observability ac-2-8-metrics (MODIFY) → `test/unit/observability/ac-2-8-metrics.spec.ts` (имя `verdeect_idempotency_late_completions_total` — в список `KIT_PACKAGE_METRICS`, стр. 9–17)
  - Стенд: в `support.ts` маршрутов с параметром пути нет (стр. 246: `controllers: [EchoController, OpenController]`, маршруты плоские), `createStand` принимает только `url`, `env`, `overrides`. Добавить в модуль стенда маршрут `@Post('items/:id')` с `@Idempotent()`, обработчик держится существующим `closeGate()`.
  - Тест (сначала). Стенд — `createStand`, маршрут `items/:id`. Обработчик первого запроса ждёт `closeGate()`.
    Образец последовательности — тест KT-22 п. 3 (`ac-4-14-idempotency.spec.ts:132–148`): `closeGate()` ставит общий `handlers.gate`, его ждёт каждый вызов обработчика (`support.ts:83–88`), поэтому шлагбаум снимается до повтора:
    1. `closeGate()`, `nextEntry()`; первый запрос с ключом `K` и `id = 'v-42'`; дождаться входа в обработчик.
    2. Сдвиг: `update … set created_at = now() - interval '6 minutes'` строки `in_progress` (как в KT-22 п. 3).
    3. `handlers.gate = null`.
    4. Повтор с `K` захватывает строку и завершается (201).
    5. `releaseFirst()` — первый завершается поздно.
    Существующий тест KT-22 п. 3 ловит этот `warn` шпионом и проверяет отсутствие `k-14`; новое поле `scope` (`'/echo'`) проверку не ломает — тест не трогать.
  - `it('AC-4.14: попытка, чью блокировку перехватил повтор, завершается: ответ повтора не перезаписан, verdeect_idempotency_late_completions_total{scope="<шаблон маршрута>"} +1, значения параметра пути в метке нет')`. Проверки:
    - в хранилище ответ повтора;
    - `app.get(KIT_PACKAGE_METRICS).idempotencyLateCompletions.get()`: одно значение с `labels.scope === '/items/:id'` (с префиксом стенда, если он есть), `value 1`;
    - в метке нет `v-42`.
  - На старом коде: поля метрики нет — ошибка типа или `undefined`. Зафиксировать.
  - Код:
    - `metrics.ts`: `idempotencyLateCompletions: Counter<'scope'>`, имя `verdeect_idempotency_late_completions_total`, `help` по-русски, TSDoc поля.
    - Интерсептор: `@Inject(KIT_PACKAGE_METRICS) metrics: KitMetrics` (ядро уже обязательно — `requireKitCore` в модуле).
    - Шаблон маршрута = `(request as FastifyRequest).routeOptions.url ?? 'unknown'`, вычисляется в `intercept` и передаётся в `completeWithRetry` новым аргументом `route`: имя `scope` у метода уже занято (`scope: IdempotencyScope`, `idempotency.interceptor.ts:432–434`). Поле `warn` и метка метрики — `scope` (R8, §3.3а).
    - В `taken()` (стр. 459–470): `warn` + `scope` и `inc({scope})`.
  - Логи: `warn {subjectKind, traceId, scope}` «идемпотентность: строку перехватила другая попытка — ответ не сохранён» (существующий текст).

- [x] **Task 8: правило алерта поздних попыток** — §3.2 стр. 83, AC-2.11, R8 (depends on 7)
  - **Skill:** none (YAML) → `alerts/verdeect-kit.rules.yml`, `test/fixtures/alerts/verdeect-kit.test.yml`, `test/fixtures/alerts/service-override.rules.yml`; nestjs-code test package ac-2-11-alert-rules (MODIFY) → `test/package/ac-2-11-alert-rules.spec.ts`
  - Правило `VerdeectIdempotencyLateCompletions` — по образцу `VerdeectRateLimitUnavailable`:
    - `sum by (service) (increase(verdeect_idempotency_late_completions_total[15m]))`, порог по умолчанию 0, переопределение `verdeect_kit_threshold:idempotency_late_completions`;
    - `severity: warning`;
    - `summary` и `description` по-русски: ответ повтора не перезаписан, проверьте долгие обработчики и срок 5 мин `in_progress`;
    - имя порога — в комментарий шапки (стр. 13–14).
  - Спека: `THRESHOLDS` + `verdeect_kit_threshold:idempotency_late_completions`; `toHaveLength(7)` → `8`. Фикстура `verdeect-kit.test.yml` — серия и ожидание алерта для умолчания и для переопределения, по образцу правила лимитера.
  - Запуск: спека — в наборе `vitest.package.config.ts` (`vitest.config.ts:10` берёт только `test/unit/**/*.spec.ts`), её docker-тесты идут в `make pack-check` (задача 20). Здесь — `pnpm vitest run -c vitest.package.config.ts test/package/ac-2-11-alert-rules.spec.ts -t "правило на каждую метрику|переопределение порога"` (тесты без Docker).
  - Логи: нет.

### Фаза 3: `/messaging`, `/redis`

- [x] **Task 9: расписание очистки — повтор при занятом замке** — §3.4 стр. 133, AC-5.12, R9
  - **Skill:** nestjs-code generic src/internal/cleanup-schedule.ts (CREATE); nestjs-code generic src/messaging/cleanup.ts (MODIFY); nestjs-code generic src/idempotency/kit-idempotency.module.ts (MODIFY); nestjs-code test integration messaging ac-5-12-cleanup (MODIFY); nestjs-code test integration idempotency ac-4-14-cleanup (MODIFY)
  - Тесты (сначала):
    - `ac-5-12-cleanup.spec.ts`: `AC-5.12: при занятом замке следующая попытка — в окне [5, 6] мин, после выполненного прохода — через час (часы подменены)`.
      - `vi.spyOn(cleanupClock, 'setTimeout')` запоминает задержки и не планирует.
      - `vi.spyOn(cleanupClock, 'random')`: `0` и `0.999`.
      - Замок держит отдельное соединение теста: `select pg_advisory_lock(hashtextextended($1, 0))` с ключом `messagingCleanupLockKey(schema)` — то же преобразование, что у `runExclusive` (`src/database/run-exclusive.ts:32`). Снятие — `pg_advisory_unlock(hashtextextended($1, 0))`.
      - Вызывается внутренний `cleanup.runScheduled()`.
      - Ожидание: задержка `300_000` (`random 0`) и `359_940` (`0.999`). После снятия замка — `3_600_000`.
    - `ac-4-14-cleanup.spec.ts`: тот же сценарий для `IdempotencyCleanup`. Ключ замка — `verdeect-kit:idempotency-cleanup:<schema>` (`kit-idempotency.module.ts:152`), тот же SQL `pg_advisory_lock(hashtextextended($1, 0))`.
    - На старом коде: `cleanupClock` нет (ошибка импорта). Зафиксировать.
  - Код:
    - `cleanup-schedule.ts`:
      - `export const cleanupClock = {setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout, random: Math.random}` (`@internal`);
      - `nextCleanupDelay(outcome: 'done' | 'busy' | 'error'): number`;
      - константы `CLEANUP_RETRY_MS = 300_000`, `CLEANUP_RETRY_JITTER_MS = 60_000`.
    - Обе очистки: `setInterval` → цепочка `cleanupClock.setTimeout`. `pass()` возвращает итог `'done' | 'busy' | 'error'`, публичный `run()` — прежний (`{ran}` у сообщений, `void` у идемпотентности). Метод `runScheduled()` (`@internal`) делает проход и планирует следующий. Остановка (`beforeApplicationShutdown`) — `cleanupClock.clearTimeout`.
    - `CLEANUP_INTERVAL_MS` остаётся в `src/messaging/topology.ts:37` (снимок констант `test/unit/messaging/topology.spec.ts:37`; в `topology.ts` нет импортов peer). `cleanup-schedule.ts` и `kit-idempotency.module.ts` импортируют её оттуда; локальная копия `kit-idempotency.module.ts:35` удаляется.
    - Шпионы на `cleanupClock` в спеках снимаются в `afterEach` (`vi.restoreAllMocks()`): файлы идут в общий проект `isolate: false` (`vitest.integration.config.ts`).
    - Первый проход — сразу, как сейчас.
  - Логи: `debug {table | scope: 'idempotency', delayMs, outcome}` «очистка: следующий проход запланирован».

- [x] **Task 10: срок обработчиков запоминается только после начала остановки `KitLifecycle`** — §3.8 стр. 191, R10
  - **Skill:** nestjs-code generic src/messaging/rabbit-connection.ts (MODIFY); nestjs-code generic src/messaging/kit-messaging.module.ts (MODIFY); nestjs-code test unit messaging ac-5-11-shutdown-deadline (MODIFY)
  - Тест (сначала), `test/unit/messaging/ac-5-11-shutdown-deadline.spec.ts`:
    - `AC-5.11: до начала остановки KitLifecycle срок не запоминается — после начала берётся новый`;
    - создать `RabbitConnection` без `start()`, опции `deadlineMs` и `stopStarted` — поддельные. Конструктор (`rabbit-connection.ts:303–306`) соединений не открывает: соединение открывает только `start()`;
    - вызов до старта даёт две разные промисы; после `stopStarted() === true` — одна и та же.
    - На старом коде опции `stopStarted` нет. Зафиксировать.
  - Код: опция `stopStarted: () => boolean`. `shutdownDeadline()` запоминает (`??=`), только если `stopStarted()`, иначе возвращает `armStopDeadline()`. Фабрика (`kit-messaging.module.ts:451–482`) передаёт `() => shutdownRemainingMs(core) !== undefined`. TSDoc `shutdownDeadline`.
  - Логи: `debug` «messaging: срок обработчиков при остановке» — добавить поле `remembered: boolean`.

- [x] **Task 11: `KitRedisChannels` — вид канала в логах** — §3.7 стр. 171, NFR-4, AC-8.6, R11
  - **Skill:** nestjs-code test integration redis ac-8-6-channel-kind (CREATE) → `test/integration/redis/ac-8-6-channel-kind.spec.ts`; nestjs-code generic src/redis/channels.ts (MODIFY)
  - Тест (сначала):
    - `createRedisApp` (`test/support/redis.ts`) с `overrides: [{provide: KIT_REDIS_LOG, useValue: перехватчик}]`, перехватчик пишет вызовы `debug`/`error` в массив;
    - `it('AC-8.6: подписка, публикация и отказ SUBSCRIBE канала kind:t-1:42 → в перехваченных логах kind, подстрок t-1 и 42 нет, в событии GlitchTip имени канала нет')`:
      - подписка, публикация, обработчик бросает (событие GlitchTip, `initFakeSentry`);
      - отказ `SUBSCRIBE` — пользователь без права на канал, как в `ac-8-6-subscribe-failures.spec.ts`;
      - в `JSON.stringify` логов и тел событий нет `t-1` и `42`, поле `channelKind === 'kind'`.
    - На старом коде в логах `channel: 'kind:t-1:42'`. Зафиксировать.
  - Изоляция: `vitest.integration.config.ts` (MODIFY, без skill) — `'test/integration/redis/ac-8-6-channel-kind.spec.ts'` (полный путь) в `isolated` с причиной «initFakeSentry».
  - Код: `channelKindOf(channel)`. Строки 86, 92–95, 117, 130–133 — `{channelKind}` вместо `{channel}`. Ошибка `NOPERM` проходит через `sanitizeError`; если её текст содержит имя канала — в лог только `err.code`. Шапка — NFR-4 v1.31.
  - Логи: прежние сообщения с `channelKind`.

### Фаза 4: `/testing`

- [x] **Task 12: `createTestApp({backgroundLoops})` и `stopBackgroundLoops(app)`** — §3.8 стр. 191, 193, AC-5.12, R12, R13 (depends on 9, 10)
  - **Skill:** nestjs-code generic src/internal/tokens.ts (MODIFY); nestjs-code generic src/messaging/kit-messaging.module.ts (MODIFY); nestjs-code generic src/testing/create-test-app.ts (MODIFY); nestjs-code generic src/testing/background-loops.ts (CREATE); nestjs-code generic src/messaging/outbox-relay.ts (MODIFY); nestjs-code generic src/messaging/cleanup.ts (MODIFY); nestjs-code generic src/idempotency/kit-idempotency.module.ts (MODIFY); nestjs-code generic src/testing/index.ts (MODIFY); nestjs-code test integration messaging ac-5-12-background-loops (CREATE); nestjs-code test integration support messaging (MODIFY) → `test/support/messaging.ts`; nestjs-code test integration support database (MODIFY) → `test/support/database.ts`
  - Стенд: `createOutboxApp` → `createMessagingApp` → `createDbApp` (`test/support/messaging.ts:130–151`, `test/support/database.ts:82–91`) опцию не принимают — добавить проброс `backgroundLoops` до `createTestApp`.
  - Тест (сначала), `test/integration/messaging/ac-5-12-background-loops.spec.ts`, стенд — `createOutboxApp` с `backgroundLoops: false`:
    - `AC-5.12: createTestApp({backgroundLoops: false}) — после OutboxStore.add и COMMIT строка не опубликована, проходов очистки нет`. Через 3 × `RELAY_POLL_MS` (`vi.waitFor` с отрицанием или `expect.poll` на неизменность) `published_at IS NULL`. Проходов очистки нет — `messagingCleanupRuns()` (`test/support/messaging.ts:471`) / `verdeect_cleanup_runs_total` = 0: первый проход идёт нативным `setTimeout(…, 0)` (`cleanup.ts:96–98`), шпион на `cleanupClock` его не видит. Подписчик потребляет событие (`publishTestEvent` + `waitForInbox`);
    - `AC-5.12: stopBackgroundLoops(app) во время прохода relay ждёт его, новых проходов нет, последующий app.close() укладывается в полный срок остановки`. Проход relay задерживается `tcpProxy.delayOn` к брокеру или поддельной публикацией. Промис `stopBackgroundLoops` разрешается после конца прохода; новая строка после этого не публикуется; `app.close()` — меньше `SHUTDOWN_TIMEOUT_MS`; повторный `stopBackgroundLoops` — без действия.
    - На старом коде — ошибка импорта. Зафиксировать.
  - Код:
    - `KIT_BACKGROUND_LOOPS = Symbol('KIT_BACKGROUND_LOOPS')` в `tokens.ts` (`@internal`).
    - `createTestApp`: опция `backgroundLoops?: boolean` (TSDoc, умолч. `true`); при `false` — `{provide: KIT_BACKGROUND_LOOPS, useValue: false}` в `KitTestExtrasModule` (глобальный).
    - Relay и `MessagingCleanup` создаются фабриками через `new` (`kit-messaging.module.ts:207`, `inject` стр. 219–224; `:296`), `@Optional()` на них не действует: в `inject` фабрики `OutboxRelay` и фабрики `cleanupProviders` добавить `{token: KIT_BACKGROUND_LOOPS, optional: true}`, значение — полем `backgroundLoops` в `OutboxRelayDeps`/`MessagingCleanupDeps`. `@Optional() @Inject(KIT_BACKGROUND_LOOPS)` — только у `IdempotencyCleanup` (класс-провайдер, `kit-idempotency.module.ts:78–83`).
    - Relay при `false`: `onApplicationBootstrap` ничего не запускает, `wake()` без действия.
    - Внутренний `stopLoops()` у трёх классов по R13. Relay: `running = false`, `requestStop()`, `wake()`, ждать `loop`. `beforeApplicationShutdown` (`outbox-relay.ts:142–163`, сейчас ранний выход `if (!this.running) return;`) после `stopLoops()` пропускает только ожидание цикла и гонку с `shutdownDeadline`, но очистку выполняет полностью и ровно один раз: `setOutboxSource(null)` (стр. 149), `unsubscribe?.()`, `channel?.close()` (стр. 158–161); повторный вызов — без действия. При `backgroundLoops: false` канала, подписки `onChannelReady` и источника метрик нет — очистка пустая.
    - `background-loops.ts`: `stopBackgroundLoops(app: INestApplicationContext): Promise<void>` — динамический `import('../messaging/outbox-relay.js')`, `import('../messaging/cleanup.js')`, `import('../idempotency/kit-idempotency.module.js')` внутри функции и `app.get(Class, {strict: false})` — оба в одном `try` (модуль не загрузился без peer `pg`/`drizzle-orm` или класса нет в приложении — пропуск), вызовы параллельно. Экспорт из `index.ts`, TSDoc. Статического импорта `/messaging` и `/idempotency` из `/testing` нет (AC-1.2, `src/testing/test-events.ts:3–4`, граф `test/package/ac-1-1-package.spec.ts:294–303`).
  - Логи: `debug` «outbox: relay — фоновые циклы отключены (backgroundLoops: false)», «фоновые циклы остановлены (stopBackgroundLoops)» `{loops: [...]}`.

- [x] **Task 13: `deliverTestEvent(app, Event, data, opts?)`** — §3.8 стр. 190, AC-5.13, R14
  - **Skill:** nestjs-code generic src/messaging/subscriber.ts (MODIFY); nestjs-code generic src/testing/test-events.ts (MODIFY); nestjs-code generic src/testing/index.ts (MODIFY); nestjs-code test integration testing ac-5-13-deliver-test-event (CREATE) → `test/integration/testing/ac-5-13-deliver-test-event.spec.ts`; nestjs-code test package ac-1-1-package (MODIFY) → `test/package/ac-1-1-package.spec.ts`
  - Тест пакета (сначала), `describe('UC-14: deliverTestEvent')`. Основная проверка AC-5.13 — уровень C (задача 16); здесь — строки таблицы итогов R14 на стенде `createSubscriberApp` (`test/support/messaging.ts:379`; принимает только `env`/`overrides`, подписчик `TestConsumer` с inbox). Строка «неподписанная версия, `'dlq'`» — на втором стенде `createMessagingApp({options: {subscriber: {dedupe: 'none'}}, providers: [TestConsumerDlq]})`, как в `ac-5-22-version-dispatch.spec.ts:176–177` (рядом с `TestConsumer` его не подключить: та же пара (`type`, `version`) — `TypeError`). Заголовки начинаются с `AC-5.13: …` (правило «test titles start with the AC ID»; прецедент — `test/integration/testing/ac-5-13-expect-outbox.spec.ts`). Ещё `deliverTestEvent` не публикует в брокер: в очереди `<svc>` 0 сообщений (management API).
  - Граф импортов: в `ac-1-1-package.spec.ts` (проверка статического графа `dist/testing`, стр. 294–303) добавить `expect(files).not.toContain('messaging/subscriber.js')`.
  - Код:
    - `subscriber.ts`: вынести классификацию из `handle()` в общий `decide(bytes, delivery)`. Он возвращает действие (`ack` / `dlq` с причиной / `retry` / `skip`) и итог, а `handle()` выполняет действие на канале. Поведение `handle()` не меняется — существующие тесты `test/integration/messaging` зелёные.
    - `deliverForTest(bytes): Promise<{result, reason?}>` (`@internal`): `decide` с `delivery = 1`, без канала. Метрика и логи — как у доставки.
    - `test-events.ts`: построение конверта вынести из `publishTestEvent` в `buildTestEnvelope`. `deliverTestEvent` получает класс динамически — `const { KitSubscriber } = await import('../messaging/subscriber.js')` внутри функции (статический импорт тянет `observability/sentry.js` с `@sentry/nestjs` и `rabbit-connection.js`, а `/testing` `/messaging` не импортирует — `test-events.ts:3–4`), берёт `app.get(KitSubscriber)` и вызывает `deliverForTest(Buffer.from(JSON.stringify(envelope)))`.
    - Экспорт `deliverTestEvent`, тип итога `KitTestDelivery` и тип опций `KitPublishTestEventOptions` (сейчас не экспортирован). TSDoc.
  - Логи: `debug {id, type, result}` «messaging: доставка (deliverTestEvent)».

- [x] **Task 14: `waitForDelivery(app, messageId, {timeoutMs})` и журнал итогов** — §3.8 стр. 190, AC-5.13, R15 (depends on 13)
  - **Skill:** nestjs-code generic src/testing/delivery.ts (CREATE); nestjs-code generic src/internal/tokens.ts (MODIFY); nestjs-code generic src/messaging/subscriber.ts (MODIFY); nestjs-code generic src/testing/index.ts (MODIFY); nestjs-code test integration testing ac-5-13-deliver-test-event (MODIFY)
  - Тест пакета (сначала), в том же файле `test/integration/testing/ac-5-13-deliver-test-event.spec.ts`, `describe('UC-14: waitForDelivery')`, заголовки начинаются с `AC-5.13: …`:
    - подписчик `dedupe: 'none'` — стенд `createMessagingApp({options: {subscriber: {dedupe: 'none'}}, providers: [TestConsumer]})` (`createSubscriberApp` опций подписчика не принимает), `publishTestEvent` → `waitForDelivery(app, id, {timeoutMs: 5_000})` → `handled`;
    - вызов после завершения доставки (дождаться побочного эффекта, затем вызвать) тоже `handled`;
    - `InvalidMessageError` → `dlq` с `reason`;
    - неизвестный `id` с `timeoutMs: 200` → `Error` с `id` в тексте.
  - Код:
    - `delivery.ts`: при загрузке — `globalThis[Symbol.for('verdeect-kit.delivery-log')] = true`; `waitForDelivery` — `KitSubscriber` динамическим `import('../messaging/subscriber.js')` внутри функции (как в задаче 13), `app.get(KitSubscriber)` и внутренний `awaitOutcome(id, ms × TEST_TIMEOUT_SCALE)`. `index.ts` импортирует и реэкспортирует.
    - `subscriber.ts`: `recordOutcome(id, result, reason)` — только в `handle()` (доставка брокера), только если флаг стоит. Итог и причина — из действия `decide()` задачи 13 (`dlq` с причиной), не из `finish()` (стр. 598–609: получает только `DeliveryResult` без причины; причина есть лишь как аргумент `toDlq`, у `InvalidMessageError` — `error.reason`, стр. 565–567). Причина пишется только при итоговом `dlq`: если `toDlq` вернул `'retry'` (сбой копии, стр. 650) — `retry` без причины; при `null` (доставка прошлого канала) записи нет. `skipped` — в ветке версии `handle()` (стр. 463–466), не внутри метода `skip()` (стр. 739, общий с репликой `handleReplica`, стр. 718). При `id === null` (неразобранный конверт, стр. 435) записи нет. `deliverForTest` (задача 13) в журнал не пишет; итог `duplicate` в журнал не пишется (его нет в типе итога R15). Сохраняется первый итог `id`, ожидающие уведомляются. Реплика не пишет.
    - Ключ символа — константа в `src/internal/tokens.ts` (`@internal`, общая для `/messaging` и `/testing`; файл уже импортируют `create-test-app.ts:20` и `/messaging`).
  - Логи: нет (итог доставки уже в `debug` «messaging: доставка»).

- [x] **Task 15: `startTestStack({labels})` и `timingGuard({onE2e})`** — §3.8 стр. 185, 192, AC-1.12, R16
  - **Skill:** nestjs-code generic src/testing/start-test-stack.ts (MODIFY); nestjs-code test integration support docker (MODIFY) → `test/support/docker.ts`; nestjs-code generic src/testing/timing-guard.ts (MODIFY); nestjs-code test integration testing ac-1-12-mailpit-minio (MODIFY)
  - Тест (сначала), `ac-1-12-mailpit-minio.spec.ts`:
    - `AC-1.12: контейнер, поднятый с labels: {job: 'x'}, несёт эту метку и verdeect.kit.service` — `startTestStack({service, mailpit: true, labels: {job: 'x'}})`, `docker ps --filter label=job=x --filter label=verdeect.kit.service=<svc>` (расширить `test/support/docker.ts`);
    - `AC-1.12: verdeect.kit.service в labels — TypeError`;
    - `AC-1.12: timingGuard({onE2e: 'warn'}) при поддельном списке контейнеров с контуром — предупреждение в stderr без исключения, умолчание — исключение` — через `runTimingGuard(deps, options)` с `composeProjects: async () => ['verdeect-orchestrator-e2e']` (тип `() => Promise<readonly string[] | null>`, `timing-guard.ts:17`), `write` — запись в массив.
    - На старом коде: опций нет, ошибка типа. Зафиксировать.
  - Код:
    - `TestStackOptions.labels?: Readonly<Record<string, string>>`, TSDoc; проверка ключа в начале `startTestStack`; `labels` на стр. 739 — `{...options.labels, 'verdeect.kit.service': service}`.
    - `timingGuard(options?: {onE2e?: 'fail' | 'warn'})`; `runTimingGuard(deps, options)`. При `'warn'` — `deps.write` с именами контуров, без исключения. Проверки нагрузки не меняются.
  - Логи: нет (stderr — сообщение помощника, как сейчас).

### Фаза 5: проект-потребитель

- [x] **Task 16: AC-5.13 в проекте-потребителе — `deliverTestEvent` и `waitForDelivery`** — AC-5.13 (depends on 13, 14)
  - **Skill:** nestjs-code test consumer delivery (CREATE) → `test/consumer/minimal/src/delivery.spec.ts`
  - Контексты — `NestFactory.createApplicationContext` с модулем, как в `messaging.spec.ts` (ядро `cli`, `KitDatabaseModule`, `KitMessagingModule.forRoot(messagingOptions)`). Два `describe` в одном файле: файлы потребителя идут последовательно (`fileParallelism: false`), у каждого `describe` свои `beforeAll`/`afterAll`. Причина разделения: контексты на общей очереди `consumer` получают сообщения брокера по кругу, и `waitForDelivery(app, id)` («в этом экземпляре») с несколькими слушателями недетерминирован; контекст без подписки на тип отправил бы сообщение в DLQ `unsubscribed` (`subscriber.ts:444–448`).
  - `describe` 1 — два контекста, у каждого свой обработчик-счётчик `CompanyCreated` (класс спеки, `subscriber.on`), брокер не участвует (только `deliverTestEvent`):
    - `AC-5.13: два приложения на общей очереди: deliverTestEvent(appA, E, data) вызывает обработчик только appA, при dedupe: 'inbox' строка inbox записана, повтор того же id — 'duplicate', data вне схемы — 'dlq' с причиной data` (`waitForInbox` по `id`);
  - `describe` 2 — один слушающий контекст (контексты `describe` 1 закрыты):
    - `AC-5.13: подписчик dedupe: 'none': publishTestEvent + waitForDelivery(app, id) → 'handled', при InvalidMessageError → 'dlq'`. `on(CompanyArchived, h, {dedupe: 'none'})` (и обработчик `CompanyCreated`, как в `messaging.spec.ts`), обработчик бросает `InvalidMessageError` для `data.companyId === 'invalid'` (у `CompanyArchived` только `companyId` — `events.ts:13–18`). `CompanyArchived` уже в `PUBLISHED_EVENTS` (`events.ts:20`); `publishTestEvent` идёт мимо outbox, покрытие `outboxEvents` не меняется.
  - Окружение — `vi.stubEnv`, как в `messaging.spec.ts`. Закрытие контекстов — `afterAll`.
  - На старом коде — ошибка импорта из архива. Зафиксировать.
  - Логи: нет.

- [x] **Task 17: CLI сервиса с `failStartup` — пример потребителя (AC-2.15)** — §3.2 стр. 86, AC-2.15, R17
  - **Skill:** nestjs-code generic test/consumer/minimal/src/service/cli.ts (CREATE); nestjs-code test consumer cli (MODIFY) → `test/consumer/minimal/src/cli.spec.ts`
  - `cli.ts` — эталон примера README (задача 18 переносит его в README без изменений по сути): `CliModule` с `KitConfigModule`, `KitCoreModule({entry: 'cli'})`, `KitDatabaseModule`, `KitMessagingModule({listen: false})`; `createApplicationContext(CliModule, {bufferLogs: true, abortOnError: false, autoFlushLogs: false})` в `try/catch` → `failStartup(error, pino({level: 'info'}, pino.destination(2)))` (почему `autoFlushLogs: false` — R17). Опции `createApplicationContext` и обработка записей Nest `Logger` после успешного старта — по ответу пользователя на [OPEN] в R17 (вариант (а) `logger: false` или (б) адаптер); до ответа задачу не начинать. Собирается в `dist/service/cli.js` (`tsconfig.build.json` уже включает `src/service`, проверить).
  - Тест в `cli.spec.ts`: `AC-2.15: CLI сервиса с неверным окружением — JSON-ошибка и выход 1, а не текст Nest`. Запуск — `spawn(process.execPath, ['dist/service/cli.js'])`, `env` без `DATABASE_URL`. Проверки: код 1; в stderr JSON-строка `level 60` с `code: 'INVALID_ENVIRONMENT'` и `keys`, содержащими `DATABASE_URL`; нет `ExceptionHandler`/`Nest`.
  - Логи: нет.

### Фаза 6: документация и выпуск

- [x] **Task 18: README и AGENTS.md** — §3.2–§3.8 v1.31, AC-9.3 (depends on 1–17)
  - **Skill:** none (Markdown)
  - `README.md`:
    1. «CLI сервиса» (стр. 720–747): пример — `abortOnError: false`, `autoFlushLogs: false` (иначе текст Nest в stderr до `catch`), опции контекста и записи Nest `Logger` после старта — по ответу на [OPEN] в R17 (как `cli.ts` задачи 17), `try/catch` с `failStartup` (как `cli.ts` задачи 17), абзац «неверное окружение и недоступная БД — JSON-ошибка и выход 1».
    2. «Остановка» (стр. 301–316): пример шага 2 — SSE и WebSocket (`socket.close(1001, 'остановка')`); фраза «хуки остановки модулей пакета (`beforeApplicationShutdown` relay, подписчика, очистки) вручную не вызывайте — остановка только через `app.close()`/сигнал; в тестах — `stopBackgroundLoops`».
    3. `configureFastify` (раздел HTTP): лимит тела после аутентификации — хук `preParsing`, пример.
    4. Модули сервиса: при `@Optional()` и типе `HealthRegistry | null` — `@Inject(HealthRegistry)`: метаданные типа объединения — `Object`.
    5. «База данных»:
       - `tx` в `Db.transaction` — только query builder, `tx.query.*` нет (для реляционного API — `DRIZZLE` вне транзакции);
       - `connectionTimeoutMillis = DB_POOL_ACQUIRE_TIMEOUT_MS`;
       - проверка соединения при запуске и `DATABASE_UNAVAILABLE`.
    6. «Наблюдаемость»: `captureThrottled` — для ожидаемых повторяющихся ошибок (одно событие за окно на ключ), `captureError` — для неожиданных, ровно раз; `DATABASE_UNAVAILABLE` у `failStartup`; метрика `verdeect_idempotency_late_completions_total{scope}` и правило шаблона.
    7. «OpenAPI» (стр. 350):
       - пути Fastify (правила R2, таблица примеров);
       - `@Api({status})` и `@Redirect`;
       - `errors` с `{code, status}`;
       - слияние `extra` — `parameters` по (`name`, `in`), прочие массивы заменяются;
       - выводимые параметры (путь, query zod-pipe, `Idempotency-Key`) в `extra` не повторять (§3.5 стр. 149).
    8. Keyset: проверка типа значения курсора (R1).
    9. Очистка: повтор через 5–6 мин при занятом замке.
    10. Redis: в логах только вид канала.
    11. «Тесты сервиса» и API `/testing` (стр. 1000+): `backgroundLoops`, `stopBackgroundLoops`, `deliverTestEvent`, `waitForDelivery` (журнал — только при загруженном `/testing`, первый итог `id`), `startTestStack({labels})`, `timingGuard({onE2e})`.
  - Раздел `## API` README (`### @verdeect/kit/testing`, `### @verdeect/kit/http`, `### @verdeect/kit/observability`): каждое новое имя экспорта — в обратных кавычках, иначе падает `test/package/ac-9-3-docs.spec.ts:119`. Новые имена: `deliverTestEvent`, `waitForDelivery`, `stopBackgroundLoops`, `KitTestDelivery`, `KitPublishTestEventOptions`. Обновить описания (спека их не проверяет): `Api` (стр. 902: `status?`, `errors` — код или `{code, status}`), `failStartup` (стр. 868: `DATABASE_UNAVAILABLE`), `KitDatabaseModule` (стр. 909: `select 1` при запуске).
  - `AGENTS.md`, строка «Состояние» (стр. 21): последний опубликованный выпуск — `1.0.0-rc.9`, готовится `1.0.0-rc.10` (как в 3610b1b).
  - Проверка: `pnpm vitest run -c vitest.package.config.ts test/package/ac-9-3-docs.spec.ts` (после задачи 19: спека проверяет и CHANGELOG).
  - Логи: нет.

- [x] **Task 19: CHANGELOG и версия** — G14, NFR-5 (depends on 18)
  - **Skill:** none (Markdown, JSON)
  - `CHANGELOG.md`: `## [1.0.0-rc.10] - 2026-11-16` под `## [Unreleased]`, по образцу rc.9:
    - строка-источник: «Находки перехода Orchestrator OR-199, OR-205, OR-207, сверка KT-103 (PRD v1.31, r26).»
    - `### Added` (каждое новое имя экспорта — в виде `` `Name` ``, иначе падает `ac-9-3-docs.spec.ts`): `deliverTestEvent`, `waitForDelivery`, `stopBackgroundLoops`, `KitTestDelivery`, `KitPublishTestEventOptions` (тип стал публичным), `createTestApp({backgroundLoops})`, `startTestStack({labels})`, `timingGuard({onE2e})`, `@Api({status})`, `errors` с `{code, status}`, метрика `verdeect_idempotency_late_completions_total` и правило `VerdeectIdempotencyLateCompletions`.
    - `### Changed`:
      - курсор по типу столбца;
      - пути Fastify и параметры;
      - `@Redirect`;
      - слияние `parameters`;
      - `DATABASE_UNAVAILABLE` и проверка соединения при запуске;
      - повтор очистки;
      - срок обработчиков после начала остановки;
      - вид канала Redis в логах.
    - `### Как перейти`:
      - отказ запуска при недоступной БД теперь у всех сервисов с `KitDatabaseModule`, в том числе у CLI и `createTestApp`: стенды тестов с намеренно недоступной БД собирать после подъёма БД;
      - новые экспорты `/testing`;
      - курсор keyset из столбца `timestamptz` в `mode: 'string'` без `cursorTimestamp` теперь 422 (текст PostgreSQL — не строгий ISO): ключ берите через `cursorTimestamp(col)`;
      - снимок OpenAPI пересобрать — пути с `::`, regex, `*`, статусы `@HttpCode`/`@Redirect`/`status` могут измениться; `:id?` — ошибка генерации, разнесите на два маршрута;
      - пример CLI — `abortOnError: false` + `failStartup`;
      - `createHttpApp`: при ошибке сборки (DI, фабрики, недоступная БД) Nest больше не печатает текст ошибки и буфер логов — обрабатывайте отклонённый промис (`try/catch` + `failStartup`);
      - правило алерта поздних попыток — в шаблоне.
  - `package.json`: `"version": "1.0.0-rc.10"`.
  - Логи: нет.

### Фаза 7: проверка

- [x] **Task 20: полная проверка** (depends on 1–19)
  - Команды по одной (правило пользователя: без `&&`):
    1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
    2. `free -h`, `uptime`, `docker ps --format '{{.Label "com.docker.compose.project"}}'`: available ≥ 3 ГБ, load < 5, нет чужих `verdeect-*-e2e`. Иначе — стоп и сообщить пользователю;
    3. `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check).
  - Падения не маскировать подъёмом сроков. Правки существующих тестов — только по изменению поведения v1.31, каждая — в отчёт (файл, было → стало, основание). Снимок OpenAPI потребителя — тоже в отчёт.
  - Соседние репозитории не трогать.

## Traceability

| UC/AC | Задачи | Тест |
|---|---|---|
| UC-4, AC-3.6 (тип значения курсора) | 1 | `test/integration/http/ac-3-6-keyset.spec.ts` — `AC-3.6: курсор с ключом timestamptz = 42, "abc", "now" и ключом uuid = "x" → 422 …` |
| UC-4, AC-3.7 (пути Fastify) | 2 | `test/unit/http/ac-3-7-openapi.spec.ts` — `AC-3.7: маршруты items::batch, … → пути …`; `test/unit/cli/ac-3-7-openapi-command.spec.ts` — `AC-3.7: :id? → JSON-ошибка CLI …` |
| UC-4, AC-3.7 (слияние `extra`) | 3 | `test/unit/http/ac-3-7-openapi-idempotency.spec.ts` — `AC-3.7: маршрут с @Idempotent, параметром пути и extra.parameters …`, `AC-3.7: параметр extra с парой (id, path) …` |
| UC-4, AC-3.7 (`status`, `@Redirect`) | 4 | `test/unit/http/ac-3-7-openapi.spec.ts` — `AC-3.7: @Api({status: 200}) у POST …`, `… status: null …`, `… @Redirect(url, 302) …` |
| UC-4, AC-3.15 (`errors` с `{code, status}`) | 4 | `test/unit/http/ac-3-15-domain-error-options.spec.ts` — `AC-3.15: errors: [{code: 'PLAN_LIMIT', status: 429}] …`, `AC-3.15: status: 500 → ошибка генерации …` |
| UC-3, AC-4.20 (`failStartup`) | 5 | `test/unit/observability/ac-2-9-fail-startup.spec.ts` — `AC-4.20: …` (3 теста) |
| UC-3, AC-4.20 (запуск при недоступной БД) | 6 | `test/integration/database/ac-4-20-database-unavailable.spec.ts` — 4 теста `AC-4.20: …` |
| UC-7, AC-4.14 (поздняя попытка) | 7 | `test/integration/idempotency/ac-4-14-late-completion.spec.ts` — `AC-4.14: попытка, чью блокировку перехватил повтор …` |
| AC-2.11 (правило алерта) | 8 | `test/package/ac-2-11-alert-rules.spec.ts` (R, `make pack-check`) |
| UC-9, AC-5.12 (повтор очистки) | 9 | `test/integration/messaging/ac-5-12-cleanup.spec.ts`, `test/integration/idempotency/ac-4-14-cleanup.spec.ts` — `AC-5.12: при занятом замке …` |
| UC-8, AC-5.11 (срок после начала остановки) | 10 | `test/unit/messaging/ac-5-11-shutdown-deadline.spec.ts` — `AC-5.11: до начала остановки KitLifecycle срок не запоминается …` |
| UC-12, AC-8.6, NFR-4 (вид канала) | 11 | `test/integration/redis/ac-8-6-channel-kind.spec.ts` — `AC-8.6: подписка, публикация и отказ SUBSCRIBE канала kind:t-1:42 …` |
| UC-9, AC-5.12 (`backgroundLoops`, `stopBackgroundLoops`) | 12 | `test/integration/messaging/ac-5-12-background-loops.spec.ts` — 2 теста `AC-5.12: …` |
| UC-14, AC-5.13 (`deliverTestEvent`, `waitForDelivery` — пакет) | 13, 14 | `test/integration/testing/ac-5-13-deliver-test-event.spec.ts` — `AC-5.13: …` |
| UC-2, UC-14, AC-5.13 (потребитель) | 16 | `test/consumer/minimal/src/delivery.spec.ts` — 2 теста `AC-5.13: …` |
| UC-14, AC-1.12 (`labels`, `onE2e`) | 15 | `test/integration/testing/ac-1-12-mailpit-minio.spec.ts` — 3 теста `AC-1.12: …` |
| UC-13, AC-2.15 (CLI с `failStartup`) | 17 | `test/consumer/minimal/src/cli.spec.ts` — `AC-2.15: CLI сервиса с неверным окружением …` |
| AC-9.3 (README, CHANGELOG) | 18, 19 | `make test-full` (уровень R) |
