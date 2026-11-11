# Phase 7: Очистка outbox/inbox и проверка outbox в `assertStrictTenantIsolation`

Plan: [index.md](index.md)
Tasks: 29-31
Depends on: Phase 1 (Tasks 1, 2), Phase 5 (Task 19), Phase 6 (Tasks 24, 26 — `TestConsumer`)

## Objective

§3.4 «очистка»: опубликованный outbox и inbox старше 7 дней удаляются раз в час. Пачки — по 1000, не больше 100 за проход, через `runExclusive`. Удаление идёт на соединении блокировки (решение E4: работает при `DB_POOL_MAX = 1`). Остановка — на шаге 3.

Метрика — общая `verdeect_cleanup_runs_total{table: outbox|inbox, result: ok|partial|interrupted|error}`, число удалённых строк пишется в `info`-лог прохода. Новых метрик и правил алертов нет: `VerdeectCleanupFailing` уже есть.

`assertStrictTenantIsolation` проверяет политику outbox на настоящей таблице `createOutboxTable` вместо заглушки E4 «только наличие политики» (§3.8, AC-4.8; запрос пользователя).

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `src/idempotency/kit-idempotency.module.ts:51-61, 100-189` | `resultOf(complete, batches, maxBatches)` → `ok`/`partial`/`interrupted`; `IdempotencyCleanup`: `onApplicationBootstrap` — первый проход `setTimeout(0).unref()`, затем `setInterval(…, 3_600_000).unref()`; `run(limits)` без наложения; `idle()`; `beforeApplicationShutdown` — `stopped`, `clearInterval`, `await current`; проход — `runExclusive(db, key, (connection) => deleteInBatches({db, sql, ...limits, shouldContinue, connection}))`, занято — `debug`, метрика не меняется; `cleanupRuns.inc({table, result})`, `info {table, deleted, batches, result}`; ошибка — `result: 'error'`, `error` + `captureError` | образец, переносится обобщённым |
| O `messaging-cleanup.job.ts` (107) | `run(now)` → `{outbox, inbox}`, `cleanTable` по таблице, ошибка одной таблицы не мешает другой; без `JobLock` (полагается на `SKIP LOCKED`) | эталон; по PRD — `runExclusive` |
| O `outbox-store.ts`, `inbox-guard.ts` | `deletePublishedBefore`/`deleteReceivedBefore` — `delete … where id in (select … limit n for update skip locked)` | SQL пачки |
| `src/database/batches.ts:91` | `deleteInBatches({db, sql: (batchSize) => SQL, batchSize, maxBatches, shouldContinue?, connection?})` → `{deleted, batches, complete}`; SQL возвращает одну строку с `deleted` | API |
| `src/database/run-exclusive.ts` | `runExclusive(db, key, fn(connection))`; задача 1 — `RESET ALL` | блокировка |
| `src/observability/metrics.ts` | `cleanupRuns` — TSDoc уже называет `outbox`, `inbox` | метрика |
| `alerts/verdeect-kit.rules.yml` | `VerdeectCleanupFailing` (`error\|partial`, 2 ч) | правило есть |
| `src/testing/tenant-isolation.ts:87-88, 157, 243-…, 271` | `OUTBOX_TABLE`; `policyViolations` для outbox → `[]`; `visibleRows` для outbox пропускается; TSDoc «`outbox` — только наличие политики до E5» | место изменения |
| `test/integration/testing/ac-4-8-strict-isolation.spec.ts` | случаи AC-4.8 на `createScratchDatabase` | новые случаи |
| `test/integration/idempotency/support.ts` | `cleanupRuns(metrics, result)` по `table === 'idempotency_key'` | образец помощника |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/messaging/cleanup.ts` | create | `MessagingCleanup`, SQL пачек |
| `src/messaging/kit-messaging.module.ts` | modify | провайдер `MessagingCleanup` при outbox или inbox |
| `src/testing/tenant-isolation.ts` | modify | проверка политики outbox по `OUTBOX_POLICY_SQL` |
| `test/integration/messaging/ac-5-12-cleanup.spec.ts`, `ac-9-5-messaging-observability.spec.ts` | create | I |
| `test/integration/testing/ac-4-8-strict-isolation.spec.ts` | modify | случаи outbox |

## Task 29: `MessagingCleanup`

### Intent
§3.4, UC-9, AC-5.12, AC-9.5, UC-8 (очистка не начинает новую пачку при остановке), решения E4 (соединение блокировки, общая метрика, `info`-лог числа строк).

### Implementation Steps
1. `src/messaging/cleanup.ts` (`Skill: nestjs-code generic src/messaging/cleanup.ts (CREATE)`). Шапка: «Очистка outbox и inbox (prd.md §3.4, UC-9, AC-5.12, AC-9.5). Эталон O messaging-cleanup.job.ts; по PRD — runExclusive, пачки на соединении блокировки (E4 KT-22 п. 4), раз в час. Метрика — verdeect_cleanup_runs_total{table: outbox|inbox} (общая, E4 П8), число строк — info-лог. Расписание и итог прохода — по образцу IdempotencyCleanup».
2. SQL пачек — функции `(batchSize: number) => SQL` по таблице. Имена — `sql.raw(quoteIdentifier(…))` из `getTableConfig` (не `${string}`), без литералов схемы. Срок — `now()` БД и константа `RETENTION_DAYS` параметром через `make_interval` (подстановка внутри литерала `interval '…'` дала бы параметр в строке и ошибку числа параметров); `$batch` — параметр `${batchSize}`:
   ```sql
   -- outbox: только опубликованные
   with d as (delete from "<s>"."outbox" where id in (
       select id from "<s>"."outbox" where published_at < now() - make_interval(days => ${RETENTION_DAYS})
       order by published_at limit ${batchSize} for update skip locked) returning 1)
   select count(*)::int as deleted from d
   -- inbox
   with d as (delete from "<s>"."inbox" where id in (
       select id from "<s>"."inbox" where received_at < now() - make_interval(days => ${RETENTION_DAYS})
       order by received_at limit ${batchSize} for update skip locked) returning 1)
   select count(*)::int as deleted from d
   ```
   Пачка идёт в `Db`-транзакции `deleteInBatches` с `tenant: null`. Outbox — исключение политики, пустой тенант видит все строки. Inbox без RLS. Функции `SECURITY DEFINER` не нужны (решение П15), в отличие от идемпотентности E4.
3. Класс `MessagingCleanup` (хуки `OnApplicationBootstrap`, `BeforeApplicationShutdown`). Конструктор внутренний: `{db, database: {runExclusive, deleteInBatches}, schema, tables: {outbox?: KitOutboxTable; inbox?: KitInboxTable}, metrics?, logger}`. Значения `database` передаются из `forRoot`: там они загружены динамическим импортом.
   - `onApplicationBootstrap` / `beforeApplicationShutdown` / `run(limits = {batchSize: CLEANUP_BATCH_SIZE, maxBatches: CLEANUP_MAX_BATCHES})` / `idle()` — как `IdempotencyCleanup` (первый проход через `setTimeout(0).unref()`, затем `setInterval(CLEANUP_INTERVAL_MS).unref()`, без наложения, не бросает).
   - Проход:
     ```ts
     const lock = await runExclusive(db, `verdeect-kit:messaging-cleanup:${schema}`, async (connection) => {
         for (const [name, sqlOf] of tables) {          // outbox, затем inbox
             if (this.stopped) { break; }                 // новая таблица не начинается после остановки
             await this.cleanTable(name, sqlOf, limits, connection);
         }
     });
     if (!lock.ran) { log.debug({tables}, 'очистка сообщений: другая реплика'); }   // метрика не меняется
     ```
   - `cleanTable(name, sqlOf, limits, connection)`:
     - `try { const r = await deleteInBatches({db, sql: sqlOf, ...limits, shouldContinue: () => !this.stopped, connection}); const result = resultOf(r.complete, r.batches, limits.maxBatches); metrics?.cleanupRuns.inc({table: name, result}); log.info({table: name, deleted: r.deleted, batches: r.batches, result}, 'очистка сообщений: проход'); }`
     - `catch (error) { metrics?.cleanupRuns.inc({table: name, result: 'error'}); log.error({table: name, err: sanitizeError(error)}, 'очистка сообщений: ошибка'); captureError(error); }` — ошибка одной таблицы не мешает другой (O).
   - `resultOf` — переиспользовать функцию E4. Она сейчас в `kit-idempotency.module.ts`; `messaging` не импортирует `idempotency` (lint). Перенести её в `src/internal/cleanup-result.ts` (`Skill: nestjs-code generic src/internal/cleanup-result.ts (CREATE)`), а `kit-idempotency.module.ts` импортирует её оттуда (`Skill: nestjs-code generic src/idempotency/kit-idempotency.module.ts (MODIFY)`) — без изменения поведения.
4. Модуль (`Skill: nestjs-code module messaging KitMessaging (MODIFY)`): провайдер `MessagingCleanup` создаётся, если задан `outbox` или `subscriber.inbox`. Провайдер — `{provide: MessagingCleanup, useFactory: (db, options, metrics?, logger?) => new MessagingCleanup({db, database: {runExclusive: database.runExclusive, deleteInBatches: database.deleteInBatches}, schema: options.schema, tables: {outbox: options.outbox, inbox: options.inbox}, metrics, logger}), inject: [database.Db, KIT_MESSAGING_OPTIONS, {token: KIT_METRICS, optional: true}, {token: KIT_LOGGER, optional: true}]}`; `database` — значение динамического импорта, захваченное в `forRoot` (задача 16, шаг 2.6). Таблицы — только заданные (BFF — без очистки).

### Required Interfaces and Contracts
- `table` метрики — `outbox` / `inbox` (имя без схемы, E4 П8).
- Ключ блокировки — один на схему для обеих таблиц: проход последовательный, на одном соединении.

### Error Handling and Logging
- `debug` — «другая реплика», пачки (`deleteInBatches`);
- `info` — итог по таблице (`table`, `deleted`, `batches`, `result`);
- `error` + `captureError` — ошибка таблицы.
- Поля `service`, `replica` — из логгера приложения (AC-9.5).

### Tests
Задача 31.

### Acceptance Criteria
- Проход удаляет только опубликованный outbox и inbox старше 7 дней; неопубликованное не удаляется никогда.

### Verification
- Задача 31.

## Task 30: `assertStrictTenantIsolation` — политика outbox

### Intent
§3.8: «знает `outbox`». E4 оставил для outbox только проверку наличия политики (П12 E4). Запрос пользователя: проверить на настоящей таблице `createOutboxTable`. Исключение одно, и оно не должно пропускать «нестрогую» политику с другим выражением.

### Implementation Steps
1. `src/testing/tenant-isolation.ts` (`Skill: nestjs-code generic src/testing/tenant-isolation.ts (MODIFY)`):
   1. Для таблицы `outbox`:
      - RLS включена и форсирована (как у всех);
      - ровно одна политика `outbox_tenant_isolation` (`OUTBOX_POLICY` из `src/internal/outbox-policy.ts`), `permissive`, `cmd = ALL`, роли `{public}`;
      - `qual` и `with_check` из `pg_policies` после существующей `normalize()` (`src/testing/tenant-isolation.ts:90-97`) равны `normalize(OUTBOX_POLICY_PG)` — новая константа рядом с `TENANT_POLICY` и `IDEMPOTENCY_POLICY` (стр. 84-86) в печатной форме PostgreSQL 17: `"((COALESCE(current_setting('app.tenant'::text, true), ''::text) = ''::text) OR (tenant = current_setting('app.tenant'::text, true)))"`. Значение сверить с `select qual from pg_policies where tablename = 'outbox'` на фикстуре `kit` (задача 7) и записать точно; отдельной `normalizePolicy` нет.
      - иначе нарушение `outbox: политика не по createOutboxTable (outbox_tenant_isolation)`.
   2. Счёт строк под пустым тенантом для outbox по-прежнему не проверяется: по исключению они видны.
   3. Импорт `OUTBOX_POLICY*` — из `internal`, не из `messaging`: `/testing` грузится без `amqplib`.
   4. TSDoc `assertStrictTenantIsolation`: «`outbox` — исключение строгой модели: политика `createOutboxTable` (пустой тенант — все строки), RLS и FORCE обязательны». Строку «до E5» убрать.
2. Шапка файла — + «E5: политика outbox по OUTBOX_POLICY_SQL».

### Required Interfaces and Contracts
Сигнатура не меняется.

### Error Handling and Logging
Нет.

### Tests
Задача 31.

### Acceptance Criteria
- Фикстура `kit` (настоящая `createOutboxTable`) проходит; outbox с иной политикой — нарушение.

### Verification
- Задача 31.

## Task 31: Тесты I — AC-5.12, AC-9.5, AC-4.8 (outbox), остановка очистки

### Implementation Steps
`Skill: nestjs-code test integration messaging <name> (CREATE)` / `(MODIFY)`:
1. `test/integration/messaging/support.ts` (или в `test/support/messaging.ts`): `cleanupRuns(metrics, table, result)` по образцу `idempotency/support.ts`; стенд `createCleanupStand({poolMax?})` — `outbox + subscriber {inbox}` и доступ к `app.get(MessagingCleanup)` (класс — токен провайдера, задача 29); до создания приложения стенд вызывает `await resetQueues()` (задача 21; так же — стенд `ac-9-5-messaging-observability.spec.ts`); до возврата стенд ждёт первый проход `await cleanup.idle()` (как E4 `createStand`, `test/integration/idempotency/support.ts:188`), сид и `countQueries` — только после этого.
2. `test/integration/messaging/ac-5-12-cleanup.spec.ts` — эквивалентность O `cleanup.int-spec`:
   - `AC-5.12: опубликованные outbox и inbox старше 7 дней удаляются, неопубликованные — никогда`. Сид под админом:
     - `evt_old` — `published_at = now() − 8 days`;
     - `evt_new` — 1 день;
     - `evt_pending` — не опубликован, `occurred_at` 30 дней;
     - inbox `m_old` 8 дней, `m_new`.
     После `cleanup.run()` остались `evt_new`, `evt_pending` и `m_new`. Метрики: `outbox ok +1`, `inbox ok +1`;
   - `AC-5.12: пачки по 1000, не больше 100 за проход — 2 пачки по 2 при maxBatches 2 и 5 строках → partial, удалено 4` (`run({batchSize: 2, maxBatches: 2})`; значения PRD — умолчания `run()`, проверены U-тестом констант задачи 17);
   - `AC-5.12: одна реплика за раз — пока блокировка занята (runExclusive того же ключа в тесте держит барьер), проход — другая реплика, метрика не меняется`;
   - `AC-5.12: DB_POOL_MAX = 1 — проход проходит на соединении блокировки` (`createCleanupStand({poolMax: 1})`, решение E4);
   - `AC-5.11: остановка во время прохода — текущая пачка дорабатывает, новая не начинается → interrupted`. Сигнал первой пачки — `countQueries(mainPool, …, {onQuery: (t) => { if (t.includes('delete from "kit"."outbox"')) { signal(); } }})` (задача 2) — только SQL очистки задачи 29: запросы relay (`claimBatch`, `statsLoop`) тоже содержат имя таблицы. Дополнительно `expect(queries.filter((t) => t.includes('delete from "kit"."outbox"'))).toHaveLength(1)`; без пауз;
   - `AC-9.5: ошибка БД таблицы outbox → result="error" outbox, inbox — ok` — подмена SQL outbox нельзя без вмешательства. Способ: `REVOKE DELETE ON kit.outbox FROM kit_app` в `try`, затем `GRANT` в `finally`. Проверяет и «ошибка одной таблицы не мешает другой».
3. `test/integration/messaging/ac-9-5-messaging-observability.spec.ts`:
   - `AC-9.5: relay, подписчик и очистка пишут метрики с меткой service и логи с полями service и replica`:
     1. стенд `outbox + subscriber {inbox}` с `providers: [TestConsumer]` (`test/support/messaging.ts`, задача 26) и перехватом логов как в E4 `test/integration/idempotency/ac-9-5-cleanup-observability.spec.ts`: `logger = pino({level: 'debug', base: {service: 'kit', replica: 'kit-1'}}, stream)` (поток `Writable` в массив) и `createMessagingApp({…, overrides: [{provide: KIT_LOGGER, useValue: logger}]})`;
     2. `add` → публикация → обработка → `cleanup.run()`;
     3. в реестре `metrics.registry.getSingleMetricAsString(…)`: `verdeect_outbox_pending{service="kit"}`, `verdeect_outbox_lag_seconds{service="kit"}`, `verdeect_events_consumed_total{service="kit",type="kit.note.created",result="handled"}`, `verdeect_cleanup_runs_total{service="kit",table="outbox"|"inbox"}`;
     4. в логах есть записи `outbox: пачка опубликована` (debug — уровень `LOG_LEVEL=debug` стенда), `messaging: доставка`, `очистка сообщений: проход` — у каждой `service = 'kit'` и `replica = 'kit-1'`.
4. `test/integration/testing/ac-4-8-strict-isolation.spec.ts` (`Skill: nestjs-code test integration testing strict-isolation (MODIFY)`):
   - `AC-4.8: outbox из createOutboxTable (схема kit) — проходит`. Существующий случай фикстуры теперь проверяет и outbox, явно — `violations` без `outbox`;
   - `AC-4.8: outbox с политикой tenantPolicy вместо исключения → нарушение «outbox: политика не по createOutboxTable»` — на `createScratchDatabase`: `DROP POLICY outbox_tenant_isolation; CREATE POLICY tenant_isolation … USING (tenant = current_setting('app.tenant', true))`;
   - `AC-4.8: outbox без FORCE → нарушение` (как у прочих таблиц);
   - `AC-4.8: outbox без политики → нарушение`.
   - `AC-4.8: outbox с политикой USING (true) (имя outbox_all) → нарушение «outbox: политика не по createOutboxTable»` — на `createScratchDatabase`: `DROP POLICY outbox_tenant_isolation ON kit.outbox; CREATE POLICY outbox_all ON kit.outbox USING (true) WITH CHECK (true)`; заменяет случай, удалённый задачей 7 (разрешающая политика не проходит исключение).

### Tests
Перечислены. `make test-integration FILTER='AC-5.12|AC-9.5|AC-4.8|AC-5.11'`.

### Acceptance Criteria
- AC-5.12, AC-9.5 (I) и AC-4.8 (outbox) зелёные; без реальных пауз.

### Verification
- `make test-integration`.

## Phase Risks and Mitigations
- Риск: `REVOKE` в тесте `error` влияет на параллельные файлы. Смягчение: `fileParallelism: false` в integration-конфиге; `GRANT` в `finally`.
- Риск: нормализация выражения политики хрупкая между версиями PostgreSQL. Смягчение: `TEST_IMAGES` фиксирует 17.11; эталон получен с той же версии.

## Phase Completion Checklist
- Задачи 29–31 выполнены; `make test-integration` зелёный; `test/package/ac-2-11-alert-rules.spec.ts` не изменился (число метрик 6).
- `index.md` обновлён.
