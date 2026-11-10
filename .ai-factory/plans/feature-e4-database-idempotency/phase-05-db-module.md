# Фаза 5: `Db`, `KitDatabaseModule` и подпуть `/database`

Plan: [index.md](index.md)
Tasks: 17-24
Depends on: Phase 1 (Tasks 2, 3), Phase 2 (Tasks 4–8), Phase 4 (Tasks 12–16)

## Цель

`Db.transaction/read/readGlobal/afterCommit/setLocal` (эталон O), пулы основной и чтения с пробами и закрытием на шаге 4, `deleteInBatches` с отслеживанием пачек для остановки, `runExclusive`, `occurredAtColumn`/`ifNewer`, метрика срока пула с меткой пула; подпуть `./database` в `exports`; фильтр `/http` больше не пишет `pool: 'unknown'`; помощник `countQueries` в `/testing`. Тесты I AC-4.1–AC-4.5, AC-4.10–AC-4.13, AC-4.15, AC-4.16; U AC-1.2 для `/database`.

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| O `src/shared/database/db.ts` | `afterCommitTasks` (WeakMap), `run(ctx, work, readOnly)`, `set_config('app.tenant', …, true)`, `withClient` (новый Drizzle на клиент, `ponytail`), `runAfterCommit` | эталон `Db` |
| O `src/shared/database/pool-client.ts:44-69` | `withPoolClient(pool, work, onBroken)`: `client.on('error')` → `broken`, `release(broken)` | клиент возвращается в пул при обрыве до `BEGIN` (Drizzle 0.45.4 выполняет `BEGIN` вне своего `try/finally`) |
| O `src/shared/database/drizzle.provider.ts` | `READ_POOL_OPTIONS` = `-c default_transaction_read_only=on -c statement_timeout=5000 -c app.tenant=`; `createPool` (`error`/`connect` обработчики, `debug`) | эталон пулов |
| O `src/shared/database/database.module.ts` | проба `database` (критичная), `onApplicationShutdown` → `pool.end()` обоих | эталон модуля, шаг 4 |
| O `src/shared/database/batches.ts` | `deleteInBatches(batch, {batchSize, maxBatches, shouldContinue})`, выход при неполной пачке | эталон пачек; по PRD — `{db, sql, …}` |
| I `src/shared/database/db.ts:38,78-104` | `batchRuns`, `stopping`, `beforeApplicationShutdown` ждёт пачки | «`Db` отслеживает идущие пачки» (§3.3) |
| I `src/shared/database/db.ts` (`read` без тенанта) | у I и O `read` без тенанта идёт в пул чтения без транзакции | по PRD: `read` без тенанта — `TenantRequiredError`, без тенанта — только `readGlobal` |
| O `src/shared/observability/pool-timeout-reporter.ts` | счётчик и GlitchTip не чаще раза в 60 с | по PRD — `captureThrottled` (E2) и `verdeect_db_pool_wait_timeouts_total{pool}` |
| O `src/shared/schedule/job-lock.ts` | блокировка в Redis | не переносится: по PRD `runExclusive` — `pg_try_advisory_lock` |
| `src/http/kit-exception.filter.ts:98-109` | ветка срока пула, `pool: 'unknown'`, `captureThrottled` | решение E3: метрику и событие пишет `Db` |
| `src/http/kit-http-core.module.ts` | глобальные `KIT_METRICS`, `HealthRegistry`, `KitLifecycle` | `KitDatabaseModule` внедряет их необязательно |
| `src/http/create-http-app.ts:162` | `app.useLogger(NestPinoLogger)` | логгер Nest → pino с `service`, `replica` в `base` |
| `test/unit/http/ac-3-3-exception-filter.spec.ts:83` | ожидание `inc({pool: 'unknown'})` | меняется |
| `test/unit/http/ac-1-2-http-without-pg.spec.ts` | граф импортов по исходникам | образец U AC-1.2 для `/database` |
| O `test/integration/database/db.int-spec.ts`, I `rls`, `read-pool`, `after-commit`, `connection-lost`, O `http/database/ac-10-8-shutdown`, `http/observability/or-119-db-pool` | случаи и приёмы | тесты эквивалентности |
| `node_modules/@nestjs/config` | `ConfigService(internalConfig)` | подмена окружения в тестах без `vi.stubEnv` |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/database/db.ts` | create | `Db`, `DbTx`, `DbReader`, ошибки, `withPoolClient`, внутренние `mainPoolOf`, `trackBatchRun` |
| `src/database/kit-database.module.ts` | create | `KitDatabaseModule`, `DRIZZLE`, `DRIZZLE_READ`, `createPools` |
| `src/database/batches.ts` | create | `deleteInBatches` |
| `src/database/run-exclusive.ts` | create | `runExclusive` |
| `src/database/if-newer.ts` | create | `occurredAtColumn`, `ifNewer` |
| `src/database/index.ts` | create | публичная поверхность §3.3 |
| `package.json` | modify | `exports["./database"]` |
| `src/http/kit-exception.filter.ts` | modify | срок пула — без метрики и события |
| `src/testing/count-queries.ts` | create | `countQueries` |
| `src/testing/index.ts` | modify | экспорт `countQueries` |
| `test/unit/database/ac-1-2-database-without-pg.spec.ts` | create | граф импортов |
| `test/unit/http/ac-3-3-exception-filter.spec.ts` | modify | метрики нет |
| `test/support/database.ts` | create | `createTestDb`, `createDbApp`, `withAppRole` |
| `test/integration/database/ac-4-*.spec.ts` | create | AC-4.1–4.5, 4.10–4.13, 4.16 |
| `test/integration/testing/ac-4-15-count-queries.spec.ts` | create | AC-4.15 |

## Task 17: `Db`

### Назначение
Единственный способ работы сервиса с БД под строгим RLS (§3.3, UC-5): один `set_config('app.tenant')` на транзакцию, чтение без тенанта — только `readGlobal`, задачи после `COMMIT`, своя переменная `app.*`.

### Шаги
1. Создать `src/database/db.ts` (`Skill: nestjs-code generic src/database/db.ts (CREATE)`). Шапка: «Db (prd.md §3.3, AC-4.1–AC-4.5, AC-4.16, UC-5). Эталон — O db.ts + pool-client.ts (withPoolClient, новый Drizzle на клиент, afterCommit через WeakMap). Из I — отслеживание пачек для остановки (batchRuns). По PRD: read без тенанта — TenantRequiredError, readGlobal — пул чтения без транзакции, afterCommit в read-only — AfterCommitInReadOnlyError, setLocal, метка пула и метрика срока пула (решение E3)».
2. Типы (экспорт): `DbTx` — транзакция Drizzle node-postgres (тип из `import type`), `DbReader` — `NodePgDatabase` пула чтения; `AfterCommitTask` — функция без аргументов, возвращающая `void` или промис.
3. Ошибки (экспорт, TSDoc): `TenantRequiredError` (`name`, сообщение «Db.read: нет тенанта в DbContext — для чтения без компании используйте Db.readGlobal»), `AfterCommitInReadOnlyError` (сообщение «Db.afterCommit: read-only транзакция или readGlobal — задача после COMMIT невозможна»). Это ошибки разработчика: фильтр `/http` даёт 500 и одно событие GlitchTip (существующая ветка «прочее»).
4. Конструктор (класс без декораторов Nest; провайдер собирает модуль, задача 18) принимает объект: `main: Pool`, `read: Pool`, `metrics?: KitMetrics`. Логгер — `new Logger('Db')` из `@nestjs/common` (как `KitExceptionFilter`; в приложении `createHttpApp` уходит в pino с `service` и `replica`).
5. Внутреннее состояние: `WeakMap<DbTx, AfterCommitTask[]>` задач; `WeakSet<object>` read-only дескрипторов (транзакции `read` и объект `readGlobal`); `Set<Promise<unknown>>` идущих пачек; флаг `stopping`. Внутренние функции модуля (не реэкспортируются из `index.ts`): `mainPoolOf(db)` (для `runExclusive`), `trackBatchRun(db, promise)`, `isStopping(db)` (для `deleteInBatches`) — через приватный `WeakMap<Db, …>` или `#`-поля с геттерами в том же файле.
6. `withPoolClient(pool, poolName, work)` (внутренняя, порт O): `pool.connect()`; ошибка подключения — пометка срока пула (шаг 10) и `throw`; на клиент — `on('error')` → запомнить `broken`; `work(client)`; в `catch` — если `broken` нет и `isConnectionError(error)` — `broken = error`; `finally` — снять слушатель, `client.release(broken)` (сломанный клиент уничтожается, пул не исчерпывается — AC-4.4), `debug` «Db: соединение сломано, клиент уничтожен» при `broken`.
7. `transaction(ctx, fn)` и `read(ctx, fn)` → общий `run(ctx, fn, readOnly)`:
   - `read` с `ctx.tenant` `null` или `''` → `TenantRequiredError` (до подключения);
   - `withPoolClient(main | read пул …)` → `drizzle(client)` → `database.transaction(callback, {accessMode: readOnly ? 'read only' : 'read write'})`; первым запросом внутри — `select set_config('app.tenant', $1, true)` с `ctx.tenant ?? ''` (ровно один `set_config`, AC-4.1); затем `fn(tx)`;
   - `read` использует **пул чтения** (`statement_timeout` 5 с — AC-4.2), `transaction` — основной;
   - после возврата транзакции (`COMMIT` выполнен) — `runAfterCommit(tx)`; при откате задачи удаляются без вызова (AC-4.3);
   - ошибка — `debug` `{tenant, traceId, readOnly, err: sanitizeError(e)}` «Db: транзакция откатилась» и `throw` как есть.
