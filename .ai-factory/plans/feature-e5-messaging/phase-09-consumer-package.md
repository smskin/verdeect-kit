# Phase 9: Проект-потребитель и проверки архива

Plan: [index.md](index.md)
Tasks: 35-36
Depends on: Phases 2–8

## Objective

AC-9.1 и AC-5.13 проверяются на упакованном архиве. Проект-потребитель на `bootstrapService` с PostgreSQL и RabbitMQ из `startTestStack`:

- публикует событие через `OutboxStore.add` и сам его потребляет (подписчик с inbox);
- проверяет запись `expectOutbox`, обработчик — `publishTestEvent` + `waitForInbox`;
- проходит `assertStrictTenantIsolation` с outbox;
- показывает метрики и логи relay, подписчика и очистки (AC-9.5).

Прогоны с `KIT_OUTBOX_COVERAGE=1` и без неё доказывают AC-5.13. Подпуть `./messaging` проверяют AC-1.1 (publint, attw, импорт) и AC-1.2 (без `amqplib`, без `pg`).

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `test/consumer/minimal/package.json` | зависимости точными версиями; `pg` есть, `amqplib` нет | + `amqplib` 2.2.0, `amqp-connection-manager` 5.0.1 |
| `test/consumer/minimal/global-setup.ts` | `tsc` и `startTestStack({service: 'consumer', postgres: true, migrations: 'drizzle'})` | + `rabbitmq`, `outboxEvents` |
| `test/consumer/minimal/src/service/{app.module,env,schema,main,items.controller}.ts` | `KitConfigModule`, `KitDatabaseModule`, `KitIdempotencyModule`, `VerdeectAuthModule`; `envBase + envDatabase + AUTH_*`; `consumer.company` + idempotency | + `envMessaging`, outbox/inbox, `KitMessagingModule` |
| `test/consumer/minimal/drizzle/0000-0002`, `drizzle.config.ts` | миграции потребителя | `0003` таблицы, `0004` права |
| `test/consumer/minimal/src/observability.spec.ts` | запуск `node --import ./dist/service/instrument.js dist/service/main.js`, ожидание строк лога по `msg`, `/metrics`, SIGTERM | AC-9.1, AC-9.5 |
| `test/consumer/minimal/src/database.spec.ts` | `assertStrictTenantIsolation`, журнал миграций (3) | + outbox, журнал (5) |
| `test/consumer/minimal/import-check.mjs`, `types-check.ts` | импорт всех подпутей | + `messaging` |
| `test/consumer/no-testcontainers/{package.json, peer-check.mjs}` | без `pg` и `testcontainers`: config/http/observability ок; database/idempotency — текст AC-1.2; testing — … | + `messaging` |
| `test/package/ac-9-1-consumer.spec.ts:44, 129` | `runInConsumer(dir(minimal), 'pnpm', ['exec', 'vitest', 'run'])`; точные строки `import-check`; ожидания `peer-check`; `drizzle-kit` «No schema changes» | + messaging, прогоны покрытия |
| `test/package/ac-1-1-package.spec.ts` | publint, attw, подпути, `MESSAGING_ENTRIES` (задача 16) | граф `dist/testing` без `amqplib` |
| `test/package/support/consumer-project.ts` | `runInConsumer` | запуск с переменными окружения |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `test/consumer/minimal/package.json`, `pnpm-lock` потребителя (если хранится) | modify | `amqplib`, `amqp-connection-manager` |
| `test/consumer/minimal/src/service/events.ts` | create | `CompanyCreated` |
| `test/consumer/minimal/src/service/{env,schema,app.module}.ts` | modify | messaging |
| `test/package/support/consumer-project.ts` | modify | `runInConsumer(dir, command, args, env = {})` |
| `test/consumer/minimal/src/service/company-events.consumer.ts`, `messaging-options.ts` | create | обработчик `CompanyCreated`; общие опции `KitMessagingModule` |
| `test/consumer/minimal/drizzle/0003_*.sql`, `0004_messaging_grants.sql`, `meta/*` | create | таблицы и права |
| `test/consumer/minimal/global-setup.ts`, `build-service.ts` | modify / create | `rabbitmq: true`, `outboxEvents` (события — динамический импорт после `tsc`); общий шаг сборки |
| `test/consumer/minimal/src/messaging.spec.ts`, `vitest.config.ts` | create / modify | AC-9.1, AC-5.13 (покрытие есть); `fileParallelism: false` |
| `test/consumer/minimal/coverage/{vitest.config.ts, global-setup.ts, coverage.spec.ts}` | create | AC-5.13 (непокрытое событие) |
| `test/consumer/minimal/src/{observability,database}.spec.ts`, `import-check.mjs`, `types-check.ts` | modify | messaging |
| `test/consumer/no-testcontainers/{package.json, peer-check.mjs, messaging-forroot.mjs}` | modify / create | AC-1.2 |
| `test/package/ac-9-1-consumer.spec.ts`, `ac-1-1-package.spec.ts` | modify | новые проверки |

