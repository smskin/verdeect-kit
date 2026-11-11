<!-- aif:plan-mode:ultra -->
# Ultra-план реализации: E5 Сообщения (`@verdeect/kit/messaging`)

Mode: ultra
Branch: feature/e5-messaging
Created: 2026-11-11

## Original Request
Реализуй этап roadmap «E5 Сообщения» по пакету требований requirements/0000-kit/ (ревизия r9, PRD v1.14).

Скоуп этапа: AC-5.1–AC-5.20; сквозной AC-9.5 для relay, подписчика и очистки outbox/inbox; prd.md §3.4 целиком (имя сервиса = имя экземпляра, defineEvent с признаком tenant, EnvelopeSchema, createOutboxTable с tenantNullable и createInboxTable, OutboxStore.add из кода без триггеров, KitMessagingModule.forRoot — pg только при outbox или dedupe: 'inbox' через динамический import(), соединение по эталону O RabbitConnection/ManagedChannel, пассивная проверка exchange, relay, subscriber.on и onReplica, retry с TTL RABBITMQ_RETRY_SECONDS и отказ запуска при другом TTL, DLQ с x-dlq-reason, очистка, CLI rabbitmq definitions, ExpectedMessageError и InvalidMessageError), §6 (outbox, inbox); §3.8 — строки и поля с этапом E5 (startTestStack с rabbitmq и definitions.json, outboxEvents и каталог прогона, workerScope.rabbitmq — vhost на воркер, expectOutbox, assertOutboxCoverage при KIT_OUTBOX_COVERAGE=1, publishTestEvent, waitForInbox); подпуть ./messaging в exports и в проверках AC-1.1, AC-1.2; проект-потребитель (AC-9.1, AC-5.13) публикует и потребляет событие; README (DLQ — разбор в 7 дней, порядок смены TTL .retry) и CHANGELOG [Unreleased]. Перенос кода — по requirements/0000-kit/files/inventory.md: эталон O (rabbit-connection, rabbit-subscriber, topology, redelivery, outbox relay, inbox-guard, messaging-cleanup.job) + опции из P (очередь реплики) и B (retryCount); тесты эквивалентности — из таблицы §2 (O outbox, outbox-atomicity, outbox-confirm, subscriber, inbox-guard, cleanup, topology, or-119-rabbit-permissions; P channel-restore; I ac-6-2-broker-outage, fr-72-outbox-seq). Каталог событий (@verdeect/events) — не в этом этапе. Репозитории сервисов — только чтение. AC уровня T — в test/timing. Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION; код сервиса, расходящийся с prd.md, не переносится как есть (P0: без SQL-триггеров outbox). Решения E4, которые касаются E5: runExclusive передаёт в fn соединение, которое держит блокировку, — очистка outbox и inbox удаляет пачки на нём, второе соединение пула не берёт (работает при DB_POOL_MAX=1); первой задачей этапа — сброс сеансового состояния (RESET ALL) этого соединения перед возвратом в пул и запрет в TSDoc на SET и set_config(…, false) внутри fn (предложение review E4); метрика очистки — общая verdeect_cleanup_runs_total{table: outbox|inbox, result: ok|partial|interrupted|error}, число удалённых строк — в info-лог прохода, правило VerdeectCleanupFailing (error|partial) уже есть — новых метрик очистки не вводить; срок пула учитывает сам пул (метка main/read); assertStrictTenantIsolation уже знает исключение outbox — проверить на настоящей таблице createOutboxTable; проверка опционального peer (amqplib, amqp-connection-manager) — синхронная при загрузке подпути, сам peer — динамическим import() (П15, без top-level await; pg у /messaging — только в forRoot при outbox или dedupe: 'inbox'); остановка — relay, подписчик и очистка в beforeApplicationShutdown (шаг 3), соединение RabbitMQ — в onApplicationShutdown (шаг 4), отдельных участников KitLifecycle не регистрировать; тесты без реальных пауз (правило Test Speed Regressions) — сигналы, подменённые часы, явный вызов прохода; мелочи из review E4: колбэк на каждый запрос в countQueries (заменить watchQueries в ac-4-14-cleanup.spec.ts), пустая строка в списке CHANGELOG Fixed, TSDoc KitDeleteInBatchesOptions.connection — транзакции Db внутри fn берут другое соединение пула. Уже реализованные этапы E1–E4 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня. Фазы должны оставлять проект в рабочем состоянии: тесты зелёные после каждой фазы.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5):
  - U — `test/unit/{messaging,internal,cli,testing,package}`;
  - I — `test/integration/{messaging,testing,cli,database,idempotency}`;
  - T — `test/timing/messaging` (AC-5.3, 5.4, 5.11, 5.16 и эквивалентность `outbox-confirm`, `channel-restore`);
  - C — `test/consumer/minimal`, `test/consumer/no-testcontainers`;
  - R — `test/package`.
- Logging: verbose.
  - `debug` — пачки relay, доставки подписчика, пропуск устаревших доставок, «другая реплика» очистки, сборка модуля.
  - `info` — соединение установлено, итог прохода очистки (`table`, `deleted`, `batches`, `result`), закрытие, CLI `rabbitmq definitions`.
  - `warn` — потеря соединения, сбой настройки канала, неудача публикации, срок пачки и остановки, ожидаемый отказ обработчика (`ExpectedMessageError`), повтор.
  - `error` — exchange отсутствует, 5 неудач строки, DLQ (кроме ожидаемых), ошибка очистки, TTL `.retry` после переподключения.
  - Только `pino`/`nestjs-pino` (логгер приложения с `service`, `replica`), без `console.*` (NFR-8, AC-9.4).
  - Не логируются: URL брокера с паролем (только `host:port`), пароли и хеши, `data` событий, значения полей с ошибкой схемы (только пути).
- Docs: no — `WARN [docs]` без обязательного чекпоинта `/aif-docs`. README, CHANGELOG и `docs/testing.md` всё равно обновляет задача 37 (AC-9.3, «Library Package Scope» (7)).