8. `readGlobal(fn)`: `fn(readDb)`, где `readDb` — `drizzle(readPool)` (создаётся один раз); без транзакции и без `set_config` (у пула чтения `app.tenant=` пусто в `options`); дескриптор в `WeakSet` read-only. Ошибка срока пула — метка `read` (шаг 10).
9. `afterCommit(tx, task)`: дескриптор в read-only `WeakSet` → `AfterCommitInReadOnlyError`; иначе задача в список транзакции. `runAfterCommit` (порт O): задачи по порядку; ошибка задачи — `error`-лог `{traceId, err: sanitizeError(e)}` «Db.afterCommit: задача упала» и `captureError(e)`; не пробрасывается; следующая задача выполняется; `transaction` возвращает результат после задач. TSDoc и README: «только для того, что можно потерять».
10. Срок пула (решение E3, AC-4.5): во всех трёх путях ошибку `isPoolTimeout` пропускать через `tagPoolTimeout(error, 'main' | 'read')`; если вернул `true` — `metrics?.dbPoolWaitTimeouts.inc({pool})`, `captureThrottled('db-pool-timeout:<pool>', error)`, `warn` `{pool}` «Db: истёк срок ожидания клиента пула». Исключение пробрасывается (фильтр `/http` ответит 503).
11. `setLocal(tx, name, value)`: `name` не по `^app\.[a-z_]{1,48}$` → `TypeError` «Db.setLocal: имя вне ^app\.[a-z_]{1,48}$»; иначе `select set_config($1, $2, true)` — имя и значение параметрами (AC-4.16). Дескриптор `readGlobal` (не транзакция) → `TypeError` «Db.setLocal: нужна транзакция Db.transaction или Db.read».
12. `beforeApplicationShutdown()` (шаг 3): `stopping = true`, `debug` `{batches: size}`, дождаться `Promise.allSettled` идущих пачек.