## Task 35: Потребитель публикует и потребляет событие

### Intent
AC-9.1 «публикует и потребляет событие», AC-5.13 (основной прогон), AC-9.5 в проекте-потребителе, UC-1 шаг 4 (outbox/inbox — фабрики).

### Implementation Steps
1. `package.json` потребителя (`Skill: none — манифест`): `"amqplib": "2.2.0"`, `"amqp-connection-manager": "5.0.1"` в `dependencies`. `@types/amqplib` — только если задача 3 выяснила, что он нужен.
2. `src/service/events.ts` (`Skill: nestjs-code outbox-event consumer companies CompanyCreated (CREATE)` — определение события на `defineEvent`, без слоёв сервиса): `export const CompanyCreated = defineEvent({type: 'consumer.company.created', version: 1, subject: 'company', data: z.object({companyId: z.string(), name: z.string().min(1)})}); export const CompanyArchived = defineEvent({type: 'consumer.company.archived', version: 1, subject: 'company', data: z.object({companyId: z.string()})}); export const PUBLISHED_EVENTS = [CompanyCreated, CompanyArchived] as const;`. `CompanyArchived` нужен прогону покрытия (задача 36). Основной прогон покрывает оба события.
3. `src/service/env.ts` (`Skill: nestjs-code generic test/consumer/minimal/src/service/env.ts (MODIFY)`): `defineEnv({...envBase, ...envDatabase, ...envMessaging, …})`.
4. `src/service/schema.ts` (`Skill: nestjs-code schema consumer service schema (MODIFY)`): `export const outbox = createOutboxTable(consumer); export const inbox = createInboxTable(consumer);` (`tenantNullable: false` по умолчанию, как у P/O).
5. (`Skill: nestjs-code migration consumer messaging (CREATE)`) `pnpm db:generate` в потребителе → `drizzle/0003_*.sql`. Ручная `0004_messaging_grants.sql`: `FORCE` на outbox, права `consumer_app` (как `0001` — сверить стиль), при необходимости `USAGE` на последовательность (задача 7).
6. `src/service/messaging-options.ts` (`Skill: nestjs-code generic test/consumer/minimal/src/service/messaging-options.ts (CREATE)`): `export const messagingOptions = {service: 'consumer', outbox: {table: schema.outbox, events: PUBLISHED_EVENTS}, subscriber: {inbox: schema.inbox}} satisfies KitMessagingModuleOptions;`. `src/service/app.module.ts`: `KitMessagingModule.forRoot(messagingOptions)`; провайдер `CompanyEventsConsumer`.
7. `src/service/company-events.consumer.ts` (`Skill: nestjs-code consumer consumer companies CompanyCreated (CREATE)` — consumer на `KitSubscriber`): `@Injectable() class CompanyEventsConsumer implements OnModuleInit { constructor(private readonly subscriber: KitSubscriber) {} onModuleInit() { this.subscriber.on(CompanyCreated, async (event, tx) => { /* без побочных действий: факт — строка inbox */ }); } }`. Обработчик пишет `debug`-лог через `Logger` Nest `{id: event.id}` `'consumer: company.created обработан'`.
8. Публикация в процессе `bootstrapService` — без HTTP-маршрута: у тестов потребителя нет издателя токенов (`observability.spec.ts` задаёт `AUTH_JWKS_URI` на мёртвый порт), а `POST /companies` закрыт `VerdeectAuthGuard`. `companies.controller.ts` и `items.controller.ts` не меняются, снимок `contracts/openapi.json` — тоже. Путь записи `OutboxStore.add` проверяет in-process `messaging.spec.ts` (шаг 10); процесс проверяет relay и подписчик (шаг 11).
9. `global-setup.ts` (`Skill: nestjs-code generic test/consumer/minimal/global-setup.ts (MODIFY)`): `startTestStack({service: 'consumer', postgres: true, rabbitmq: true, migrations: 'drizzle', outboxEvents: PUBLISHED_EVENTS})`. События — **динамическим** `const { PUBLISHED_EVENTS } = await import('./dist/service/events.js')` после `execFileSync(tsc)` (top-level await в файле `globalSetup` допустим). Статический `import` поднялся бы до сборки и упал бы на чистом checkout без `dist`.
10. `src/messaging.spec.ts` (`Skill: nestjs-code test integration consumer messaging (CREATE)`), в процессе теста. `createTestApp` недоступен: у потребителя нет `@nestjs/testing` (`testing-peer.spec.ts` проверяет именно это). Поэтому контекст собирается `NestFactory.createApplicationContext(MessagingTestModule, {logger: false})`, где `MessagingTestModule` в спеке = `{imports: [KitConfigModule.forRoot({schema: serviceEnvSchema}), KitDatabaseModule.forRoot({schema}), KitMessagingModule.forRoot({тот же объект опций, что в AppModule — вынести его в src/service/messaging-options.ts}), providers: [CompanyEventsConsumer]}` (без HTTP и auth). Окружение — `vi.stubEnv` (DATABASE_URL = `inject('kitDatabaseUrl')`, RABBITMQ_URL = `workerScope().rabbitmq.url`, RABBITMQ_RETRY_SECONDS = 1, `AUTH_ISSUER`, `AUTH_JWKS_URI`, `AUTH_RESOURCE` — значения из `observability.spec.ts` (`serviceEnvSchema` требует их; `SERVICE_URLS` схема не содержит и не нужен)) до `create`, `vi.unstubAllEnvs()` и `ctx.close()` в `afterAll`. vitest потребителя изолирует файлы по умолчанию, `stubEnv` не протекает. `test/consumer/minimal/vitest.config.ts` (`Skill: none — конфиг Vitest`) получает `fileParallelism: false` с комментарием «relay `messaging.spec.ts` и процесса `observability.spec.ts` опрашивают один `consumer.outbox`»: `ctx.close()` в `afterAll` останавливает relay файла до старта следующего, и строку шага 11 берёт только процесс. Случаи:
    - `AC-9.1: OutboxStore.add в транзакции — expectOutbox(tx, CompanyCreated) проходит` (покрытие `consumer.company.created.v1`);
    - `AC-9.1: CompanyArchived — expectOutbox проходит` (покрытие `consumer.company.archived.v1`);
    - `AC-9.1: relay публикует, подписчик потребляет — строка inbox по id события (waitForInbox)`;
    - `AC-5.13: publishTestEvent(CompanyCreated) + waitForInbox проверяют обработчик без sleep`.