## Roadmap Linkage
Milestone: "E5 Сообщения"
Rationale: план реализует ровно скоуп вехи E5 из `.ai-factory/ROADMAP.md`: `/messaging` §3.4, помощники `/testing` этапа E5, CLI `rabbitmq definitions`, AC-5.1–AC-5.20, AC-9.5 (relay, подписчик, очистка).

## Requirements Reconciliation

Authority (запрос пользователя, skill-context «Requirements Package Authority»): `requirements/0000-kit/prd.md` **v1.14 (ревизия r9, коммит `7d5e28a`, md5 `763d4929b4c602cb2b632838f45ad6a3`, 557 строк)** > `requirements/0000-kit/files/inventory.md` > `.ai-factory/ROADMAP.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`, `rules/base.md`. Код сервиса, расходящийся с PRD, не переносится как есть (P0: без SQL-триггеров outbox I/P, без `x-<svc>-dlq-reason`, без `x-message-ttl` основной очереди B).

**Milestone scope:**
- AC-5.1–AC-5.13, AC-5.15–AC-5.20 (AC-5.14 зачёркнут в PRD, заменён AC-5.15);
- AC-9.5 (relay, подписчик, очистка outbox/inbox);
- §3.4 целиком; §6 (строки `createOutboxTable`, `createInboxTable`);
- строки и поля §3.8 с этапом E5: `startTestStack` — `rabbitmq` + `definitions.json`, `outboxEvents` и каталог прогона; `workerScope().rabbitmq`; `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`;
- части UC-5, UC-6, UC-8, UC-12, UC-14 (и UC-1, UC-2, UC-9 в объёме AC-5.x);
- растущие AC-1.1, AC-1.2 (подпуть `./messaging`) и AC-4.8 (политика outbox на настоящей таблице — запрос пользователя);
- сквозные AC-9.1 (потребитель публикует и потребляет событие), AC-9.3 (README, CHANGELOG), AC-9.4 (lint на новый код без изменения правила).
- Решения review E4 из запроса: задачи 1–3.

Вне скоупа: `@verdeect/events` (каталог событий, §3.9), `/crypto` (E7), `/redis` и `redisPrefix` (E8), AC-7.x, AC-8.x, AC-9.5 для лимитера.

`[OPEN]` §11:
- п. 1 (`platform.policy.changed` в `platform-client`) — решается после E5 чатом platform-client; kit даёт `onReplica` (задача 25), блокировки нет;
- п. 2, 3 к E5 не относятся;
- п. 4 `[ASSUMPTION]` — драйвер `amqplib` 2.2.0 + `amqp-connection-manager` 5.0.1, принят (задача 3).

Блокирующих вопросов нет: три вопроса планирования заданы пользователю 2026-11-11 и решены (П1–П3).

`[ASSUMPTION]` §6 «колонки — по O, колонка вне O — только с требованием». Колонки outbox — O с отличиями по PRD §6:
- `subject_id` text вместо `subject` jsonb (вид субъекта — из `defineEvent.subject`);
- `tenant` nullable по `tenantNullable` (I);
- `actor` и `trace_id` NOT NULL — `DbContext` их всегда даёт.

Inbox — O, но `id` вместо `message_id` (§6 «`id` (PK, id события)»).

Решения (источник → задачи):

| Решение | Источник | Задачи |
|---|---|---|
| `RESET ALL` после `pg_advisory_unlock` и перед возвратом соединения `runExclusive`; TSDoc запрещает `SET` и `set_config(…, false)`; сбой — клиент уничтожается | запрос (review E4) | 1 |
| `countQueries(pool, fn, {onQuery})`; локальный `watchQueries` удалён | запрос (review E4) | 2, 31 |
| Очистка outbox/inbox — `runExclusive` + `deleteInBatches({connection})` на соединении блокировки; метрика `verdeect_cleanup_runs_total{table: outbox\|inbox, result}`, `info`-лог с `deleted`; новых метрик и правил нет | запрос (E4 П8, KT-22 п. 4) | 29, 31 |
| Синхронная проверка `amqplib`, `amqp-connection-manager` в `src/messaging/peer.ts` (первый импорт `index.ts`); пакеты — `loadPeer` при вызове; без top-level await | запрос (П15 E4), ARCHITECTURE | 5, 14, 16, 17, 36 |
| `pg` — `requirePeer('pg', 'messaging')` в `forRoot` только при outbox или `dedupe: 'inbox'`; значения `database` — динамическим `import()` там же (`forRoot` асинхронный, как пример ARCHITECTURE) | §3.4, AC-1.2, NFR-3, ARCHITECTURE | 16, 17, 36 |
| Остановка: relay, подписчик, очистка — `beforeApplicationShutdown` (шаг 3); соединение — `onApplicationShutdown` (шаг 4); участников `KitLifecycle` нет | запрос (решение E3/E4), ARCHITECTURE «Жизненный цикл» | 16, 20, 25, 29 |
| Тесты без реальных пауз: сигналы (`onQuery`, барьеры), подменённые таймеры relay (AC-5.16), явный `run()` очистки, `x-death` вместо 5 TTL. Реальное время — только где PRD фиксирует длительность или проверяется настоящий брокер: AC-5.4 (10 с), AC-5.7 (один TTL 1 с), срок пачки 5 с | запрос (Test Speed), skill-context «Fast Test Suites» (6) | 23, 26, 28, 31 |
| Exchange `verdeect.events` — только `checkExchange`; объявляет `definitions.json` | §3.4, ARCHITECTURE anti-patterns | 9, 14, 18, 27 |
| `x-dlq-reason` (заголовок PRD), значения П7 | §3.4 | 25, 26 |
| Метрики `verdeect_outbox_pending`, `verdeect_outbox_lag_seconds`, `verdeect_events_consumed_total{type, result}` уже в `kitMetrics` (E2) — не добавляются | §3.2, разведка | 20, 25 |

