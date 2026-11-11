# Фаза 6: Подпуть `/idempotency`

Plan: [index.md](index.md)
Tasks: 25-34
Depends on: Phase 1 (Task 3), Phase 5 (Tasks 17–24)

## Цель

`createIdempotencyTable`, `idempotencyPurgeSql`, `KitIdempotencyModule.forRoot({table})` (хранилище на `Db`, проверка функции очистки при старте, очистка через `runExclusive` и `deleteInBatches`), `@Idempotent({required?, tenantFromBody?})` и интерсептор (§3.3а PRD v1.14, UC-7, AC-4.14); заголовки идемпотентности в OpenAPI по метаданным `@Idempotent` (§3.5); метрики очистки (AC-9.5). Подпуть `./idempotency` в `exports`.

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| O `src/shared/http/idempotency.interceptor.ts` | `IDEMPOTENT`, `KEY_FORMAT = /^[\x21-\x7E]{1,200}$/`, `readIdempotencyKey`, `canonicalJson`, `requestHash`, `run`, `completeWithRetry`, статус из `HTTP_CODE_METADATA` (POST → 201) | эталон интерсептора |
| O `src/shared/http/idempotency.store.ts` | `begin` (`INSERT … ON CONFLICT DO NOTHING` → `SELECT … FOR UPDATE`, `expired` 24 ч, `abandoned` 5 мин, `mismatch` до `in_progress`), `complete`, `release`, `purge` | эталон хранилища |
| O `src/shared/http/idempotency-cleanup.job.ts` | `@Cron` раз в час, `deleteInBatches(…, {batchSize: 1000, maxBatches: 100, shouldContinue})`, `beforeApplicationShutdown` | эталон очистки; `@nestjs/schedule` — не peer kit, расписание — таймер |
| O `drizzle/0000_tables.sql:230-243`, `0002_functions.sql:69-121` | колонки, PK, индекс `created_at`, функция `idempotency_purge(p_limit)` `SECURITY DEFINER`, владелец directory, временный `GRANT CREATE ON SCHEMA` | эталон таблицы и функции |
| O `test/http/shared/idempotency.http-spec.ts`, `test/http/turns/ac-2-2-idempotency.http-spec.ts`, `test/integration/shared/idempotency-cleanup.int-spec.ts` | случаи (см. задачу 34) | тесты эквивалентности AC-4.14 |
| `@verdeect/auth` `dist/index.d.ts` | `UserPrincipal {sub, clientId, tenant}`, `AgentPrincipal {sub, tenant}`, `ServicePrincipal {clientId}`; `@verdeect/auth/nest` — `principalOf`, `VerdeectAuthGuard`; `@verdeect/auth/testing` — `createTestSigner`, `TEST_RESOURCE` | область ключа; тестовые токены |
| `src/http/errors.ts:45-50` | `IDEMPOTENCY_KEY_REUSED` 422, `IDEMPOTENCY_IN_PROGRESS` 409, `IDEMPOTENCY_KEY_REQUIRED` 400; `DomainError` | коды уже в `kitErrors` (E3) |
| `src/http/api/openapi-document.ts` | `parametersOf`, `errorsOf`, `buildOpenApiDocument`, `metadataOf` | заголовки по метаданным |
| `src/internal/metadata.ts` | `IDEMPOTENT_METADATA`, `KitIdempotentOptions` | задача 3 |
| `src/observability/metrics.ts` | `KitMetrics`, `kitMetrics` | метрики очистки |
| `test/support/fake-sentry.ts` | `initFakeSentry` | «событие GlitchTip ровно одно» |
| `test/unit/http/bootstrap-support.ts` | `useBootstrapStand`, `ExitCalled` | отказ запуска через `failStartup` |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/observability/metrics.ts` | modify | `cleanupRuns` (`verdeect_cleanup_runs_total`) |
| `alerts/verdeect-kit.rules.yml`, `test/fixtures/alerts/verdeect-kit.test.yml`, `test/package/ac-2-11-alert-rules.spec.ts` | modify | правило `VerdeectCleanupFailing` и его проверки (AC-2.11) |
| `src/idempotency/table.ts` | create | `createIdempotencyTable`, `idempotencyPurgeSql`, тип `KitIdempotencyTable` |
| `src/idempotency/idempotent.decorator.ts` | create | `Idempotent` |
| `src/idempotency/idempotency.interceptor.ts` | create | `IdempotencyInterceptor`, хранилище, отпечаток |
| `src/idempotency/kit-idempotency.module.ts` | create | `KitIdempotencyModule`, очистка, проверка функции |
| `src/idempotency/peer.ts` | create | `requirePeer('pg', 'idempotency')` (синхронно) |
| `src/idempotency/index.ts` | create | публичная поверхность §3.3а |
| `package.json` | modify | `exports["./idempotency"]` |
| `src/http/api/openapi-document.ts` | modify | `Idempotency-Key`, `Idempotent-Replayed`, коды `IDEMPOTENCY_*` |
| `test/fixtures/database/schema.ts`, `migrations/**` | modify | таблица идемпотентности, функция очистки |
| `test/unit/idempotency/*.spec.ts`, `test/unit/http/ac-3-7-openapi-idempotency.spec.ts`, `test/unit/observability/ac-2-8-metrics.spec.ts` | create / modify | U |
| `test/integration/idempotency/*.spec.ts` | create | I AC-4.14, AC-9.5 |
| `vitest.integration.config.ts` | modify | `ISOLATED` с причинами |

## Task 25: Метрика очистки и правило алерта (AC-9.5, AC-2.11)

### Назначение
NFR-8, AC-9.5: фоновая операция (очистка идемпотентности — с E4; outbox/inbox — E5 использует ту же метрику) пишет метрику с `service`. Решение плана П8 с условиями KT-19 п. 2: одна общая метрика очистки пакета; число удалённых строк — в `info`-логе прохода; AC-2.11 — правило на каждую метрику пакета.

### Шаги
1. `src/observability/metrics.ts` (`Skill: nestjs-code generic src/observability/metrics.ts (MODIFY)`): в `KitMetrics` и `kitMetrics` — `cleanupRuns: Counter<'table' | 'result'>`, имя `verdeect_cleanup_runs_total`, help «Проходы фоновой очистки по таблице и итогу (ok, partial, error)». TSDoc: `table` — имя таблицы без схемы, значения ограничены таблицами пакета (`idempotency_key`; в E5 — `outbox`, `inbox`); `result`: `ok` — проход завершён, `partial` — упёрся в `maxBatches`, а записи старше срока остались (очистка не успевает), `error` — проход упал. Проход, не взявший блокировку (другая реплика), метрику не меняет. Метрики числа удалённых строк нет.
2. Шапку файла дополнить «AC-9.5 (E4): метрика очистки».
3. `alerts/verdeect-kit.rules.yml` (`Skill: none — правила vmalert (YAML)`): правило `VerdeectCleanupFailing` в группе `verdeect-kit`, по образцу `VerdeectEventsDlq` (порог по умолчанию 0, переопределение по `service`):
   ```yaml
   - alert: VerdeectCleanupFailing
     # Порог по умолчанию — 0: любой неудачный или неполный проход очистки за 2 часа.
     expr: |
       sum by (service, table, result) (increase(verdeect_cleanup_runs_total{result=~"error|partial"}[2h]))
         > on (service) group_left ()
       (
         max by (service) (verdeect_kit_threshold:cleanup_runs)
           or on (service) (max by (service) (verdeect_cleanup_runs_total) * 0)
       )
     labels:
       severity: warning
     annotations:
       summary: 'Очистка {{ $labels.table }} сервиса {{ $labels.service }}: {{ $labels.result }}'
       description: >-
         За 2 часа проход очистки таблицы {{ $labels.table }} сервиса {{ $labels.service }} завершился с итогом
         {{ $labels.result }} (verdeect_cleanup_runs_total). error — проход упал: ошибка в журнале сервиса
         («очистка … : ошибка»). partial — проход упёрся в предел пачек, записи старше срока остались: очистка
         не успевает за потоком записей.
   ```
   Комментарий в шапке файла — добавить `:cleanup_runs` в список имён порогов.
4. `test/fixtures/alerts/verdeect-kit.test.yml` (`Skill: none — фикстура vmalert-tool`): случаи `VerdeectCleanupFailing` — `result="error"` прирост 1 → алерт с `result: error`; `result="partial"` → алерт с `result: partial`; только `ok` → `exp_alerts: []`; переопределение порога `verdeect_kit_threshold:cleanup_runs` = 5 для сервиса — прирост 1 без алерта (как у существующих правил). Существующую серию `verdeect_db_pool_wait_timeouts_total{service="c",pool="write"}` (стр. 23) заменить на `pool="main"` — метки пула только `main` и `read` (KT-19 п. 3).
5. `test/package/ac-2-11-alert-rules.spec.ts` (`Skill: nestjs-code test unit package alert-rules (MODIFY)`): `toHaveLength(5)` → 6 (метрики `verdeect_*` реестра); список порогов `THRESHOLDS` — + `verdeect_kit_threshold:cleanup_runs`.
6. `test/unit/observability/ac-2-8-metrics.spec.ts` (`Skill: nestjs-code test unit observability metrics (MODIFY)`): случай `AC-9.5: kitMetrics — verdeect_cleanup_runs_total{table,result} с меткой service`.

### Ошибки и логи
Нет.

### Проверка
- `make test FILTER='AC-9.5'`; `make pack-check` (AC-2.11 — vmalert в Docker).

## Task 26: `createIdempotencyTable` и `idempotencyPurgeSql`

### Назначение
§6 и §3.3а v1.14: таблица `idempotency_key` в схеме сервиса под RLS `tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')`; текст SQL функции очистки для миграции сервиса (при строгой политике `<svc>_app` чужих записей не видит).

### Шаги
1. Создать `src/idempotency/table.ts` (`Skill: nestjs-code generic src/idempotency/table.ts (CREATE)`). Шапка: «createIdempotencyTable, idempotencyPurgeSql (prd.md §3.3а v1.14, §6, AC-4.8, AC-4.14). Эталон — O idempotency.schema.ts, 0002_functions.sql idempotency_purge. По PRD: tenant nullable, subject вместо actor, ответ с Location, политика IS NOT DISTINCT FROM nullif(…)». Файл **без `pg`** (импортируется `drizzle-kit` фикстур и схемой сервиса): внешние пакеты — только `drizzle-orm`, `drizzle-orm/pg-core`; внутренние — `../internal/service-name.js` (`assertServiceName`), `../internal/sql-identifier.js` (`quoteIdentifier`).
2. `createIdempotencyTable(schema: PgSchema)` → таблица `idempotency_key` (тип `KitIdempotencyTable` — `ReturnType` фабрики, экспорт):
   | Колонка | Тип | Ограничения |
   |---|---|---|
   | `tenant` | `text` | nullable (запись без компании — сервисный вызов без `tenantFromBody`) |
   | `subject` | `text` | not null; `user:<sub>`, `agent:<sub>`, `service:<client_id>` |
   | `key` | `text` | not null |
   | `fingerprint` | `text` | not null; SHA-256 hex |
   | `state` | `text` | not null, default `in_progress`; `CHECK (state IN ('in_progress', 'done'))` |
   | `response_status` | `smallint` | nullable |
   | `response_body` | `jsonb` | nullable |
   | `response_location` | `text` | nullable (§6 «ответ (статус, тело, `Location`)») |
   | `created_at` | `timestamptz` | not null, default `now()` |
   - Уникальность области и ключа — `unique('idempotency_key_scope_key').on(tenant, subject, key).nullsNotDistinct()` (PK по колонке с `NULL` невозможен в PostgreSQL; `NULLS NOT DISTINCT` — PostgreSQL ≥ 15, `TEST_IMAGES` — 17.11). Решение плана: «PK по области и ключу» §6 выражен уникальным ограничением.
   - Индекс `idempotency_key_created_idx` по `created_at`.
   - Политика `pgPolicy('idempotency_key_scope', {as: 'permissive', for: 'all', to: 'public', using, withCheck})`, выражение:
     ```sql
     tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')
     ```
3. `idempotencyPurgeSql(schema: PgSchema): string`:
   1. Имя схемы — `schema.schemaName`; проверка той же внутренней функцией, что имя сервиса: `assertServiceName(name, 'idempotencyPurgeSql')` (`^[a-z][a-z0-9-]{1,31}$`, как у `bootstrapService`, `prepareDatabase`, `createCipher`; KT-20 п. 1 — регулярка KT-18 `^[a-z][a-z0-9_]{1,31}$` не используется); вне формата → `TypeError`. Роли — `<схема>_directory`, `<схема>_app` (длина ≤ 63). **Все идентификаторы** — схема, таблица `idempotency_key`, функция `idempotency_purge`, роли — только через `quoteIdentifier` (`src/internal/sql-identifier.ts`, задача 3), строковой подстановки без экранирования нет.
   2. Текст — операторы через `\n--> statement-breakpoint\n` (разделитель миграций Drizzle):
      ```sql
      CREATE OR REPLACE FUNCTION "<s>"."idempotency_purge"(batch integer) RETURNS integer
          LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = "<s>", pg_temp AS $$
      DECLARE deleted integer;
      BEGIN
          DELETE FROM "<s>"."idempotency_key" i WHERE i.ctid IN (
              SELECT o.ctid FROM "<s>"."idempotency_key" o
              WHERE o.created_at < now() - interval '24 hours' ORDER BY o.created_at LIMIT batch);
          GET DIAGNOSTICS deleted = ROW_COUNT;
          RETURN deleted;
      END $$;
      --> statement-breakpoint
      GRANT SELECT, DELETE ON "<s>"."idempotency_key" TO "<s>_directory";
      --> statement-breakpoint
      GRANT CREATE ON SCHEMA "<s>" TO "<s>_directory";
      --> statement-breakpoint
      ALTER FUNCTION "<s>"."idempotency_purge"(integer) OWNER TO "<s>_directory";
      --> statement-breakpoint
      REVOKE CREATE ON SCHEMA "<s>" FROM "<s>_directory";
      --> statement-breakpoint
      REVOKE ALL ON FUNCTION "<s>"."idempotency_purge"(integer) FROM PUBLIC;
      --> statement-breakpoint
      GRANT EXECUTE ON FUNCTION "<s>"."idempotency_purge"(integer) TO "<s>_app";
      ```
      (временный `GRANT CREATE` нужен смене владельца — эталон O `0002_functions.sql:97,103`; миграция выполняется под `<s>_owner`, который член `<s>_directory` — `prepareDatabase`).
   3. TSDoc: сервис кладёт текст в свою SQL-миграцию (`drizzle-kit generate --custom`), README — пример.
4. Константы для других файлов подпути: `PURGE_FUNCTION` = `idempotency_purge`, `IDEMPOTENCY_TABLE` = `idempotency_key`.

### Тесты
Задача 33 (текст), 34 (действие), 36 (`assertStrictTenantIsolation`).

## Task 27: `@Idempotent`

### Шаги
1. Создать `src/idempotency/idempotent.decorator.ts` (`Skill: nestjs-code generic src/idempotency/idempotent.decorator.ts (CREATE)`). Шапка: «@Idempotent (prd.md §3.3а, AC-4.14). Эталон — O IDEMPOTENT/SetMetadata; ключ метаданных — internal/metadata.ts (читает OpenAPI /http)». Без `pg`.
2. `Idempotent(options: KitIdempotentOptions = {})` — `SetMetadata(IDEMPOTENT_METADATA, options)`; `tenantFromBody` пустая строка или с пустым сегментом пути → `TypeError` при объявлении. TSDoc: только на маршрутах с `VerdeectAuthGuard` (PRD v1.14).
3. Экспорт типа `KitIdempotentOptions` — реэкспорт из `internal/metadata.ts` в `index.ts`.

## Task 28: Интерсептор и хранилище

### Назначение
UC-7, AC-4.14, §3.3а.

### Шаги
1. Создать `src/idempotency/idempotency.interceptor.ts` (`Skill: nestjs-code generic src/idempotency/idempotency.interceptor.ts (CREATE)`). Шапка: «IdempotencyInterceptor и хранилище (prd.md §3.3а v1.14, AC-4.14, UC-7). Эталон — O idempotency.interceptor.ts + idempotency.store.ts. По PRD: область user/agent → (tenant, sub), service → client_id или (client_id, поле tenantFromBody); Location в ответе; без принципала — 500; коды — DomainError словаря /http».
2. Константы: `KEY_FORMAT` = `^[\x21-\x7E]{1,200}$` (O); `ABANDONED_AFTER_MINUTES` = 5; `EXPIRES_AFTER_HOURS` = 24; заголовки `idempotency-key` (вход), `Idempotent-Replayed` (выход).
3. Чистые функции (экспорт внутри пакета для U-тестов): `canonicalJson(value)` — порт O (массивы по порядку, ключи объектов по возрастанию кодовых единиц, `undefined` → `null`); `fingerprintOf(method, path, body)` — SHA-256 hex от `<METHOD> <path>\n<canonicalJson(body ?? null)>`, путь — `req.originalUrl ?? req.url` без query (RULES.md: путь Fastify); `scopeOf(principal, body, options)` → `{tenant: string | null, subject: string}`:
   - `user` → `{tenant: principal.tenant, subject: 'user:' + sub}`; опция `tenantFromBody` игнорируется (подложный `tenant` в теле не меняет область);
   - `agent` → `{tenant: principal.tenant, subject: 'agent:' + sub}`; опция игнорируется;
   - `service` → `subject: 'service:' + clientId`; `tenant` — значение поля `tenantFromBody` (путь через точку по объекту тела), если это непустая строка, иначе `null` (поле отсутствует, пустое или не строка — без ошибки).
4. `IdempotencyInterceptor` (`@Injectable()`, внедряет `Reflector`, `Db`, токен таблицы `KIT_IDEMPOTENCY_TABLE` из модуля):
   1. метаданных `IDEMPOTENT_METADATA` нет → `next.handle()`;
   2. принципал — проверяется **до ключа** (PRD v1.14 §3.3а: без принципала — 500 при любом ключе и без ключа); `principalOf(request)` из `@verdeect/auth/nest`; `null` → `Error` «@Idempotent: нет проверенного принципала — нужен VerdeectAuthGuard на маршруте» (фильтр: 500 `INTERNAL_ERROR`, `error`-лог, GlitchTip ровно раз; обработчик не вызывается — PRD v1.14);
   3. ключ: нет заголовка → `required` ? `DomainError('IDEMPOTENCY_KEY_REQUIRED')` : `next.handle()`; не строка или не по `KEY_FORMAT` → `DomainError('VALIDATION_FAILED', {issues: [{path: 'Idempotency-Key', code: 'invalid'}]})` (O);
   4. `scope`, `fingerprint`; `DbContext` — `{tenant: scope.tenant, traceId: String(request.id), actor: {clientId?, channel: 'http'}}`;
   5. Сравнение области во всех запросах `SELECT`/`UPDATE`/`DELETE` — `tenant IS NOT DISTINCT FROM $tenant AND subject = $subject AND key = $key` (у O — `eq(tenant, ctx.tenant ?? '')`, при nullable `tenant` равенство с `NULL` всегда ложно: сервисный вызов без `tenantFromBody` выполнял бы обработчик при каждом повторе). `begin` — одна `db.transaction(ctx)`: `INSERT … ON CONFLICT ON CONSTRAINT idempotency_key_scope_key DO NOTHING RETURNING key`; вставлено → `new`; иначе `SELECT … FOR UPDATE` строки области с вычисленными `expired` (`created_at < now() - interval '24 hours'`) и `abandoned` (`state = 'in_progress' AND created_at < now() - make_interval(mins => 5)`); строки нет после конфликта `INSERT` → `Error` «idempotency: строка области не найдена после конфликта» (ошибка разработчика, 500; нормально не возникает — `FOR UPDATE` видит строку под той же политикой); `expired` или `abandoned` → `UPDATE` (`fingerprint`, `state = 'in_progress'`, ответ `NULL`, `created_at = now()`) → `new` (`abandoned` — `warn`); иначе `fingerprint` другой → `mismatch`; `in_progress` → `in_progress`; иначе `replay` (`status`, `body`, `location`). Порядок проверок — как O (`mismatch` до `in_progress`). Гонка двух первых запросов: второй `INSERT` ничего не вставит, `SELECT … FOR UPDATE` дождётся `COMMIT` первого и увидит `in_progress` → 409 (уникальное ограничение — последняя защита).
   6. `mismatch` → `DomainError('IDEMPOTENCY_KEY_REUSED')`; `in_progress` → `DomainError('IDEMPOTENCY_IN_PROGRESS')`; оба — `warn` `{subjectKind, keyPrefix: первые 8 знаков ключа, traceId}` (ключ целиком и `sub` не логируются);
   7. `replay` → статус, `Idempotent-Replayed: true`, `Location` (если сохранён), тело как сохранено;
   8. `new` → выполнить `next.handle()` (`lastValueFrom`, умолчание `undefined`); ошибка обработчика → `release` (`DELETE … WHERE <область> AND state = 'in_progress'` в своей транзакции; сбой `release` — `error`-лог + `captureError`), затем исходная ошибка дальше (ошибки не сохраняются, повтор выполняется заново — O);
   9. успех: статус — `HTTP_CODE_METADATA` обработчика, иначе POST → 201, прочие → 200 (O); `Location` — `reply.getHeader('location')` после обработчика (строка или `null`); `complete` — `UPDATE state = 'done', response_status, response_body, response_location` в своей транзакции; первый сбой — `warn` и повтор, второй — `error` + `captureError` (клиент получает ответ, строка `in_progress` переиспользуется через 5 мин — O `completeWithRetry`);
   10. `debug` `{subjectKind, keyPrefix, state}` на `begin` и `complete`.
5. Ответ обработчика сохраняется как JSON (`response_body` `jsonb`); не JSON-сериализуемое тело — ошибка `complete` (лог и `captureError`, как сбой).

### Контракты
- Сочетания §3.3а — таблица «Сочетания» в `index.md` (Requirements Reconciliation).
- Тело и `Location` ответа — в БД под RLS, не в логах.

### Тесты
Задачи 33, 34.

## Task 29: `KitIdempotencyModule`

### Шаги
1. Создать `src/idempotency/kit-idempotency.module.ts` (`Skill: nestjs-code generic src/idempotency/kit-idempotency.module.ts (CREATE)`). Шапка: «KitIdempotencyModule.forRoot({table}) (prd.md §3.3а v1.14, AC-4.14, AC-9.5, UC-9). Эталон — O idempotency.module.ts + idempotency-cleanup.job.ts; по PRD: очистка через runExclusive функцией idempotency_purge пачками; нет функции — отказ запуска; расписание — таймер (без @nestjs/schedule)».
2. `forRoot({table})` → `DynamicModule`, `global: true`: провайдер `KIT_IDEMPOTENCY_TABLE` (таблица), `{provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor}`, класс очистки `IdempotencyCleanup`. Модуль требует `KitDatabaseModule` (`Db` глобален); нет `Db` — Nest сам отказывает при сборке.
3. Схема таблицы — `getTableConfig(table).schema`; формат — `assertServiceName`; нет схемы → `TypeError` при `forRoot` «KitIdempotencyModule: таблица без схемы — createIdempotencyTable(pgSchema(…))».
4. `IdempotencyCleanup` (внедряет `Db`, таблицу, `KIT_METRICS` и `KIT_LOGGER` — оба с `optional: true`; `KitLifecycle` не нужен — остановка через хуки Nest). Логи прохода — через `KIT_LOGGER` экземпляра приложения (логгер pino с `base` `service`, `replica`); нет `KIT_LOGGER` — `new Logger('IdempotencyCleanup')` Nest. Логгер Nest вне запроса nestjs-pino 5.3 отправляет в корневой логгер процесса (первого приложения), поэтому в тестах проекта `shared` его не перехватить:
   - `onModuleInit` (до прослушивания порта): `db.readGlobal` — `select to_regprocedure($1) is not null as ok` с параметром `quoteIdentifier(<схема>) + '.' + quoteIdentifier(PURGE_FUNCTION) + '(integer)'` (имя схемы — `assertServiceName` при `forRoot`); `false` → `Error` «KitIdempotencyModule: нет функции <схема>.idempotency_purge — добавьте idempotencyPurgeSql(<схема>) в SQL-миграцию сервиса» (в `bootstrapService` — `failStartup`, в тестах — отказ `createTestApp`);
   - `onApplicationBootstrap`: промис первого прохода создаётся **синхронно** в самом хуке — задержка 0 мс через таймер с `unref()`, затем `run()`; промис сохраняется как текущий проход; затем `setInterval(…, CLEANUP_INTERVAL_MS).unref()`, `CLEANUP_INTERVAL_MS` = 3 600 000 (O — раз в час);
   - проход — `run(limits?)`; пределы по умолчанию — константа файла `CLEANUP_LIMITS` `{batchSize: 1000, maxBatches: 100}`; параметр `limits` нужен только тестам пакета (класс не экспортируется из `index.ts`, публичный API не меняется); повтор проходов не накладывается (идущий — пропуск): `runExclusive(db, 'verdeect-kit:idempotency-cleanup:<схема>', …)` → `deleteInBatches({db, sql: batch → select <quoteIdentifier(схема)>.<quoteIdentifier('idempotency_purge')>(batch) as deleted (идентификаторы — `quoteIdentifier`, `batch` — параметр), ...limits, shouldContinue: () → !stopped})`;
   - итог (KT-19 п. 2): `{ran: false}` → метрика не меняется, `debug` «очистка идемпотентности: другая реплика»; успех — `result` = `partial`, если `complete` ложь и `batches === maxBatches` (остались записи старше срока), иначе `ok`; `cleanupRuns.inc({table: 'idempotency_key', result})`; `info` `{table, deleted, batches, result}` «очистка идемпотентности: проход» (`service`, `replica` — из `base` логгера приложения); ошибка → `result: 'error'`, `error` `{table, err: sanitizeError}` «очистка идемпотентности: ошибка», `captureError`; ошибка не пробрасывается;
   - внутренний метод `idle()` — текущий проход, включая ещё не начатый первый (промис создан в `onApplicationBootstrap`, поэтому `idle()` сразу после `createTestApp` ждёт и первый проход); прохода нет — разрешённый промис; нужен тестам пакета;
   - `beforeApplicationShutdown` (шаг 3, решение E3): `stopped = true`, снять таймеры, дождаться идущего прохода (пачка дорабатывает, новая не начинается).
5. Участников `KitLifecycle` модуль не регистрирует.

### Тесты
Задача 34.

## Task 30: `peer.ts`, публичный `/idempotency`, `exports`

### Шаги
1. Создать `src/idempotency/peer.ts` (`Skill: nestjs-code generic src/idempotency/peer.ts (CREATE)`): синхронный `requirePeer('pg', 'idempotency')` (задача 4; без top-level await — схему сервиса грузит `drizzle-kit` через `require`); шапка «первым импортом index.ts: без pg — текст AC-1.2 с /idempotency, раньше загрузки /database».
2. Создать `src/idempotency/index.ts` (`Skill: nestjs-code generic src/idempotency/index.ts (CREATE)`): первый импорт — `./peer.js`; реэкспорты `createIdempotencyTable`, `idempotencyPurgeSql`, тип `KitIdempotencyTable`, `KitIdempotencyModule`, `Idempotent`, тип `KitIdempotentOptions`. `IdempotencyInterceptor` не экспортируется (регистрирует модуль).
3. `package.json` `exports["./idempotency"]` — `{types, default}` на `dist/idempotency/index.*`; `test/unit/package/package-manifest.spec.ts` — список `exports` с `./idempotency` и случай формы.

## Task 31: Заголовки идемпотентности в OpenAPI

### Шаги
1. `src/http/api/openapi-document.ts` (`Skill: nestjs-code generic src/http/api/openapi-document.ts (MODIFY)`): шапка — «Idempotency-Key — по метаданным @Idempotent (internal/metadata.ts, E4)».
2. По `IDEMPOTENT_METADATA` обработчика (только метод — декоратор методный). Ошибки — в `errorsOf` (его же использует `routeResponseSchema` → `expectMatchesApi`, `src/testing/expect-matches-api.ts`): иначе документ и проверка ответа расходятся. Параметр и заголовок ответа — в `buildOperation`/`parametersOf`:
   - параметр заголовка `{name: 'Idempotency-Key', in: 'header', required: options.required === true, schema: {type: 'string', pattern: '^[\\x21-\\x7E]{1,200}$'}}` — последним в `parameters`;
   - заголовок успешного ответа `Idempotent-Replayed` — `{schema: {type: 'string', enum: ['true']}, description: 'ответ сохранён и повторён'}`;
   - ошибки в `errorsOf` (дописываются к существующим кодам статуса): 409 `IDEMPOTENCY_IN_PROGRESS` (вместе с `TENANT_REQUIRED`, если он есть), 422 `IDEMPOTENCY_KEY_REUSED` (вместе с `VALIDATION_FAILED`), при `required` — 400 `IDEMPOTENCY_KEY_REQUIRED` (вместе с `BAD_REQUEST`).
3. Импорт — только `../../internal/metadata.js` (http не импортирует idempotency, lint).

## Task 32: Фикстура БД — таблица идемпотентности и функция

### Шаги
1. `test/fixtures/database/schema.ts` (`Skill: none — фикстура теста, TypeScript схемы Drizzle; соглашения nestjs-code test`): `export const idempotency = createIdempotencyTable(kit)` (импорт из `../../../src/idempotency/table.js`).
2. `pnpm db:fixtures` → новая миграция `0002_*.sql` (таблица, ограничение, индекс, `ENABLE RLS`, политика).
3. `drizzle-kit generate … --custom --name idempotency_purge` → `0003_idempotency_purge.sql`: строки `ALTER TABLE "kit"."idempotency_key" FORCE ROW LEVEL SECURITY;`, `GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."idempotency_key" TO "kit_app";` и **текст `idempotencyPurgeSql(kit)` байт в байт**, после строки `--> statement-breakpoint`. Текст получить после `make build` командой:
   ```bash
   node --input-type=module -e "import { pgSchema } from 'drizzle-orm/pg-core'; import { idempotencyPurgeSql } from './dist/idempotency/table.js'; process.stdout.write(idempotencyPurgeSql(pgSchema('kit')));"
   ```
4. U-тест задачи 33 сверяет файл с выводом функции (защита от расхождения).
5. Новая миграция попадает и в копию фикстуры теста AC-4.17 (задача 11): там роли `kit_*` и схема заменяются на `kitcli_*`/`kitcli` — после этой задачи прогнать `make test-module M='cli'`.

## Task 33: Тесты U

### Шаги
1. `test/unit/idempotency/idempotency-purge-sql.spec.ts` (`Skill: nestjs-code test unit idempotency purge-sql (CREATE)`), `describe('UC-7: idempotencyPurgeSql')`:
   - `AC-4.14: функция "kit"."idempotency_purge"(batch integer) RETURNS integer, SECURITY DEFINER, SET search_path = "kit", pg_temp`;
   - `AC-4.14: владелец kit_directory, REVOKE ALL … FROM PUBLIC, GRANT EXECUTE … TO kit_app, удаление старше 24 ч`;
   - `KT-20: имя схемы вне формата имени сервиса ^[a-z][a-z0-9-]{1,31}$ → TypeError` (`it.each`: `Kit`, `k`, `kit_app`, `kit;drop`, `kit"x`, 33 знака);
   - `KT-20: idempotencyPurgeSql(pgSchema('bff-app')) — "bff-app"."idempotency_purge", OWNER TO "bff-app_directory", GRANT EXECUTE … TO "bff-app_app", SET search_path = "bff-app", pg_temp; все идентификаторы в двойных кавычках`;
   - `AC-4.14: 0003_idempotency_purge.sql фикстуры содержит текст idempotencyPurgeSql(kit) без изменений`.
2. `test/unit/idempotency/fingerprint.spec.ts` (`Skill: nestjs-code test unit idempotency fingerprint (CREATE)`): `AC-4.14: canonicalJson — порядок ключей не влияет, вложенные объекты сортируются, массивы по порядку`; `AC-4.14: отпечаток — метод + путь без query + SHA-256 тела`; `AC-4.14: scopeOf — user (tenant, user:sub), agent (tenant, agent:sub), service (null, service:client)`; `AC-4.14: service + tenantFromBody 'org.slug' — tenant из тела; поле пустое / нет / не строка — null без ошибки`; `AC-4.14: user с подложным tenant в теле — область из токена`.
3. `test/unit/http/ac-3-7-openapi-idempotency.spec.ts` (`Skill: nestjs-code test unit http openapi-idempotency (CREATE)`): фикстура-контроллер с `@Idempotent()` и `@Idempotent({required: true})`: `AC-3.7: Idempotency-Key в parameters, required по опции, pattern O`; `AC-3.7: Idempotent-Replayed в заголовках успешного ответа`; `AC-3.7: 409 IDEMPOTENCY_IN_PROGRESS, 422 IDEMPOTENCY_KEY_REUSED, 400 IDEMPOTENCY_KEY_REQUIRED (только required)`; `AC-3.7: маршрут без @Idempotent — без этих заголовков`; `AC-3.7: expectMatchesApi принимает 409 IDEMPOTENCY_IN_PROGRESS и 400 IDEMPOTENCY_KEY_REQUIRED на маршруте с @Idempotent({required: true})` (ответы — объекты `{statusCode, json()}` по образцу `test/unit/http/ac-3-7-openapi.spec.ts`); документ валиден `@seriousme/openapi-schema-validator`.
4. `test/unit/idempotency/ac-1-2-idempotency-peer.spec.ts` (`Skill: nestjs-code test unit idempotency peer (CREATE)`): граф — первый импорт `src/idempotency/index.ts` — `./peer.js`; `pg` не импортируется статически.

### Проверка
- `make test`.

## Task 34: Тесты I AC-4.14 и AC-9.5

### Шаги
1. Общий стенд `test/integration/idempotency/support.ts` (`Skill: nestjs-code test integration idempotency support (CREATE)`): модуль приложения — `KitConfigModule.forRoot` (окружение `envBase` + `envDatabase`), `VerdeectAuthModule.forRoot({issuers: [signer.issuer], resource: TEST_RESOURCE})` с издателем `createTestSigner()` (`@verdeect/auth/testing`: JWKS на своём локальном сервере, `signer.close()` в `afterAll`), `KitDatabaseModule.forRoot({schema})`, `KitIdempotencyModule.forRoot({table: idempotency})`, контроллер `POST /echo` (`@UseGuards(VerdeectAuthGuard)`, `@Idempotent()`, ставит `Location: /echo/<n>`, может ждать «шлагбаум», бросать `Error` или `DomainError('VALIDATION_FAILED')`), `POST /strict` (`required: true`), `POST /service` (`tenantFromBody: 'tenant'`, `RequireService`), `POST /open` (`@Idempotent()` без guard'а); токены — `signer.userToken({sub, tenant, tenant_id})`, `signer.serviceToken({client_id, sub})`; `tenant` по умолчанию — `workerScope().tenant`, вторая компания — `globex`; приложение — `createDbApp({module, schema: <схема окружения стенда>, env})` (задача 24, `setPreparsedEnv`); после создания приложения стенд ждёт `app.get(IdempotencyCleanup).idle()` (первый проход после старта завершён — он не держит блокировку, не удваивает метрику и не удаляет строки теста); `beforeEach` — `TRUNCATE kit.idempotency_key`; базовые значения метрик снимаются после `idle()`.
2. `test/integration/idempotency/ac-4-14-idempotency.spec.ts` (`Skill: nestjs-code test integration idempotency http (CREATE)`) — **проект `isolated`** (`initFakeSentry`: процесс-глобальный Sentry), `describe('UC-7: Idempotency-Key')`, эквивалентность O `http/shared/idempotency` и `ac-2-2-idempotency`:
   - `AC-4.14: повтор с тем же ключом и телом — сохранённый статус 201, тело, Location + Idempotent-Replayed: true; обработчик один раз`;
   - `AC-4.14: другое тело — 422 IDEMPOTENCY_KEY_REUSED`;
   - `AC-4.14: параллельный первый — 409 IDEMPOTENCY_IN_PROGRESS` (шлагбаум);
   - `AC-4.14: два параллельных запроса с одним ключом — обработчик один раз` (O AC-2.2);
   - `AC-4.14: required без ключа — 400 IDEMPOTENCY_KEY_REQUIRED`;
   - `AC-4.14: ключ 201 знак — 422 VALIDATION_FAILED path Idempotency-Key`;
   - `AC-4.14: in_progress старше 5 мин переиспользуется; моложе — 409` (`created_at` сдвигается администратором);
   - `AC-4.14: запись старше 24 ч — запрос выполняется заново без Idempotent-Replayed`;
   - `AC-4.14: ключ одного sub не виден другому sub и другой компании` (тот же ключ: `sub` A/B, компании `acme`/`globex` — оба 201 без повтора);
   - `AC-4.14: сервисный вызов с tenantFromBody 'tenant' — ключ одного client_id в двух компаниях не пересекается; без поля tenant — область client_id`;
   - `AC-4.14: сервисный вызов без tenantFromBody (tenant NULL) — повтор → сохранённый ответ и Idempotent-Replayed; параллельный первый → 409 IDEMPOTENCY_IN_PROGRESS`;
   - `AC-4.14: вызов пользователя с подложным tenant в теле не меняет область`;
   - `AC-4.14: обработчик бросил — повтор выполняется заново; ошибка не сохраняется`;
   - `AC-4.14: маршрут с @Idempotent без guard'а и с Idempotency-Key — 500 INTERNAL_ERROR, обработчик не вызван, событие GlitchTip ровно одно`
   - `AC-4.14: маршрут с @Idempotent без guard'а без Idempotency-Key — 500 INTERNAL_ERROR, обработчик не вызван, событие GlitchTip ровно одно` (`delivered` фейкового транспорта после `Sentry.flush`);
   - `AC-4.14: запись компании недоступна под другой компанией и без компании (политика IS NOT DISTINCT FROM)` — прямые запросы роли `kit_app` с `set_config`.
3. `test/integration/idempotency/ac-4-14-cleanup.spec.ts` (`Skill: nestjs-code test integration idempotency cleanup (CREATE)`), проект `shared`, эквивалентность O `idempotency-cleanup.int`: строки вставляет администратор (`acme` 25 ч, `globex` 30 ч, без компании 26 ч, `acme` 1 ч); `IdempotencyCleanup` — из приложения стенда (`app.get`), проход — `run()`; под ролью `kit_app`:
   - `AC-4.14: очистка под kit_app удаляет записи старше 24 ч двух компаний и запись без компании, запись моложе 24 ч остаётся`;
   - `AC-4.14: две реплики одновременно — проход выполняет одна, вторая не берёт блокировку и метрику не меняет`;
   - `AC-9.5: обычный проход → verdeect_cleanup_runs_total{result="ok"} +1, лог с deleted`;
   - `AC-9.5: записей больше batchSize × maxBatches → result="partial"` — 5 просроченных строк, `run({batchSize: 2, maxBatches: 2})`;
   - `AC-9.5: ошибка БД во время прохода → result="error", error-лог, captureError` (функция `idempotency_purge` в `createScratchDatabase()` заменяется администратором на функцию с `RAISE EXCEPTION`);
   - `AC-4.11: остановка во время прохода — пачка дорабатывает, новая не начинается` (`batchSize` фиксирован, проверка по числу пачек через `countQueries`).
3a. `test/integration/idempotency/ac-4-14-purge-sql-hyphen.spec.ts` (`Skill: nestjs-code test integration idempotency purge-sql-hyphen (CREATE)`), проект `shared`, своя БД (`test/support/postgres.ts`), сервис `bff-app` (KT-20 п. 1): `prepareDatabase({service: 'bff-app'})`; под `"bff-app_owner"` — таблица `"bff-app"."idempotency_key"` (DDL — `0002_*.sql` фикстуры с заменой схемы) и текст `idempotencyPurgeSql(pgSchema('bff-app'))` по операторам:
   - `KT-20: функция "bff-app"."idempotency_purge" создана — SECURITY DEFINER, владелец bff-app_directory, search_path задан, у PUBLIC нет EXECUTE`;
   - `KT-20: под bff-app_app вызов функции удаляет запись старше 24 ч, свежая остаётся`.
   В `afterAll` — `DROP DATABASE … WITH (FORCE)`, `DROP OWNED BY` и `DROP ROLE` ролей `bff-app_*`.
4. `test/integration/idempotency/ac-4-14-missing-purge-function.spec.ts` (`Skill: nestjs-code test integration idempotency missing-purge-function (CREATE)`) — **проект `isolated`** (`vi.stubEnv`, перехват `process.exit` — `useBootstrapStand`): БД из `createScratchDatabase()` с `DROP FUNCTION kit.idempotency_purge(integer)`:
   - `AC-4.14: без функции idempotency_purge createTestApp отказывает, текст называет idempotencyPurgeSql`;
   - `AC-4.14: bootstrapService без функции — fatal через failStartup с текстом про idempotencyPurgeSql, exit 1, порт не открыт`.
5. `test/integration/idempotency/ac-9-5-cleanup-observability.spec.ts` (`Skill: nestjs-code test integration idempotency cleanup-observability (CREATE)`), проект `shared`: `AC-9.5: проход очистки — verdeect_cleanup_runs_total с метками table="idempotency_key", result="ok", service="kit" растёт (значение — по `registry.getSingleMetric(...).get()` / метки в любом порядке; в тексте `/metrics` `service` идёт последней); лог «очистка идемпотентности: проход» с полями service, replica, table, deleted` — лог перехватывается подменой `KIT_LOGGER` в `overrides` стенда (логгер pino с потоком в память и тем же `base`, что даёт `createLoggerOptions`) — так проект `shared` не зависит от корневого логгера nestjs-pino.
6. `vitest.integration.config.ts` (`Skill: none — конфиг Vitest`): `ISOLATED` — `test/integration/idempotency/ac-4-14-idempotency.spec.ts` (причина: `initFakeSentry` — процесс-глобальный Sentry) и `test/integration/idempotency/ac-4-14-missing-purge-function.spec.ts` (причина: `vi.stubEnv` и `process.exit` — стенд `bootstrapService`).

### Требования
AC-4.14 (полностью, v1.14), AC-9.5 (очистка идемпотентности), AC-4.11 (остановка очистки), UC-7, UC-9.

### Проверка
- `make test-module M='idempotency'`.

## Риски
- Риск: `ON CONFLICT ON CONSTRAINT` с `NULLS NOT DISTINCT` — поддержано PostgreSQL 15+. Mitigation: `TEST_IMAGES.postgres` 17.11, тест AC-4.14 «без компании» (сервисный вызов без `tenantFromBody`) проверяет повтор с `tenant NULL`.
- Риск: nestjs-pino держит один pino-http и корневой логгер на процесс (RULES.md). Mitigation: очистка логирует через `KIT_LOGGER` экземпляра; тесты подменяют `KIT_LOGGER` и читают свой поток.

## Чек-лист фазы
- Задачи 25–34 выполнены; `make lint analyse test test-integration` зелёные.