11. `src/observability.spec.ts` (`Skill: nestjs-code test integration consumer observability (MODIFY)`; процесс `bootstrapService`): окружение + `RABBITMQ_URL`, `RABBITMQ_RETRY_SECONDS=1`:
    - `AC-9.1: строка outbox, вставленная тестом (SQL под ролью consumer_app: id = newId('evt'), tenant 'acme', type consumer.company.created, version 1, subject_id, actor {channel: 'system'}, trace_id, data), — процесс публикует её не позже опроса 1 с и сам потребляет — строка inbox` (ожидание `waitForInbox(id, {timeoutMs: 5000})`; эквивалент «строки другого процесса» AC-5.3);
    - каждый случай AC-9.5 ниже запускает свой процесс (`afterEach` его завершает), поэтому сначала вставляет свою строку outbox тем же SQL, что случай AC-9.1, и ждёт `waitForInbox(id, {timeoutMs: 5000})`, затем проверяет логи и `/metrics`;
    - `AC-9.5: relay, подписчик и очистка сообщений — строки лога с service=consumer и replica=consumer-1` (`очистка сообщений: проход` — `info`; `messaging: доставка` и `outbox: пачка опубликована` — `debug`: `LOG_LEVEL=debug` этого процесса);
    - `AC-9.5: /metrics — verdeect_events_consumed_total{service="consumer",…,result="handled"}, verdeect_cleanup_runs_total{service="consumer",table="outbox"}, …table="inbox"}, verdeect_outbox_lag_seconds{service="consumer"}`;
    - `AC-9.1: SIGTERM — выход 0 в срок` — существующий случай, теперь с RabbitMQ (шаг 3 — relay, подписчик и очистка, шаг 4 — соединение).
    - существующий `AC-9.1: /health — database и database-read up` (`observability.spec.ts` ~124-133, `toEqual({status: 'ok', checks: {database: 'up', 'database-read': 'up'}})`) → ожидание `checks: {database: 'up', 'database-read': 'up', rabbitmq: 'up'}`, `status: 'ok'`; `/health` опрашивается до `rabbitmq: 'up'` со сроком 10 000 мс × `TEST_TIMEOUT_SCALE` (сигнал, не пауза): проба `rabbitmq` (задача 16) сразу после старта может быть down.