**Решения плана вне формулировок PRD.** П1–П3 приняты пользователем 2026-11-11. PRD v1.15 (§3.4, AC-5.15, AC-5.18) обновит чат kit. Остальные решения — для сверки чатом kit по итогам этапа (как KT-19 для E4).

| # | Решение | Обоснование | Задачи |
|---|---|---|---|
| П1 | `KitMessagingModule.forRoot({service, outbox?: {table, events}, subscriber?: {dedupe?: 'inbox'\|'none', inbox?}})`. `tenantNullable` читается из колонки `tenant` таблицы `createOutboxTable`, во `forRoot` не дублируется. Событие `'none'` в `outbox.events` при NOT NULL — `MessagingStartupError` `MESSAGING_TENANT_NOT_NULLABLE` с текстом по образцу отказов запуска kit, без значений окружения. `subscriber` не задан — подписчика нет. `dedupe: 'inbox'` требует `inbox`. Таблицы — одной схемы | ответ пользователя (вопрос 1); §3.4 сигнатура `outbox?: {tenantNullable}` и AC-5.15 «отказ `forRoot`» — модулю нужны таблицы и список событий | 16, 17, 19 |
| П2 | Vhost и пользователь на каждый `VITEST_POOL_ID` 1..`maxWorkers` создаёт `globalSetup` (`startTestStack`) из того же `buildDefinitions`. Имя `<svc>-test-<runId>-w<N>`. До создания удаляются остатки прошлых прогонов с префиксом `<svc>-test-`. Teardown удаляет всё с префиксом. `workerScope()` остаётся синхронной. AC-5.18 «по завершении воркера» → «по завершении прогона», тест проверяет состояние после teardown | ответ пользователя (вопрос 2); у Vitest нет хука завершения воркера | 11, 12, 13, 36 |
| П3 | CLI берёт хеш пароля из `RABBITMQ_PASSWORD_HASH_<SVC>` (`bff-app` → `_BFF_APP`; значение — `rabbitmqctl hash_password`, `rabbit_password_hashing_sha256`). Нет ключа или неверный формат → `INVALID_ENVIRONMENT {keys}`. Тестовый стек считает хеш сам (`hashRabbitPassword`) | ответ пользователя (вопрос 3); §3.4 «хеш пароля — из окружения» | 9, 10, 13, 37 |
| П4 | Связь `tx → DbContext` — внутренний `src/internal/tx-context.ts` (WeakMap). `Db.run` связывает, `OutboxStore.add` читает. API `Db` не меняется | §3.4 «`tenant`, `actor`, `traceId` — из `DbContext`»; `messaging` не импортирует значения `database` статически | 4, 19 |
| П5 | `Db` (токен DI), `runExclusive`, `deleteInBatches` — из `await import('../database/index.js')` в `forRoot` после `requirePeer('pg', 'messaging')`. Lint запрещает значения `../database/*` в `src/messaging` | ARCHITECTURE «messaging получает `Db` через DI»; `Db` — класс-токен | 3, 16, 29 |
| П6 | Обработчик `(event: Envelope<E>, tx: DbTx \| null)`: транзакция с `DbContext {tenant: envelope.tenant, traceId: envelope.traceId ?? envelope.id, actor: {channel: 'system'}}`, inbox занят в ней; `tx = null` при `dedupe: 'none'`. Регистрация — `KitSubscriber.on` до `onApplicationBootstrap` | §3.4 «inbox занимается в той же транзакции до обработчика», «`dedupe: 'none'` — без БД» | 25 |
| П7 | Значения `x-dlq-reason`: `not-json`, `envelope`, `unsubscribed`, `tenant` (PRD), `data`, `InvalidMessageError.reason`, `ExpectedMessageError.code`, `retries-exhausted`. GlitchTip: непредвиденная после исчерпания — `captureError` ровно раз; причины разбора — `captureThrottled`; ожидаемая — без отправки | §3.4; эталон O; skill-context «Expected Errors Are Not Reported» | 25, 26 |
| П8 | Отказ запуска при другом TTL `.retry`: `assertQueue` → 406 → `MessagingStartupError` `MESSAGING_RETRY_TTL_MISMATCH` с текстом PRD. Канал `fatal` без повторов. При старте `onApplicationBootstrap` ждёт первый исход настройки (не дольше `RABBITMQ_RETRY_SECONDS`) и отклоняется до `listen`. Брокер недоступен при старте — запуск продолжается (`/health` down), TTL проверится при подключении; несовпадение позже — `error` + GlitchTip, канал `fatal` | AC-5.19 «без цикла переподключений»; эталон O (повтор каждые `RABBITMQ_RETRY_SECONDS`) | 14, 25, 26 |
| П9 | Общий срок обработчиков остановки `shutdownDeadline()` = `max(1000, SHUTDOWN_TIMEOUT_MS − SHUTDOWN_DRAIN_MS − 2000 − 1000)` от первого вызова (запас на закрытие канала и соединения) вместо константы O 8000 | AC-5.11 «в общем сроке»; KitLifecycle — общий срок от сигнала | 14, 20, 25, 28 |
| П10 | Метрики outbox обновляет цикл relay раз в `RELAY_POLL_MS` (1000 мс) независимо от состояния канала (`count`, `min(occurred_at)` по частичному индексу) | AC-5.4 «`lag` растёт» при недоступном брокере; relay без канала БД не опрашивает | 20 |
| П11 | Проба `/health` `rabbitmq` — некритичная, `isConnected() && topologyReady()` | эталон O; §3.2 не задаёт | 16, 18 |
| П12 | Топологию `<svc>`, `.retry`, `.dlq` объявляет подписчик, всегда при наличии `subscriber`; привязки — по типам `on`. `definitions.json` очередей не содержит | ARCHITECTURE «Сообщения»; TTL не фиксируется в файле развёртывания | 9, 25 |
| П13 | Права M3: configure `^<svc>(\..*)?$`, write `^(verdeect\.events\|amq\.default\|<svc>(\..*)?)$`, read `^(verdeect\.events\|<svc>(\..*)?)$` — чтение и своей DLQ (у O read на DLQ нет) | §3.4 «read — `verdeect.events` и свои очереди» | 9, 13, 27 |
| П14 | Ключи `provide`: `kitRabbitmqUrl` (админ, `/`), `kitRabbitmqManagementUrl`, `kitRabbitmqWorkers` (`{vhost, url, adminUrl}` по `VITEST_POOL_ID`), `kitOutboxCoverageDir` | §3.8 «адреса — `provide`» | 11, 32, 33 |
| П15 | Очистка outbox/inbox — прямой `DELETE` под `<svc>_app` с `tenant: null` (outbox — исключение политики, inbox без RLS); функции `SECURITY DEFINER` не нужны (в отличие от идемпотентности E4) | §3.4, §6 | 29 |
| П16 | `expectOutbox` учитывает только строки текущей транзакции (`xmin = pg_current_xact_id()::xid`) и проверяет `data` по схеме события; ключ покрытия `<type>.v<version>` пишется после всех проверок | §3.8 «проверяет запись события в транзакции», «после успешной проверки» | 32, 34 |
| П17 | `waitForInbox` опрашивает `<svc>.inbox` (схема = `kitDatabaseService`) с шагом 20 мс до `timeoutMs × TEST_TIMEOUT_SCALE` | §3.8 «ожидание обработки без `sleep`» в тесте | 33 |
| П18 | `publishTestEvent` публикует администратором vhost воркера через confirm-канал; тенант по умолчанию — `workerScope().tenant` для `'required'`, `null` для `'none'`; `opts.tenant` может нарушать признак (тесты AC-5.15 сервиса) | §3.8; эталон O `bus.ts` | 33 |
| П19 | `globalSetup` уровня T: `timingGuard` + `startTestStack({postgres, rabbitmq, migrations})` | AC уровня T E5 требуют брокер и БД | 11 |
| П20 | `KitSubscriber`, `OutboxStore` — классы-токены DI, экспортируются; `RabbitConnection`, `OutboxRelay`, `MessagingCleanup` — внутренние | §3.4 «`OutboxStore.add`», «`subscriber.on`»; «что не перечислено — не экспортируется» | 16, 19, 25 |
| П21 | `EnvelopeSchema`: все поля §7.1 обязательны, `tenant`/`actor`/`traceId` — nullable, `subject {kind, id}`, не strict (у O — optional/unknown) | AC-5.2 «конверт relay совпадает с §7.1» | 5, 8, 22 |
| П22 | Индексы outbox: неопубликованные по `seq`, опубликованные по `published_at` (очистка); индекса по тенанту нет (у I нет; запросы relay и очистки без тенанта) | §6 «индекс неопубликованных по `seq`» | 6 |
| П23 | Строка outbox с типом вне `outbox.events` (старая версия сервиса) публикуется с `subject.kind = 'unknown'` и `warn` один раз на тип | relay не теряет события | 20 |
| П24 | `onReplica`: неразобранное или ошибка обработчика — без повтора и DLQ; метрика `result: 'dlq'` («не обработано, повтора не будет») | P `policy-changed.consumer`; метка `result` фиксирована §3.2 | 25 |