### Контракты
- `DbContext` — из `tenant.ts` (задача 5).
- Публичные методы `Db`: `transaction`, `read`, `readGlobal`, `afterCommit`, `setLocal` и хук `beforeApplicationShutdown`.
- [OPEN] §11 п. 3 (`BEGIN` + `set_config` одной посылкой) не реализуется: два запроса, как O.

### Ошибки и логи
См. шаги 7, 9, 10. Параметры SQL и значения тенанта в логах — тенант можно (не секрет, нужен для разбора), параметры запросов домена — нет.

### Тесты
Задача 24.

### Критерии приёмки
- `make analyse` зелёный.

### Проверка
- задача 24.

## Task 18: `KitDatabaseModule`

### Шаги
1. Создать `src/database/kit-database.module.ts` (`Skill: nestjs-code generic src/database/kit-database.module.ts (CREATE)`). Шапка: «KitDatabaseModule.forRoot({schema}) (prd.md §3.3, AC-4.4, AC-4.5, UC-8). Эталон — O drizzle.provider.ts + database.module.ts: пулы main/read, READ_POOL_OPTIONS, обработчики error/connect, проба database, onApplicationShutdown — шаг 4».
2. Токены (экспорт): `DRIZZLE` = `Symbol('DRIZZLE')`, `DRIZZLE_READ` = `Symbol('DRIZZLE_READ')` — экземпляры `drizzle(pool, {schema})` (для запросов вне `Db`, например `countQueries` через `$client`). Внутренние токены пулов — `KIT_PG_POOL`, `KIT_PG_READ_POOL` (не экспортируются).
3. `READ_POOL_OPTIONS` — строка O (см. «Свидетельства»).
4. `createPools(env: KitDatabaseEnv)` (экспорт внутри пакета — для `test/support/database.ts`): два `pg.Pool` на `DATABASE_URL`, `max: DB_POOL_MAX`, `connectionTimeoutMillis: DB_POOL_ACQUIRE_TIMEOUT_MS`; у пула чтения — `options: READ_POOL_OPTIONS`; обработчики `pool.on('error')` → `warn` `{pool, err: sanitizeError}` «пул БД: ошибка простаивающего клиента»; `pool.on('connect', client → client.on('error', тот же warn))`; `debug` `{pool, max}` при создании (адрес не логируется).
5. `KitDatabaseModule.forRoot({schema})` — `DynamicModule`, `global: true`:
   - провайдер окружения: `ConfigService` (`getOrThrow` трёх ключей `envDatabase`); нет `ConfigService` → `Error` «KitDatabaseModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envDatabase»;
   - пулы → `drizzle(pool, {schema})` под `DRIZZLE`/`DRIZZLE_READ`;
   - `Db` — `useFactory` с `KIT_METRICS` (`optional: true`, из `internal/tokens.js`);
   - экспорт: `Db`, `DRIZZLE`, `DRIZZLE_READ`.
