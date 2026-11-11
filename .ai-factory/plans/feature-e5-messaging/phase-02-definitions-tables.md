# Phase 2: Определения событий, конверт, таблицы outbox/inbox

Plan: [index.md](index.md)
Tasks: 4-8
Depends on: Phase 1 (Task 3)

## Objective

Подпуть `/messaging` получает статический граф без брокера и без БД. В него входят:

- `defineEvent` с признаком `tenant`;
- `EnvelopeSchema` / `Envelope<E>`;
- классы ошибок обработчика;
- фабрики Drizzle `createOutboxTable` (`tenantNullable`) и `createInboxTable`;
- синхронная проверка опциональных peer `amqplib` и `amqp-connection-manager`.

`Db` начинает связывать `tx` с его `DbContext` во внутреннем модуле: так `OutboxStore.add(tx, …)` прочитает `tenant`, `actor` и `traceId`. Фикстура БД пакета получает `kit.outbox` и `kit.inbox`.

Точка входа `./messaging` в `exports` появляется в фазе 4 (задача 16), когда есть модуль.

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| O `src/shared/messaging/schema/outbox.schema.ts` (45) | колонки `id`, `seq` (identity), `type`, `version`, `tenant` NOT NULL, `actor` jsonb, `subject` jsonb, `data`, `occurred_at`, `trace_id`, `published_at`, `attempts`, `last_error`; индексы `outbox_unpublished_seq_idx` (`seq` where `published_at is null`), `outbox_published_at_idx`; политика `outbox_tenant_isolation` | эталон таблицы |
| O `schema/inbox.schema.ts` (16) | `message_id` PK, `type`, `received_at` default now, индекс `inbox_received_at_idx`, без RLS | эталон inbox |
| O/P/I `event-envelope.ts` (59/59/60) | `IncomingEnvelopeSchema` (id, type, version int ≥ 1, occurredAt iso offset, tenant nullable optional, actor/subject unknown optional, data record, traceId nullable optional; не strict), `envelopeFromOutbox` | `EnvelopeSchema` — одинаковая во всех трёх копиях |
| O `expected-message-error.ts`, `invalid-message.error.ts` | `abstract class ExpectedMessageError(code, message)`, `name = new.target.name`; `InvalidMessageError(reason)`, `code = 'INVALID_MESSAGE'` | эталон ошибок |
| `src/internal/peer.ts:51,66` | `requirePeerWith`, `requirePeer(library, subpath)` | синхронная проверка (П15 E4) |
| `src/idempotency/peer.ts`, `src/idempotency/index.ts:3` | `requirePeer('pg', 'idempotency')`; `import './peer.js'` первым | образец |
| `src/idempotency/table.ts` | `createIdempotencyTable(schema)`, `getTableConfig`, `pgPolicy`, `assertServiceName(schema.schemaName, …)` | образец фабрики |
| `src/database/tenant.ts:11` | `DbContext {tenant, traceId, actor {clientId?, accountId?, memberId?, onBehalfOf?, channel}}` | поля строки outbox |
| `src/database/db.ts:85,165-…` | `internals` WeakMap, `Db.run(ctx, fn, readOnly, client?)`, `afterCommitTasks`, `transactions` | место привязки `tx → ctx` |
| `src/internal/service-name.ts` | `assertServiceName(service, where)` | имя схемы |
| `test/fixtures/database/schema.ts`, `drizzle.config.ts`, `migrations/0000-0004` | `kit = pgSchema('kit')`, `note`, `setting`, `idempotency`; 0001 — FORCE и права; `pnpm db:fixtures`; ручной SQL — `drizzle-kit generate --custom` | фикстура |
| PRD §3.4, §6 | колонки outbox по §6: `subject_id` (не jsonb), `tenant` nullable по `tenantNullable` | расхождение с O — по PRD |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/internal/tx-context.ts` | create | `bindTxContext(tx, ctx)`, `txContextOf(tx)` |
| `src/database/db.ts` | modify | `run` связывает `tx` с `ctx` |
| `src/internal/outbox-policy.ts` | create | `OUTBOX_POLICY`, `OUTBOX_POLICY_SQL` — выражение исключения |
| `src/messaging/peer.ts` | create | `requirePeer('amqplib', 'messaging')`, `requirePeer('amqp-connection-manager', 'messaging')` |
| `src/messaging/errors.ts` | create | `ExpectedMessageError`, `InvalidMessageError`, внутренний `MessagingStartupError` |
| `src/messaging/define-event.ts` | create | `defineEvent`, `KitEvent`, `KitEventTenant` |
| `src/messaging/envelope.ts` | create | `EnvelopeSchema`, `Envelope<E>`, внутренние `buildEnvelope`, `parseEnvelope` |
| `src/messaging/tables.ts` | create | `createOutboxTable`, `createInboxTable`, типы `KitOutboxTable`, `KitInboxTable`, внутренние имена |
| `test/fixtures/database/schema.ts`, `migrations/**` | modify | `kit.outbox` (`tenantNullable: true`), `kit.inbox`, права |
| `test/unit/messaging/*.spec.ts`, `test/unit/internal/tx-context.spec.ts` | create | U |
| `test/integration/database/ac-4-7-migrations.spec.ts`, `test/integration/testing/ac-4-18-scratch-database.spec.ts` | modify | число миграций 7; список таблиц `kit` с outbox и inbox |

## Task 4: Контекст транзакции во внутреннем модуле

### Intent
§3.4: `OutboxStore.add(tx, Event, {subjectId, data})` берёт `tenant`, `actor`, `traceId` из `DbContext`, хотя получает только `tx`. Сейчас `Db` контекст транзакции не хранит. `messaging` не может импортировать значения `database` статически (AC-1.2), поэтому связь `tx → ctx` живёт в `internal`: это чистый модуль без `pg`, который импортируют оба подпути.

### Implementation Steps
1. Создать `src/internal/tx-context.ts` (`Skill: nestjs-code generic src/internal/tx-context.ts (CREATE)`). Шапка: «Связь транзакции Db с её DbContext (prd.md §3.4 OutboxStore.add — tenant, actor, traceId из DbContext). Внутренний модуль: database пишет, messaging читает — без импорта database».
   ```ts
   import type { DbContext } from '../database/tenant.js'; // только тип
   const contexts = new WeakMap<object, DbContext>();
   export function bindTxContext(tx: object, ctx: DbContext): void { contexts.set(tx, ctx); }
   export function txContextOf(tx: object): DbContext | undefined { return contexts.get(tx); }
   ```
   `src/database/tenant.ts` импортирует только `drizzle-orm` и `drizzle-orm/pg-core` (проверено), поэтому `import type` из него безопасен для графа `/messaging`.
2. `src/database/db.ts` (`Skill: nestjs-code generic src/database/db.ts (MODIFY)`): в `run(ctx, fn, readOnly, client?)` сразу после создания объекта транзакции Drizzle (там, где он добавляется в `this.transactions` или `this.readOnly`) вызвать `bindTxContext(tx, ctx)`. `readGlobal` контекста не имеет и не связывается.
3. Публичная поверхность не меняется.

### Required Interfaces and Contracts
- `txContextOf(tx)` возвращает тот же объект `ctx`, что получил `Db.transaction(ctx, …)` / `Db.read(ctx, …)`, в том числе после завершения транзакции (связь не снимается; WeakMap держит запись, пока жив `tx`). Для `readGlobal` и для объекта не из `Db` — `undefined`.

### Error Handling and Logging
Нет.

### Tests
`test/unit/internal/tx-context.spec.ts` (`Skill: nestjs-code test unit internal tx-context (CREATE)`): `bindTxContext`/`txContextOf` на объектах и `undefined` для чужого. Интеграционно связь проверяет AC-5.2 (задача 22).

### Acceptance Criteria
- `make test FILTER='tx-context'` зелёный.
- Существующий `test-integration` (`Db`) зелёный.

### Verification
- `make test`; `make test-integration FILTER='AC-4.1'`.

## Task 5: `peer.ts`, ошибки, `defineEvent`, `EnvelopeSchema`

### Intent
Статическая часть §3.4: определения и конверт `01` §7.1 нужны relay, подписчику, `/testing` (`publishTestEvent`, `expectOutbox`) и каталогу `@verdeect/events` (вне этапа). Проверка peer — синхронная при загрузке (П15 E4, ARCHITECTURE).

### Implementation Steps
1. `src/messaging/peer.ts` (`Skill: nestjs-code generic src/messaging/peer.ts (CREATE)`):
   ```ts
   // Проверка опциональных peer /messaging при загрузке подпути (prd.md NFR-3, AC-1.2; П15 E4): без top-level await.
   import { requirePeer } from '../internal/peer.js';
   requirePeer('amqplib', 'messaging');
   requirePeer('amqp-connection-manager', 'messaging');
   ```
   Порядок фиксирован (`amqplib` первым). Текст ошибки: «`@verdeect/kit/messaging` требует amqplib — добавьте в зависимости сервиса».
2. `src/messaging/errors.ts` (`Skill: nestjs-code generic src/messaging/errors.ts (CREATE)`). Шапка: эталон O `expected-message-error.ts`, `invalid-message.error.ts`.
   - `export abstract class ExpectedMessageError extends Error`: конструктор `(readonly code: string, message: string)`, `code` проверяется `^[A-Z][A-Z0-9_]*$` (иначе `TypeError`), `this.name = new.target.name`. TSDoc: «Ожидаемый отказ обработки (например, зависимость временно недоступна): `warn` и повтор через `<svc>.retry` до 5 раз, затем DLQ с `x-dlq-reason` = `code`; в GlitchTip не отправляется».
   - `export class InvalidMessageError extends Error`: `readonly code = 'INVALID_MESSAGE'`, конструктор `(readonly reason: string)`, `message` — `сообщение отклонено: ${reason}`, `name = 'InvalidMessageError'`. TSDoc: «Сообщение нельзя обработать никогда — сразу в `<svc>.dlq`, `x-dlq-reason` = `reason`». `reason` обрезается до 200 символов. TSDoc предупреждает: не класть в `reason` значения ПДн, а только пути и коды.
   - Внутренний (не экспортируется из `index.ts`) `export class MessagingStartupError extends Error implements StartupFailure`: `constructor(readonly startupCode: 'MESSAGING_TENANT_NOT_NULLABLE' | 'MESSAGING_RETRY_TTL_MISMATCH', message: string, private readonly details: Record<string, string>)`, `startupDetails()` → `details`. `name = 'MessagingStartupError'`. Тип `StartupFailure` — `import type` из `../observability/fail-startup.js`. В `details` только имена (тип события, имя очереди), значений окружения нет (ответ пользователя на вопрос 1).
3. `src/messaging/define-event.ts` (`Skill: nestjs-code generic src/messaging/define-event.ts (CREATE)`):
   ```ts
   export type KitEventTenant = 'required' | 'none';
   export interface KitEvent<TType extends string = string, TData extends z.ZodObject = z.ZodObject, TTenant extends KitEventTenant = KitEventTenant> {
       readonly type: TType; readonly version: number; readonly subject: string; readonly tenant: TTenant; readonly data: TData;
   }
   export function defineEvent<TType extends string, TData extends z.ZodObject, TTenant extends KitEventTenant = 'required'>(
       definition: { type: TType; version: number; subject: string; tenant?: TTenant; data: TData },
   ): KitEvent<TType, TData, TTenant>
   ```
   Проверки (иначе `TypeError` с текстом `defineEvent(<type>): …`):
   - `type` по `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)+$` (каталог `01` §7.2: `platform.company.created`), длина ≤ 120;
   - `version` — целое ≥ 1;
   - `subject` по `^[a-z][a-z0-9_]*$`;
   - `tenant` ∈ {`required`, `none`}, умолчание `required`;
   - `data` — `ZodObject` **не** strict (§3.4 «zod без `.strict()`»): у strict-объекта zod 4 `catchall` равен `ZodNever`. Способ проверки (`data._zod.def.catchall` / `instanceof z.ZodNever`) сверить с Context7 `zod` 4.6. Strict → `TypeError` «data без .strict(): новые поля событий добавляются без мажора».
   Результат заморожен (`Object.freeze`).
4. `src/messaging/envelope.ts` (`Skill: nestjs-code generic src/messaging/envelope.ts (CREATE)`). Шапка: эталон O/P/I `event-envelope.ts` (одинаковая схема), конверт `01` §7.1.
   - `export const EnvelopeSchema = z.object({id: z.string().min(1), type: z.string().min(1), version: z.number().int().min(1), occurredAt: z.iso.datetime({offset: true}), tenant: z.string().min(1).nullable(), actor: z.record(z.string(), z.unknown()).nullable(), subject: z.object({kind: z.string().min(1), id: z.string().min(1)}), data: z.record(z.string(), z.unknown()), traceId: z.string().min(1).nullable()})`. Схема не strict. Отличие от O (там `tenant`, `actor`, `subject`, `traceId` — optional/unknown): по PRD конверт relay совпадает с §7.1, поэтому поля обязательны, `null` допустим. Это решение П21. Входящий конверт проверяется той же схемой: сервисы, перешедшие на kit, публикуют через этот relay.
   - `export type Envelope<E extends KitEvent = KitEvent> = Omit<z.output<typeof EnvelopeSchema>, 'type' | 'data' | 'tenant' | 'version'> & {readonly type: E['type']; readonly version: number; readonly data: z.output<E['data']>; readonly tenant: E['tenant'] extends 'none' ? null : string}`.
   - Внутренняя `buildEnvelope(row: OutboxRowForEnvelope): Envelope` — из строки outbox (`id`, `type`, `version`, `occurredAt: Date`, `tenant`, `actor`, `subjectKind`, `subjectId`, `data`, `traceId`). `occurredAt` → `toISOString()`, `subject = {kind, id}`.
   - Внутренняя `parseEnvelope(content: Buffer): {ok: true, envelope} | {ok: false, reason: 'not-json' | 'envelope', fields: string[]}`. `fields` — верхнеуровневые имена полей из `issues[].path[0]` без значений.
   - Внутренняя `tenantViolation(event: KitEvent, envelope): boolean` — `'required'` и `tenant === null`, или `'none'` и `tenant !== null`.
5. Поле `subject.kind` конверта берётся из `Event.subject`. В строке outbox его нет (§6 — только `subject_id`), relay восстанавливает его по реестру событий модуля (задача 20).

### Required Interfaces and Contracts
- Экспорты (появятся в `index.ts`, задача 16): `defineEvent`, `EnvelopeSchema`, `ExpectedMessageError`, `InvalidMessageError`, типы `Envelope`, `KitEvent`, `KitEventTenant`.
- `MessagingStartupError`, `buildEnvelope`, `parseEnvelope`, `tenantViolation` — внутренние.

### Error Handling and Logging
- `TypeError` в `defineEvent` — при загрузке модуля сервиса, до запуска.
- Логов нет.

### Tests
См. задачу 8.

### Acceptance Criteria
- Файлы без статических импортов значений `pg`, `amqplib`, `amqp-connection-manager`, `../database/*` (`make lint`).

### Verification
- `make lint`; `make typecheck` (через `make analyse`).

## Task 6: `createOutboxTable`, `createInboxTable`

### Intent
§6 и §3.4. Пакет даёт фабрики, таблицы создают миграции сервиса (`drizzle-kit`). Outbox — единственное исключение строгой RLS: пустой тенант видит все строки (это нужно relay и очистке). Выражение исключения нужно и `assertStrictTenantIsolation` (задача 30), а `/testing` не должен грузить `/messaging` (без `amqplib`), поэтому выражение лежит в `internal`.

### Implementation Steps
1. `src/internal/outbox-policy.ts` (`Skill: nestjs-code generic src/internal/outbox-policy.ts (CREATE)`):
   ```ts
   export const OUTBOX_TABLE = 'outbox';
   export const INBOX_TABLE = 'inbox';
   export const OUTBOX_POLICY = 'outbox_tenant_isolation';
   /** Исключение строгой модели (§3.4, §6): пустой тенант — все строки; иначе — только строки тенанта. */
   export const OUTBOX_POLICY_SQL =
       "coalesce(current_setting('app.tenant', true), '') = '' OR tenant = current_setting('app.tenant', true)";
   ```
2. `src/messaging/tables.ts` (`Skill: nestjs-code generic src/messaging/tables.ts (CREATE)`). Шапка: «createOutboxTable, createInboxTable (prd.md §3.4, §6). Эталон — O outbox.schema.ts, inbox.schema.ts; из I — nullable tenant (tenantNullable); по PRD §6 — subject_id вместо subject jsonb, id inbox — id события». Импорты: `drizzle-orm`, `drizzle-orm/pg-core` и внутренние модули. **Без** `pg` и без `./peer.js`: схема сервиса грузится `drizzle-kit` через `require`. Проверку peer делает `index.ts`.
   - `createOutboxTable(schema: PgSchema, options: {readonly tenantNullable?: boolean} = {})`:
     1. `assertServiceName(schema.schemaName, 'createOutboxTable')`.
     2. `schema.table('outbox', {…}, (t) => [...])`:

     | Колонка | Drizzle | Ограничения |
     |---|---|---|
     | `id` | `text('id').primaryKey()` | `evt_` + ULID (`newId('evt')`, задача 19) |
     | `seq` | `bigint('seq', {mode: 'number'}).generatedAlwaysAsIdentity()` | порядок публикации |
     | `tenant` | `text('tenant')` + `.notNull()` при `tenantNullable !== true` | |
     | `type` | `text('type').notNull()` | |
     | `version` | `integer('version').notNull()` | |
     | `subject_id` | `text('subject_id').notNull()` | |
     | `actor` | `jsonb('actor').notNull()` | `DbContext.actor` |
     | `trace_id` | `text('trace_id').notNull()` | `DbContext.traceId` |
     | `data` | `jsonb('data').notNull()` | |
     | `occurred_at` | `timestamp('occurred_at', {withTimezone: true, mode: 'date'}).notNull().defaultNow()` | |
     | `published_at` | `timestamp('published_at', {withTimezone: true, mode: 'date'})` | nullable |
     | `attempts` | `integer('attempts').notNull().default(0)` | |
     | `last_error` | `text('last_error')` | nullable |

     3. Индексы: `index('outbox_unpublished_seq_idx').on(t.seq).where(sql\`${t.publishedAt} is null\`)` и `index('outbox_published_at_idx').on(t.publishedAt).where(sql\`${t.publishedAt} is not null\`)`. Индекса по тенанту нет: у I его нет, запросы relay/очистки идут без тенанта. Это решение П22.
     4. `pgPolicy(OUTBOX_POLICY, {as: 'permissive', for: 'all', to: 'public', using: sql.raw(OUTBOX_POLICY_SQL), withCheck: sql.raw(OUTBOX_POLICY_SQL)})`. `.enableRLS()` не вызывать — drizzle-kit 0.31.11 сам пишет `ENABLE ROW LEVEL SECURITY` для таблицы с `pgPolicy` (как `note` и `idempotency_key` фикстуры E4). `FORCE` — SQL-миграцией сервиса (как E4).
     5. Признак nullable читает модуль через `getTableConfig(table).columns.find(c => c.name === 'tenant')?.notNull` — отдельного поля нет.
   - `createInboxTable(schema: PgSchema)`: `assertServiceName(…, 'createInboxTable')`; таблица `inbox`: `id text PK` (id события), `type text not null`, `received_at timestamptz not null default now()`, индекс `inbox_received_at_idx` по `received_at`. Без RLS (служебная, §6).
   - Типы `KitOutboxTable = ReturnType<typeof createOutboxTable>`, `KitInboxTable = ReturnType<typeof createInboxTable>` — экспорт.
   - TSDoc фабрик: сервис добавляет миграцией `ALTER TABLE <s>.outbox FORCE ROW LEVEL SECURITY` и права `<svc>_app` (`SELECT, INSERT, UPDATE, DELETE` на `outbox`, `SELECT, INSERT, DELETE` на `inbox`), пример — README (задача 37).
3. Внутренняя функция `outboxTenantNullable(table: KitOutboxTable): boolean` (в `tables.ts`, не экспортируется из `index.ts`).

### Required Interfaces and Contracts
- `createOutboxTable(pgSchema, {tenantNullable = false})`, `createInboxTable(pgSchema)` — сигнатуры §3.4.
- Имена таблиц фиксированы (`outbox`, `inbox`): на них ссылаются `assertStrictTenantIsolation`, `expectOutbox`, `waitForInbox`.

### Error Handling and Logging
- `TypeError` — имя схемы вне формата.

### Tests
Задача 8.

### Acceptance Criteria
- `drizzle-kit generate` по фикстуре (задача 7) создаёт таблицы, индексы и политику без ручных правок SQL.

### Verification
- `pnpm db:fixtures` (задача 7).

## Task 7: Фикстура БД пакета — `kit.outbox`, `kit.inbox`

### Intent
Тесты I (фазы 5–8) идут на БД `kit`, мигрированной в `globalSetup` (E4). Outbox фикстуры — с `tenantNullable: true`: так проверяются события и `'required'`, и `'none'`. Отказ `forRoot` при NOT NULL проверяется на таблице, построенной в тесте без БД (задача 17).

### Implementation Steps
1. `test/fixtures/database/schema.ts` (`Skill: nestjs-code generic test/fixtures/database/schema.ts (MODIFY)`): `export const outbox = createOutboxTable(kit, {tenantNullable: true}); export const inbox = createInboxTable(kit);`. Импорт из `../../../src/messaging/tables.js` — не из `index.ts`: drizzle-kit загружает схему без `amqplib`-проверки. Пакеты стоят в devDependencies, поэтому проверка прошла бы и так, но фикстура не зависит от peer.
2. (`Skill: nestjs-code migration kit messaging (CREATE)`) `pnpm db:fixtures` → новая миграция `0005_*.sql` (таблицы, индексы, политика). Проверить, что SQL содержит `CREATE POLICY "outbox_tenant_isolation"` с выражением `OUTBOX_POLICY_SQL` и `ALTER TABLE "kit"."outbox" ENABLE ROW LEVEL SECURITY`.
3. (`Skill: nestjs-code migration kit messaging_grants (CREATE)`) Ручная миграция `drizzle-kit generate --custom --config test/fixtures/database/drizzle.config.ts --name messaging_grants` → `0006_messaging_grants.sql`:
   ```sql
   ALTER TABLE "kit"."outbox" FORCE ROW LEVEL SECURITY;
   --> statement-breakpoint
   GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."outbox" TO "kit_app";
   --> statement-breakpoint
   GRANT SELECT, INSERT, DELETE ON "kit"."inbox" TO "kit_app";
   ```
   `0001_force_grants.sql` выдаёт права явным `GRANT … ON "kit"."note", "kit"."setting" TO "kit_app"` (без default privileges), поэтому оба `GRANT` выше обязательны. Права на последовательность identity: проверить вставкой под `kit_app` (тест AC-5.2). Если PostgreSQL потребует `USAGE` на последовательность `outbox_seq_seq`, добавить `GRANT USAGE ON SEQUENCE` в эту же миграцию.
4. `test/support/database.ts` → `truncateFixtures` (`Skill: nestjs-code generic test/support/database.ts (MODIFY)`): добавить `kit.outbox`, `kit.inbox` в список очищаемых таблиц (`TRUNCATE … RESTART IDENTITY`).

### Error Handling and Logging
Нет.

### Tests
- Существующий AC-4.8 (`assertStrictTenantIsolation({schema: 'kit'})`) обязан остаться зелёным: outbox сейчас — исключение по имени с проверкой наличия политики (E4), inbox — без колонки тенанта. Если AC-4.8 падает на `inbox` (таблица без тенанта и без RLS), это ошибка в фикстуре, а не повод менять проверку.
- `test/integration/testing/ac-4-8-strict-isolation.spec.ts` (`Skill: nestjs-code test integration testing strict-isolation (MODIFY)`): удалить случай `AC-4.8: таблица outbox с политикой и FORCE проходит (исключение строгой модели)` (стр. 129–142) — его `CREATE TABLE kit.outbox` падает, когда в фикстуре есть настоящий `kit.outbox`; исключение outbox теперь проверяет существующий случай фикстуры. Остальные случаи AC-4.8 остаются зелёными без изменений; замена удалённого случая — задача 31, шаг 4.
- `test/integration/database/ac-4-7-migrations.spec.ts` (`Skill: nestjs-code test integration database migrations (MODIFY)`): `MIGRATION_COUNT = 5` (стр. 25) → `7` (0005 — таблицы, 0006 — `messaging_grants`; `GRANT USAGE ON SEQUENCE`, если нужен, — в 0006).
- `test/integration/testing/ac-4-18-scratch-database.spec.ts` (`Skill: nestjs-code test integration testing scratch-database (MODIFY)`): ожидаемый список таблиц схемы `kit` (сортировка по `relname`, `toEqual`) — `__migrations` (false), `idempotency_key` (true), `inbox` (false), `note` (true), `outbox` (true), `setting` (false); название теста дополнить outbox и inbox.

### Acceptance Criteria
- `make test-integration` зелёный на новой фикстуре.

### Verification
- `pnpm db:fixtures` без изменений после повторного запуска («No schema changes»).
- `make test-integration`.

## Task 8: Тесты U фазы

### Intent
AC-5.15 (часть «признак tenant»), §3.4, §6 — проверки без брокера и БД.

### Implementation Steps
`Skill: nestjs-code test unit messaging <name> (CREATE)` для каждого файла:
1. `test/unit/messaging/define-event.spec.ts`:
   - `§3.4: defineEvent — tenant по умолчанию 'required'`;
   - `§3.4: defineEvent — strict data → TypeError`;
   - `§3.4: defineEvent — type вне каталога / version 0 / subject с заглавной → TypeError`;
   - `§3.4: результат заморожен`.
2. `test/unit/messaging/envelope.spec.ts`:
   - `AC-5.2: buildEnvelope — поля 01 §7.1, occurredAt ISO, subject {kind, id}`;
   - `AC-5.2: EnvelopeSchema принимает конверт с tenant: null`;
   - `AC-5.7: parseEnvelope — не JSON → not-json; без id → envelope, fields ['id'], без значений`;
   - `AC-5.15: tenantViolation — 'required' + null, 'none' + 'acme' → true; иначе false`.
3. `test/unit/messaging/tables.spec.ts`:
   - `§6: createOutboxTable — колонки и индексы (getTableConfig)`;
   - `§6: tenantNullable: false → tenant notNull; true → nullable (outboxTenantNullable)`;
   - `§6: политика outbox_tenant_isolation с OUTBOX_POLICY_SQL`;
   - `§6: createInboxTable — id PK, без политики`;
   - `§3.4: схема вне ^[a-z][a-z0-9-]{1,31}$ → TypeError`.
4. `test/unit/messaging/errors.spec.ts`:
   - `AC-5.7: ExpectedMessageError — code SCREAMING_SNAKE, name подкласса`;
   - `AC-5.7: InvalidMessageError — code INVALID_MESSAGE, reason ≤ 200`;
   - `MessagingStartupError реализует StartupFailure (startupCode, startupDetails)` — по форме: `typeof error.startupCode === 'string'` и `typeof error.startupDetails === 'function'`. Отдельного предиката в `fail-startup.ts` нет, `failStartup` распознаёт отказ по форме.
5. `test/unit/messaging/envelope.test-d.ts` (`Skill: nestjs-code test unit messaging envelope (CREATE)`; `vitest.config.ts` проверяет типы `test/unit/**/*.test-d.ts`, стр. 16–18):
   - `§3.4: Envelope — tenant: string для 'required', null для 'none'; data — z.output схемы события` (`expectTypeOf<Envelope<typeof RequiredEvent>['tenant']>().toEqualTypeOf<string>()`, `…<typeof NoneEvent>['tenant']>().toEqualTypeOf<null>()`, `['data']` — `z.output` схемы).

### Tests
Перечислены выше. Команда: `make test FILTER='messaging'`.

### Acceptance Criteria
- Все случаи зелёные. Unit-набор остаётся < 30 с (NFR-7).

### Verification
- `make test`.

## Phase Risks and Mitigations
- Риск: drizzle-kit 0.31.11 генерирует политику с `USING` без скобок или переписывает выражение. Смягчение: тест AC-4.8 на outbox (задача 31) сравнивает выражение из `pg_policies` с нормализацией, а не строкой из TS.
- Риск: `Envelope<E>` с условным типом `tenant` усложняет вывод. Смягчение: type-тест `test/unit/messaging/envelope.test-d.ts` (`expectTypeOf`) — задача 8, шаг 5.

## Phase Completion Checklist
- Задачи 4–8 выполнены; `make lint`, `make test`, `make test-integration` зелёные.
- `index.md` обновлён.