12. `src/database.spec.ts` (`Skill: nestjs-code test integration consumer database (MODIFY)`): журнал — 5 миграций; `assertStrictTenantIsolation({schema: 'consumer'})` проходит с outbox (политика `createOutboxTable`).
13. `import-check.mjs` (`Skill: none — проверочный скрипт .mjs`) / `types-check.ts` (`Skill: nestjs-code generic test/consumer/minimal/types-check.ts (MODIFY)`): `import('@verdeect/kit/messaging')` → `messaging:ok`; типы `KitEvent`, `Envelope`, `KitMessagingModuleOptions`.

### Error Handling and Logging
По соглашениям потребителя.

### Tests
Перечислены.

### Acceptance Criteria
- `pnpm exec vitest run` потребителя зелёный с `KIT_OUTBOX_COVERAGE=1`.

### Verification
- `make test-package` (сборка архива и прогон потребителя).

## Task 36: Проверки архива — AC-1.1, AC-1.2, AC-9.1, AC-5.13, AC-5.18

### Implementation Steps
1. `test/consumer/minimal/coverage/` (`Skill: nestjs-code test integration consumer coverage (CREATE)`) — отдельный прогон того же проекта с непокрытым событием:
   - `vitest.config.ts` — `include: ['coverage/*.spec.ts']`, `globalSetup: ['./coverage/global-setup.ts']`;
   - `global-setup.ts` — тот же `execFileSync(tsc -p tsconfig.build.json)`, что основной (вынести в `build-service.ts` потребителя — `Skill: nestjs-code generic test/consumer/minimal/build-service.ts (CREATE)` — и вызвать из обоих), затем `await import('../dist/service/events.js')` и `startTestStack({service: 'consumer', postgres: true, migrations: 'drizzle', outboxEvents: PUBLISHED_EVENTS})`, без `rabbitmq`: покрытию брокер не нужен;
   - `coverage.spec.ts`:
     - `AC-5.13: CompanyCreated покрыт` — `expectOutbox` успешный;
     - `AC-5.13: упавший expectOutbox(CompanyArchived) покрытия не даёт` — `await expect(expectOutbox(tx, CompanyArchived)).rejects.toThrow()` без строки.
     Транзакции на `Db` — `NestFactory.createApplicationContext` модуля `{imports: [KitConfigModule.forRoot(...), KitDatabaseModule.forRoot({schema})]}` без `KitMessagingModule` (брокера в этом прогоне нет; `vi.stubEnv` DATABASE_URL). `OutboxStore` не нужен: строка `CompanyCreated` вставляется SQL под ролью приложения (`tx.execute(insert into consumer.outbox (id, tenant, type, version, subject_id, actor, trace_id, data) values …)`) в транзакции `db.transaction(ctx('acme'), …)`. `expectOutbox` проверяет строку, а не путь записи.