6. Класс модуля внедряет пулы, `HealthRegistry` (`@Optional()`) и реализует:
   - `onModuleInit`: при наличии `HealthRegistry` — пробы `database` и `database-read`, `critical: true`, каждая — `select 1` на своём пуле (без `Db.read`: ему нужен тенант);
   - `onApplicationShutdown` (шаг 4, решение E3): `info` `{main: {total, idle}, read: {total, idle}}` «пулы БД: закрытие», затем `Promise.all` двух `pool.end()`.
   Участников `KitLifecycle` модуль не регистрирует (решение E3).
7. Опция `schema` — объект схемы Drizzle сервиса (TSDoc); других опций нет (P0).

### Контракты
- Формула соединений README: `2 × DB_POOL_MAX × реплики` (два пула).
- Без `createHttpApp` (контекст CLI сервиса) модуль работает без проб и метрики.

### Ошибки и логи
Шаги 4–6.

### Тесты
Задача 24 (AC-4.4, AC-4.5, закрытие — в AC-4.4).

### Проверка
- задача 24.

## Task 19: `deleteInBatches`

### Шаги
1. Создать `src/database/batches.ts` (`Skill: nestjs-code generic src/database/batches.ts (CREATE)`). Шапка: «deleteInBatches (prd.md §3.3, AC-4.11, UC-8, UC-9). Эталон — O batches.ts (выход при неполной пачке, maxBatches, shouldContinue); I — отслеживание идущих пачек в Db».
2. Тип опций `KitDeleteInBatchesOptions`: `db: Db`; `sql` — функция от размера пачки, возвращающая `SQL` Drizzle, результат которого — **одна строка с целой колонкой `deleted`** (TSDoc с примером в README: `WITH d AS (DELETE … LIMIT … RETURNING 1) SELECT count(*)::int AS deleted FROM d` или вызов функции `SECURITY DEFINER`); `batchSize`, `maxBatches` (целые ≥ 1, иначе `RangeError`); `shouldContinue?` — функция без аргументов → `boolean`. Результат `{deleted: number, batches: number}`.
3. Алгоритм: цикл, пока `batches < maxBatches`, `!isStopping(db)` и `shouldContinue?.() ?? true`: пачка — `db.transaction(SYSTEM_CONTEXT, tx → tx.execute(sql(batchSize)))`, `deleted` строки (строка или `bigint` → `Number`), сумма; `count < batchSize` → выход. Весь проход регистрируется `trackBatchRun(db, promise)`: остановка ждёт текущую пачку, новая не начинается (AC-4.11).
4. `SYSTEM_CONTEXT` — `{tenant: null, traceId: <ulid прохода>, actor: {channel: 'system'}}` (внутренняя константа-фабрика; при пустом тенанте строгий RLS скрывает строки компаний — для них нужна функция `SECURITY DEFINER`, README).
5. Лог: `debug` `{batch, deleted}` на каждой пачке.

