# Phase 4: Соединение RabbitMQ, топология, `KitMessagingModule.forRoot`, подпуть `./messaging`

Plan: [index.md](index.md)
Tasks: 14-18
Depends on: Phase 2 (Tasks 4–6), Phase 3 (Tasks 9, 11, 12)

## Objective

Переносится `RabbitConnection`/`ManagedChannel` по эталону O (`topologyReady`, `shutdownDeadline`, `markOpened/isCurrent`, `cancelConsumers`). Exchange `verdeect.events` проверяется пассивно. Добавляются константы топологии и `retryCount` (B — очередь параметром).

`KitMessagingModule.forRoot({service, outbox?: {table, events}, subscriber?: {dedupe?, inbox?}})` (решение П1 — ответ пользователя на вопрос 1) проверяет:

- имя сервиса (AC-5.20);
- `pg` при outbox или inbox (AC-1.2);
- согласованность таблиц;
- события `'none'` при NOT NULL `tenant` — отказ запуска (AC-5.15).

Затем модуль собирает соединение, пробу `/health` и шаг 4 остановки. Relay, подписчик и очистка подключаются к модулю в фазах 5–7. Подпуть `./messaging` появляется в `exports`.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| O `src/shared/messaging/rabbit-connection.ts` (551) | `ChannelOptions {name, confirm, publishTimeout?, setup?}`, `brokerEndpoint(url)`, `ManagedChannel` (`markOpened`, `isCurrent`, `ack`/`nack` пропускают устаревшие, `publish`, `sendToQueue`, `consume` запоминает потребителей, `cancelConsumers`, `close` с `CHANNEL_CLOSE_TIMEOUT_MS`, `replace`), `RabbitConnection` (`start` ленивый: `connect([url], {heartbeatIntervalInSeconds: 10, reconnectTimeInSeconds: retrySeconds})`, события `connect`/`disconnect`/`connectFailed`/`error`, `isConnected`, `topologyReady`, `isChannelReady`, `onChannelReady`, `shutdownDeadline`, `createChannel`, `onApplicationShutdown` с `CONNECTION_CLOSE_TIMEOUT_MS`), `openWrapper`: `markOpened` → `channel.on('error')` (`closedByBroker`) → стадии `exchange` (`checkExchange`) / `setup` / `ready` через `runStage`; `scheduleRetry` один unref-таймер; GlitchTip один раз на канал | эталон переноса |
| P `rabbit-connection.ts` (538) | то же без `cancelConsumers` и флага `stopped` | O полнее |
| O `topology.ts` (64) | константы: `HEARTBEAT_SECONDS=10`, `CHANNEL_CLOSE_TIMEOUT_MS=2000`, `CONNECTION_CLOSE_TIMEOUT_MS=1000`, `CONSUMER_PREFETCH=10`, `MAX_RETRIES=5`, `SHUTDOWN_HANDLERS_TIMEOUT_MS=8000` | константы пакета |
| O `redelivery.ts` (30), B `redelivery.ts` (38) | `retryCount(headers)` / B `retryCount(headers, queue)` — `x-death` с `queue` и `reason === 'rejected'`; `decideRedelivery` | эталон + опция B |
| O `messaging.module.ts` (76) | `register({entry})` global; проба `health.register('rabbitmq', false, …)` — некритичная; `onModuleInit` | регистрация |
| `src/idempotency/kit-idempotency.module.ts:202-…` | `forRoot({table})` — схема из `getTableConfig(table).schema`, `assertServiceName`, `global: true`, внутренние токены | образец forRoot |
| `src/database/kit-database.module.ts:127` | `databaseEnv()` — `ConfigService.getOrThrow`, понятная ошибка без `KitConfigModule` | чтение окружения |
| `src/http/kit-http-core.module.ts` | экспортирует `KitLifecycle`, `HealthRegistry`, `KIT_METRICS`, `KIT_LOGGER` (global) | DI модуля |
| `src/observability/health-registry.ts:38` | `register(name, probe, {critical})` | проба |
| `src/internal/peer.ts` | `requirePeer`, `loadPeer` | `pg` в `forRoot`, `amqp-connection-manager` в `start` |
| `src/http/bootstrap-service.ts:77-…` | отказ инициализации модулей → `failStartup` (`abortOnError: false`) | AC-5.15, AC-5.19, AC-5.20 — отказ запуска |
| `test/unit/http/ac-3-10-*.spec.ts` | текст отказа `bootstrapService: имя сервиса «…» вне формата …` | AC-5.20 — «тот же текст» |
| `test/unit/package/package-manifest.spec.ts:53`, `test/package/ac-1-1-package.spec.ts:78, ~133` | точный список `exports`, подпути dist, `DATABASE_ENTRIES` | `./messaging` |
| `test/unit/idempotency/ac-1-2-idempotency-peer.spec.ts` | граф импортов, первый импорт `./peer.js`, без TLA | образец AC-1.2 |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/messaging/topology.ts` | create | имена очередей, константы, сроки |
| `src/messaging/redelivery.ts` | create | `retryCount(headers, queue)`, `decideRedelivery` |
| `src/messaging/rabbit-connection.ts` | create | `RabbitConnection`, `ManagedChannel` |
| `src/messaging/kit-messaging.module.ts` | create | `KitMessagingModule.forRoot`, проверки, соединение, проба |
| `src/messaging/index.ts` | create | публичная поверхность §3.4 (растёт в фазах 5–7) |
| `package.json` | modify | `exports["./messaging"]` |
| `test/unit/package/package-manifest.spec.ts`, `test/package/ac-1-1-package.spec.ts` | modify | `./messaging` |
| `test/unit/messaging/*.spec.ts` | create | U AC-5.20, AC-1.2, AC-5.15 (forRoot), redelivery, topology |
| `test/support/messaging.ts` | create | `createMessagingApp` |
| `test/integration/messaging/connection.spec.ts` | create | I: пассивная проверка exchange, проба |

## Task 14: `RabbitConnection` и `ManagedChannel`

### Intent
§3.4 «соединение (основа — O `RabbitConnection`/`ManagedChannel`)». Relay и подписчик работают через один экземпляр. Exchange проверяется пассивно: его владелец — `definitions.json`.

### Implementation Steps
Шаги 1–2 — содержимое файлов задачи 15 (выполняется до этой); шаг 3 — сама задача 14.
1. `src/messaging/topology.ts` (задача 15). Шапка: эталон O `topology.ts`; имена — от `service`, `x-dlq-reason` (PRD) вместо `x-<svc>-dlq-reason`.
   ```ts
   export { EVENTS_EXCHANGE } from '../internal/rabbitmq-definitions.js';
   export const DLQ_REASON_HEADER = 'x-dlq-reason';
   export const CONSUMER_PREFETCH = 10;          // §3.4
   export const MAX_RETRIES = 5;                 // §3.4 «5 повторов по x-death»
   export const HEARTBEAT_SECONDS = 10;
   export const CHANNEL_CLOSE_TIMEOUT_MS = 2_000;
   export const CONNECTION_CLOSE_TIMEOUT_MS = 1_000;
   export const RELAY_BATCH_SIZE = 100, RELAY_BATCH_DEADLINE_MS = 5_000, RELAY_POLL_MS = 1_000;
   export const RELAY_BACKOFF_MIN_MS = 1_000, RELAY_BACKOFF_MAX_MS = 300_000, RELAY_ALERT_ATTEMPTS = 5;
   export const PUBLISH_CONFIRM_TIMEOUT_MS = 10_000;
   export const RETENTION_DAYS = 7, CLEANUP_INTERVAL_MS = 3_600_000, CLEANUP_BATCH_SIZE = 1_000, CLEANUP_MAX_BATCHES = 100;
   export interface KitQueues { readonly main: string; readonly retry: string; readonly dlq: string }
   export function queuesOf(service: string): KitQueues   // {main: svc, retry: `${svc}.retry`, dlq: `${svc}.dlq`}
   export function replicaQueueOf(service: string, replica: string): string // `${svc}.replica.${replica}`
   export function handlersDeadlineMs(env: {SHUTDOWN_TIMEOUT_MS: number; SHUTDOWN_DRAIN_MS: number}): number
   //  = max(1_000, SHUTDOWN_TIMEOUT_MS − SHUTDOWN_DRAIN_MS − CHANNEL_CLOSE_TIMEOUT_MS − CONNECTION_CLOSE_TIMEOUT_MS) — П9
   ```
   Все константы внутренние: `index.ts` их не экспортирует.
2. `src/messaging/redelivery.ts` (задача 15). Эталон O `redelivery.ts`, из B — очередь параметром: `retryCount(headers: Record<string, unknown> | undefined, queue: string): number` (запись `x-death` с `queue === queue && reason === 'rejected'`, `Number(count ?? 0)`, нечисло → 0); `decideRedelivery(headers, queue): 'retry' | 'dlq'` (`< MAX_RETRIES` → `retry`).
3. `src/messaging/rabbit-connection.ts` (`Skill: nestjs-code generic src/messaging/rabbit-connection.ts (CREATE)`). Перенос O построчно с отличиями:
   1. Не `@Injectable`: `new RabbitConnection(options)` в фабрике модуля, где `options = {url, retrySeconds, logger: PinoLogger | Nest Logger, deadlineMs: number}`. `ConfigService` не внедряется.
   2. Пакеты — `import type { ConfirmChannel, ConsumeMessage, Options } from 'amqplib'` и `import type { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager'`. Значение — `const acm = await loadPeer<typeof import('amqp-connection-manager')>('amqp-connection-manager', 'messaging')` в `start()`. В модуле нет top-level await.
   3. `start(): Promise<void>` — идемпотентный. Ожидает загрузку пакета, `connect()` не ожидает. `firstAttempt(): Promise<'connected' | 'failed'>` резолвится первым событием `connect` или `connectFailed`. Нужен подписчику для проверки TTL при старте (задача 25, П8).
   4. `shutdownDeadline()` — `this.stopDeadline ??= sleep(options.deadlineMs, false, {ref: false})` (`setTimeout` из `node:timers/promises`), как O. Срок — `handlersDeadlineMs(env)`, решение П9, вместо константы O 8000.
   5. События, логи и GlitchTip — как O, но через `captureError` (дедупликация на объект) / `captureThrottled('rabbitmq:<стадия>:<канал>', error)` из `/observability`, без `@sentry/nestjs` напрямую. Адрес брокера — `brokerEndpoint(url)` (`host:port`): полный URL с паролем не логируется.
   5а. `channelOutcome(name: string): Promise<{kind: 'ready'} | {kind: 'fatal'; error: Error} | {kind: 'failed'; error: Error}>` — первый исход настройки канала после `createChannel` (стадии `exchange`/`setup`/`ready` из `openWrapper`): готов, фатальная ошибка настройки (`MessagingStartupError` из `setup`, см. п. 6) или прочая ошибка стадии (в ней — последняя ошибка канала `closedByBroker`). Резолвится один раз; последующие переподключения его не меняют. Нужен подписчику (задача 25, П8).
   5б. `topologyReady()` — все созданные каналы готовы; **без каналов — `true`** (отличие от O, где `channels.size > 0 && every(ready)`: в kit модуль может работать без каналов до появления relay/подписчика, и проба `isConnected() && topologyReady()` тогда отражает только соединение).
   6. `fatalSetupError(channel: string, error)` — новый хук: канал с фатальной ошибкой настройки (406 TTL `.retry`, задача 25) не повторяется (`scheduleRetry` его пропускает). Состояние канала `fatal` → `topologyReady()` = false. Остальные ошибки — повтор каждые `RABBITMQ_RETRY_SECONDS`, как O.
   7. `onApplicationShutdown()` вызывает модуль (шаг 4). Сам класс хуков Nest не реализует.
   8. Шапка: «Эталон O rabbit-connection.ts (P — без cancelConsumers/stopped). Отличия: фабрика вместо DI, loadPeer acm, срок остановки из SHUTDOWN_TIMEOUT_MS (П9), captureError/captureThrottled пакета, фатальная ошибка настройки без повторов (AC-5.19)».

### Required Interfaces and Contracts
- Внутренние классы: `RabbitConnection`, `ManagedChannel`, `ChannelOptions`. Из `index.ts` они не экспортируются (§3.4 их не перечисляет).
- Пассивная проверка: `channel.checkExchange(EVENTS_EXCHANGE)` — `assertExchange` в пакете нет (ARCHITECTURE anti-pattern).

### Error Handling and Logging
- `info` `rabbitmq: соединение установлено` (`endpoint`);
- `warn` `rabbitmq: соединение потеряно` / `ошибка соединения`;
- `debug` `rabbitmq: попытка не удалась`;
- `error` + GlitchTip один раз — `rabbitmq: exchange verdeect.events отсутствует`, затем `warn` `… всё ещё отсутствует`;
- `warn` — сбой стадии `setup`;
- `error` + GlitchTip один раз на канал — сбой `ready`;
- `debug` — пропуск подтверждения устаревшей доставки;
- `info` — закрытие (шаг 4); `warn` — срок закрытия канала или соединения вышел.
- Поля `service`, `replica` добавляет логгер приложения (`KIT_LOGGER`, базовые поля `bootstrapService` и `createTestApp`). Проверку делает AC-9.5.

### Tests
Интеграционно — задачи 18, 22, 26, 28. Unit для чистых функций — задача 17.

### Acceptance Criteria
- Файл без статических значений `amqplib`/`acm` (lint).

### Verification
- `make lint`, `make analyse`.

## Task 15: Топология и повторы — `topology.ts`, `redelivery.ts`

### Intent
Имена очередей от имени экземпляра (§3.4 «имя сервиса»), константы PRD (prefetch 10, 5 повторов, пачки relay, сроки очистки), счёт повторов по `x-death` (O + опция B — очередь параметром). Задача 14 использует эти константы. Выполняется **первой в фазе**: шаги 1–2 задачи 14 описывают содержимое файлов этой задачи.

### Implementation Steps
1. Создать `src/messaging/topology.ts` (`Skill: nestjs-code generic src/messaging/topology.ts (CREATE)`) — содержимое по шагу 1 задачи 14.
2. Создать `src/messaging/redelivery.ts` (`Skill: nestjs-code generic src/messaging/redelivery.ts (CREATE)`) — по шагу 2 задачи 14.

### Required Interfaces and Contracts
- Всё внутреннее; `index.ts` не экспортирует.

### Error Handling and Logging
Нет (чистые функции).

### Tests
`test/unit/messaging/redelivery.spec.ts`, `topology.spec.ts` — задача 17.

### Acceptance Criteria
- Константы совпадают с §3.4: пачка 100, срок 5 с, опрос 1000 мс, пауза 1 с → 5 мин, 5 неудач, prefetch 10, 5 повторов, 7 дней, пачки 1000 × 100, раз в час.

### Verification
- `make test FILTER='redelivery|topology'`.

## Task 16: `KitMessagingModule.forRoot`, `index.ts`, `exports["./messaging"]`

### Intent
§3.4, AC-1.2, AC-5.15, AC-5.20, решение П1 (ответ пользователя на вопрос 1). Модуль — единственная точка сборки соединения, relay, подписчика и очистки. Остановка — хуками Nest: relay, подписчик и очистка в `beforeApplicationShutdown` (шаг 3), соединение в `onApplicationShutdown` (шаг 4). Отдельных участников `KitLifecycle` нет (решение E3/E4).

### Implementation Steps
1. `src/messaging/kit-messaging.module.ts` (`Skill: nestjs-code module messaging KitMessaging (CREATE)` — модуль пакета, без слоёв сервиса; шаблон модуля из скила только как каркас `@Module`):
   1. Типы опций (экспорт `KitMessagingModuleOptions`):
      ```ts
      export interface KitMessagingModuleOptions {
          readonly service: string;
          readonly outbox?: { readonly table: KitOutboxTable; readonly events: readonly KitEvent[] };
          readonly subscriber?: { readonly dedupe?: 'inbox' | 'none'; readonly inbox?: KitInboxTable };
      }
      ```
      TSDoc: `outbox.events` — все события, которые сервис публикует (`OutboxStore.add` для события вне списка — `TypeError`, задача 19). `tenantNullable` берётся из таблицы (`createOutboxTable(schema, {tenantNullable})`). `subscriber` не задан — подписчика нет. `dedupe` по умолчанию `'inbox'` и требует `inbox`. `'none'` — без БД и inbox (роль BFF).
   2. `static async forRoot(options): Promise<DynamicModule>` — порядок проверок фиксирован:
      1. `assertServiceName(options.service, 'KitMessagingModule')`. Текст тот же, что у AC-3.10 (общая функция), отличается только префикс места.
      2. `dedupe = options.subscriber?.dedupe ?? 'inbox'`; `needsDb = options.outbox !== undefined || (options.subscriber !== undefined && dedupe === 'inbox')`.
      3. `subscriber` с `dedupe: 'inbox'` без `inbox` → `TypeError('KitMessagingModule: subscriber с dedupe: \'inbox\' требует inbox: createInboxTable(schema)')`; `dedupe: 'none'` с `inbox` → `TypeError` («inbox не используется при dedupe: 'none'»).
      4. Схемы: у `outbox.table` и `subscriber.inbox` схема из `getTableConfig(t).schema`; нет схемы или схемы разные → `TypeError`. Имя схемы проверяется `assertServiceName(schema, 'KitMessagingModule')`.
      5. События: дубликаты `type` в `outbox.events` → `TypeError`. Если `!outboxTenantNullable(table)` и есть событие с `tenant: 'none'` → `throw new MessagingStartupError('MESSAGING_TENANT_NOT_NULLABLE', \`событие ${type} без компании (tenant: 'none') требует createOutboxTable(схема, {tenantNullable: true})\`, {event: type, table: \`${schema}.outbox\`})`. Это AC-5.15 и ответ пользователя: код и текст по образцу отказов запуска kit, без значений окружения.
      6. `if (needsDb) { requirePeer('pg', 'messaging'); }` — текст «`@verdeect/kit/messaging` требует pg — добавьте в зависимости сервиса» (AC-1.2, «при сборке модуля, до прослушивания порта»). Затем динамический импорт значений `database`: `const database = await import('../database/index.js')`. Этот путь выполняется только при `needsDb`, и `pg` уже есть. Нужны `Db` (токен DI), `runExclusive`, `deleteInBatches`. Без `needsDb` `database` не загружается.
      7. Провайдеры (внутренние токены — `Symbol('KIT_MESSAGING_OPTIONS')`, `Symbol('KIT_RABBIT_CONNECTION')` в этом файле):
         - токены `KIT_MESSAGING_OPTIONS`, `KIT_RABBIT_CONNECTION` экспортируются из файла модуля (не из `index.ts`) для тестов пакета;
         - `KIT_MESSAGING_OPTIONS` → нормализованные опции (`service`, `schema`, `dedupe`, `events` — `Map<type, KitEvent>`, `outbox?: KitOutboxTable`, `inbox?: KitInboxTable`); фабрики `OutboxRelay` (таблица `OutboxStore`), `KitSubscriber` (`inbox`) и `MessagingCleanup` (таблицы очистки) берут таблицы отсюда;
         - `KIT_RABBIT_CONNECTION` → фабрика `new RabbitConnection({url: env.RABBITMQ_URL, retrySeconds: env.RABBITMQ_RETRY_SECONDS, logger, deadlineMs: handlersDeadlineMs(env)})`. Окружение — `ConfigService` (`{token: ConfigService, optional: true}`); нет — `Error('KitMessagingModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envBase и envMessaging')`, как `databaseEnv()`. Ключи: `RABBITMQ_URL`, `RABBITMQ_RETRY_SECONDS`, `REPLICA_ID`, `SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_DRAIN_MS`;
         - класс `MessagingLifecycle` (внутренний `@Injectable`, `OnModuleInit`, `OnApplicationShutdown`): `onModuleInit` — `void connection.start()` и `health?.register('rabbitmq', async () => connection.isConnected() && connection.topologyReady(), {critical: false})` (`HealthRegistry` `@Optional`; некритичная — эталон O, П11); `onApplicationShutdown` — `await connection.onApplicationShutdown()` (шаг 4);
         - фазы 5–7 добавляют сюда `OutboxStore`, `OutboxRelay`, `KitSubscriber`, `MessagingCleanup`.
      8. `{module: KitMessagingModule, global: true, providers, exports: [публичные классы фаз 5–6]}`.
   3. `debug`-лог в `onModuleInit`: `{service, outbox: boolean, subscriber: dedupe | 'off'}` `'messaging: модуль собран'`.
2. `src/messaging/index.ts` (`Skill: nestjs-code generic src/messaging/index.ts (CREATE)`):
   ```ts
   // Публичная поверхность @verdeect/kit/messaging (prd.md §3.4).
   import './peer.js'; // первым: синхронная проверка amqplib и amqp-connection-manager (AC-1.2, П15)
   export { defineEvent } from './define-event.js';
   export type { KitEvent, KitEventTenant } from './define-event.js';
   export { EnvelopeSchema } from './envelope.js';
   export type { Envelope } from './envelope.js';
   export { ExpectedMessageError, InvalidMessageError } from './errors.js';
   export { createInboxTable, createOutboxTable } from './tables.js';
   export type { KitInboxTable, KitOutboxTable } from './tables.js';
   export { KitMessagingModule } from './kit-messaging.module.js';
   export type { KitMessagingModuleOptions } from './kit-messaging.module.js';
   ```
3. `package.json` (`Skill: none — манифест`): `"./messaging": {"types": "./dist/messaging/index.d.ts", "default": "./dist/messaging/index.js"}` по алфавиту между `./idempotency` и `./observability`.
4. `test/unit/package/package-manifest.spec.ts` и `test/package/ac-1-1-package.spec.ts` (`Skill: nestjs-code test unit package manifest (MODIFY)`, `Skill: nestjs-code test unit package package (MODIFY)`):
   - точный список ключей `exports` + `./messaging`;
   - список подпутей dist + `messaging`;
   - список «без testing/shell-quote» + `messaging`;
   - новый набор `MESSAGING_ENTRIES` (статический граф `dist/messaging/index.js`): нет импорта `pg`, `amqplib`, `amqp-connection-manager`, `drizzle-orm/node-postgres`, `../database/` статически; нет top-level await. Проверка — тем же разбором графа, что `DATABASE_ENTRIES`.

### Required Interfaces and Contracts
- `forRoot` асинхронный (`Promise<DynamicModule>`) — как пример ARCHITECTURE и `KitConfigModule.forRoot`. Сервис пишет `imports: [KitMessagingModule.forRoot({...})]`: Nest принимает Promise.
- Решение П1 расходится с буквой PRD §3.4 (`outbox?: {tenantNullable}`). Оно записано в «Решения плана вне формулировок PRD», PRD v1.15 обновит чат kit.

### Requirement Evidence
| Сочетание опций | `pg` | БД | Подписчик | Relay | Очистка | Проверка |
|---|---|---|---|---|---|---|
| только `service` | нет | нет | нет | нет | нет | U «без outbox и subscriber модуль собирается без pg» |
| `outbox` | да | да | нет | да | outbox | AC-5.1–5.5 |
| `subscriber {dedupe: 'none'}` | нет | нет | да, без inbox, `tx = null` | нет | нет | AC-5.8 |
| `subscriber {inbox}` (умолч. `'inbox'`) | да | да | да, inbox | нет | inbox | AC-5.6 |
| `outbox` + `subscriber {inbox}` | да | да | да | да | outbox + inbox | потребитель AC-9.1 |
| `outbox` + `subscriber {dedupe: 'none'}` | да | да | без inbox | да | outbox | U сочетания |

### Error Handling and Logging
- Отказы `forRoot` (`TypeError`, `MessagingStartupError`, текст `requirePeer`) отклоняют Promise модуля. `bootstrapService` переводит их в `failStartup` до прослушивания порта (E3), `createTestApp` — в отклонённый Promise.
- Логи — п. 1.3.

### Tests
Задача 17.

### Acceptance Criteria
- `import('@verdeect/kit/messaging')` без `pg` проходит (граф).
- `make pack-check` зелёный с новым входом.

### Verification
- `make build`; `make pack-check`.

## Task 17: Тесты U — AC-5.20, AC-1.2, AC-5.15 (forRoot), redelivery

### Implementation Steps
`Skill: nestjs-code test unit messaging <name> (CREATE)`:
1. `test/unit/messaging/ac-5-20-service-name.spec.ts`:
   - `AC-5.20: forRoot с service 'Bff_App', '' и 33 символа — отказ с тем же текстом, что AC-3.10` (сравнить `message` после префикса места с текстом `assertServiceName` из `bootstrapService`);
   - `AC-5.20: 'bff-app' проходит` (`forRoot({service: 'bff-app'})` без outbox/subscriber резолвится).
2. `test/unit/messaging/ac-1-2-messaging-peer.spec.ts` (по образцу `ac-1-2-idempotency-peer.spec.ts`):
   - `AC-1.2: index.ts первым импортирует ./peer.js; peer.ts вызывает requirePeer('amqplib') и requirePeer('amqp-connection-manager')`;
   - `AC-1.2: файлы src/messaging без статического импорта значений pg, amqplib, amqp-connection-manager, drizzle-orm/node-postgres, ../database/* и без top-level await` (разбор исходников, как у образца);
   - `AC-1.2: без amqplib — «@verdeect/kit/messaging требует amqplib — добавьте в зависимости сервиса»` (`requirePeerWith` с резолвером, бросающим `MODULE_NOT_FOUND`);
   - `AC-1.2: forRoot с outbox или dedupe 'inbox' (умолчание) без pg — «@verdeect/kit/messaging требует pg …»`. Этот случай — в отдельном файле `test/unit/messaging/ac-1-2-messaging-forroot-pg.spec.ts` с `vi.mock('../../../src/internal/peer.js', …)`: `requirePeer('pg', …)` бросает ошибку AC-1.2 через настоящую `missingPeerMessage`. В `vitest.config.ts` `isolate` не задан (по умолчанию `true`), подмена не протекает в другие файлы. В этом же файле — `AC-1.2: forRoot с subscriber {dedupe: 'none'} без pg не требует pg`: `forRoot({service: 'kit', subscriber: {dedupe: 'none'}})` резолвится, подмена `requirePeer` не вызвана с `'pg'` (в файле без подмены `pg` установлен, и случай ничего бы не проверял);
   - `AC-5.10: в src/messaging нет assertExchange — exchange только checkExchange` (разбор исходников `src/messaging/**/*.ts` тем же способом, что остальные случаи файла).
3. `test/unit/messaging/ac-5-15-forroot.spec.ts`:
   - `AC-5.15: событие 'none' при createOutboxTable({tenantNullable: false}) — отказ forRoot MESSAGING_TENANT_NOT_NULLABLE, details {event, table}, текст называет tenantNullable: true`;
   - `AC-5.15: то же событие при tenantNullable: true — forRoot собирается`;
   - `§3.4: inbox без dedupe 'inbox', таблицы разных схем, дубликат события → TypeError`.
   Таблицы строятся в тесте: `createOutboxTable(pgSchema('kitnn'))`. БД не нужна, в отличие от `forRoot` с `pg` — `pg` в devDependencies, `import('../database/index.js')` грузится без подключения.
4. `test/unit/messaging/redelivery.spec.ts` — эталон O `redelivery.spec.ts` (29) + B:
   - `AC-5.7: retryCount — запись x-death своей очереди с reason rejected`;
   - `AC-5.7: чужая очередь / expired / нечисло → 0`;
   - `AC-5.7: decideRedelivery — 4 → retry, 5 → dlq`.
5. `test/unit/messaging/topology.spec.ts`:
   - `§3.4: queuesOf('bff-app') → bff-app, bff-app.retry, bff-app.dlq; replicaQueueOf → bff-app.replica.r1`;
   - `П9: handlersDeadlineMs({10_000, 0}) = 7_000; ({2_000, 1_500}) = 1_000`.

### Tests
Перечислены. Команда `make test FILTER='messaging'`.

### Acceptance Criteria
- AC-5.20 и AC-1.2 (подпуть `/messaging`) покрыты на уровне U.

### Verification
- `make test`.

## Task 18: Стенд модуля и I — пассивная проверка exchange, проба `/health`

### Intent
Общий стенд для фаз 5–8 и проверка поведения соединения на настоящем брокере. Эквивалентность — O `topology.int-spec` «exchange verdeect.events не объявляется».

### Implementation Steps
1. `test/support/messaging.ts` (`Skill: nestjs-code generic test/support/messaging.ts (CREATE)`):
   - `messagingEnv(overrides?)` → окружение `{...envBase defaults, DATABASE_URL: inject('kitDatabaseUrl'), RABBITMQ_URL: workerScope().rabbitmq.url, RABBITMQ_RETRY_SECONDS: '1', SHUTDOWN_TIMEOUT_MS: '10000', REPLICA_ID: 'kit-1'}`. `RABBITMQ_RETRY_SECONDS = 1` — AC-5.7 «в тесте 1»;
   - `createMessagingApp({options: Omit<KitMessagingModuleOptions, 'service'>, env?, imports?, providers?, overrides?: readonly KitTestOverride[]})` (`overrides` передаются в `createTestApp`, как в `createDbApp`; нужны подмене `KIT_LOGGER` в задачах 26, 31) — по образцу `createDbApp` (`test/support/database.ts`): модуль `{imports: [KitConfigModule.forRoot({schema: defineEnv({...envBase, ...envDatabase, ...envMessaging})}), KitDatabaseModule.forRoot({schema: fixtures}), KitMessagingModule.forRoot({service: 'kit', ...options}), ...imports]}`, `setPreparsedEnv` и `createTestApp({module, service: 'kit'})`. Без БД (`dedupe: 'none'`) `KitDatabaseModule` не подключается;
   - сервис `kit`, а очереди `kit`, `kit.retry`, `kit.dlq` по правам vhost воркера (сервис стека `kit`).
2. `test/integration/messaging/connection.spec.ts` (`Skill: nestjs-code test integration messaging connection (CREATE)`):
   - `§3.4: exchange verdeect.events проверяется пассивно — при удалённом exchange сервис его не объявляет, /health 200 degraded, rabbitmq down`:
     1. `BrokerClient.deleteExchange`;
     2. стенд `subscriber: {dedupe: 'none'}` (в фазе 4 подписчика ещё нет, каналов модуль не открывает);
     3. тест открывает канал сам: `app.get(KIT_RABBIT_CONNECTION).createChannel({name: 'probe', confirm: true})` — токен экспортирован из `src/messaging/kit-messaging.module.ts` (не из `index.ts`); стадия `exchange` `openWrapper` выполняет `checkExchange`;
     4. опрос `HealthRegistry.evaluate()` до `rabbitmq: 'down'` со сроком × `TEST_TIMEOUT_SCALE`, без фиксированного `sleep`;
     5. `exchangeExists() === false`;
     6. `finally` — `declareEventsExchange()` и `channel.close()`.
   - `§3.4: с exchange — канал probe готов, rabbitmq up, topologyReady` — тот же канал `probe`, опрос до `rabbitmq: 'up'`.
   - `§3.4: модуль без каналов при живом соединении — rabbitmq up` (задача 14, п. 3.5б).
   - `§3.4: модуль без outbox и subscriber не открывает каналов, соединение закрывается на шаге 4` (`app.close()`, `isConnected() === false`).

### Error Handling and Logging
Нет.

### Tests
Перечислены.

### Acceptance Criteria
- `make test-integration FILTER='§3.4'` зелёный.

### Verification
- `make test-integration`.

## Phase Risks and Mitigations
- Риск: `KitConfigModule` и `forRoot` асинхронные, порядок разбора окружения не определён. Смягчение: окружение читается в фабриках провайдеров (`ConfigService`), а не в `forRoot`. `forRoot` проверяет только опции.
- Риск: `import('../database/index.js')` из `dist/messaging` попадёт в граф AC-1.1 как динамический — это допустимо. Смягчение: проверка `MESSAGING_ENTRIES` смотрит только статические импорты.

## Phase Completion Checklist
- Задачи 15, 14, 16–18 выполнены (15 — первой); `make lint`, `make test`, `make test-integration`, `make pack-check` зелёные.
- `index.md` обновлён.