Сочетания опций модуля — таблица задачи 16. Сочетания записи (`'required'`/`'none'` × тенант × `tenantNullable`) — таблица задачи 19. Входящие сообщения × `dedupe` — таблица задачи 25.

Проверка на реальных артефактах: проект-потребитель (задачи 35–36) на упакованном архиве:
- генерирует миграции outbox/inbox настоящим `drizzle-kit` и мигрирует через `startTestStack`;
- поднимает RabbitMQ с `definitions.json` пакета;
- публикует событие `OutboxStore.add` в транзакции `Db` (in-process) и через relay процесса `bootstrapService`, потребляет его своим подписчиком (строка inbox);
- проходит `assertStrictTenantIsolation` с outbox;
- проверяет покрытие `KIT_OUTBOX_COVERAGE=1` на трёх прогонах.

## Architecture and Decisions
- Слои (ARCHITECTURE «Правила зависимостей»):
  - `messaging` → `observability`, `config`, `internal` (значения), `database` (только `import type` и динамический `import()` в `forRoot`);
  - `testing` → `messaging/envelope.ts`, `messaging/define-event.ts` напрямую (без `peer.ts`) и `internal`;
  - CLI → `internal/rabbitmq-definitions.ts`.
  `/testing` и CLI грузятся без `amqplib`.
- Файлы `src/messaging`: `peer.ts`, `errors.ts`, `define-event.ts`, `envelope.ts`, `tables.ts`, `topology.ts`, `redelivery.ts`, `rabbit-connection.ts`, `outbox-store.ts`, `outbox-relay.ts`, `inbox.ts`, `subscriber.ts`, `cleanup.ts`, `kit-messaging.module.ts`, `index.ts`. Это ARCHITECTURE стр. 96–101 плюс `errors.ts`, `redelivery.ts`, `peer.ts`.
- `internal`: `tx-context.ts`, `outbox-policy.ts`, `rabbitmq-definitions.ts`, `cleanup-result.ts` (перенос `resultOf` из `idempotency`).
- `testing`: `rabbitmq-admin.ts`, `outbox-coverage.ts`, `test-events.ts`.
- CLI: `commands/rabbitmq.ts`.
- Модуль собирает провайдеры фабриками: `RabbitConnection` (общий), `OutboxRelay` (строит `OutboxStore`), `KitSubscriber`, `MessagingCleanup`, `MessagingLifecycle` (старт соединения, проба, шаг 4). Хуки Nest — у объектов фабрик.
- Тесты I и T идут на vhost воркера под пользователем с правами M3 сервиса `kit`. Очереди — `kit`, `kit.retry`, `kit.dlq`, `kit.replica.kit-1`; `RABBITMQ_RETRY_SECONDS=1`.
- В `isolated` integration-конфига — только файлы с `initFakeSentry`: `ac-5-7-dlq-retry.spec.ts`. На уровне T `ac-5-16-relay-backoff.spec.ts` изолирован по умолчанию.