### Тесты
Задача 24 (AC-4.11).

### Проверка
- задача 24.

## Task 20: `runExclusive`

### Шаги
1. Создать `src/database/run-exclusive.ts` (`Skill: nestjs-code generic src/database/run-exclusive.ts (CREATE)`). Шапка: «runExclusive (prd.md §3.3, AC-4.12, UC-9): pg_try_advisory_lock на выделенном соединении основного пула. Эталон O job-lock (Redis) не переносится — по PRD advisory lock».
2. Сигнатура: `runExclusive(db, key, fn)` → `Promise<{ran: true, result: T} | {ran: false}>`; `key` — непустая строка (иначе `TypeError`).
3. Алгоритм: `withPoolClient(mainPoolOf(db), 'main', client → …)`: `select pg_try_advisory_lock(hashtextextended($1, 0)) as locked`; `false` → `{ran: false}` без ожидания, `debug` `{key}` «runExclusive: занято»; `true` → `try` `fn()`, `finally` — `select pg_advisory_unlock(hashtextextended($1, 0))` на **том же** клиенте (ошибка разблокировки — `warn` и сломанный клиент: `release(error)` закроет соединение, блокировка уровня сеанса снимется вместе с ним).
4. `fn` работает со своими транзакциями `Db` (другие клиенты пула): README — блокировка держит одно соединение, `DB_POOL_MAX ≥ 2`.

### Тесты
Задача 24 (AC-4.12).

### Проверка
- задача 24.

## Task 21: `occurredAtColumn` и `ifNewer`

### Шаги
1. Создать `src/database/if-newer.ts` (`Skill: nestjs-code generic src/database/if-newer.ts (CREATE)`). Шапка: «occurredAtColumn, ifNewer (prd.md §3.3, AC-4.13, UC-6): порядок по occurredAt — помощник обработчика, не поведение подписчика (inventory §4 п. 9)». Файл без `pg`.
2. `occurredAtColumn(name)` — `timestamp(name, {withTimezone: true, mode: 'date'})`, nullable.
3. `ifNewer(column, occurredAt: Date)` — условие Drizzle:
   ```sql
   (<column> IS NULL OR <column> < $occurredAt)
   ```
   TSDoc: использовать в `WHERE` обновления; `updated: 0` (`rowCount` 0) — нормальный итог для устаревшего события.

### Тесты
Задача 24 (AC-4.13).

## Task 22: Публичный `/database`, `exports`, фильтр `/http`