2. `test/package/ac-9-1-consumer.spec.ts` (`Skill: nestjs-code test unit package consumer (MODIFY)`):
   - `AC-9.1: проект-потребитель проходит свои тесты` — основной прогон с `KIT_OUTBOX_COVERAGE=1` (покрыты оба события) → выход 0;
   - `AC-5.13: при KIT_OUTBOX_COVERAGE=1 событие без успешного expectOutbox роняет teardown со списком типов` — `runInConsumer(minimal, 'pnpm', ['exec', 'vitest', 'run', '-c', 'coverage/vitest.config.ts'], {KIT_OUTBOX_COVERAGE: '1'})` → выход ≠ 0, вывод содержит `consumer.company.archived.v1` и не содержит `consumer.company.created.v1` в списке;
   - `AC-5.13: без KIT_OUTBOX_COVERAGE тот же прогон не падает` → выход 0;
   - `AC-5.18: после прогона потребителя vhost и пользователи с префиксом consumer-test- удалены` — вывод основного прогона содержит `[startTestStack] RabbitMQ: удалено vhost N, пользователей N` с N ≥ 1 (задача 13);
   - `import-check` — точная строка + `messaging:ok` (по алфавиту);
   - `drizzle-kit generate` потребителя — «No schema changes» (схема с outbox и inbox грузится через `require`, П15 E4 — без `ERR_REQUIRE_ASYNC_MODULE`).
   `test/package/support/consumer-project.ts` (`Skill: nestjs-code generic test/package/support/consumer-project.ts (MODIFY)`): `runInConsumer(dir, command, args)` сейчас вызывает `runCommand(command, args, dir)` без окружения — добавить 4-й параметр `env: Readonly<Record<string, string>> = {}` и передать его в `runCommand` (`test/package/support/pack.ts:32` уже принимает `env`). Вызов выше — `runInConsumer(minimal, 'pnpm', [...], {KIT_OUTBOX_COVERAGE: '1'})`.
3. `test/consumer/no-testcontainers` (`Skill: none — проверочный скрипт .mjs`):
   - `package.json` + `amqplib` 2.2.0, `amqp-connection-manager` 5.0.1 (без `pg`, без `testcontainers`);
   - `peer-check.mjs`: `@verdeect/kit/messaging` импортируется без `pg` → `messaging:ok`;
   - новый `messaging-forroot.mjs`: `KitMessagingModule.forRoot({service: 'peer-check', subscriber: {dedupe: 'none'}})` резолвится; `forRoot({service: 'peer-check', outbox: {table, events: []}})` с таблицей `createOutboxTable(pgSchema('peer-check'))` → отказ с текстом «@verdeect/kit/messaging требует pg — добавьте в зависимости сервиса». Имя — по `^[a-z][a-z0-9-]{1,31}$` (не короче 2 знаков), иначе `TypeError` раньше проверки `pg`. `peer-check.mjs` по-прежнему выдаёт `testing:@verdeect/kit/testing требует testcontainers …` (`test/package/ac-9-1-consumer.spec.ts:99`).
   - Случай «без `amqplib`»: третий проект не создаётся. Это U-тест `requirePeerWith` (задача 17) и проверка графа `dist/messaging` (п. 4) — статический граф не тянет пакет до `requirePeer`.
   - `ac-9-1-consumer.spec.ts`: ожидания `peer-check` + `messaging:ok`; запуск `messaging-forroot.mjs` → две строки результата.
4. `test/package/ac-1-1-package.spec.ts` (`Skill: nestjs-code test unit package package (MODIFY)`):
   - `AC-1.1: publint --strict и attw --profile esm-only — без замечаний с ./messaging` (существующие проверки по всем `exports` — новый вход проверяется автоматически, убедиться);
   - `AC-1.2: dist/messaging — первый импорт peer.js, без статического pg, amqplib, amqp-connection-manager, drizzle-orm/node-postgres, database, без TLA` (`MESSAGING_ENTRIES`, задача 16);
   - `AC-1.1: dist/testing не импортирует amqplib и messaging/index статически` — `/testing` грузится без `amqplib`;
   - архив содержит `dist/messaging/**`, `dist/cli/commands/rabbitmq.js`, `dist/internal/rabbitmq-definitions.js`.

### Tests
Перечислены. `make test-package`.

### Acceptance Criteria
- `make pack-check` зелёный: AC-1.1, AC-1.2, AC-9.1, AC-5.13 на архиве.

### Verification
- `make pack-check`.

## Phase Risks and Mitigations
- Риск: прогон потребителя дольше (RabbitMQ + 3 прогона vitest). Смягчение: прогон покрытия без брокера; NFR-7 — ориентир `make ci` < 10 мин, замерить и записать в итог.
- Риск: in-process тест потребителя с `vi.stubEnv` и nestjs-pino 5.3 (один pino-http на процесс, RULES.md). Смягчение: `messaging.spec.ts` — отдельный файл; vitest потребителя изолирует файлы по умолчанию.

## Phase Completion Checklist
- Задачи 35–36 выполнены; `make pack-check` зелёный.
- `index.md` обновлён.