## Phase Index
1. [Фаза 1: Основа — решения E4, зависимости и lint](phase-01-foundation.md) — Tasks 1-3
2. [Фаза 2: Определения событий, конверт, таблицы](phase-02-definitions-tables.md) — Tasks 4-8
3. [Фаза 3: definitions.json, CLI, RabbitMQ в startTestStack](phase-03-broker-stack.md) — Tasks 9-13
4. [Фаза 4: Соединение, топология, KitMessagingModule, ./messaging](phase-04-connection-module.md) — Tasks 14-18
5. [Фаза 5: OutboxStore.add и relay](phase-05-outbox-relay.md) — Tasks 19-23
6. [Фаза 6: Подписчик, inbox, retry/DLQ, реплика](phase-06-subscriber.md) — Tasks 24-28
7. [Фаза 7: Очистка и проверка outbox в изоляции](phase-07-cleanup-isolation.md) — Tasks 29-31
8. [Фаза 8: Помощники /testing](phase-08-testing-helpers.md) — Tasks 32-34
9. [Фаза 9: Проект-потребитель и проверки архива](phase-09-consumer-package.md) — Tasks 35-36
10. [Фаза 10: README, CHANGELOG, docs](phase-10-docs.md) — Task 37

## Cross-Phase Dependencies
- Фаза 2 — от задачи 3: lint-блок `src/messaging`, devDependencies AMQP.
- Фаза 3 — от задачи 3 (`amqplib` для `test/support/broker.ts`). Задача 11 включает RabbitMQ во все прогоны I и T.
- Фаза 4 — от задач 4–6 (определения, таблицы) и 9, 11, 12 (`EVENTS_EXCHANGE`, vhost воркера для стенда).
- Фаза 5 — от задач 4 (контекст `tx`), 7 (фикстура `kit.outbox`), 14–18 (соединение, модуль, стенд).
- Фаза 6 — от задач 14–18 и 21 (события и помощники фикстуры).
- Фаза 7 — от задач 1, 2 (`RESET ALL`, `onQuery`), 19 (SQL outbox), 24 (inbox), 26 (`TestConsumer`), 6 (политика).
- Фаза 8 — от задач 11, 12 (`provide`, vhost), 19–21, 25, 26 (`TestConsumer`).
- Фаза 9 — от всех задач 1–34: всё публичное E5 — в архиве.
- Фаза 10 — от всех: имена экспортов сверяются с итоговыми `index.ts`.

## Tasks