### Шаги
1. Создать `src/database/index.ts` (`Skill: nestjs-code generic src/database/index.ts (CREATE)`). **Первая строка импорта — `./pg.js`** (ошибка AC-1.2 до остальных модулей). Явные реэкспорты: `KitDatabaseModule`, `DRIZZLE`, `DRIZZLE_READ`; `Db`, `TenantRequiredError`, `AfterCommitInReadOnlyError`, типы `DbTx`, `DbReader`, `AfterCommitTask`; `DbContext` (тип); `tenantColumn`, `tenantPolicy`; `prepareDatabase`, типы `KitPrepareDatabaseOptions`, `KitPrepareDatabaseResult`; `runMigrations`; `newId`, `ulid` (из `../internal/ids.js`); `isUniqueViolation`, `isConnectionError`, `isPoolTimeout` (из `../internal/pg-errors.js`, без дублирования); `deleteInBatches`, тип `KitDeleteInBatchesOptions`; `runExclusive`; `occurredAtColumn`, `ifNewer`. Не экспортируются: `moveJournal`, `grantDatabaseAccess`, `createPools`, `mainPoolOf`, `withPoolClient`, `tagPoolTimeout`.
2. `package.json` `exports` — `"./database": {"types": "./dist/database/index.d.ts", "default": "./dist/database/index.js"}` (между `./config` и `./http`, по алфавиту, как существующие).
3. `src/http/kit-exception.filter.ts` (`Skill: nestjs-code generic src/http/kit-exception.filter.ts (MODIFY)`): ветка `isPoolTimeout` — убрать `dbPoolWaitTimeouts.inc` и `captureThrottled` (их делает `Db` с меткой пула, задача 17); остаются `warn` `SERVICE_UNAVAILABLE`, `Retry-After: 1`, 503. `KIT_METRICS` фильтру больше не нужен — удалить параметр конструктора, импорты `KIT_METRICS`, `KitMetrics` и `captureThrottled` (`captureError` остаётся); `APP_FILTER` в `kit-http-core.module.ts` создаёт фильтр без зависимостей. Шапку и TSDoc обновить: «метрику и событие срока пула пишет Db (/database, AC-4.5)». Срок пула не из `Db` (собственный пул сервиса) — 503 без метрики (README «Ошибки»).
4. `test/unit/http/ac-3-3-exception-filter.spec.ts` (MODIFY): случай срока пула — ожидается 503, `Retry-After: 1`, событие GlitchTip не отправлено, метрика фильтром не меняется; название — `AC-3.3: срок пула → 503 SERVICE_UNAVAILABLE + Retry-After: 1; метрику пишет Db (AC-4.5)`.
5. `test/unit/database/ac-1-2-database-without-pg.spec.ts` (`Skill: nestjs-code test unit database without-pg (CREATE)`), граф как в `test/unit/http/ac-1-2-http-without-pg.spec.ts`: `AC-1.2: /database импортирует pg и drizzle-orm/node-postgres только через src/database/pg.ts (loadPeer и import())`; `AC-1.2: первый импорт src/database/index.ts — ./pg.js`; `AC-1.2: /http по-прежнему не достигает src/database` (существующий тест не меняется).
6. `test/unit/package/package-manifest.spec.ts` (MODIFY): случай `AC-1.1: exports — ровно …` (строка 53) — список с `./database`, новое название `AC-1.1: exports — ровно ./config, ./database, ./http, ./observability, ./testing, ./package.json`; новый случай `AC-1.1: ./database — {types, default} на dist/database/index.*` по образцу случая `./http`. Шапку файла — «форма exports E1–E4».

### Тесты
Шаги 4–6.

### Проверка
- `make lint analyse test`.

## Task 23: `countQueries`

