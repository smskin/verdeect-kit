# Phase 10: README, CHANGELOG, docs

Plan: [index.md](index.md)
Tasks: 37
Depends on: Tasks 1–36

## Objective

AC-9.3 для `/messaging` и изменённой поверхности `/testing`, `/database`:

- README содержит API подпути, правила развёртывания (DLQ — разбор в 7 дней, порядок смены TTL `.retry`), пример BFF `bff-app`/`bff-admin` (§3.4 «имя сервиса», CE-3), `definitions.json` и ключи `RABBITMQ_PASSWORD_HASH_<SVC>`, миграции outbox/inbox с правами.
- CHANGELOG `[Unreleased]` — каждый новый экспорт.
- `docs/testing.md` — RabbitMQ в стеке, vhost на воркер, `KIT_OUTBOX_COVERAGE`, список `isolated`.

Версия пакета не меняется (G14).

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `README.md` | разделы: Подпути (37, строка `/messaging \| E5 \| в своём этапе`), Конфигурация окружения (55), Наблюдаемость (112; таблица шагов остановки ≈153; «Пороги» 176 — без `cleanup_runs`), База данных (263), Идемпотентность (305), Тесты сервиса (326; стр. 358 «RabbitMQ и Redis появятся в E5 и E8»), Развёртывание (393), Реестр префиксов id (406; `evt` уже есть), API (420; `### @verdeect/kit/<подпуть>`) | места правки |
| `test/package/ac-9-3-docs.spec.ts:10` | `ENTRY_POINTS` — каждый экспорт в бэктиках под `## API` и в CHANGELOG `[Unreleased]`; фрагменты `## Развёртывание` уже включают DLQ, «7 дней», `RABBITMQ_RETRY_SECONDS`, `.retry` | + `messaging` |
| `CHANGELOG.md` | `[Unreleased]` → вступление (стр. 7, этапы E1–E4), `Added`, `Changed`, `Fixed` | + E5 |
| `docs/testing.md` | «Когда запускать», «Тайм-ауты», «Проекты интеграционного конфига» (38–60) | + RabbitMQ, покрытие, `isolated` |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `README.md` | modify | раздел «Сообщения», API `/messaging`, `/testing` E5, развёртывание, пороги |
| `CHANGELOG.md` | modify | `[Unreleased]` E5 |
| `docs/testing.md` | modify | RabbitMQ, vhost, покрытие outbox, `isolated` |
| `test/package/ac-9-3-docs.spec.ts` | modify | `ENTRY_POINTS` + `messaging`; фрагменты развёртывания |

## Task 37: Документация E5

### Intent
AC-9.3, «Library Package Scope» (7): изменение публичной поверхности сопровождается README и CHANGELOG в том же плане.

