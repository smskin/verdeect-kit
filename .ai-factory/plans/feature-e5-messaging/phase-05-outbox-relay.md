# Phase 5: `OutboxStore.add` и relay

Plan: [index.md](index.md)
Tasks: 19-23
Depends on: Phase 2 (Tasks 4–7), Phase 4 (Tasks 14–18)

## Objective

UC-5 полностью:

- `OutboxStore.add(tx, Event, {subjectId, data})` пишет строку из кода, без SQL-триггеров (P0, §10 Platform/Identity). Проверяет `data` и признак `tenant` до записи. Берёт `tenant`, `actor`, `traceId` из `DbContext`. Будит relay через `afterCommit`.
- Relay публикует пачку ≤ 100 по `seq` с `FOR UPDATE SKIP LOCKED` и подтверждениями брокера. Срок пачки — 5 с; при неудаче — паузы 1 с → 5 мин; опрос раз в 1000 мс; без канала БД не опрашивается.
- Метрики — `verdeect_outbox_pending`, `verdeect_outbox_lag_seconds`.
- Остановка — в `beforeApplicationShutdown`.

Тесты — AC-5.1–AC-5.5, AC-5.15 (запись), AC-5.16 и эквивалентность O `outbox`, `outbox-atomicity`, `outbox-confirm`, I `ac-6-2-broker-outage`, `fr-72-outbox-seq`.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| O `outbox-store.ts` (154) | `add(tx, event)` — `id: 'evt_' \|\| new_ulid()`, поля от вызывающего; `claimBatch(tx, limit)` — `published_at is null order by seq limit n FOR UPDATE SKIP LOCKED`; `markPublished(tx, ids)`; `markFailed(tx, id, error)` — `attempts+1`, `last_error` ≤ 500; `stats(tx)` — `count(*)`, `min(occurred_at)` | эталон; по PRD `id = newId('evt')` в коде, поля из `DbContext` |
| O `outbox-relay.ts` (300) | `start`: канал `outbox-relay` confirm, `publishTimeout`; `onChannelReady` — сброс паузы и `wakeUp`; `iterate`: нет соединения/канала → пауза `null` (ждёт пробуждения), иначе `drain`; полная пачка → пауза 0, иначе опрос; ошибка публикации → `nextBackoff`; ошибка БД → `error` + Sentry + пауза; `drain` — одна `db.transaction(system)`: `claimBatch(100)`, по строке `publish` в пределах `startedAt + 5000`, первая неудача → `markFailed` + `reportFailure` и стоп; `markPublished`; `publish` — `channel.publish(EVENTS_EXCHANGE, row.type, Buffer(JSON(envelope)), {persistent, messageId: row.id, type, contentType: 'application/json', timestamp: floor(occurredAt/1000)})` против `setTimeout(reject('confirm deadline'))`; `reportFailure` — `warn` каждый раз, при `attempts === 5` — `error` + Sentry ровно раз; `wakeUp`/`sleep`; `stop` | эталон relay |
| P `outbox-relay.ts` (291) | `STOPPED` и `stopRequested`: `publish` гонится с остановкой — строка не помечается неудачной; `if (!running) break`; `beforeApplicationShutdown` — гонка `stop()` со `shutdownDeadline` | гонка со сроком (§3.4, AC-5.11) |
| O `outbox-metrics.ts`, I `outbox-metrics.ts` (70) | lag — возраст старейшей неопубликованной; I — `pending` | обе метрики есть в `kitMetrics` |
| `src/observability/metrics.ts` | `outboxPending`, `outboxLagSeconds` (Gauge без меток), `setDefaultLabels({service})` | метрики уже в реестре |
| `src/database/db.ts` | `Db.transaction`, `Db.afterCommit(tx, task)` | запись и пробуждение |
| `src/internal/tx-context.ts` (задача 4) | `txContextOf(tx)` | поля из `DbContext` |
| `src/internal/ids.ts` | `newId('evt')` | id строки |
| O `test/integration/messaging/outbox.int-spec.ts` (195), `integration/outbox/outbox-atomicity.int-spec.ts` (130), `timing/messaging/outbox-confirm.timing-spec.ts` (67); I `http/messaging/ac-6-2-broker-outage.http-spec.ts` (124), `integration/messaging/fr-72-outbox-seq.int-spec.ts` (77) | названия и проверки — см. задачи 22–23 | эквивалентность |
| `src/testing/tcp-proxy.ts` | `tcpProxy(target)`, `break`, `freeze`, `restore`, `url`; порт `amqp:` 5672 | обрывы брокера |
| `test/support/fake-sentry.ts` | `initFakeSentry` | «событие GlitchTip» |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/messaging/outbox-store.ts` | create | `OutboxStore` (`add`), внутренние запросы relay и очистки |
| `src/messaging/outbox-relay.ts` | create | `OutboxRelay` |
| `src/messaging/kit-messaging.module.ts` | modify | провайдеры `OutboxStore`, `OutboxRelay` при `outbox` |
| `src/messaging/index.ts` | modify | `export { OutboxStore }` |
| `test/integration/messaging/*.spec.ts` | create | I |
| `test/timing/messaging/*.spec.ts` | create | T |

## Task 19: `OutboxStore.add`

### Intent
§3.4 `OutboxStore.add` и UC-5 шаги 2–4, альтернативы А1, А2. Строки outbox пишет только код, триггеров нет (P0). Транзакция сервиса откатывается целиком, если `data` не по схеме или признак `tenant` нарушен (AC-5.1, AC-5.15).

### Implementation Steps
1. `src/messaging/outbox-store.ts` (`Skill: nestjs-code generic src/messaging/outbox-store.ts (CREATE)`). Шапка: «OutboxStore (prd.md §3.4, §6, UC-5, AC-5.1, AC-5.2, AC-5.15). Эталон O outbox-store.ts; по PRD — id = newId('evt') в коде, tenant/actor/traceId из DbContext (txContextOf), проверка data и признака tenant, afterCommit → relay.wake(); триггеров нет (P0)».
2. Класс `OutboxStore` (`@Injectable()` не нужен: провайдер — `useFactory`). Конструктор `(deps: {db: Db; table: KitOutboxTable; events: ReadonlyMap<string, KitEvent>; wake: () => void})` — внутренний. `Db` — `import type`.
3. Публичный метод:
   ```ts
   async add<E extends KitEvent>(tx: DbTx, event: E, input: { readonly subjectId: string; readonly data: z.input<E['data']> }): Promise<string>
   ```
   Порядок (каждая ошибка — исключение до `INSERT`; сервис не ловит её, транзакция откатывается):
   1. `events.get(event.type) !== event` (определение не из `outbox.events` модуля, в том числе другой объект с тем же `type`) → `TypeError('OutboxStore.add: событие <type> не объявлено в KitMessagingModule.forRoot({outbox: {events}})')`. Нужно для AC-5.13: покрытие считается по списку.
   2. `ctx = txContextOf(tx)`; `undefined` → `TypeError('OutboxStore.add: tx — не транзакция Db.transaction')`. Транзакция `Db.read` (read-only) связана с контекстом (задача 4) и здесь проходит; её отклоняет `db.afterCommit` в п. 6 — до `INSERT`, иначе PostgreSQL отказал бы раньше с 25006.
   3. Признак tenant: `event.tenant === 'required' && (ctx.tenant === null || ctx.tenant === '')` → `TypeError('OutboxStore.add: событие <type> требует компанию (tenant: 'required'), в DbContext тенанта нет')`. `event.tenant === 'none' && ctx.tenant` непустой → `TypeError('… событие <type> без компании (tenant: 'none'), а в DbContext тенант задан')`.
   4. `subjectId` — непустая строка, иначе `TypeError`.
   5. `parsed = event.data.safeParse(input.data)`; неуспех → `TypeError(\`OutboxStore.add: data события ${type} не по схеме: ${paths}\`)`, где `paths` — `issues.map(i => i.path.join('.') || '(root)')` без значений (NFR-4).
   6. `db.afterCommit(tx, () => wake())` — **до** `INSERT`. На read-only транзакции это `AfterCommitInReadOnlyError` (E4, `src/database/db.ts:216-219`) — исключение и откат. Регистрация до записи безопасна: если `INSERT` потом упадёт, `Db.run` удаляет задачи транзакции (`afterCommitTasks.delete(current)` в `catch`).
   7. `id = newId('evt')`; `INSERT` через Drizzle `tx.insert(table).values({id, tenant: event.tenant === 'none' ? null : ctx.tenant, type, version, subjectId, actor: ctx.actor, traceId: ctx.traceId, data: parsed.data})`. `occurred_at` — по умолчанию БД. RLS `WITH CHECK` пропускает строку своего тенанта.
   8. `debug` `{type, id}` `'outbox: строка добавлена'`. `return id`.
4. Внутренние методы для relay — на `DbTx`, построителем запросов Drizzle по объекту таблицы `t` (имена схемы и таблицы рендерит Drizzle; литералов схемы нет — AC-9.4). Идентификаторы **никогда** не подставляются как `${string}` в шаблон `sql` (станут параметром, ошибка 42601); в сырых фрагментах — объект таблицы `${t}` или `sql.raw(quoteIdentifier(…))`. Импорты — `and`, `eq`, `inArray`, `isNull`, `sql` из `drizzle-orm`:
   - `claimBatch(tx, limit)` → `tx.select({id: t.id, type: t.type, version: t.version, tenant: t.tenant, subjectId: t.subjectId, actor: t.actor, traceId: t.traceId, data: t.data, occurredAt: t.occurredAt, attempts: t.attempts}).from(t).where(isNull(t.publishedAt)).orderBy(t.seq).limit(limit).for('update', {skipLocked: true})`. Построитель даёт ключи camelCase и `occurredAt: Date` (`mode: 'date'`); сырой `tx.execute` вернул бы `occurred_at` строкой (drizzle-orm 0.45.4 `node-postgres/session.js`, rawQueryConfig), и relay упал бы на `row.occurredAt.getTime()`;
   - `markPublished(tx, ids)` → `tx.update(t).set({publishedAt: sql\`now()\`}).where(inArray(t.id, ids))` — не `any(${ids})`: массив в шаблоне `sql` раскрывается в `($1, $2, …)`;
   - `markFailed(tx, id, error: string)` → `tx.update(t).set({attempts: sql\`${t.attempts} + 1\`, lastError: sql\`left(${error}, 500)\`}).where(and(eq(t.id, id), isNull(t.publishedAt))).returning({attempts: t.attempts})` → `rows[0]?.attempts`;
   - `stats(tx)` → `tx.execute(sql\`select count(*)::int as pending, coalesce(extract(epoch from now() - min(${t.occurredAt}))::float8, 0) as lag from ${t} where ${t.publishedAt} is null\`)`, строки — `result.rows`; при отсутствии строк `lag` = 0.
5. `src/messaging/index.ts` (`Skill: nestjs-code generic src/messaging/index.ts (MODIFY)`): `export { OutboxStore } from './outbox-store.js';`.
6. Провайдеры модуля — в задаче 20, шаг 11: фабрика `OutboxRelay` создаёт `OutboxStore` (с `wake: () => relay.wake()`), провайдер `OutboxStore` = `useFactory: (relay) => relay.store`, `inject: [OutboxRelay]`; `OutboxStore` — в `exports`. В этой задаче модуль не меняется.

### Required Interfaces and Contracts
- Публичный экспорт — только класс и метод `add`. `claimBatch` и остальные — `@internal` в TSDoc. Их видно в `.d.ts`, поэтому имена методов начинаются с `/** @internal */`; проверить, что `api-extractor` не используется. Сейчас не используется, отметки достаточно.
- `data` в строке — результат `parse` (умолчания zod применены).

### Requirement Evidence
| Событие | `DbContext.tenant` | Таблица | Результат | Тест |
|---|---|---|---|---|
| `'required'` | `'acme'` | любая | строка `tenant = 'acme'` | AC-5.2 |
| `'required'` | `null` | любая | `TypeError`, откат | AC-5.15 |
| `'none'` | `null` | `tenantNullable: true` | строка `tenant = null` | AC-5.15 |
| `'none'` | `'acme'` | любая | `TypeError`, откат | AC-5.15 |
| `'none'` | — | `tenantNullable: false` | отказ `forRoot` (задача 16) | AC-5.15 U |
| любое | — | `data` не по схеме | `TypeError`, откат, строки домена нет | AC-5.1 |

### Error Handling and Logging
- `TypeError` с текстами выше, без значений `data`.
- `debug` на добавлении.

### Tests
Задача 22.

### Acceptance Criteria
- Строка пишется только при соблюдённых проверках; иначе транзакция сервиса откатывается.

### Verification
- `make test-integration FILTER='AC-5.(1|2|15)'` (после задачи 22).

## Task 20: `OutboxRelay`

### Intent
§3.4 «relay», UC-5 шаг 5, А3–А6, AC-5.3–5.5, AC-5.16, AC-9.5. Перенос O с гонкой остановки P.

### Implementation Steps
1. `src/messaging/outbox-relay.ts` (`Skill: nestjs-code generic src/messaging/outbox-relay.ts (CREATE)`). Шапка: «OutboxRelay (prd.md §3.4 relay, UC-5, AC-5.3–5.5, AC-5.16, AC-9.5). Эталон O outbox-relay.ts; из P — гонка publish/остановки (STOPPED) и beforeApplicationShutdown против shutdownDeadline; по PRD — опрос 1000 мс (O — 200), метрики verdeect_outbox_*».
2. Конструктор (внутренний): `{db: Db; store: OutboxStore; connection: RabbitConnection; events: ReadonlyMap<string, KitEvent>; metrics?: KitMetrics; logger; timers?: RelayTimers}`.
   - `RelayTimers {now(): number; sleep(ms: number, signal: AbortSignal, kind: 'pause' | 'confirm' | 'stats'): Promise<void>}` — внутренний; пауза цикла (шаг 4.3) передаёт `'pause'`, гонка подтверждения в `publish` (шаг 6) — `'confirm'`, `statsLoop` (шаг 9) — `'stats'`; по умолчанию `Date.now` и `setTimeout` из `node:timers/promises` с `signal` и `ref: false`. Подмена нужна тесту AC-5.16 («часы подменяются», правило Test Speed): тест подставляет управляемые таймеры, реальных пауз нет.
3. Жизненный цикл: `OutboxRelay` — `@Injectable`-совместимый класс с хуками `onApplicationBootstrap` и `beforeApplicationShutdown`. Провайдер — `useFactory`; Nest вызывает хуки у объектов из фабрик.
   - `onApplicationBootstrap()`:
     1. `channel = connection.createChannel({name: 'outbox-relay', confirm: true, publishTimeout: PUBLISH_CONFIRM_TIMEOUT_MS})`;
     2. `connection.onChannelReady('outbox-relay', () => { this.backoffMs = 0; this.wake(); })`;
     3. запуск цикла `loop` (не ожидается) и таймера метрик: `statsLoop` каждые `RELAY_POLL_MS` независимо от состояния канала — так `lag` растёт и при недоступном брокере (AC-5.4), П10.
   - `wake()` — флаг `wakeRequested` и прерывание текущего `sleep` (`AbortController`).
4. Цикл (`iterate`, порядок как O):
   1. `!connection.isConnected() || !connection.isChannelReady('outbox-relay')` → ждать пробуждения без таймера (`sleep(Infinity)` до `wake`). Без соединения БД не опрашивается (§3.4).
   2. `drain()` в `try`:
      - ошибка БД → `error` `'outbox: ошибка БД relay'` + `captureThrottled('outbox-relay:db', err)`, пауза `nextBackoff()`;
      - иначе: публикация не удалась → пауза `nextBackoff()`; пачка полная (100) → пауза 0; иначе `RELAY_POLL_MS`, а `backoffMs` сбрасывается.
   3. `sleep(pause)` — прерывается `wake()` и остановкой. `wakeRequested` проверяется до сна: пробуждение во время `drain` не теряется (AC-5.3 «< 100 мс без ожидания опроса»).
5. `drain()` — одна `db.transaction({tenant: null, traceId: ulid(), actor: {channel: 'system'}}, async (tx) => …)`. Пустой тенант видит все строки по исключению outbox:
   1. `rows = store.claimBatch(tx, RELAY_BATCH_SIZE)`;
   2. `deadline = now() + RELAY_BATCH_DEADLINE_MS`;
   3. по порядку: `if (!running) break`; `remaining = deadline − now()`; `remaining ≤ 0` → `warn` `'outbox: срок пачки вышел'` `{published, left}` и `break` (строка не помечается неудачной);
   4. `result = await Promise.race([publish(row, remaining), stopRequested])`; `STOPPED` → `break` без `markFailed`;
   5. ошибка публикации → `attempts = store.markFailed(tx, row.id, sanitizeError(err).message)`; `reportFailure(row, attempts, err)`; `failed = true`; `break` — первая неудача прерывает пачку и сохраняет порядок (§3.4);
   6. `store.markPublished(tx, publishedIds)` если не пусто;
   7. `debug` `{published, claimed}` `'outbox: пачка опубликована'` при `published > 0`.
6. `publish(row, timeoutMs)`:
   - `envelope = buildEnvelope({…row, subjectKind: events.get(row.type)?.subject})`. Если тип не в реестре модуля (строка от старой версии сервиса) → `subjectKind = 'unknown'` и `warn` один раз на тип. Это решение П23: строка всё равно публикуется;
   - `channel.publish(EVENTS_EXCHANGE, row.type, Buffer.from(JSON.stringify(envelope)), {persistent: true, messageId: row.id, type: row.type, contentType: 'application/json', timestamp: Math.floor(row.occurredAt.getTime() / 1000)})` с гонкой против `timers.sleep(timeoutMs)` → `Error('confirm deadline')`. Подтверждение — Promise `ManagedChannel.publish` (confirm-канал).
7. `reportFailure(row, attempts, err)`:
   - всегда `warn` `{id, type, attempts, err: sanitizeError(err)}` `'outbox: публикация не удалась'`;
   - при `attempts === RELAY_ALERT_ATTEMPTS` (ровно раз на строку) — `error` `{id, type, attempts}` `'outbox: строка не опубликована 5 раз'` и `captureError(new Error('outbox: строка не опубликована 5 раз'), {tags: {code: 'OUTBOX_PUBLISH_FAILED'}, extra: {id, type, attempts}})`. **Без `data`** (AC-5.16).
8. `nextBackoff()`: `backoffMs = backoffMs === 0 ? RELAY_BACKOFF_MIN_MS : min(backoffMs × 2, RELAY_BACKOFF_MAX_MS)` → 1, 2, 4, 8 … 256, 300 с.
9. `statsLoop`: каждые `RELAY_POLL_MS` `db.transaction(system, tx => store.stats(tx))` → `metrics?.outboxPending.set(pending)`, `metrics?.outboxLagSeconds.set(lag)`. Ошибка → `warn` `'outbox: метрики не обновлены'` один раз подряд, значения прежние (O). Останавливается вместе с relay. Решение П10: опрос раз в секунду — один лёгкий запрос по частичному индексу.
10. `beforeApplicationShutdown()` (шаг 3), по P:
    ```ts
    this.running = false; this.requestStop(); this.wake();
    const stopped = await Promise.race([this.loop.then(() => true), this.connection.shutdownDeadline()]);
    if (!stopped) { logger.warn('outbox: срок остановки relay вышел, идём дальше'); }
    this.statsAbort.abort(); await this.channel?.close();
    ```
    Текущая транзакция пачки дорабатывает: `markPublished` для опубликованных до остановки. Неопубликованные остаются без `attempts + 1`.
11. Модуль (`Skill: nestjs-code module messaging KitMessaging (MODIFY)`): при `outbox` — провайдер `OutboxRelay` (`useFactory`, `inject: [database.Db, KIT_RABBIT_CONNECTION, KIT_MESSAGING_OPTIONS, {token: KIT_METRICS, optional: true}, {token: KIT_LOGGER, optional: true}]` — без `OutboxStore`, иначе цикл). Цикл зависимостей `OutboxStore` ↔ `OutboxRelay` (`wake`) развязать так: relay не зависит от store-провайдера, а создаёт свой `OutboxStore` внутренних запросов, либо store получает `wake` через `ModuleRef`. Решение — **один объект**: фабрика `OutboxRelay` строит `OutboxStore` сама, а провайдер `OutboxStore` — `useFactory: (relay) => relay.store`, `inject: [OutboxRelay]`.

### Required Interfaces and Contracts
- `OutboxRelay` не экспортируется (§3.4 его не перечисляет).
- Публикация идёт только через relay. Модуль не даёт API «опубликовать мимо outbox» (ARCHITECTURE anti-pattern).

### Error Handling and Logging
- `debug` — пачка, сон;
- `warn` — неудача публикации, срок пачки, метрики, неизвестный тип, срок остановки;
- `error` + GlitchTip — 5 неудач строки (ровно раз), ошибка БД (`captureThrottled`).
- Поля `service`, `replica` — из логгера приложения (AC-9.5). `data` в логи не попадает.

### Tests
Задачи 22–23.

### Acceptance Criteria
- Строка, добавленная через `OutboxStore.add`, публикуется после `COMMIT` без ожидания опроса.

### Verification
- Задачи 22–23.

## Task 21: Поддержка тестов outbox

### Intent
Общие помощники тестов фаз 5–8: стенд с outbox, перехват публикаций, ожидание без фиксированных пауз.

### Implementation Steps
1. `test/support/messaging.ts` (`Skill: nestjs-code generic test/support/messaging.ts (MODIFY)`):
   - события фикстуры:
     - `TestNoteCreated = defineEvent({type: 'kit.note.created', version: 1, subject: 'note', data: z.object({noteId: z.string(), title: z.string().min(1)})})`;
     - `TestAccountTouched = defineEvent({type: 'kit.account.touched', version: 1, subject: 'account', tenant: 'none', data: z.object({accountId: z.string()})})`.
     Литералы `kit.*` допустимы: AC-9.4 проверяет только `src/**` и сервисы `identity|platform|orchestrator|bff|files|media`;
   - `createOutboxApp({env?, events = [TestNoteCreated, TestAccountTouched]})` → `createMessagingApp({options: {outbox: {table: fixtures.outbox, events}}})`;
   - `waitFor(check: () => Promise<boolean>, {timeoutMs, what})` — опрос через `setImmediate`/событийный цикл с шагом 10 мс до срока × `TEST_TIMEOUT_SCALE`. Это ожидание внешнего процесса (брокер), а не пауза теста. Ошибка срока называет `what`;
   - `outboxRows()` — `adminQuery('select … from kit.outbox order by seq')`;
   - `resetQueues()` — удаляет очереди `kit`, `kit.retry`, `kit.dlq` vhost воркера (вместе с их привязками к `verdeect.events` и сообщениями) через `BrokerClient.connect()` (администратор vhost, задача 12) → `deleteQueue`; «очереди нет» (404) — успех. Зачем: vhost воркера живёт весь прогон (задача 11), очереди durable, а `bindQueue` накапливается — привязки и сообщения предыдущих файлов (например, 200 `kit.note.created` из `ac-5-5-two-relays.spec.ts` в очереди, привязанной стендом подписчика другого файла) ломали бы точные счётчики и проверки «очередь пуста» следующих файлов. Вызывает каждый файл, создающий стенд с `subscriber` (задачи 26–28, 31, 34), **до** создания стенда в том же хуке (`beforeAll` для стенда на файл, `beforeEach` — на тест); никогда при живом стенде файла.
2. `test/support/broker.ts`: `capture('kit.#')` уже есть (задача 12).

### Error Handling and Logging
Нет.

### Tests
Используется задачами 22–23, 26–28, 31, 34.

### Acceptance Criteria
- Помощники без `setTimeout`-пауз фиксированной длины в тестах.

### Verification
- `make lint`.

## Task 22: Тесты I — AC-5.1, AC-5.2, AC-5.5, AC-5.15 (запись), эквивалентность O и I

### Implementation Steps
`Skill: nestjs-code test integration messaging <name> (CREATE)`, файлы в `test/integration/messaging/`. Каждый файл — `beforeEach(truncateFixtures)` (`test/support/database.ts`, с задачи 7 очищает `kit.outbox` и `kit.inbox`): строки других файлов ломали бы точные счётчики (`captured.length === 1`, `200`):
1. `ac-5-1-outbox-atomicity.spec.ts` — обобщение O `outbox-atomicity` (сбой записи outbox → изменения домена нет):
   - `AC-5.1: data не по схеме — TypeError, строки kit.note и kit.outbox нет` — `db.transaction(ctx('acme'), tx => { insert note; await store.add(tx, TestNoteCreated, {subjectId, data: {noteId: 'n', title: ''}}) })` → reject; `select count(*) from kit.note` = 0;
   - `AC-5.1: успех — note и строка outbox видны после COMMIT вместе`;
   - `AC-5.1: откат после add — ни note, ни строки` (O «откат — нет ни изменения, ни строки»);
   - `AC-5.1: текст ошибки называет путь title, без значения`;
   - `§3.4: OutboxStore.add в транзакции Db.read → AfterCommitInReadOnlyError, строки outbox нет` (задача 19, п. 3.6).
2. `ac-5-2-outbox-row.spec.ts`:
   - `AC-5.2: строка содержит tenant, actor, traceId из DbContext и id evt_ + ULID` — `ctx = {tenant: 'acme', traceId: 'trace-1', actor: {accountId: 'acc', channel: 'http'}}`;
   - `AC-5.2: конверт relay совпадает с 01 §7.1 — EnvelopeSchema.parse(body), routing key = type, messageId = id, type, persistent, contentType, timestamp` — `BrokerClient.capture('kit.#')`, `waitFor(captured.length === 1)`, затем полная проверка тела `toEqual` по 9 полям (O «relay публикует с routing key = type…»), `published_at` проставлен;
   - `O outbox: add строки чужого tenant под app.tenant=acme → ошибка политики` — прямой `INSERT` строки `tenant = 'other'` под `ctx('acme')` через `tx.execute` → ошибка RLS `WITH CHECK` (42501).
3. `ac-5-5-two-relays.spec.ts`:
   - `AC-5.5: две реплики relay — каждая строка публикуется один раз (SKIP LOCKED)`:
     1. два приложения `createOutboxApp()` (`REPLICA_ID` `kit-1`, `kit-2`) на одном vhost;
     2. 200 строк вставляются в одну транзакцию одного приложения;
     3. `capture` до 200 сообщений;
     4. `messageId` уникальны, число = 200, у всех строк `published_at`.
   Оба приложения закрываются в `afterAll`.
4. `ac-5-15-outbox-tenant.spec.ts`:
   - `AC-5.15: 'required' без тенанта в DbContext — TypeError, строки домена нет`;
   - `AC-5.15: 'none' с тенантом — TypeError, откат`;
   - `AC-5.15: 'none' без тенанта при tenantNullable: true — строка tenant = null, конверт tenant: null`.
5. `outbox-order.spec.ts` — эквивалентность I `fr-72-outbox-seq`, O `outbox` «порядок по seq»:
   - `FR-72 (I): seq монотонен внутри и между транзакциями`;
   - `O outbox: порядок публикации — по seq после разрыва соединения`:
     1. стенд с `RABBITMQ_URL` через `tcpProxy(workerScope().rabbitmq.url)`;
     2. `proxy.break()`, ожидание `!isConnected()` по сигналу (`waitFor`);
     3. три `add` в разных транзакциях;
     4. `proxy.restore()`;
     5. `capture` → `messageId` в порядке `seq`.
   - `O outbox: verdeect_outbox_lag_seconds > 0 при неопубликованной строке и 0 после публикации; verdeect_outbox_pending` — метрики из `KIT_METRICS` (`metrics.outboxLagSeconds.get()`).
6. `vitest.integration.config.ts`: файлы этой задачи `initFakeSentry` не используют и остаются в `shared`.

### Tests
Перечислены. Команда `make test-integration FILTER='AC-5.(1|2|5|15)|FR-72|O outbox'`.

### Acceptance Criteria
- AC-5.1, AC-5.2, AC-5.5 и запись AC-5.15 зелёные.

### Verification
- `make test-integration`.

## Task 23: Тесты T — AC-5.3, AC-5.4, AC-5.16, O `outbox-confirm`

### Intent
Уровень T по PRD. Реальные паузы допустимы только там, где проверяется поведение настоящего драйвера: недоступность брокера 10 с по AC-5.4, срок подтверждения 5 с. AC-5.16 — на подменённых часах.

### Implementation Steps
`Skill: nestjs-code test timing messaging <name> (CREATE)`, файлы в `test/timing/messaging/`; каждый файл — `beforeEach(truncateFixtures)`, `ac-5-16-relay-backoff.spec.ts` — ещё и `afterAll(truncateFixtures)` (его строка не публикуется никогда); стек — `test/timing/global-setup.ts` (задача 11):
1. `ac-5-3-publish-latency.spec.ts`:
   - `AC-5.3: публикация < 100 мс после COMMIT без ожидания опроса` — `t0` сразу после `await db.transaction(...)`, время прихода в `capture` < 100 мс × `TEST_TIMEOUT_SCALE`. Повторить 5 раз, проверить медиану: исключает прогрев;
   - `AC-5.3: строка, вставленная другим процессом (adminQuery INSERT без afterCommit), — не позже 1000 мс + пачка` — предел 1000 мс + 500 мс × scale.
2. `ac-5-4-broker-outage.spec.ts` — эквивалентность I `ac-6-2-broker-outage`, O `outbox-confirm`:
   - `AC-5.4: брокер недоступен 10 с — события копятся, verdeect_outbox_lag_seconds растёт, после восстановления опубликованы по seq без потерь и повторов`:
     1. `tcpProxy`, `proxy.break()`;
     2. 3 `add` с паузой между ними на событийном цикле;
     3. реальное ожидание 10 с (PRD фиксирует длительность) через `timers/promises` `setTimeout`;
     4. в это время `lag` растёт (два замера), `pending = 3`, `capture` пуст;
     5. `proxy.restore()`;
     6. `waitFor(captured.length === 3)`, `messageId` по `seq`, повторов нет;
     7. `lag` → 0, `pending` → 0.
3. `ac-5-16-relay-backoff.spec.ts`:
   - `AC-5.16: строка, не опубликованная 5 раз подряд, — error-лог и событие GlitchTip с id и type, без data; паузы 1 → 2 → 4 → 8 → 16 с … до 300 с`:
     1. `OutboxRelay` строится напрямую: `Db` из `createTestDb`, `OutboxStore`, `RabbitConnection`-заглушка `{isConnected: () => true, isChannelReady: () => true, createChannel: () => fakeChannel, onChannelReady, shutdownDeadline}`; `fakeChannel.publish` всегда отклоняет;
     2. `RelayTimers` — управляемые: `sleep(ms, signal, kind)` с `kind === 'pause'` записывает `ms` в массив и резолвится по `tick()` теста; `'confirm'` не резолвится никогда (заглушка `publish` отклоняет сама), `'stats'` резолвится только по `signal` abort (иначе `statsLoop` крутил бы `db.transaction` в цикле);
     3. одна строка outbox вставляется **до** `onApplicationBootstrap()` relay (`adminQuery` INSERT): первый `drain` берёт её сразу, лишней паузы опроса `RELAY_POLL_MS` в массиве нет;
     4. после 9 неудач: паузы (`kind === 'pause'`) `[1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000]` и `attempts = 9`;
     5. ещё один `tick()` → 10-я неудача: 10-я пауза 300000, `attempts = 10`;
     6. GlitchTip — ровно одно событие (`initFakeSentry`) с `extra {id, type, attempts: 5}`, без поля `data`; в `error`-логе тех же полей нет `data` (перехват логгера `pino` в поток-массив).
   Реальных пауз нет. В `vitest.timing.config.ts` один проект без `isolate: false`: файлы изолированы по умолчанию, `initFakeSentry` не протекает.
4. `outbox-confirm.spec.ts` — эквивалентность O `outbox-confirm.timing-spec`:
   - `O outbox-confirm: брокер не подтверждает — транзакция пачки закрыта за ≤ 5 с, строки повторятся` (как O):
     1. `proxy.freeze()`;
     2. `add`;
     3. опрос `attempts > 0` под админом — видно только после `COMMIT` транзакции пачки: `publish` гонится с `timers.sleep(remaining)` → `Error('confirm deadline')` → `markFailed` (задача 20, шаги 5.5 и 6);
     4. прошло < 5000 мс + 1000 мс × scale, `published_at is null`, `last_error` содержит `confirm deadline`.

### Tests
Перечислены. Команда `make test-timing FILTER='AC-5.(3|4|16)|outbox-confirm'`.

### Acceptance Criteria
- Тесты T зелёные; AC-5.16 без реальных пауз.

### Verification
- `make test-timing`.

## Phase Risks and Mitigations
- Риск: `Promise.race` с `stopRequested` оставляет неподтверждённую публикацию, которая потом подтвердится, а строка не помечена — повтор после рестарта. Смягчение: это ожидаемое «не больше одного раза по смыслу» с inbox у получателя (UC-6), как у P. Записать в TSDoc relay.
- Риск: статистика каждую секунду под нагрузкой. Смягчение: запрос идёт по частичному индексу `published_at is null`. Если замер покажет проблему — `ponytail:`-комментарий о переходе на `collect` при скрейпе.

## Phase Completion Checklist
- Задачи 19–23 выполнены; `make test-integration`, `make test-timing` зелёные.
- `index.md` обновлён.