### Шаги
1. Создать `src/testing/count-queries.ts` (`Skill: nestjs-code generic src/testing/count-queries.ts (CREATE)`). Шапка: «countQueries (prd.md §3.8, AC-4.15, UC-14)».
2. Тип пула — структурный (`on`/`off` события `acquire`; без импорта `pg`): `KitCountablePool`. Результат — `{result: T, count: number, queries: readonly string[]}` (`queries` — текст SQL без параметров, по порядку).
3. Алгоритм: подписка на `acquire` пула; на каждого выданного клиента — обёртка метода `query` экземпляра (счётчик и текст; исходный метод сохраняется); после `fn` (в `finally`) — отписка и восстановление методов у всех обёрнутых клиентов. Запросы, начатые до вызова, не считаются. TSDoc: «считает все запросы пула за время `fn`; параллельная нагрузка на тот же пул попадёт в счёт».
4. `src/testing/index.ts`: `countQueries`, `export type KitCountablePool`.

### Тесты
Задача 24 (AC-4.15).

## Task 24: Тесты I фазы

### Шаги
1. `test/support/database.ts` (`Skill: nestjs-code test integration support database (CREATE)`):
   - `createTestDb({poolMax?, acquireTimeoutMs?, url?})` — `createPools` по `inject('kitDatabaseUrl')` (или `url`), `Db` с настоящим `kitMetrics({service: 'kit'})`, возвращает `{db, main, read, metrics, close}`;
   - `adminQuery(sql, params?)` — по `kitDatabaseAdminUrl`;
   - `truncateFixtures()` — `TRUNCATE kit.note, kit.setting` под администратором;
   - `createDbApp({module, env})` — `createTestApp({module, service: 'kit', overrides: [{provide: ConfigService, useValue: new ConfigService(parseEnv(schema, env))}]})`: окружение без `vi.stubEnv` (проект `shared`).
2. `test/integration/database/ac-4-1-transaction.spec.ts` (эквивалентность O `db`, I `rls`), `describe('UC-5: Db.transaction')`:
   - `AC-4.1: transaction ставит ровно один set_config('app.tenant', …, true)` — `countQueries` по `main`: запросы `begin`, `set_config`, домен, `commit`; `set_config` один;
   - `AC-4.1: значение не переживает транзакцию — то же соединение после COMMIT видит пустое current_setting('app.tenant', true)` — `createTestDb({poolMax: 1})`, после `transaction` с `tenant: 'acme'` прямой `main.query` на единственном клиенте пула; pid тот же (`pg_backend_pid()` внутри и после);
   - `AC-4.1: под tenant acme видны и пишутся только строки acme, строка globex не видна; запись строки globex под acme → ошибка политики (42501)`;
   - `AC-4.1: transaction с tenant null — 0 строк компаний (строгий RLS, P0)`.