### Implementation Steps
1. `README.md` (`Skill: none — документация (markdown)`):
   1. «Подпути»: `/messaging | E5 | amqplib, amqp-connection-manager; pg — только при outbox или inbox`.
   2. Новый раздел `## Сообщения` (после «Идемпотентность»):
      - **Имя сервиса** = имя экземпляра → очереди `<svc>`, `<svc>.retry`, `<svc>.dlq`, `<svc>.replica.<REPLICA_ID>`, пользователь RabbitMQ. Пример: BFF — два экземпляра `bff-app` и `bff-admin`, у каждого свои очереди и пользователь.
      - **События**: `defineEvent({type, version, subject, tenant, data})`; `tenant: 'none'` — только для событий без компании (каталог `01` §7.2); `data` без `.strict()`. Каталог событий — `@verdeect/events`.
      - **Таблицы**: схема Drizzle `createOutboxTable(schema, {tenantNullable})`, `createInboxTable(schema)`. SQL-миграция сервиса добавляет `FORCE ROW LEVEL SECURITY` на outbox и права `<svc>_app` (пример SQL — как в фикстуре задачи 7). Outbox — исключение строгой модели (пустой тенант видит все строки), `assertStrictTenantIsolation` проверяет его политику.
      - **Модуль**: `KitMessagingModule.forRoot({service, outbox: {table, events}, subscriber: {dedupe, inbox}})` — пример для сервиса с outbox и inbox и для BFF (`subscriber: {dedupe: 'none'}`, без БД). `tenantNullable` берётся из таблицы. Событие `'none'` при NOT NULL — отказ запуска `MESSAGING_TENANT_NOT_NULLABLE`.
      - **Запись**: `OutboxStore.add(tx, Event, {subjectId, data})` в `Db.transaction` — проверка `data` и признака tenant, откат транзакции при ошибке; триггеров нет.
      - **Relay**: пачка ≤ 100 по `seq`, подтверждения брокера, срок пачки 5 с, опрос 1 с, паузы 1 с → 5 мин, 5 неудач строки — `error` + GlitchTip; метрики `verdeect_outbox_pending`, `verdeect_outbox_lag_seconds`.
      - **Подписчик**: `KitSubscriber.on(Event, (event, tx) => …)` в `onModuleInit`; inbox в транзакции обработчика; `prefetch` 10; 5 повторов через `.retry` (TTL `RABBITMQ_RETRY_SECONDS`); DLQ с `x-dlq-reason` — таблица значений (`not-json`, `envelope`, `unsubscribed`, `tenant`, `data`, причина `InvalidMessageError`, код `ExpectedMessageError`, `retries-exhausted`); `ExpectedMessageError` / `InvalidMessageError`; `onReplica` — очередь реплики без inbox и DLQ; порядок по `occurredAt` — `ifNewer`.
      - **Очистка**: опубликованный outbox и inbox старше 7 дней, раз в час, `runExclusive`, метрика `verdeect_cleanup_runs_total{table: outbox|inbox}`.
      - **Остановка**: relay, подписчик и очистка — шаг 3, соединение RabbitMQ — шаг 4.
   3. «Наблюдаемость» → «Пороги»: + `verdeect_kit_threshold:cleanup_runs` (пропуск E4, найден разведкой).
   4. «Тесты сервиса»:
      - стр. 358 → «RabbitMQ — `startTestStack({rabbitmq: true})` (E5), Redis — E8»;
      - помощники `workerScope().rabbitmq`, `expectOutbox`, `assertOutboxCoverage` + `outboxEvents` + `KIT_OUTBOX_COVERAGE=1` в `make test-integration` и CI, `publishTestEvent`, `waitForInbox`;
      - `countQueries(pool, fn, {onQuery})`.
   5. «Развёртывание»:
      - `verdeect-kit rabbitmq definitions --services <svc,…> [--out definitions.json]` и ключи `RABBITMQ_PASSWORD_HASH_<SVC>` (`bff-app` → `RABBITMQ_PASSWORD_HASH_BFF_APP`, значение — `rabbitmqctl hash_password <пароль>`); брокер грузит файл при старте (`load_definitions`); права — configure/write/read из §3.4; exchange `verdeect.events` объявляет файл, сервисы проверяют его пассивно;
      - **DLQ — разбор в 7 дней**: сообщения `<svc>.dlq` разбирает владелец сервиса не позже 7 дней (алерт `VerdeectEventsDlq`); причина — заголовок `x-dlq-reason`; повторная отправка — перекладкой в `<svc>` после исправления;
      - **порядок смены TTL `.retry`**: 1) остановить все реплики сервиса; 2) дождаться опустошения `<svc>.retry` (или переложить сообщения в `<svc>`); 3) удалить очередь `<svc>.retry`; 4) задать новый `RABBITMQ_RETRY_SECONDS` и запустить реплики — очередь объявится с новым TTL. Иначе — отказ запуска «очередь `<svc>.retry` объявлена с другим TTL — пересоздайте очередь».
   6. `## API` → `### @verdeect/kit/messaging`: каждый экспорт `index.ts` в бэктиках с одной строкой: `defineEvent`, `EnvelopeSchema`, `Envelope`, `KitEvent`, `KitEventTenant`, `createOutboxTable`, `createInboxTable`, `KitOutboxTable`, `KitInboxTable`, `OutboxStore`, `KitSubscriber`, `KitEventHandler`, `KitReplicaHandler`, `KitMessagingModule`, `KitMessagingModuleOptions`, `ExpectedMessageError`, `InvalidMessageError`. `### @verdeect/kit/testing` — строки `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`, `KitCountQueriesOptions` уже добавлены задачами 2, 32, 33; дополнить описанием и примерами.
   7. Таблица совместимости — без изменений (`events` — вне этапа).
2. `CHANGELOG.md` (`Skill: none — Keep a Changelog`), `[Unreleased]`:
   - вступление — «этапы E1–E5»;
   - `Added`:
     - «`/messaging`: …» — по строке на каждый экспорт из п. 1.6;
     - «`/testing`: `startTestStack({rabbitmq, outboxEvents})`, `workerScope().rabbitmq`, `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`»;
     - «CLI: `verdeect-kit rabbitmq definitions`»;
   - `Changed`:
     - «`/testing`: `countQueries(pool, fn, {onQuery})` и тип `KitCountQueriesOptions`» — запись уже добавлена задачей 3, сохранить;
     - «`/database`: `Db` связывает транзакцию с `DbContext` (для `OutboxStore.add`) — без изменения API»;
   - `Fixed` — записи задачи 3 (`RESET ALL`).
   Списки без пустых строк внутри.
3. `docs/testing.md` (`Skill: none — документация`):
   - RabbitMQ в `globalSetup` I и T;
   - vhost на воркер (префикс `<svc>-test-<run>-w<N>`, удаление в teardown и остатков прошлых прогонов);
   - `KIT_OUTBOX_COVERAGE=1`;
   - уровень T теперь со стеком;
   - «Проекты интеграционного конфига» — новые файлы `isolated` с причинами (`ac-5-7-dlq-retry.spec.ts`).
4. `test/package/ac-9-3-docs.spec.ts` (`Skill: nestjs-code test unit package docs (MODIFY)`):
   - `ENTRY_POINTS` + `'src/messaging/index.ts'` (форма записи — как у соседних);
   - фрагменты `## Развёртывание`: + `rabbitmq definitions`, `RABBITMQ_PASSWORD_HASH_`, «пересоздайте очередь» / порядок смены TTL (одна устойчивая подстрока, например `удалить очередь`), `x-dlq-reason`.

### Error Handling and Logging
Нет.

### Tests
- `test/package/ac-9-3-docs.spec.ts` — зелёный.

### Acceptance Criteria
- Каждый экспорт `src/messaging/index.ts` и новые экспорты `src/testing/index.ts` — в README `## API` и CHANGELOG `[Unreleased]`.
- `package.json` `version` не изменён.

### Verification
- `make analyse`; `make test-package`; `make ci` — полный.

## Phase Risks and Mitigations
- Риск: имена экспортов разошлись с итоговым кодом. Смягчение: задача выполняется последней; `ac-9-3-docs.spec.ts` сверяет README с `index.ts`.

## Phase Completion Checklist
- Задача 37 выполнена; `make ci` зелёный.
- `index.md` обновлён.
