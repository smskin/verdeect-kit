# Фаза 4: Тестовый контур БД

Plan: [index.md](index.md)
Tasks: 12-16
Depends on: Phase 2 (Tasks 4, 6, 7, 8, 9)

## Цель

`startTestStack` с E4 готовит БД: `prepareDatabase` всегда при `postgres: true`, миграции — при `migrations`, шаблон для `createScratchDatabase`; новые адреса — через `provide`. Помощники `/testing`: `createScratchDatabase` (AC-4.18), `workerScope` (`tenant` — слаг, PRD v1.14), `assertAppRoleIsNotOwner` (AC-4.6). `globalSetup` пакета переходит на подготовленную и мигрированную БД `kit`. `/testing` по-прежнему импортируется без `pg` (BFF): код БД грузится динамически только при вызове.

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| `src/testing/start-test-stack.ts` | `TestStackOptions`, `postgresPart`, `ProvidedContext`, `startTestStack` | расширяется: `migrations`, подготовка, шаблон |
| `src/testing/index.ts` | явный список экспортов | новые экспорты |
| `test/integration/global-setup.ts` | `startTestStack({service: 'kit', postgres: true})` | + `migrations` |
| `test/integration/testing/ac-1-13-postgres.spec.ts:36-47` | `AC-1.13: подготовки БД нет` | в E4 подготовка есть — случай меняется |
| `vitest.integration.config.ts` | `ISOLATED` (пусто), `fileParallelism: false` | файлы последовательно; изоляция воркеров — по `workerScope` |
| O `test/support/global-setup.ts` | `prepareTestDatabase`: `prepareDatabase` → URL ролей → `runMigrations`; `provide` `adminDatabaseUrl`, `ownerDatabaseUrl`, `appDatabaseUrl` | эталон подготовки; шаблонной БД у O/I нет — по PRD (`CREATE DATABASE … TEMPLATE`) |
| O `test/support/database.ts` | `withRole`, `truncateAll` | приёмы тестов (в пакет не идут) |
| `test/consumer/no-testcontainers/peer-check.mjs` | импорт `/testing` без `pg` и `testcontainers` | ожидание: ошибка — про `testcontainers`, не про `pg` |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/testing/start-test-stack.ts` | modify | `migrations`, подготовка, шаблон, ключи `provide` |
| `src/testing/scratch-database.ts` | create | `createScratchDatabase` |
| `src/testing/worker-scope.ts` | create | `workerScope`, `KitWorkerScope` |
| `src/testing/tenant-isolation.ts` | create | `assertAppRoleIsNotOwner` (фаза 7 добавит `assertStrictTenantIsolation`) |
| `src/testing/index.ts` | modify | экспорты |
| `test/integration/global-setup.ts` | modify | `migrations` фикстуры |
| `test/integration/testing/ac-1-13-postgres.spec.ts` | modify | случай «подготовки нет» → «без migrations — роли и схема, таблиц нет» |
| `test/integration/testing/ac-4-18-scratch-database.spec.ts` | create | AC-4.18 |
| `test/integration/database/ac-4-6-prepare-database.spec.ts` | modify | + `assertAppRoleIsNotOwner` |
| `test/integration/database/ac-4-7-migrations.spec.ts` | modify | БД из `createScratchDatabase` |
| `test/unit/testing/worker-scope.spec.ts` | create | формат и уникальность `tenant` |

## Task 12: Подготовка БД в `startTestStack`

### Назначение
§3.8 «`prepareDatabase` + миграции (с E4)», AC-4.18: тестовый контур повторяет production-путь (ARCHITECTURE «Testing → пакет»).

### Шаги
1. `src/testing/start-test-stack.ts` (`Skill: nestjs-code generic src/testing/start-test-stack.ts (MODIFY)`). Шапка: заменить «E1: только … без подготовки БД и миграций (E4)» на «E4: при postgres — prepareDatabase и шаблон <svc>_template; migrations — runMigrations до копии; rabbitmq (E5), redis (E8) — позже. Код БД — динамический import() (без pg /testing импортируется)».
2. `TestStackOptions`: поле `migrations?: string` — путь к папке миграций `drizzle-kit` относительно `process.cwd()` (корень проекта при `globalSetup`); TSDoc: «применяется к шаблону под ролью `<svc>_owner`, журнал — `<svc>.__migrations`; без `postgres: true` — `TypeError` при вызове `startTestStack`».
3. `startTestStack`: `migrations` без `postgres` → `TypeError` «startTestStack: migrations требует postgres: true» (до возврата функции `globalSetup`).
4. `ProvidedContext` — новые ключи (TSDoc на каждом):
   - `kitDatabaseUrl` — роль `<svc>_app` к БД `<svc>` (значение `DATABASE_URL` тестов);
   - `kitDatabaseOwnerUrl` — роль `<svc>_owner` к БД `<svc>` (`DATABASE_MIGRATOR_URL`);
   - `kitDatabaseAdminUrl` — суперпользователь к БД `<svc>`;
   - `kitDatabaseService` — имя сервиса (схема и роли);
   - `kitDatabaseTemplate` — имя шаблонной БД.
5. После старта контейнера `postgres` (в `postgresPart.provide` — сделать его асинхронным; порядок частей стека не меняется) — функция `prepareStackDatabase(adminUrl, service, migrations)`:
   1. `pg` — `loadPeer('pg', 'testing')` внутри функции (статический импорт значения `pg` запрещён lint, `/testing` импортируется без `pg`); клиент суперпользователя — из него, идентификаторы — `quoteIdentifier` (задача 3); динамический импорт `../database/prepare-database.js` и `../database/migrations.js`;
   2. пароли `<svc>_owner`/`<svc>_app` — `randomBytes(16)` hex на прогон;
   3. суперпользователем к БД `postgres`: `CREATE DATABASE "<svc>_template"`;
   4. `prepareDatabase` с `adminUrl` к `<svc>_template`;
   5. при `migrations` — `runMigrations({url: <owner к шаблону>, folder: resolve(migrations), schema: service})`; пул миграций закрыт к концу вызова;
   6. `CREATE DATABASE "<svc>" TEMPLATE "<svc>_template"` (к шаблону в этот момент нет соединений), затем `grantDatabaseAccess` на `<svc>` (права уровня БД при копировании не переносятся);
   7. `provide` пяти ключей из шага 4; `kitPostgresUrl` — как в E1.
   Имена БД — `quoteIdentifier` (задача 3); имя сервиса уже проверено `assertServiceName`.
6. Ошибка подготовки — как отказ старта контейнера: текст `[startTestStack] не удалось подготовить БД: <сообщение>` в stderr до `throw` (Vite теряет текст ошибок `globalSetup`, эталон O `setup-error.ts`), контейнеры останавливаются. Печатаются только имя шага (`create-template`, `prepare`, `migrate`, `copy`) и `code` ошибки (SQLSTATE или системный код), без `message`: текст ошибки `pg` может содержать адрес и имя роли. Исключение — шаг `migrate`: печатается и `message` (текст ошибки SQL миграции нужен разработчику; адреса и паролей в нём нет — соединение уже установлено). Исходная ошибка — `cause` брошенной.
7. Логи: `startTestStack` пишет только в stderr при отказе (как E1, `console.*` запрещён — `process.stderr.write`).

### Контракты
- `postgres: true` без `migrations` — роли и схема есть, таблиц нет (случай AC-1.13 в задаче 16).
- Повторный `globalSetup` в другом прогоне — новый контейнер, конфликтов нет.

### Ошибки и логи
Шаг 6; значения паролей и адресов не выводятся.

### Тесты
Задача 16.

### Критерии приёмки
- `make test-integration` после задачи 16 — зелёный.

### Проверка
- задача 16.

## Task 13: `createScratchDatabase`

### Назначение
§3.8 E4, UC-14 шаг 4, AC-4.18: пустая мигрированная БД из шаблона за < 1 с — для тестов, которым нужна чистая БД (AC-4.7, AC-4.8).

### Шаги
1. Создать `src/testing/scratch-database.ts` (`Skill: nestjs-code generic src/testing/scratch-database.ts (CREATE)`). Шапка: «createScratchDatabase (prd.md §3.8, AC-4.18, UC-14): CREATE DATABASE … TEMPLATE <svc>_template; адреса — из inject (startTestStack)».
2. Тип результата `KitScratchDatabase` (все поля `readonly`): `name`, `url` (роль приложения), `ownerUrl`, `adminUrl` (суперпользователь), `drop(): Promise<void>`.
3. `createScratchDatabase(): Promise<KitScratchDatabase>`:
   1. `inject` — значение из `vitest` через `loadPeer('vitest', 'testing')` внутри функции (статический импорт значения `vitest` запрещён lint);
   2. нет `kitDatabaseTemplate` → `Error` «createScratchDatabase: startTestStack({postgres: true}) не запускался»;
   3. имя — `<svc>_s<8 hex>`; `pg` — `loadPeer('pg', 'testing')` внутри функции; суперпользователем к БД `postgres` (из `kitPostgresUrl`): `CREATE DATABASE "<имя>" TEMPLATE "<шаблон>"`;
   4. `grantDatabaseAccess` (динамический импорт `../database/prepare-database.js`) на новой БД;
   5. URL ролей — адреса `kitDatabaseUrl`/`kitDatabaseOwnerUrl`/`kitDatabaseAdminUrl` с заменой имени БД;
   6. `drop` — `DROP DATABASE IF EXISTS "<имя>" WITH (FORCE)`; повторный вызов — без ошибки.
4. Параллельный вызов двумя воркерами: `CREATE DATABASE … TEMPLATE` при одновременном копировании одного шаблона падает `55006` (шаблон занят). Повтор до 5 раз с паузой 50 мс × номер попытки; затем исходная ошибка.

### Контракты
- Тест сам вызывает `drop()` в `afterAll`/`afterEach`.

### Ошибки и логи
Ошибки — исключения; логов нет.

### Тесты
Задача 16 (AC-4.18).

### Критерии приёмки
- Время вызова < 1 с на шаблоне фикстуры (`TEST_TIMEOUT_SCALE`).

### Проверка
- задача 16.

## Task 14: `workerScope`

### Назначение
§3.8 v1.14: `tenant` — случайный слаг компании в формате claim `tenant` (`01` §5.2) — то же значение, что сервис кладёт в `DbContext.tenant` и в claim `tenant` тестового токена; уникален для воркера. Поля `rabbitmq` (E5) и `redisPrefix` (E8) в типе отсутствуют (§3.8, правило «Library Package Scope» (6)).

### Шаги
1. Создать `src/testing/worker-scope.ts` (`Skill: nestjs-code generic src/testing/worker-scope.ts (CREATE)`). Шапка: «workerScope (prd.md §3.8 v1.14, UC-14): E4 — tenant; rabbitmq (E5), redisPrefix (E8) — позже. Записей в таблицы не создаёт (N2, CE-4)».
2. Интерфейс `KitWorkerScope`: `readonly tenant: string`; TSDoc: «слаг компании воркера; строку компании, если нужна, создаёт фабрика сервиса; `tenantId` — фабрика сервиса».
3. `workerScope(): KitWorkerScope`: значение вычисляется один раз на модуль (воркер) и кэшируется: `w<id>-<8 hex>`, где `id` — `process.env.VITEST_POOL_ID` (нет — `0`), хвост — `randomBytes(4)` hex. Формат проверяется регуляркой слага `^[a-z0-9][a-z0-9-]{0,48}$` (TENANT_SLUG O без ведущего `_`, который у O зарезервирован для служебных компаний) — внутренняя константа файла; несоответствие — `Error` (защита от будущей правки формата).
4. Только чтение `process.env`, без записи.

### Контракты
- Два вызова в одном воркере — одно значение; разные воркеры — разные (случайный хвост + номер).

### Ошибки и логи
Нет.

### Тесты
Задача 16.

### Критерии приёмки
- U-тест задачи 16 зелёный.

### Проверка
- `make test FILTER='workerScope'`.

## Task 15: `assertAppRoleIsNotOwner`

### Назначение
§3.8 E4, AC-4.6: роль приложения не владеет схемой и без `BYPASSRLS`. Файл продолжит `assertStrictTenantIsolation` (задача 35).

### Шаги
1. Создать `src/testing/tenant-isolation.ts` (`Skill: nestjs-code generic src/testing/tenant-isolation.ts (CREATE)`). Шапка: «assertAppRoleIsNotOwner, assertStrictTenantIsolation (prd.md §3.8, AC-4.6, AC-4.8). Проверки — по каталогу PostgreSQL под ролью приложения; pg не импортируется: db — объект с query».
2. Тип `KitQueryable` — объект с методом `query(text, values?)`, возвращающим промис `{rows: unknown[]}` (подходит `pg.Pool`, `pg.Client`, `PoolClient`). Экспорт типа.
3. `assertAppRoleIsNotOwner(db: KitQueryable): Promise<void>` — под текущей ролью соединения:
   - `select rolsuper, rolbypassrls from pg_roles where rolname = current_user` — `rolsuper` или `rolbypassrls` → нарушение;
   - `select nspname from pg_namespace where nspowner = (select oid from pg_roles where rolname = current_user)` — непустой список → нарушение со списком схем;
   - `select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relowner = (… current_user) and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'` — непустой → нарушение;
   - KT-19 п. 1 — нет `CREATE` на БД: `select has_database_privilege(current_user, current_database(), 'CREATE')` истина → нарушение «CREATE на базе <БД>»;
   - нет `CREATE` ни на одной схеме БД: `select nspname from pg_namespace where nspname not in ('pg_catalog', 'information_schema') and nspname not like 'pg_toast%' and nspname not like 'pg_temp%' and has_schema_privilege(current_user, oid, 'CREATE')` — непустой → нарушение «CREATE на схеме <имя>» (в PostgreSQL 15+ у `PUBLIC` нет `CREATE` на `public`, поэтому чистая БД проходит);
   - нарушения собираются; есть хоть одно → `Error` «assertAppRoleIsNotOwner: <роль>: <перечень нарушений через «; »»».

