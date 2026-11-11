# Phase 6: Подписчик, inbox, retry/DLQ, очередь реплики

Plan: [index.md](index.md)
Tasks: 24-28
Depends on: Phase 4 (Tasks 14–18), Phase 5 (Task 21)

## Objective

UC-6 полностью: `subscriber.on(Event, (event, tx) => …)` и `subscriber.onReplica(Event, handler)`.

Подписчик объявляет топологию очередей:

- `<svc>` (durable, DLX → `<svc>.retry`);
- `<svc>.retry` (TTL `RABBITMQ_RETRY_SECONDS` → `<svc>`; другой TTL — отказ запуска без цикла переподключений);
- `<svc>.dlq`.

Обработка сообщения:

- 5 повторов по `x-death`, `prefetch` 10;
- inbox занимается в транзакции обработчика: повтор `id` → `duplicate`;
- сразу в DLQ с `x-dlq-reason` уходят: не JSON, неверный конверт, неподписанный тип, `data` не по схеме, `InvalidMessageError`, признак `tenant`;
- `ExpectedMessageError` → `warn` и повтор;
- `dedupe: 'none'` работает без БД.

Метрика — `verdeect_events_consumed_total{type, result}`. Остановка: снять потребителей → дождаться доставок → закрыть канал (O). Тесты — AC-5.6–5.11, 5.15, 5.17, 5.19 и эквивалентность O `subscriber`, `inbox-guard`, `topology`, `or-119-rabbit-permissions`, P `channel-restore`.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| O `rabbit-subscriber.ts` (400) | `register(type, handler)` (повтор → ошибка); `onApplicationBootstrap` → канал `orchestrator-subscriber` confirm, `setup = setupQueues(ch, types)`, `consume(queue, track)`; `track` — при `stopping` не подтверждает, иначе `inFlight`; `handle`: `delivery = retryCount + 1` → `parse` (not json / envelope) → тип по `envelope.type` (не routing key) → обработчик → устаревшая доставка (`!isCurrent`) — пропуск → `ack`; ошибки: `InvalidMessageError` → DLQ; `ExpectedMessageError` → `decideRedelivery`: retry (`nack(false,false)`) / DLQ c `code`; прочее → retry / DLQ `retries exhausted` + Sentry; `toDlq` — `sendToQueue(dlq, content, {persistent, messageId, type, contentType, headers: {...headers, [DLQ_REASON_HEADER]: reason}})` → `ack` только после подтверждения копии, сбой копии → `nack` → retry; `beforeApplicationShutdown` — `stopping`, `cancelConsumers`, `allSettled(inFlight)`, `close`, гонка с `shutdownDeadline` | эталон |
| O `topology` в `setupQueues` | `assertQueue(main, {durable, deadLetterExchange: '', deadLetterRoutingKey: retry})`, `assertQueue(retry, {durable, messageTtl, deadLetterExchange: '', deadLetterRoutingKey: main})`, `assertQueue(dlq, {durable})`, `prefetch(10, false)` через `await` (acm 5.0.1 не ждёт опцию `consume`), `bindQueue(main, EVENTS_EXCHANGE, type)` на каждый тип | эталон топологии |
| O `inbox-guard.ts` (43) | `claim(tx, id, type)` — `insert … on conflict do nothing returning`; параллельный claim того же id ждёт первую транзакцию | эталон inbox |
| O `delivery-result.ts`, `consumed-handler.ts` | `DeliveryResult {Handled, Duplicate, Retry, Dlq}` | результаты = метки метрики |
| B `rabbit-subscriber.ts:285`, `bff-metrics.ts:123` | `bff_events_consumed_total{type,result}` | эталон метрики |
| P `modules/authz/consumers/policy-changed.consumer.ts` (183) | канал `authz-replica` confirm: false, `assertQueue(q, {exclusive, autoDelete, durable: false})`, `bindQueue`, `consume(q, handle, {noAck: true})`; без inbox, DLQ, retry; ошибка обработчика — `error` + Sentry; закрытие — гонка со сроком | эталон `onReplica` |
| B `test/timing/rabbitmq-permissions.timing-spec.ts:277`, P `integration/messaging/channel-setup.int-spec.ts:152` | 406 PRECONDITION_FAILED при другом TTL / аргументах очереди | AC-5.19 |
| O `test/integration/messaging/subscriber.int-spec.ts` (224), `inbox-guard.int-spec.ts` (74), `topology.int-spec.ts` (152), `or-119-rabbit-permissions.int-spec.ts` (226) | названия — задачи 26–27 | эквивалентность |
| P `test/timing/messaging/channel-restore.timing-spec.ts` (213), `test/support/channel-harness.ts` | удаление exchange → канал закрыт брокером → `/health` down ≤ 2 с → замена канала без разрыва соединения | эквивалентность AC-5.11 / восстановления |
| `src/observability/metrics.ts` | `eventsConsumed` `Counter<'type' \| 'result'>` | метрика уже есть |
| `src/observability/sentry.ts` | `captureError`, `captureThrottled` | GlitchTip |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/messaging/inbox.ts` | create | `claimInbox`, запрос очистки inbox |
| `src/messaging/subscriber.ts` | create | `KitSubscriber` (`on`, `onReplica`), обработка, DLQ, retry, остановка, топология, проверка TTL |
| `src/messaging/kit-messaging.module.ts` | modify | провайдер `KitSubscriber` при `subscriber` |
| `src/messaging/index.ts` | modify | `KitSubscriber`, тип `KitEventHandler` |
| `test/integration/messaging/*.spec.ts`, `test/timing/messaging/*.spec.ts` | create | I, T |
| `test/support/messaging.ts` | modify | `TestConsumer` (режимы, счётчик, барьер) |
| `vitest.integration.config.ts`, `docs/testing.md` | modify | `ISOLATED` (файлы с `initFakeSentry`) |

## Task 24: inbox

### Intent
§3.4 «inbox занимается в той же транзакции до обработчика, повтор `id` → `duplicate` без вызова»; §6 `inbox`.

### Implementation Steps
1. `src/messaging/inbox.ts` (`Skill: nestjs-code generic src/messaging/inbox.ts (CREATE)`). Шапка: эталон O `inbox-guard.ts`.
   - `claimInbox(tx: DbTx, table: KitInboxTable, id: string, type: string): Promise<boolean>` — `tx.insert(table).values({id, type}).onConflictDoNothing().returning({id: table.id})` → `rows.length > 0`;
   - `inboxCleanupSql(table, batchSize): SQL` и `outboxCleanupSql(table, batchSize): SQL` для очистки (задача 29) — здесь или в `cleanup.ts`. Решение: в `cleanup.ts`, так файл inbox остаётся маленьким.
2. Параллельная доставка того же `id` (две реплики): второй `INSERT` ждёт первую транзакцию; после её `COMMIT` — `false` (O). Поведение СУБД, отдельного кода не нужно.

### Required Interfaces and Contracts
Внутреннее.

### Error Handling and Logging
Нет.

### Tests
Задача 26 (`O inbox-guard`).

### Acceptance Criteria
- `claimInbox` возвращает `false` для уже занятого `id`.

### Verification
- Задача 26.

## Task 25: `KitSubscriber`

### Intent
§3.4 `subscriber.on`, `subscriber.onReplica`; UC-6; AC-5.6–5.9, 5.11, 5.15, 5.17, 5.19; AC-9.5. Решения: П6 (обработчик `(event, tx)`, `tx = null` при `dedupe: 'none'`), П7 (значения `x-dlq-reason`), П8 (отказ запуска при другом TTL).

### Implementation Steps
1. `src/messaging/subscriber.ts` (`Skill: nestjs-code generic src/messaging/subscriber.ts (CREATE)`). Шапка: «KitSubscriber (prd.md §3.4, UC-6, AC-5.6–5.9, 5.11, 5.15, 5.17, 5.19, AC-9.5). Эталон O rabbit-subscriber.ts, topology (setupQueues), inbox-guard; из P — очередь реплики (policy-changed.consumer), метрика *_events_consumed_total; из B — retryCount(headers, queue). По PRD: x-dlq-reason, inbox в транзакции подписчика, проверка data и признака tenant, dedupe 'none', отказ запуска при другом TTL .retry».
2. Типы (экспорт):
   ```ts
   export type KitEventHandler<E extends KitEvent> = (event: Envelope<E>, tx: DbTx | null) => Promise<void>;
   export type KitReplicaHandler<E extends KitEvent> = (event: Envelope<E>) => Promise<void>;
   ```
   TSDoc `KitEventHandler`: «`tx` — транзакция `Db` с `DbContext` события (`tenant` конверта, `traceId` конверта или `id`, `actor: {channel: 'system'}`). inbox уже занят в ней, изменения обработчика и отметка inbox фиксируются одним `COMMIT`. При `dedupe: 'none'` `tx = null`: БД нет (роль BFF), обработчик сам идемпотентен. Порядок по `occurredAt` — `ifNewer` из `/database` (UC-6 шаг 4)». `DbTx` — `import type`.
3. Класс `KitSubscriber` (экспорт). Конструктор внутренний: `{service, replica, dedupe, inbox?: KitInboxTable, db?: Db, connection, retrySeconds, metrics?, logger}`.
   - `on<E extends KitEvent>(event: E, handler: KitEventHandler<E>): void`. Повтор `type` → `TypeError('KitSubscriber.on: обработчик <type> уже зарегистрирован')`. После `onApplicationBootstrap` → `TypeError('KitSubscriber.on: регистрация — до запуска приложения (onModuleInit)')`;
   - `onReplica<E>(event: E, handler: KitReplicaHandler<E>): void` — те же правила, свой реестр.
   TSDoc класса: сервис внедряет `KitSubscriber` и регистрирует обработчики в `onModuleInit` своего провайдера.
4. `onApplicationBootstrap()`:
   1. `connection` уже запущено (`MessagingLifecycle.onModuleInit`).
   2. Основной канал `subscriber`: `createChannel({name: 'subscriber', confirm: true, setup: (ch) => this.setupQueues(ch)})`. `setupQueues`:
      - `assertQueue(q.main, {durable: true, deadLetterExchange: '', deadLetterRoutingKey: q.retry})`;
      - `assertQueue(q.retry, {durable: true, messageTtl: retrySeconds × 1000, deadLetterExchange: '', deadLetterRoutingKey: q.main})` в `try`. Ошибка с `code === 406` (PRECONDITION_FAILED) и текстом про `x-message-ttl` → `throw new MessagingStartupError('MESSAGING_RETRY_TTL_MISMATCH', \`очередь ${q.retry} объявлена с другим TTL — пересоздайте очередь\`, {queue: q.retry})` (текст PRD дословно). `RabbitConnection` помечает канал `fatal` (задача 14, п. 3.6) и не повторяет его;
      - `assertQueue(q.dlq, {durable: true})`;
      - `await ch.prefetch(CONSUMER_PREFETCH, false)` (O: через `await`);
      - `bindQueue(q.main, EVENTS_EXCHANGE, type)` на каждый тип `on`.
      Очереди объявляются всегда, даже без обработчиков (O). `consume(q.main, (msg) => this.track(msg))` — только при наличии обработчиков.
   3. Канал реплики `subscriber-replica` — только при наличии `onReplica`: `confirm: false`, `setup`: `assertQueue(replicaQueueOf(service, replica), {exclusive: true, autoDelete: true, durable: false})`, `bindQueue` на типы, `consume(q, (msg) => this.trackReplica(msg), {noAck: true})`.
   4. **Отказ запуска при другом TTL (П8)**: `await connection.firstAttempt()`. При `'connected'` — ждать первого исхода настройки канала `subscriber`: `ready` | `fatal` | ошибка стадии. Это `connection.channelOutcome('subscriber')` — первый исход после старта, добавить в `RabbitConnection` (задача 14). Исход `fatal` с `MessagingStartupError` → `throw error`: `onApplicationBootstrap` отклоняется, `bootstrapService` вызывает `failStartup` до `listen`. Цикла переподключений нет: канал `fatal`. При `'failed'` (брокер недоступен при старте) или другой ошибке стадии — запуск продолжается (`/health` rabbitmq down, повтор раз в `RABBITMQ_RETRY_SECONDS`, как O). Если TTL не совпадёт после переподключения позже — `error` + `captureError` один раз и канал `fatal` (повторов нет, `/health` down).
   5. Срок ожидания первого исхода ограничен `retrySeconds × 1000` (heartbeat и TCP-таймауты acm): время старта не может расти неограниченно.
5. `track(msg)`: при `stopping` — `debug` и без подтверждения (сообщение вернётся брокеру при закрытии канала); иначе `inFlight.add(handle(msg))`.
6. `handle(msg)` — основной поток (порядок фиксирован; `result` ∈ `handled|duplicate|retry|dlq` → `metrics?.eventsConsumed.inc({type, result})`, `type` — `envelope.type` или `'unknown'`):
   1. `delivery = retryCount(msg.properties.headers, q.main) + 1`.
   2. `parsed = parseEnvelope(msg.content)`; `not-json` → `toDlq('not-json')`; `envelope` → `toDlq('envelope', {fields})`.
   3. `event = handlers.get(envelope.type)`; нет → `toDlq('unsubscribed')`. Тип — по `envelope.type`, не по routing key: после retry routing key — имя очереди.
   4. `tenantViolation(event, envelope)` → `toDlq('tenant')` (AC-5.15).
   5. `data = event.data.safeParse(envelope.data)`; неуспех → `toDlq('data', {fields: paths})`.
   6. Вызов:
      - `dedupe === 'inbox'`: `await db.transaction({tenant: envelope.tenant, traceId: envelope.traceId ?? envelope.id, actor: {channel: 'system'}}, async (tx) => { if (!(await claimInbox(tx, inbox, envelope.id, envelope.type))) { duplicate = true; return; } await handler(typedEnvelope, tx); })`;
      - `dedupe === 'none'`: `await handler(typedEnvelope, null)`.
      `typedEnvelope` — конверт с разобранными `data`.
   7. Устаревшая доставка (`!channel.isCurrent(msg)`) после обработчика → `debug`, без ack/nack/логов (O).
   8. Успех → `channel.ack(msg)`; `result = duplicate ? 'duplicate' : 'handled'`. `debug` `{id, type, delivery, result}` `'messaging: доставка'`.
   9. Ошибка:
      - `InvalidMessageError` → `toDlq(error.reason)`;
      - `ExpectedMessageError` → `decideRedelivery(headers, q.main) === 'dlq'` ? `toDlq(error.code, {report: false})` : `warn` `{id, type, code, delivery}` `'messaging: ожидаемый отказ, повтор'` + `toRetry()`;
      - прочее → `dlq` ? `toDlq('retries-exhausted', {report: true, error})` : `warn` `{id, type, delivery, err: sanitizeError}` `'messaging: ошибка обработчика, повтор'` + `toRetry()`.
7. `toRetry()`: `channel.nack(msg, false, false)` → dead-letter в `.retry`, возврат через TTL. `result = 'retry'`.
8. `toDlq(reason, {report = true, fields?, error?})`:
   1. Устаревшая доставка → выход.
   2. `report`:
      - `error`-лог `{id?, type?, reason, fields?, delivery}` `'messaging: сообщение в DLQ'`;
      - для непредвиденной ошибки (`retries-exhausted`) — `captureError(error, {tags: {code: 'MESSAGE_DEAD_LETTERED'}, extra: {id, type, reason}})` (ровно раз на сообщение);
      - для причин разбора (`not-json`, `envelope`, `unsubscribed`, `tenant`, `data`, причина `InvalidMessageError`) — `captureThrottled(\`messaging-dlq:${type}:${reasonClass}\`, new Error(\`messaging: сообщение в DLQ (${reason})\`))`, где `reasonClass` — `reason` без суффикса после `:`.
      Без `report` — `warn`.
   3. `await channel.sendToQueue(q.dlq, msg.content, {persistent: true, messageId: msg.properties.messageId, type: msg.properties.type, contentType: msg.properties.contentType, headers: {...msg.properties.headers, [DLQ_REASON_HEADER]: reason}})` → `channel.ack(msg)` только после подтверждения копии. Сбой копии → `nack(msg, false, false)` и `result = 'retry'`.
   4. `result = 'dlq'`.
9. Значения `x-dlq-reason` (П7): `not-json`, `envelope`, `unsubscribed`, `tenant` (PRD дословно), `data`, `InvalidMessageError.reason`, `ExpectedMessageError.code`, `retries-exhausted`. Значения `data` и ПДн в заголовок не попадают: в `envelope`/`data` — только сама причина, пути полей — только в лог.
10. `trackReplica(msg)` (P, `noAck`): `parseEnvelope` → тип → `tenantViolation` → `data` → `handler(env)`. Любая неудача — `warn` (разбор) или `error` + `captureError` (обработчик), без повторов и DLQ. Метрика `eventsConsumed{type, result: 'handled' | 'dlq'}`: неразобранное на реплике считается `dlq`. Это решение П24; отдельного значения метки нет, а `dlq` ближе всего («не обработано, повтора не будет»). Записать в TSDoc `onReplica`.
11. `beforeApplicationShutdown()` (шаг 3), O:
    ```ts
    this.stopping = true;
    const steps = (async () => { await main?.cancelConsumers(); await replica?.cancelConsumers();
        await Promise.allSettled([...this.inFlight]); await main?.close(); await replica?.close(); return true; })()
        .catch((err) => { warn(err); return true; });
    if (!(await Promise.race([steps, connection.shutdownDeadline()]))) { warn('messaging: срок остановки подписчика вышел, идём дальше'); }
    ```
    `warn` на каждом этапе (O): «потребители сняты», «доставки завершены». Очередь реплики удаляется брокером при закрытии канала (exclusive, auto-delete, AC-5.9).
12. Модуль (`Skill: nestjs-code module messaging KitMessaging (MODIFY)`): при `subscriber` — провайдер `KitSubscriber` (`useFactory`, `inject: [KIT_MESSAGING_OPTIONS, KIT_RABBIT_CONNECTION, ConfigService, …(dedupe 'inbox' ? [database.Db] : []), {token: KIT_METRICS, optional: true}, {token: KIT_LOGGER, optional: true}]`), в `exports`. `src/messaging/index.ts` (`Skill: nestjs-code generic src/messaging/index.ts (MODIFY)`): `export { KitSubscriber }`, `export type { KitEventHandler, KitReplicaHandler }`.

### Required Interfaces and Contracts
- §3.4: `subscriber.on(Event, (event, tx) => …)`, `subscriber.onReplica(Event, handler)` — объект `KitSubscriber`.
- Порядок шагов UC-6 — в коде в том же порядке с комментариями номеров (`rules/base.md` «Поток управления»).

### Requirement Evidence
| Входящее | `dedupe` | Итог | `x-dlq-reason` | Метрика `result` | GlitchTip | Тест |
|---|---|---|---|---|---|---|
| новое, обработчик ок | inbox | `ack`, inbox занят | — | handled | — | AC-5.6 (база) |
| повтор `id` | inbox | `ack`, обработчик не вызван | — | duplicate | — | AC-5.6 |
| новое, ок | none | `ack`, `tx = null` | — | handled | — | AC-5.8 |
| не JSON | любое | DLQ | not-json | dlq | throttled | AC-5.7 |
| неверный конверт | любое | DLQ | envelope | dlq | throttled | AC-5.7 |
| неподписанный тип | любое | DLQ | unsubscribed | dlq | throttled | AC-5.7 |
| `'required'` + `tenant: null` | любое | DLQ | tenant | dlq | throttled | AC-5.15 |
| `data` не по схеме | любое | DLQ | data | dlq | throttled | §3.4 UC-6 шаг 2 |
| `InvalidMessageError(r)` | любое | DLQ | r | dlq | throttled | AC-5.7 |
| `ExpectedMessageError(C)`, доставка < 6 | любое | `.retry` | — | retry | — | AC-5.7 |
| `ExpectedMessageError(C)`, 5 повторов | любое | DLQ | C | dlq | — (warn) | AC-5.7 |
| ошибка, < 6 | любое | `.retry` | — | retry | — | O subscriber |
| ошибка, 5 повторов | любое | DLQ | retries-exhausted | dlq | 1 | O subscriber |
| реплика, ок | — | без ack (noAck) | — | handled | — | AC-5.9 |

### Error Handling and Logging
- `debug` — доставка, пропуск устаревшей;
- `warn` — ожидаемый отказ, повтор, этапы остановки, срок остановки;
- `error` — DLQ (кроме ожидаемых), ошибка обработчика реплики, TTL после переподключения.
- Поля `service`, `replica` — из логгера приложения.

### Tests
Задачи 26–28.

### Acceptance Criteria
- Поведение по таблице сочетаний.

### Verification
- Задачи 26–28.

## Task 26: Тесты I — AC-5.6–5.9, 5.15, 5.17, 5.19, эквивалентность O

### Implementation Steps
`Skill: nestjs-code test integration messaging <name> (CREATE)`, `test/integration/messaging/`. Стенд — `createMessagingApp({options: {subscriber: {inbox: fixtures.inbox}}, providers: [TestConsumer]})`. `TestConsumer` регистрирует в `onModuleInit` `TestNoteCreated` (`'required'`) и `TestAccountTouched` (`'none'`, задача 21 — нужен случаю AC-5.15 «'none' с тенантом»: проверка `unsubscribed` идёт раньше `tenant`), режимы задаёт поле `data.title`: `ok`, `invalid`, `expected`, `fail`, `block`. `TestConsumer` определяется и экспортируется в `test/support/messaging.ts` (`Skill: nestjs-code generic test/support/messaging.ts (MODIFY)`; файл задач 18, 21): `@Injectable`, внедряет `KitSubscriber`, регистрирует оба события в `onModuleInit`, отдаёт счётчик вызовов по типу и управляемый барьер (Promise) для `block`. Новой фабрики стенда нет — `createMessagingApp({options, providers: [TestConsumer]})`; его же используют задачи 27, 28 (timing), 31, 34. Публикация — `BrokerClient.publishRaw` / `sendToQueue` (до задачи 33; `publishTestEvent` перепроверит в задаче 34). Каждый файл этой задачи до создания своего стенда вызывает `await resetQueues()` (задача 21) в том же хуке, что создаёт стенд: иначе привязки `kit` и сообщения `kit`/`kit.dlq` предыдущих файлов воркера (у `ac-5-9` — «у очереди `kit` нет привязок», `kit.dlq` пуста; у `ac-5-6`, `ac-5-17` — точные счётчики) зависят от порядка файлов.
1. `ac-5-6-inbox-duplicate.spec.ts`:
   - `AC-5.6: повтор сообщения с тем же id → duplicate, обработчик не вызван, verdeect_events_consumed_total{result="duplicate"} +1`. Одно сообщение публикуется дважды с одним `id`. Обработчик вызван 1 раз, строка `kit.inbox` одна, метрика `handled` +1 и `duplicate` +1. Ожидание — по метрике (`waitFor`).
   - `O inbox-guard: первый claim → true, повтор → false; откат первого claim — повтор → true; параллельный claim того же id ждёт первую транзакцию`. Прямые вызовы `claimInbox` на `createTestDb`; барьер — Promise, без пауз.
2. `ac-5-7-dlq-retry.spec.ts` (`initFakeSentry` → в `ISOLATED` с причиной «initFakeSentry: Sentry — глобальное состояние процесса»):
   - `AC-5.7: не JSON → kit.dlq, x-dlq-reason not-json`;
   - `AC-5.7: неверный конверт (без id) → envelope`;
   - `AC-5.7: неподписанный тип → unsubscribed`;
   - `AC-5.7: InvalidMessageError → причина из reason`;
   - `AC-5.7: ExpectedMessageError → повтор через .retry (RABBITMQ_RETRY_SECONDS=1), warn, без GlitchTip` — одна реальная задержка TTL 1 с (поведение брокера). Ожидание второй доставки — по счётчику вызовов обработчика;
   - `AC-5.7: ExpectedMessageError после 5 повторов → DLQ с причиной = код, без GlitchTip` — исчерпание моделируется заголовком `x-death [{queue: 'kit', reason: 'rejected', count: 5}]` при `sendToQueue('kit', …)` (эталон O, без 5 реальных TTL);
   - `O subscriber: непредвиденная ошибка первой доставки → retry, без GlitchTip`;
   - `O subscriber: непредвиденная после исчерпания → DLQ retries-exhausted, GlitchTip ровно один раз`;
   - `§3.4: data не по схеме → DLQ data, путь поля в логе, значения нет`.
   Сообщение DLQ читается `BrokerClient.take('kit.dlq')`, причина — `properties.headers['x-dlq-reason']`. Очереди очищаются в `beforeEach` (`purge`).
3. `ac-5-8-dedupe-none.spec.ts`:
   - `AC-5.8: dedupe 'none' — подписчик работает без БД, tx = null; модуль собран без KitDatabaseModule`. Стенд без `KitDatabaseModule`. Модуль не требует `pg`: это доказывает U-тест AC-1.2 (задача 17). Здесь — что `Db` не нужен в DI.
4. `ac-5-9-replica-queue.spec.ts`. `TestConsumer` регистрирует только `on`, а канал реплики создаётся лишь при `onReplica` (задача 25, шаг 4.3). Поэтому в `test/support/messaging.ts` — отдельный провайдер `ReplicaConsumer` (`@Injectable`, внедряет `KitSubscriber`, в `onModuleInit` регистрирует только `subscriber.onReplica(TestNoteCreated, handler)`; режимы по `data.title` — `ok`, `fail`; счётчик вызовов, как у `TestConsumer`). Стенд — `createMessagingApp({options: {subscriber: {dedupe: 'none'}}, providers: [ReplicaConsumer]})`: обработчиков `on` нет, у очереди `kit` нет привязок (задача 25, шаг 4.2), и событие не уходит в `kit` → `kit.retry` → `kit.dlq`. Публикация — `BrokerClient.publishRaw('kit.note.created', …)`:
   - `AC-5.9: onReplica — очередь kit.replica.<REPLICA_ID> exclusive, auto-delete, не durable; событие доходит до обработчика`. Свойства очереди — `admin.queue(vhost, name)` (`admin = rabbitAdminFromProvided(inject('kitRabbitmqManagementUrl'), inject('kitRabbitmqUrl'))`, задача 11): `exclusive === true`, `autoDelete === true`, `durable === false`;
   - `AC-5.9: очередь удаляется при остановке реплики` — после `app.close()` `queue(...) === null`;
   - `AC-5.9: без inbox и DLQ — ошибка обработчика не создаёт сообщений в kit.dlq` — `title: 'fail'`; после того как счётчик вызовов `ReplicaConsumer` дошёл до 1 (сигнал, без паузы): `admin.queue(vhost, 'kit.dlq').messages === 0` и `admin.queue(vhost, 'kit').messages === 0`.
5. `ac-5-15-subscriber-tenant.spec.ts`:
   - `AC-5.15: подписчик получает 'required' с tenant: null — DLQ, x-dlq-reason: tenant, обработчик не вызван`;
   - `AC-5.15: 'none' с тенантом — DLQ tenant`.
6. `ac-5-17-prefetch.spec.ts`:
   - `AC-5.17: prefetch 10 — при 20 сообщениях и блокирующем обработчике одновременно не больше 10 неподтверждённых`:
     1. обработчик `block` ждёт общий Promise-барьер;
     2. публикуется 20 сообщений;
     3. ожидание 10 вызовов (`waitFor`);
     4. `admin.queue(vhost, 'kit')` (тот же `rabbitAdminFromProvided`) → `messagesUnacknowledged === 10`, `messagesReady === 10` (сигнал — опрос management API, без паузы);
     5. снять барьер → обработаны все 20.
7. `ac-5-19-retry-ttl.spec.ts`:
   - `AC-5.19: kit.retry объявлена с другим TTL — запуск отклонён MessagingStartupError «очередь kit.retry объявлена с другим TTL — пересоздайте очередь», без цикла переподключений`:
     1. `await resetQueues()`, затем админ объявляет `kit.retry` с `x-message-ttl: 99000` и тем же DLX (порядок важен: `resetQueues` после объявления удалил бы подготовленную очередь);
     2. `createMessagingApp(...)` → reject с этим текстом и `startupCode`;
     3. логгер подменён `overrides: [{provide: KIT_LOGGER, useValue: logger}]` (поток в массив, задача 18). Проверки: отказ приходит за `RABBITMQ_RETRY_SECONDS × 1000 + 1000 × TEST_TIMEOUT_SCALE` мс; в логе не больше одной строки сбоя стадии настройки канала `subscriber` (одна попытка, повтора нет); после неё нет записей `rabbitmq: попытка не удалась` и повторной настройки. `error`-строка не требуется: при старте подписчик бросает `MessagingStartupError`, `error` пишется только при несовпадении после переподключения (задача 25);
     4. `finally` — удалить очередь (следующие тесты объявят её с TTL 1 с).
   Отказ через `bootstrapService` (`failStartup`, выход 1) покрыт общим механизмом E3 (`abortOnError: false`). Дополнительно — случай в потребителе не нужен: проверка бы удвоилась.
8. `topology.spec.ts` — эквивалентность O `topology.int-spec`:
   - `O topology: старт объявляет kit (DLX → kit.retry), kit.retry (TTL RABBITMQ_RETRY_SECONDS × 1000 → kit), kit.dlq` — повторное объявление админом с теми же аргументами проходит;
   - `O topology: привязки — только для зарегистрированных типов` — событие третьего, незарегистрированного типа `kit.other.created` отброшено exchange, `kit` и `kit.dlq` пусты.
9. `vitest.integration.config.ts` (`Skill: none — конфиг Vitest`) и `docs/testing.md` (`Skill: none — документация`) «Проекты интеграционного конфига»: `ac-5-7-dlq-retry.spec.ts` в `ISOLATED` с причиной.

### Tests
Перечислены. `make test-integration FILTER='AC-5.(6|7|8|9|15|17|19)|O (inbox|subscriber|topology)'`.

### Acceptance Criteria
- Все случаи зелёные; реальная пауза — только TTL 1 с одного случая AC-5.7.

### Verification
- `make test-integration`.

## Task 27: I AC-5.10 — права `definitions.json`

### Intent
AC-5.10 и UC-12 А1, обобщение O `or-119-rabbit-permissions`: с правами из CLI операции relay и подписчика проходят, объявление и чтение чужой очереди — `ACCESS_REFUSED`, exchange сервис не объявляет.

### Implementation Steps
1. `test/integration/messaging/ac-5-10-permissions.spec.ts` (`Skill: nestjs-code test integration messaging permissions (CREATE)`):
   - vhost воркера уже создан из `buildDefinitions` (права M3 пользователя воркера для сервиса `kit`). Это тот же путь, что CLI: задача 13 доказала, что CLI даёт тот же JSON;
   - до создания стенда — `await resetQueues()` (задача 21);
   - `AC-5.10: с правами definitions relay публикует в verdeect.events, подписчик получает и подтверждает` — стенд `outbox + subscriber {inbox}` с `providers: [TestConsumer]` (задача 26) на `workerScope().rabbitmq.url`; `add` → обработчик вызван → строка inbox;
   - `AC-5.10: сбой обработчика → kit.retry (dead-letter через exchange по умолчанию), InvalidMessageError → копия в kit.dlq` — права `amq.default`;
   - `AC-5.10: объявление чужой очереди %s → ACCESS_REFUSED` (`it.each(['platform', 'platform.retry', 'identity'])`) — отдельное соединение пользователем воркера, `assertQueue`, код 403;
   - `AC-5.10: чтение чужой очереди → ACCESS_REFUSED` — админ создаёт `platform` в vhost воркера, пользователь — `consume('platform')` → 403;
   - `AC-5.10: exchange виден пассивной проверкой` — `checkExchange('verdeect.events')` пользователем воркера проходит. Отсутствие `assertExchange` в коде проверяет U-случай задачи 17.
   - `AC-5.10: своя очередь kit.dlq читается пользователем` (`checkQueue`).
   Брокер и права — общие vhost воркера, свой контейнер не нужен (у O — свой контейнер и `rabbitmqctl`).

### Tests
Перечислены.

### Acceptance Criteria
- AC-5.10 полностью покрыт (вместе с задачей 13).

### Verification
- `make test-integration FILTER='AC-5.10'`.

## Task 28: Тесты T — AC-5.11, P `channel-restore`

### Implementation Steps
`Skill: nestjs-code test timing messaging <name> (CREATE)`, `test/timing/messaging/`. Каждый стенд с `subscriber` создаётся после `await resetQueues()` (задача 21) в том же хуке:
1. `ac-5-11-shutdown.spec.ts` — эквивалентность O `subscriber` (остановка), P `channel-restore`:
   - `AC-5.11: остановка — подписчик снимает потребителей и дожидается начатой доставки, relay дорабатывает пачку, очистка не начинает новую — в общем сроке`. Стенд `outbox + subscriber {inbox}` с `providers: [TestConsumer]` (`test/support/messaging.ts`, задача 26), `SHUTDOWN_TIMEOUT_MS = 10000`:
     1. обработчик держит барьер;
     2. публикация события → обработчик начат (сигнал);
     3. `app.close()` запускается;
     4. проверка по сигналам: `consumerCount('kit') === 0` до снятия барьера;
     5. снять барьер;
     6. `close` завершён, сообщение подтверждено (`kit` пуст, строка inbox есть);
     7. весь `close` < 10 000 мс × scale.
     Очистка (фаза 7) — третий участник: случай «проход очистки не начинается после остановки» — задача 31 (`AC-4.11`-подобный, на сигнале `onQuery`).
   - `AC-5.11: обработчик дольше срока — подписчик идёт дальше после shutdownDeadline, close в общем сроке` — отдельный стенд `subscriber: {dedupe: 'none'}` без `KitDatabaseModule`: на стенде с inbox зависший обработчик держит клиент основного пула в `db.transaction`, и `main.end()` шага 4 не завершится. `SHUTDOWN_TIMEOUT_MS = 4000` → срок обработчиков 1000 мс (П9); обработчик ждёт барьер, который тест снимает в `finally` после проверок; `close` < 4000 мс × scale; `warn` «срок остановки подписчика вышел».
   - `AC-5.11: relay — остановка во время неподтверждённой публикации: транзакция пачки зафиксирована, строка без attempts + 1 и last_error, close в общем сроке` (задача 20, шаги 5.4 и 10 — гонка `STOPPED` P). Стенд `createOutboxApp` с `RABBITMQ_URL` через `tcpProxy(workerScope().rabbitmq.url)` (как `outbox-order.spec.ts`, задача 22), `SHUTDOWN_TIMEOUT_MS = 10000`:
     1. `waitFor(() => app.get(KIT_RABBIT_CONNECTION).isChannelReady('outbox-relay'))`;
     2. `proxy.freeze()` — подтверждения брокера не приходят;
     3. сигнал начала пачки (задача 2) — взводится только после `add`:
        ```ts
        let armed = false;
        let signal!: () => void;
        const firstClaim = new Promise<void>((resolve) => { signal = resolve; });
        const { queries } = await countQueries(mainPoolOf(app.get(Db)), async () => {
            await add(...);
            armed = true;
            await firstClaim;
            // захват вернулся, relay ушёл в publish на замороженный прокси
            await waitFor(async () => (await adminQuery(
                "select 1 from pg_stat_activity where state = 'idle in transaction' and query ilike '%for update skip locked%' and query not ilike '%delete%'",
            )).length > 0, { timeoutMs: 5000, what: 'relay: пачка захвачена, публикация не подтверждена' });
            await app.close();
        }, { onQuery: (t) => { if (armed && t.includes('for update skip locked') && !t.includes('delete')) { signal(); } } });
        expect(queries.filter((t) => t.includes('for update skip locked') && !t.includes('delete')).length).toBeGreaterThan(0);
        ```
        Почему так: relay опрашивает `claimBatch` раз в `RELAY_POLL_MS` и на пустой таблице (задача 20, шаг 4.2), а SQL очистки (задача 29, шаг 2; `MessagingCleanup` есть при `outbox`) тоже содержит `for update skip locked`. Без взвода и фильтра `delete` сигнал мог прийти до строки, и `close` начинался бы до захвата — проверки шага 4 прошли бы на незахваченной строке. Взвод после `add` гарантирует: следующий захват (READ COMMITTED, после `COMMIT` и пробуждения `afterCommit`) видит строку. `onQuery` срабатывает **до отправки** запроса (задача 2): если сразу вызвать `app.close()`, `running = false` (задача 20, шаг 10) может наступить раньше ответа `claimBatch`, и пачка выйдет по `if (!running) break` (шаг 5.3) без публикации — гонка `STOPPED` (шаг 5.4) не проверяется. Поэтому `close` ждёт, пока соединение relay станет `idle in transaction` с захватом последним запросом: между ответом `claimBatch` и `channel.publish` только синхронный код, значит публикация уже начата и не подтверждена. Сигнал — `pg_stat_activity` (запрос админа сам `active` и фильтром не ловится); `select … for update skip locked/nowait` админом как сигнал не годится — он сам заблокировал бы строку, и relay её пропустил бы;
     4. `close` < 10 000 мс × scale; строка: `published_at is null`, `attempts = 0`, `last_error is null` (под админом, `outboxRows()`);
     5. `proxy.restore()` в `finally`.
2. `channel-restore.spec.ts` — эквивалентность P `channel-restore.timing-spec`:
   - `P channel-restore: брокер закрыл канал relay (404 при публикации в удалённый exchange) → /health down ≤ 2 с; после объявления exchange канал заменён, строка опубликована без разрыва соединения`. Сигналы:
     1. удаление exchange;
     2. `add`;
     3. опрос `HealthRegistry.evaluate()` до `rabbitmq: down` ≤ 2000 мс × scale;
     4. `declareEventsExchange()`;
     5. `waitFor` публикации;
     6. число `disconnect` соединения = 0 — счётчик через внутренний доступ к `RabbitConnection` (`app.get(KIT_RABBIT_CONNECTION)` — токен экспортировать для тестов из внутреннего модуля, не из `index.ts`).
   - `P channel-restore: канал relay не готов (нет exchange) → outbox не опрашивается, attempts не растут, lag растёт; после объявления exchange все строки опубликованы за ≤ 2 × RABBITMQ_RETRY_SECONDS` — шпион `claimBatch` (через `vi.spyOn` экземпляра `relay.store`, не прототипа) = 0 вызовов за окно.

### Tests
Перечислены.

### Acceptance Criteria
- AC-5.11 зелёный в общем сроке.

### Verification
- `make test-timing`.

## Phase Risks and Mitigations
- Риск: amqplib 2.2.0 закрывает канал при 406 и бросает ошибку асинхронно (событие `error` канала), а `assertQueue` отклоняется с `IllegalOperationError`. Смягчение: классификация по `code === 406` на первой ошибке канала; `RabbitConnection` хранит последнюю ошибку канала (`closedByBroker` O) и передаёт её в `channelOutcome`.
- Риск: `prefetch` применяется к каналу, а acm пересоздаёт канал при переподключении. Смягчение: `prefetch` — в `setup`, он повторяется на каждом (пере)подключении (O).

## Phase Completion Checklist
- Задачи 24–28 выполнены; `make test-integration`, `make test-timing` зелёные.
- `index.md` обновлён.