3. `ac-4-2-read.spec.ts` (I `read-pool`): `AC-4.2: read без тенанта → TenantRequiredError без запроса к БД`; `AC-4.2: read с тенантом — read only (INSERT → 25006)`; `AC-4.2: readGlobal без транзакции и set_config, таблица setting читается, INSERT → 25006`; `AC-4.2: запрос дольше 5 с в readGlobal → отмена 57014` (`pg_sleep(6)`); `AC-4.2: после read с тенантом соединения пула чтения без тенанта`.
4. `ac-4-3-after-commit.spec.ts` (I `after-commit`): `AC-4.3: задачи после COMMIT по порядку, видят зафиксированные данные`; `AC-4.3: после ROLLBACK не выполняются`; `AC-4.3: упавшая первая задача не отменяет вторую и результат транзакции`; `AC-4.3: afterCommit в read → AfterCommitInReadOnlyError`; `AC-4.3: afterCommit на дескрипторе readGlobal → AfterCommitInReadOnlyError`.
5. `ac-4-4-connection-lost.spec.ts` (O `connection-lost` / `ac-10-8-shutdown` случай 1): `createTestDb({poolMax: 2})`; `AC-4.4: 2 × DB_POOL_MAX обрывов до BEGIN — пул не исчерпан, следующая транзакция проходит` — цикл 4 раза: занять клиентов, `pg_terminate_backend` их pid суперпользователем, вернуть в пул, вызвать `transaction` (ожидается отказ по соединению), затем успешная `transaction`, `main.totalCount ≤ 2`; `AC-4.4: обрыв посреди транзакции через tcpProxy.break — отказ, процесс жив, после restore — новая транзакция на новом соединении`; `UC-8: onApplicationShutdown закрывает оба пула (createDbApp + app.close(), затем pool.totalCount === 0)`.
6. `ac-4-5-pool-timeout.spec.ts` (O `or-119-db-pool`): `createTestDb({poolMax: 1, acquireTimeoutMs: 100})`; `AC-4.5: исчерпание основного пула → isPoolTimeout, poolTimeoutOf = main, verdeect_db_pool_wait_timeouts_total{pool="main"} +1`; то же для `read` (`pool="read"`); `AC-4.5: HTTP — маршрут с Db.transaction при занятом пуле → 503 SERVICE_UNAVAILABLE + Retry-After: 1, метрика +1 ровно один раз` (`createDbApp` с модулем `KitConfigModule.forRoot({schema: defineEnv({...envBase, ...envDatabase})})`, `KitDatabaseModule.forRoot({schema: fixtureSchema})`, контроллер теста; метрика — по `KIT_METRICS` приложения); `AC-4.5: проба /health database — up при свободном пуле`.
7. `ac-4-10-pg-errors.spec.ts`: `AC-4.10: isUniqueViolation(err, 'note_pkey') — ошибка повтора id на глубине cause 3` (обёртки `Error` с `cause`); `AC-4.10: isConnectionError — обрыв tcpProxy.break во время запроса`.
8. `ac-4-11-delete-in-batches.spec.ts`: `AC-4.11: shouldContinue = false после первой пачки — одна пачка, deleted = batchSize`; `AC-4.11: Db.beforeApplicationShutdown во время пачки — пачка дорабатывает, новая не начинается` (пачка с `pg_sleep(0.3)`); `AC-4.11: неполная пачка завершает проход; maxBatches ограничивает` (удаление строк `setting` CTE `WITH d AS (DELETE … RETURNING 1) SELECT count(*)::int AS deleted FROM d`).
9. `ac-4-12-run-exclusive.spec.ts`: два `Db` на разных пулах (две «реплики»): `AC-4.12: одновременно — fn выполняется ровно раз, вторая {ran: false} без ожидания` (вторая возвращается раньше окончания `fn` первой); `AC-4.12: исключение в fn — блокировка снята, следующий runExclusive выполняется`.
10. `ac-4-13-if-newer.spec.ts`: `AC-4.13: событие старее сохранённого occurred_at — updated: 0`; `AC-4.13: новее — обновлено`; `AC-4.13: occurred_at NULL — обновлено`.
11. `ac-4-16-set-local.spec.ts`: `AC-4.16: имя вне ^app\.[a-z_]{1,48}$ → TypeError` (`it.each`: `app.Tenant`, `tenant`, `app.`, 49 букв); `AC-4.16: значение со ' передаётся параметром и читается current_setting`; `AC-4.16: значение не переживает транзакцию`.
12. `test/integration/testing/ac-4-15-count-queries.spec.ts`: `AC-4.15: transaction с одним запросом домена — count 4 (begin, set_config, запрос, commit), queries по порядку`; `AC-4.15: запросы до вызова не считаются, методы клиентов восстановлены после`.
13. Все файлы — проект `shared` (окружение — через `ConfigService`, без `vi.stubEnv`); `beforeEach` — `truncateFixtures`; `afterAll` — `close` пулов и приложений.

### Требования
AC-4.1–AC-4.5, AC-4.10–AC-4.13, AC-4.15, AC-4.16; UC-4, UC-5, UC-6, UC-8, UC-9.

### Критерии приёмки
- Все файлы зелёные в `make test-integration`; утечек соединений нет (последний тест файла — `close`).

### Проверка
- `make test-module M='database testing'`.

## Риски
- Риск: строка случая AC-4.1 «следующая транзакция видит пустое» — `set_config` транзакции ставит своё значение раньше чтения. Mitigation: проверка прямым `query` на том же клиенте пула с `max: 1` после `COMMIT` (шаг 2).

## Чек-лист фазы
- Задачи 17–24 выполнены; `make lint analyse test test-integration` зелёные.