### Контракты
- Вызывающий передаёт соединение **роли приложения** (`kitDatabaseUrl`); под суперпользователем проверка падает (это и есть смысл).

### Ошибки и логи
Ошибка — с именами ролей и схем (не секреты), без значений строк.

### Тесты
Задача 16.

### Критерии приёмки
- Проходит под `<svc>_app`, падает под `<svc>_owner` и суперпользователем, падает при `CREATE` роли приложения на БД или схеме.

### Проверка
- задача 16.

## Task 16: Экспорты, `globalSetup` пакета и тесты фазы

### Шаги
1. `src/testing/index.ts` (`Skill: nestjs-code generic src/testing/index.ts (MODIFY)`): добавить `createScratchDatabase`, `export type KitScratchDatabase`; `workerScope`, `export type KitWorkerScope`; `assertAppRoleIsNotOwner`, `export type KitQueryable`. Шапка: «E1 → E4».
2. `test/integration/global-setup.ts` (`Skill: nestjs-code test integration support global-setup (MODIFY)`): `startTestStack({service: 'kit', postgres: true, migrations: 'test/fixtures/database/migrations'})`; комментарий — AC-4.18.
3. `test/integration/testing/ac-1-13-postgres.spec.ts` (`Skill: nestjs-code test integration testing postgres (MODIFY)`): случай `AC-1.13: подготовки БД нет` заменить на `AC-1.13: startTestStack({postgres: true}) без migrations — роли kitnomig_* и схема kitnomig есть, таблиц в схеме нет` — отдельный вызов `startTestStack({service: 'kitnomig', postgres: true})` с поддельным `project` (как существующий случай «без флага postgres»), запросы — по адресу из пойманного `provide('kitDatabaseAdminUrl', …)`, `teardown` в `finally`. Шапку файла поправить: «подготовка БД — E4 (AC-4.18)».
4. `test/integration/testing/ac-4-18-scratch-database.spec.ts` (`Skill: nestjs-code test integration testing scratch-database (CREATE)`), `describe('UC-14: пустая БД из шаблона')`:
   - `AC-4.18: kitDatabaseUrl, kitDatabaseOwnerUrl, kitDatabaseAdminUrl, kitDatabaseService, kitDatabaseTemplate переданы через provide`;
   - `AC-4.18: БД kit подготовлена и мигрирована — журнал kit.__migrations, таблицы note и setting, FORCE RLS у note`;
   - `AC-4.18: первая строка 0000_*.sql фикстуры — CREATE SCHEMA IF NOT EXISTS "kit"` (защита от перегенерации без правки, задача 8);
   - `AC-4.18: createScratchDatabase — пустая мигрированная БД за < 1 с` (`performance.now()`, граница `1000 × TEST_TIMEOUT_SCALE`; в БД таблицы фикстуры, 0 строк в `note`);
   - `AC-4.18: роль kit_app подключается к пустой БД, drop() удаляет её, повторный drop() — без ошибки`;
   - `AC-4.18: два одновременных createScratchDatabase — обе БД созданы` (повтор `55006`).