### Фаза 1: Основа — решения E4, зависимости и lint
- [x] Task 1: `runExclusive` — `RESET ALL` перед возвратом соединения, TSDoc-запрет `SET`; TSDoc `connection` ([details](phase-01-foundation.md#task-1-runexclusive-сбрасывает-сеанс-соединения-перед-возвратом-в-пул))
- [x] Task 2: `countQueries(…, {onQuery})`, замена `watchQueries` ([details](phase-01-foundation.md#task-2-countqueries--колбэк-на-каждый-запрос))
- [x] Task 3: devDependencies `amqplib`/`amqp-connection-manager`, lint `src/messaging/**`, CHANGELOG ([details](phase-01-foundation.md#task-3-зависимости-amqp-lint-srcmessaging-changelog)) (depends on 1, 2)

### Фаза 2: Определения событий, конверт, таблицы
- [x] Task 4: `internal/tx-context.ts`, `Db` связывает `tx` с `DbContext` ([details](phase-02-definitions-tables.md#task-4-контекст-транзакции-во-внутреннем-модуле)) (depends on 3)
- [x] Task 5: `peer.ts`, ошибки, `defineEvent`, `EnvelopeSchema` ([details](phase-02-definitions-tables.md#task-5-peerts-ошибки-defineevent-envelopeschema)) (depends on 3)
- [x] Task 6: `createOutboxTable`, `createInboxTable`, `internal/outbox-policy.ts` ([details](phase-02-definitions-tables.md#task-6-createoutboxtable-createinboxtable)) (depends on 3)
- [x] Task 7: Фикстура `kit.outbox`, `kit.inbox`, права ([details](phase-02-definitions-tables.md#task-7-фикстура-бд-пакета--kitoutbox-kitinbox)) (depends on 6)
- [x] Task 8: U — `defineEvent`, конверт, таблицы, ошибки ([details](phase-02-definitions-tables.md#task-8-тесты-u-фазы)) (depends on 4, 5, 6)

### Фаза 3: definitions.json, CLI, RabbitMQ в startTestStack
- [x] Task 9: `internal/rabbitmq-definitions.ts` — `buildDefinitions`, права M3, хеш пароля ([details](phase-03-broker-stack.md#task-9-builddefinitions--одна-функция-для-cli-и-тестового-стека)) (depends on 3)
- [x] Task 10: CLI `verdeect-kit rabbitmq definitions` ([details](phase-03-broker-stack.md#task-10-cli-verdeect-kit-rabbitmq-definitions)) (depends on 9)
- [x] Task 11: RabbitMQ в `startTestStack`, vhost на воркер, `globalSetup` I и T ([details](phase-03-broker-stack.md#task-11-rabbitmq-в-startteststack-vhost-на-воркер)) (depends on 9)
- [x] Task 12: `workerScope().rabbitmq`, `test/support/broker.ts` ([details](phase-03-broker-stack.md#task-12-workerscoperabbitmq-и-testsupportbrokerts)) (depends on 11)
- [x] Task 13: Тесты — definitions, CLI, AC-5.10 (CLI), AC-5.18 ([details](phase-03-broker-stack.md#task-13-тесты-фазы--definitions-cli-ac-518)) (depends on 9, 10, 11, 12)

### Фаза 4: Соединение, топология, KitMessagingModule, ./messaging
- [x] Task 14: `RabbitConnection`, `ManagedChannel` ([details](phase-04-connection-module.md#task-14-rabbitconnection-и-managedchannel)) (depends on 3, 15)
- [x] Task 15: `topology.ts`, `redelivery.ts` ([details](phase-04-connection-module.md#task-15-топология-и-повторы--topologyts-redeliveryts)) (depends on 9)
- [x] Task 16: `KitMessagingModule.forRoot`, `index.ts`, `exports["./messaging"]` ([details](phase-04-connection-module.md#task-16-kitmessagingmoduleforroot-indexts-exportsmessaging)) (depends on 4, 5, 6, 14, 15)
- [x] Task 17: U — AC-5.20, AC-1.2, AC-5.15 (`forRoot`), redelivery, topology ([details](phase-04-connection-module.md#task-17-тесты-u--ac-520-ac-12-ac-515-forroot-redelivery)) (depends on 15, 16)
- [x] Task 18: Стенд модуля, I — пассивная проверка exchange, проба ([details](phase-04-connection-module.md#task-18-стенд-модуля-и-i--пассивная-проверка-exchange-проба-health)) (depends on 12, 16)

### Фаза 5: OutboxStore.add и relay
- [x] Task 19: `OutboxStore.add` ([details](phase-05-outbox-relay.md#task-19-outboxstoreadd)) (depends on 4, 5, 6, 16)
- [x] Task 20: `OutboxRelay` ([details](phase-05-outbox-relay.md#task-20-outboxrelay)) (depends on 14, 15, 16, 19)
- [x] Task 21: Поддержка тестов outbox ([details](phase-05-outbox-relay.md#task-21-поддержка-тестов-outbox)) (depends on 7, 18, 20)
- [x] Task 22: I — AC-5.1, 5.2, 5.5, 5.15 (запись), O outbox, I fr-72 ([details](phase-05-outbox-relay.md#task-22-тесты-i--ac-51-ac-52-ac-55-ac-515-запись-эквивалентность-o-и-i)) (depends on 7, 19, 20, 21)
- [x] Task 23: T — AC-5.3, 5.4, 5.16, O outbox-confirm ([details](phase-05-outbox-relay.md#task-23-тесты-t--ac-53-ac-54-ac-516-o-outbox-confirm)) (depends on 11, 19, 20, 21)

### Фаза 6: Подписчик, inbox, retry/DLQ, реплика
- [x] Task 24: inbox ([details](phase-06-subscriber.md#task-24-inbox)) (depends on 6)
- [x] Task 25: `KitSubscriber` — `on`, `onReplica`, DLQ, retry, TTL, остановка ([details](phase-06-subscriber.md#task-25-kitsubscriber)) (depends on 5, 14, 15, 16, 24)
- [x] Task 26: I — AC-5.6–5.9, 5.15, 5.17, 5.19, O subscriber/inbox-guard/topology ([details](phase-06-subscriber.md#task-26-тесты-i--ac-5659-515-517-519-эквивалентность-o)) (depends on 7, 21, 25)
- [x] Task 27: I — AC-5.10, права `definitions.json` ([details](phase-06-subscriber.md#task-27-i-ac-510--права-definitionsjson)) (depends on 13, 20, 25, 26)
- [x] Task 28: T — AC-5.11, P channel-restore ([details](phase-06-subscriber.md#task-28-тесты-t--ac-511-p-channel-restore)) (depends on 20, 21, 25, 26)

### Фаза 7: Очистка и проверка outbox в изоляции
- [x] Task 29: `MessagingCleanup`, `internal/cleanup-result.ts` ([details](phase-07-cleanup-isolation.md#task-29-messagingcleanup)) (depends on 1, 16, 19, 24)
- [x] Task 30: `assertStrictTenantIsolation` — политика outbox ([details](phase-07-cleanup-isolation.md#task-30-assertstricttenantisolation--политика-outbox)) (depends on 6)
- [x] Task 31: I — AC-5.12, AC-9.5, AC-4.8 (outbox), AC-5.11 (очистка) ([details](phase-07-cleanup-isolation.md#task-31-тесты-i--ac-512-ac-95-ac-48-outbox-остановка-очистки)) (depends on 2, 7, 21, 25, 26, 29, 30)

### Фаза 8: Помощники /testing
- [x] Task 32: `expectOutbox`, `assertOutboxCoverage`, `outboxEvents`, `KIT_OUTBOX_COVERAGE` ([details](phase-08-testing-helpers.md#task-32-expectoutbox-assertoutboxcoverage-outboxevents)) (depends on 5, 6, 11)
- [x] Task 33: `publishTestEvent`, `waitForInbox` ([details](phase-08-testing-helpers.md#task-33-publishtestevent-waitforinbox)) (depends on 5, 11, 12)
- [x] Task 34: U и I помощников (AC-5.13 на уровне пакета) ([details](phase-08-testing-helpers.md#task-34-тесты-помощников--u-и-i-ac-513-на-уровне-пакета)) (depends on 21, 25, 26, 32, 33)

### Фаза 9: Проект-потребитель и проверки архива
- [x] Task 35: Потребитель публикует и потребляет событие ([details](phase-09-consumer-package.md#task-35-потребитель-публикует-и-потребляет-событие)) (depends on 16, 19, 20, 25, 29, 30, 32, 33)
- [x] Task 36: AC-1.1, AC-1.2, AC-9.1, AC-5.13, AC-5.18 на архиве ([details](phase-09-consumer-package.md#task-36-проверки-архива--ac-11-ac-12-ac-91-ac-513-ac-518)) (depends on 13, 16, 35)

### Фаза 10: README, CHANGELOG, docs
- [x] Task 37: README, CHANGELOG `[Unreleased]`, `docs/testing.md`, AC-9.3 ([details](phase-10-docs.md#task-37-документация-e5)) (depends on 1–36)

## Traceability

| UC / AC | Задачи | Тест (файл → название) |
|---|---|---|
| AC-5.1 (UC-5) | 19, 22 | `test/integration/messaging/ac-5-1-outbox-atomicity.spec.ts` → `AC-5.1: data не по схеме — TypeError, строки kit.note и kit.outbox нет`, `AC-5.1: успех — note и строка outbox видны после COMMIT вместе`, `AC-5.1: откат после add…` |
| AC-5.2 (UC-5) | 4, 5, 19, 20, 22 | `ac-5-2-outbox-row.spec.ts` → `AC-5.2: строка содержит tenant, actor, traceId из DbContext и id evt_ + ULID`, `AC-5.2: конверт relay совпадает с 01 §7.1 — EnvelopeSchema.parse(body)…`; U `envelope.spec.ts` → `AC-5.2: buildEnvelope…` |
| AC-5.3 (UC-5) | 20, 23 | `test/timing/messaging/ac-5-3-publish-latency.spec.ts` → `AC-5.3: публикация < 100 мс после COMMIT…`, `AC-5.3: строка, вставленная другим процессом, — не позже 1000 мс + пачка` |
| AC-5.4 (UC-5) | 20, 23 | `ac-5-4-broker-outage.spec.ts` → `AC-5.4: брокер недоступен 10 с — события копятся, verdeect_outbox_lag_seconds растёт…` (I `ac-6-2-broker-outage`, O `outbox-confirm`) |
| AC-5.5 (UC-5) | 20, 22 | `ac-5-5-two-relays.spec.ts` → `AC-5.5: две реплики relay — каждая строка публикуется один раз (SKIP LOCKED)` |
| AC-5.6 (UC-6) | 24, 25, 26 | `ac-5-6-inbox-duplicate.spec.ts` → `AC-5.6: повтор сообщения с тем же id → duplicate…`, `O inbox-guard: …` |
| AC-5.7 (UC-6) | 5, 15, 25, 26 | `ac-5-7-dlq-retry.spec.ts` → `AC-5.7: не JSON → kit.dlq, x-dlq-reason not-json`, `…envelope`, `…unsubscribed`, `…InvalidMessageError…`, `AC-5.7: ExpectedMessageError → повтор через .retry…`, `AC-5.7: ExpectedMessageError после 5 повторов → DLQ…`; U `redelivery.spec.ts`, `errors.spec.ts`, `envelope.spec.ts` |
| AC-5.8 (UC-6) | 16, 17, 25, 26 | `ac-5-8-dedupe-none.spec.ts` → `AC-5.8: dedupe 'none' — подписчик работает без БД, tx = null…`; U `ac-1-2-messaging-forroot-pg.spec.ts` → `AC-1.2: forRoot с subscriber {dedupe: 'none'} без pg не требует pg` |
| AC-5.9 (UC-6) | 25, 26 | `ac-5-9-replica-queue.spec.ts` → `AC-5.9: onReplica — очередь kit.replica.<REPLICA_ID> exclusive, auto-delete…`, `AC-5.9: очередь удаляется при остановке реплики`, `AC-5.9: без inbox и DLQ…` (провайдер `ReplicaConsumer`, стенд `dedupe: 'none'`) |
| AC-5.10 (UC-12) | 9, 10, 13, 27 | `test/integration/cli/ac-5-10-rabbitmq-definitions.spec.ts` → `AC-5.10: definitions из CLI загружаются в брокер…`; `test/integration/messaging/ac-5-10-permissions.spec.ts` → `AC-5.10: с правами definitions relay публикует…`, `AC-5.10: объявление чужой очереди %s → ACCESS_REFUSED`, `AC-5.10: чтение чужой очереди → ACCESS_REFUSED`, `AC-5.10: exchange виден пассивной проверкой…`; U `rabbitmq-definitions.spec.ts` |
| AC-5.11 (UC-8) | 14, 20, 25, 28, 29, 31 | `test/timing/messaging/ac-5-11-shutdown.spec.ts` → `AC-5.11: остановка — подписчик снимает потребителей…`, `AC-5.11: обработчик дольше срока…`; `ac-5-11-shutdown.spec.ts` → `AC-5.11: relay — остановка во время неподтверждённой публикации: транзакция пачки зафиксирована, строка без attempts + 1 и last_error…`; `ac-5-12-cleanup.spec.ts` → `AC-5.11: остановка во время прохода…`; `channel-restore.spec.ts` (P) |
| AC-5.12 (UC-9) | 29, 31 | `ac-5-12-cleanup.spec.ts` → `AC-5.12: опубликованные outbox и inbox старше 7 дней удаляются…`, `AC-5.12: пачки…`, `AC-5.12: одна реплика за раз…`, `AC-5.12: DB_POOL_MAX = 1…` |
| AC-5.13 (UC-2, UC-14) | 32, 33, 34, 35, 36 | U `outbox-coverage.spec.ts`; I `ac-5-13-expect-outbox.spec.ts`; C `test/consumer/minimal/src/messaging.spec.ts` → `AC-5.13: publishTestEvent(CompanyCreated) + waitForInbox…`; `coverage/coverage.spec.ts`; `test/package/ac-9-1-consumer.spec.ts` → `AC-5.13: при KIT_OUTBOX_COVERAGE=1 событие без успешного expectOutbox роняет teardown…`, `AC-5.13: без KIT_OUTBOX_COVERAGE тот же прогон не падает` |
| AC-5.15 (UC-5, UC-6) | 5, 16, 17, 19, 22, 25, 26 | U `ac-5-15-forroot.spec.ts` → `AC-5.15: событие 'none' при createOutboxTable({tenantNullable: false}) — отказ forRoot…`; I `ac-5-15-outbox-tenant.spec.ts`, `ac-5-15-subscriber-tenant.spec.ts` → `AC-5.15: подписчик получает 'required' с tenant: null — DLQ, x-dlq-reason: tenant…` |
| AC-5.16 (UC-5) | 20, 23 | `test/timing/messaging/ac-5-16-relay-backoff.spec.ts` → `AC-5.16: строка, не опубликованная 5 раз подряд, — error-лог и событие GlitchTip с id и type, без data; паузы 1 → 2 → 4…` |
| AC-5.17 (UC-6) | 25, 26 | `ac-5-17-prefetch.spec.ts` → `AC-5.17: prefetch 10 — при 20 сообщениях…` |
| AC-5.18 (UC-14) | 11, 12, 13, 36 | `test/integration/testing/ac-5-18-worker-vhost.spec.ts` → `AC-5.18: workerScope().rabbitmq…`, `AC-5.18: teardown удаляет vhost…`; `ac-9-1-consumer.spec.ts` → `AC-5.18: после прогона потребителя vhost… удалены` |
| AC-5.19 (UC-6) | 14, 25, 26 | `ac-5-19-retry-ttl.spec.ts` → `AC-5.19: kit.retry объявлена с другим TTL — запуск отклонён…` |
| AC-5.20 (UC-1, UC-6) | 16, 17 | `test/unit/messaging/ac-5-20-service-name.spec.ts` → `AC-5.20: forRoot с service 'Bff_App'…`, `AC-5.20: 'bff-app' проходит` |
| AC-9.5 (NFR-8) | 20, 25, 29, 31, 35 | `test/integration/messaging/ac-9-5-messaging-observability.spec.ts` → `AC-9.5: relay, подписчик и очистка пишут метрики с меткой service и логи с полями service и replica`; `ac-5-12-cleanup.spec.ts` → `AC-9.5: ошибка БД таблицы outbox → result="error"…`; `test/consumer/minimal/src/observability.spec.ts` → `AC-9.5: relay, подписчик и очистка сообщений…`, `AC-9.5: /metrics…` |
| AC-1.1 (UC-16) | 16, 36 | `test/unit/package/package-manifest.spec.ts` (exports `./messaging`); `test/package/ac-1-1-package.spec.ts` → publint/attw, `AC-1.1: dist/testing не импортирует amqplib…` |
| AC-1.2 (UC-1) | 5, 16, 17, 36 | `test/unit/messaging/ac-1-2-messaging-peer.spec.ts`, `ac-1-2-messaging-forroot-pg.spec.ts`; `test/package/ac-1-1-package.spec.ts` → `AC-1.2: dist/messaging…`; `ac-9-1-consumer.spec.ts` (`peer-check`, `messaging-forroot.mjs`) |
| AC-4.8 (UC-1) | 6, 30, 31 | `test/integration/testing/ac-4-8-strict-isolation.spec.ts` → `AC-4.8: outbox из createOutboxTable…`, `AC-4.8: outbox с политикой tenantPolicy вместо исключения → нарушение…` |
| AC-4.12, AC-4.15 (решения E4) | 1, 2 | `ac-4-12-run-exclusive.spec.ts` → `AC-4.12: сеанс соединения блокировки сброшен…`; `ac-4-15-count-queries.spec.ts` → `AC-4.15: onQuery…` |
| AC-9.1 (UC-1, UC-16) | 35, 36 | `test/consumer/minimal/src/messaging.spec.ts`, `observability.spec.ts` → `AC-9.1: строка outbox, вставленная тестом, — процесс публикует её … и сам потребляет…`; `database.spec.ts`; `test/package/ac-9-1-consumer.spec.ts` → `AC-9.1: проект-потребитель проходит свои тесты` |
| AC-9.3 | 37 | `test/package/ac-9-3-docs.spec.ts` (`ENTRY_POINTS` + messaging, фрагменты развёртывания) |
| AC-9.4 | 3 (правило не меняется) | `test/package/ac-9-4-lint-rules.spec.ts`; `make lint` |
| UC-5 | 4, 19, 20, 22, 23 | AC-5.1–5.5, 5.15, 5.16 |
| UC-6 | 24–26 | AC-5.6–5.9, 5.15, 5.17, 5.19 |
| UC-8 | 20, 25, 28, 29 | AC-5.11 |
| UC-12 | 9, 10, 13, 27 | AC-5.10 |
| UC-14 | 11–13, 32–34 | AC-5.13, AC-5.18 |

## Commit Plan
- **Commit 1** (после задач 1–3): `fix(database): RESET ALL соединения runExclusive; feat(testing): countQueries onQuery; chore: devDependencies AMQP и lint messaging`
- **Commit 2** (после задач 4–8): `feat(messaging): defineEvent, EnvelopeSchema, createOutboxTable/createInboxTable, ошибки обработчика`
- **Commit 3** (после задач 9–13): `feat(cli,testing): rabbitmq definitions, RabbitMQ в startTestStack, vhost на воркер`
- **Commit 4** (после задач 14–18): `feat(messaging): RabbitConnection, KitMessagingModule.forRoot; подпуть ./messaging`
- **Commit 5** (после задач 19–23): `feat(messaging): OutboxStore.add и relay с подтверждениями брокера`
- **Commit 6** (после задач 24–28): `feat(messaging): подписчик с inbox, retry/DLQ, очередь реплики`
- **Commit 7** (после задач 29–31): `feat(messaging): очистка outbox/inbox; feat(testing): политика outbox в assertStrictTenantIsolation`
- **Commit 8** (после задач 32–34): `feat(testing): expectOutbox, assertOutboxCoverage, publishTestEvent, waitForInbox`
- **Commit 9** (после задач 35–37): `test(consumer): сообщения на архиве; docs: README и CHANGELOG E5`

## Definition of Done
- `make ci` зелёный (lint → analyse → test → test-integration → build → pack-check); `make test-timing` зелёный.
- Все AC скоупа — в Traceability с зелёными тестами; названия тестов начинаются с ID.
- `src/**` без `console.*` и без имён схем сервисов (AC-9.4). Нет статических импортов `pg`, `amqplib`, `amqp-connection-manager`, нет значений `database` в `src/messaging`. Нет `assertExchange` и SQL-триггеров outbox.
- Решения П1–П24 отправлены чату kit для PRD v1.15 (П1–П3 — изменения формулировок §3.4, AC-5.15, AC-5.18).
- README, CHANGELOG `[Unreleased]`, TSDoc у каждого нового экспорта; `version` не меняется (G14).