5. `test/integration/database/ac-4-6-prepare-database.spec.ts` (`Skill: nestjs-code test integration database prepare-database (MODIFY)`): `AC-4.6: assertAppRoleIsNotOwner проходит под kitprep_app` и `AC-4.6: assertAppRoleIsNotOwner падает под kitprep_owner (владелец схемы)`; `AC-4.6: kitprep_app без CREATE на базе и схеме после prepareDatabase` (`has_database_privilege`, `has_schema_privilege`); `AC-4.6: assertAppRoleIsNotOwner падает после GRANT CREATE ON DATABASE … TO kitprep_app` и `… падает после GRANT CREATE ON SCHEMA kitprep TO kitprep_app` (права выдаёт и в `finally` отзывает суперпользователь) — соединения `pg.Client` с паролями теста.
6. `test/integration/database/ac-4-7-migrations.spec.ts` (`Skill: nestjs-code test integration database migrations (MODIFY)`): исходная БД — `createScratchDatabase()` (уже мигрированная: проверка «applied: 0» и журнала — на ней); случай «первый runMigrations пишет журнал» — на новой пустой БД, подготовленной суперпользователем (`CREATE DATABASE`, `grantDatabaseAccess`, `CREATE SCHEMA kit AUTHORIZATION kit_owner`), миграции — под `kitDatabaseOwnerUrl` с заменой имени БД; восстановление дампа — так же; `prepareDatabase` с ролями `kit_*` в файле больше не вызывается.
7. `test/unit/testing/worker-scope.spec.ts` (`Skill: nestjs-code test unit testing worker-scope (CREATE)`), `describe('UC-14: workerScope')`:
   - `§3.8: tenant — слаг ^[a-z0-9][a-z0-9-]{0,48}$, начинается с w<VITEST_POOL_ID>-`;
   - `§3.8: повторный вызов в воркере — то же значение`;
   - `§3.8: в типе нет rabbitmq и redisPrefix (E5, E8)` — `expectTypeOf` в `test/unit/testing/worker-scope.test-d.ts`.
8. `docs/testing.md` — не здесь (задача 39).

### Требования
AC-1.13 (v1.14: «в E1 нет» — подготовка с E4), AC-4.6, AC-4.7, AC-4.18; §3.8 строки `startTestStack`, `workerScope`, `createScratchDatabase`, `assertAppRoleIsNotOwner`.

### Критерии приёмки
- `make test test-integration` зелёные; `test/consumer/no-testcontainers` (задача 38) по-прежнему получает ошибку про `testcontainers` при импорте `/testing` без `pg`.

### Проверка
- `make test test-integration`.

## Риски
- Риск: `CREATE DATABASE … TEMPLATE` падает, если к шаблону есть соединение. Mitigation: шаблон используется только `startTestStack` до копирования; тесты к нему не подключаются; повтор `55006` в `createScratchDatabase`.

## Чек-лист фазы
- Задачи 12–16 выполнены; `make lint analyse test test-integration` зелёные.
