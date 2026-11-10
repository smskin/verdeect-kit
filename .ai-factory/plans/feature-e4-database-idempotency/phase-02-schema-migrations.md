# Фаза 2: Схема, подготовка БД и миграции

Plan: [index.md](index.md)
Tasks: 4-9
Depends on: Phase 1 (Task 1 — `drizzle-kit`, lint; Task 2 — `ids`)

## Цель

Без Nest-модуля и без `Db`: загрузчик `pg` и драйвера Drizzle, `DbContext`, `tenantColumn`/`tenantPolicy`, `prepareDatabase` (роли `<svc>_owner`, `<svc>_app`, `<svc>_directory`, схема), `runMigrations` (журнал `<schema>.__migrations`) и внутренний `moveJournal`; фикстура схемы и миграций пакета, сгенерированная `drizzle-kit`. Проверки I AC-4.6 (часть «роли, повтор») и AC-4.7 — на контейнере `kitPostgresUrl` текущего `globalSetup` (без подготовки). Подпуть `./database` в `exports` ещё не объявлен (фаза 5).

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| O `src/shared/database/prepare-database.ts` | `LOGIN_ATTRIBUTES`, `DIRECTORY_ATTRIBUTES`, `roleExists`, `upsertRole`, порядок GRANT/CREATE SCHEMA | эталон `prepareDatabase` |
| O `src/shared/database/migrator.ts` | `countApplied` (две выборки, иначе 42P01), `runMigrations` (пул `max: 1`, `withPoolClient`) | эталон `runMigrations`; журнал у O — `drizzle.__drizzle_migrations`, по PRD — `<schema>.__migrations` |
| O `src/shared/database/pool-options.ts` | `CONNECTION_TIMEOUT_MS = 5000` | срок соединения CLI/миграций |
| O `src/shared/database/columns.ts:22-26` | `tenantIsolation` — `pgPolicy` `for: 'all'`, `using` = `withCheck` = `tenant = current_setting('app.tenant', true)` | эталон `tenantPolicy` |
| O `drizzle/0001_force_grants.sql` | `FORCE ROW LEVEL SECURITY`, `GRANT … TO orchestrator_app` | права и FORCE — SQL-миграцией сервиса |
| `node_modules/drizzle-orm/pg-core/dialect.js:45-67` | `migrationsSchema`, `migrationsTable`, `CREATE SCHEMA IF NOT EXISTS` | `migrate` создаёт схему журнала: владельцу нужен `CREATE` на БД |
| `src/internal/peer.ts` | `loadPeer` | загрузка `pg` |
| `src/internal/service-name.ts` | `assertServiceName` | формат имени сервиса |
| `src/config/cli-schemas.ts` | `prepareEnvSchema`, `migrateEnvSchema` | ключи CLI (фаза 3) |
| O `test/integration/database/fr-21-roles.int-spec.ts`, `ac-10-8-migrate.int-spec.ts`; I `test/integration/database/migrations.int-spec.ts` | атрибуты ролей, повтор `db:prepare` — `created: []`, повтор миграций — `applied: 0` | тесты эквивалентности AC-4.6, AC-4.7 |
| `test/integration/global-setup.ts` | `startTestStack({service: 'kit', postgres: true})` | в этой фазе не меняется |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/internal/peer.ts` | modify | `requirePeer` — синхронная проверка peer с текстом AC-1.2 |
| `src/database/pg.ts` | create | `requirePeer('pg')` при импорте; `loadPg`, `loadDrizzle` — ленивый `import()` |
| `src/database/tenant.ts` | create | `DbContext`, `tenantColumn`, `tenantPolicy`, `TENANT_SETTING` |
| `src/database/prepare-database.ts` | create | `prepareDatabase`, внутренняя `grantDatabaseAccess` |
| `src/database/migrations.ts` | create | `runMigrations`, внутренняя `moveJournal`, `MIGRATIONS_TABLE` |
| `test/fixtures/database/schema.ts` | create | схема фикстуры `kit`: `note`, `setting` |
| `test/fixtures/database/drizzle.config.ts` | create | конфиг `drizzle-kit` |
| `test/fixtures/database/migrations/**` | create (генерация) | `0000_*.sql`, `0001_force_grants.sql`, `meta/` |
| `test/support/postgres.ts` | create | помощники уровня I: админ-запрос, БД прогона, URL роли |
| `test/integration/database/ac-4-6-prepare-database.spec.ts` | create | AC-4.6 (роли, повтор) |
| `test/integration/database/ac-4-7-migrations.spec.ts` | create | AC-4.7 |

## Task 4: Загрузчик `pg` и драйвера Drizzle

### Назначение
`/database` и `/idempotency` без `pg` падают при импорте текстом AC-1.2. Драйвер `drizzle-orm/node-postgres` импортирует `pg` статически, поэтому грузится только после проверки. **Без top-level await в статическом графе точек входа:** схему сервиса (`schema.ts` с `tenantColumn`, `createIdempotencyTable` из `@verdeect/kit/database`, `/idempotency`) загружает `drizzle-kit` 0.31.11 через CJS-хук `tsx` и `require`, а `require` ESM-графа с top-level await падает `ERR_REQUIRE_ASYNC_MODULE` (воспроизведено на tsx 4.23 / Node 24).

**Правило ARCHITECTURE «Правила зависимостей» (обновлено коммитом `754cc15` по KT-20 п. 2, П15):** проверка опционального peer — синхронная при загрузке модуля (`requirePeer`, `createRequire(import.meta.url).resolve`, текст AC-1.2 при импорте подпути, а не при первом вызове); сам peer — динамический `import()` при вызове. Причина — `drizzle-kit` загружает схему сервиса через `require`. Шапки `src/database/pg.ts` и `src/idempotency/peer.ts` ссылаются на это правило (П15). Тест AC-1.2 для `/database` и `/idempotency` (задача 38) не меняется. Модули E1–E3 с top-level `await loadPeer` (`src/testing/start-test-stack.ts:13`) в этом этапе не переделываются.

### Шаги
1. `src/internal/peer.ts` (`Skill: nestjs-code generic src/internal/peer.ts (MODIFY)`): новая функция `requirePeer(library, subpath)` — синхронно `createRequire(import.meta.url).resolve(library)`; ошибка `MODULE_NOT_FOUND` о самом пакете `library` → `Error` с текстом `missingPeerMessage(library, subpath)` и `cause`; прочие ошибки — как есть. Существующие `loadPeer`/`loadPeerWith` не меняются. Тест — `test/unit/internal/ac-1-2-load-peer.spec.ts` (MODIFY, `Skill: nestjs-code test unit internal load-peer (MODIFY)`): `AC-1.2: requirePeer — отсутствующий пакет → текст AC-1.2; установленный — без ошибки`.
2. Создать `src/database/pg.ts` (`Skill: nestjs-code generic src/database/pg.ts (CREATE)`). Шапка: «pg и драйвер Drizzle для /database (prd.md §3.3, AC-1.2, NFR-3): requirePeer('pg', 'database') синхронно при импорте; pg, drizzle-orm/node-postgres и его migrator — ленивый import() (драйвер импортирует pg статически). Top-level await нет: drizzle-kit загружает схему сервиса через require».
3. Верхний уровень модуля: `requirePeer('pg', 'database')` (синхронно, без `await`).
4. Экспортировать (внутри пакета, не из `index.ts`):
   - `loadPg()` — мемоизированный промис модуля `pg` (значение по умолчанию: `Pool`, `Client`, `escapeIdentifier`, `escapeLiteral`);
   - `loadDrizzle()` — мемоизированный промис `{drizzle, migrate}` из `drizzle-orm/node-postgres` и `drizzle-orm/node-postgres/migrator`;
   - типы `Pool`, `PoolClient`, `PoolConfig` (`import type` из `pg`), `NodePgDatabase` (`import type` из драйвера);
   - константу `CONNECTION_TIMEOUT_MS` = 5000 (срок соединения CLI, миграций и `prepareDatabase`, эталон O `pool-options.ts`).
5. Все потребители — асинхронные функции (`prepareDatabase`, `runMigrations`, `moveJournal`, фабрики `KitDatabaseModule`, `createPools`): берут `pg` и драйвер через `await loadPg()` / `await loadDrizzle()`. Синхронные фабрики схемы (`tenantColumn`, `tenantPolicy`, `occurredAtColumn`, `ifNewer`, `createIdempotencyTable`, `idempotencyPurgeSql`) `pg` не трогают.
6. Не экспортировать из публичного `index.ts` (задача 22) ничего, кроме реэкспортов §3.3.

### Контракты
- Любой файл `src/database/**`, которому нужен `pg` или драйвер, получает их только из `./pg.js`.
- `src/database/index.ts` первым импортом подключает `./pg.js` (задача 22): ошибка AC-1.2 возникает при импорте раньше других модулей.
- В статическом графе `dist/database/index.js` и `dist/idempotency/index.js` нет top-level await (проверка — задача 38).

### Ошибки и логи
Нет `pg` → `Error` «@verdeect/kit/database требует pg — добавьте в зависимости сервиса» (`requirePeer`). Логов нет.

### Тесты
Проверка поведения без `pg` — уровень C в задаче 38 (проект `no-testcontainers` без `pg`); загрузка схемы потребителя `drizzle-kit` — задача 38; граф импортов — U в задаче 22.

### Критерии приёмки
- `make lint analyse test` зелёные; `drizzle-orm/node-postgres` нигде не импортируется статически значением; `await` на верхнем уровне `src/database/**`, `src/idempotency/**` отсутствует.

### Проверка
- `make lint analyse test`; `grep -rn '^await\|^const .* = await' src/database src/idempotency` — пусто.

## Task 5: `DbContext`, `tenantColumn`, `tenantPolicy`

### Назначение
Строгая модель RLS §3.3: колонка тенанта и политика `tenant = current_setting('app.tenant', true)`; SQL политики генерирует `drizzle-kit` сервиса, `FORCE` — SQL-миграцией сервиса. P0: режима «пустой тенант видит всё» нет (у I он есть — не переносится).

### Шаги
1. Создать `src/database/tenant.ts` (`Skill: nestjs-code generic src/database/tenant.ts (CREATE)`). Шапка: «DbContext, tenantColumn, tenantPolicy (prd.md §3.3, AC-4.8, P0 — только строгий RLS). Эталон — O columns.ts tenantIsolation; I (пустой тенант видит всё) не переносится». Файл не импортирует `pg` (его импортирует `drizzle.config.ts` фикстур и схема сервиса).
2. `TENANT_SETTING` — строка `app.tenant` (внутренняя константа, экспорт только внутри пакета).
3. Интерфейс `DbContext` (TSDoc по §3.3, все поля `readonly`): `tenant: string | null`; `traceId: string`; `actor` — объект с необязательными `clientId`, `accountId`, `memberId`, `onBehalfOf` (строки) и обязательным `channel` (строка) — поля `actor` конверта `01` §7.1.
4. `tenantColumn(name?: string)` — колонка `text` с именем `tenant` (параметр по умолчанию `tenant`; другое имя — только если сервису нужно, проверки `assertStrictTenantIsolation` ищут колонку `tenant`), `notNull()`. TSDoc: «nullable-тенант — только `createIdempotencyTable` и outbox E5».
5. `tenantPolicy(column: PgColumn)` — `pgPolicy` с именем `tenant_isolation` (имя таблицы при объявлении политики недоступно; имена политик уникальны в пределах таблицы — PostgreSQL). Параметры: `as: 'permissive'`, `for: 'all'`, `to: 'public'`, `using` и `withCheck` — SQL `<column> = current_setting('app.tenant', true)`.
6. TSDoc `tenantPolicy`: в сервисе нужна SQL-миграция `ALTER TABLE <svc>.<таблица> FORCE ROW LEVEL SECURITY` и права `GRANT … TO <svc>_app` (README, задача 39).

### Контракты
```sql
-- Политика, которую должен сгенерировать drizzle-kit по tenantPolicy (проверяется в задаче 9 через pg_policies):
CREATE POLICY "tenant_isolation" ON "kit"."note" AS PERMISSIVE FOR ALL TO public
  USING ("kit"."note"."tenant" = current_setting('app.tenant', true))
  WITH CHECK ("kit"."note"."tenant" = current_setting('app.tenant', true));
```

### Ошибки и логи
Нет.

### Тесты
Генерация и действие политики — в задачах 8, 9 (SQL фикстуры) и 36 (AC-4.8).

### Критерии приёмки
- Схема фикстуры (задача 8) собирается `drizzle-kit` с этими функциями.

### Проверка
- `make lint analyse`.

## Task 6: `prepareDatabase`

### Назначение
Одна функция для CLI `db prepare` (фаза 3) и `startTestStack` (фаза 4): идемпотентно создаёт роли и схему сервиса (§3.3, AC-4.6). Роли в миграциях не создаются.

### Шаги
1. Создать `src/database/prepare-database.ts` (`Skill: nestjs-code generic src/database/prepare-database.ts (CREATE)`). Шапка: «prepareDatabase (prd.md §3.3, AC-4.6, UC-12). Эталон — O prepare-database.ts: ALTER или CREATE ROLE, атрибуты, GRANT роли directory владельцу, права на БД, схема AUTHORIZATION владельца. По PRD: имя сервиса параметром; схема drizzle не создаётся (журнал — в схеме сервиса); USAGE схемы роли приложения».
2. Тип `KitPrepareDatabaseOptions`: `service`, `adminUrl`, `ownerPassword`, `appPassword` (строки). Тип результата `KitPrepareDatabaseResult`: `database: string`, `roles: readonly string[]` (порядок owner, app, directory), `created: readonly string[]` (роли, созданные этим вызовом).
3. `prepareDatabase(options): Promise<KitPrepareDatabaseResult>`:
   1. `assertServiceName(service, 'prepareDatabase')`.
   2. Имена ролей: `<svc>_owner`, `<svc>_app`, `<svc>_directory`; схема — `<svc>`. Все имена в SQL — только через `quoteIdentifier` (`src/internal/sql-identifier.ts`, задача 3; KT-20 п. 1), пароли — через `escapeLiteral` (DDL не принимает параметры).
   3. `pg.Client` (`await loadPg()`) с `connectionString: adminUrl`, `connectionTimeoutMillis: 5000` (константа `CONNECTION_TIMEOUT_MS` из `pg.ts`, задача 4; эталон O `pool-options.ts`); обработчик `error` клиента — no-op до `end()`.
   4. Для каждой роли — `SELECT 1 FROM pg_roles WHERE rolname = $1`, затем `CREATE ROLE` или `ALTER ROLE` с атрибутами: owner и app — `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<…>'`; directory — `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`. Повтор меняет пароль на переданный (как O) и не создаёт ничего нового.
   5. `GRANT <svc>_directory TO <svc>_owner` (владелец передаёт функции `SECURITY DEFINER` роли directory).
   6. `grantDatabaseAccess(client, service, database)` — внутренняя экспортируемая функция этого файла (её вызывают `startTestStack` и `createScratchDatabase`, задачи 12, 13): права выдаются **на БД из параметра `database`** (`quoteIdentifier`), а не на `current_database()` — вызывающий может быть подключён к БД `postgres`: `GRANT CONNECT, CREATE ON DATABASE <database> TO <svc>_owner`; `GRANT CONNECT ON DATABASE <database> TO <svc>_app`. `prepareDatabase` сам передаёт `SELECT current_database()` своего соединения.
   7. `CREATE SCHEMA IF NOT EXISTS <svc> AUTHORIZATION <svc>_owner`; `ALTER SCHEMA <svc> OWNER TO <svc>_owner`; `GRANT USAGE ON SCHEMA <svc> TO <svc>_app, <svc>_directory`.
   8. `client.end()` в `finally`.
4. Лог: функция принимает необязательный `logger` (тип `Logger` из `pino`) во втором параметре; `info` `{service, database, created}` сообщение «prepareDatabase: готово»; `debug` на каждой роли `{role, action: 'create'|'alter'}`. Пароли, адрес и SQL с паролем не логируются.

### Контракты
- Права на таблицы роли приложения (`SELECT, INSERT, UPDATE, DELETE`) и `FORCE RLS` — в SQL-миграциях сервиса, не здесь (эталон O; README).
- **KT-19 п. 1:** `<svc>_app` получает только `CONNECT` на БД и `USAGE` на схему — **никогда `CREATE`** ни на БД, ни на схему (иначе роль приложения создаёт объекты и становится их владельцем в обход миграций). `CREATE` на БД — только `<svc>_owner`. Проверка — `assertAppRoleIsNotOwner` (задача 15) и тест AC-4.6 (задача 16).
- Ошибка подключения или SQL — исключение `pg` как есть (CLI переводит в JSON без адресов, задача 10).

### Ошибки и логи
- Имя сервиса вне формата — `TypeError` `assertServiceName`.
- Пароль ни в одном логе и тексте ошибки (`escapeLiteral` строит SQL, SQL не логируется).

### Тесты
Задача 9.

### Критерии приёмки
- Повторный вызов — `created: []`, атрибуты ролей прежние.

### Проверка
- `make test-module M='database'` после задачи 9.

## Task 7: `runMigrations` и `moveJournal`

### Назначение
Журнал миграций — `<schema>.__migrations`, схема `drizzle` не создаётся (AC-4.7); перенос журнала O/I/P из `drizzle.__drizzle_migrations` — `db move-journal` (§3.3, переходы §10).

### Шаги
1. Создать `src/database/migrations.ts` (`Skill: nestjs-code generic src/database/migrations.ts (CREATE)`). Шапка: «runMigrations, moveJournal (prd.md §3.3, AC-4.7, AC-4.17). Эталон — O migrator.ts: пул max 1, срок соединения 5 с, подсчёт применённых двумя запросами. По PRD: журнал <schema>.__migrations, папка и схема — от сервиса».
2. Константы: `MIGRATIONS_TABLE` = `__migrations`; имя схемы = имя сервиса — проверка той же внутренней `assertServiceName` (`^[a-z][a-z0-9-]{1,31}$`, KT-20 п. 1), в SQL — только `quoteIdentifier`.
3. `runMigrations({url, folder, schema}, logger?)` → `Promise<{applied: number}>`:
   1. Схема вне формата (`assertServiceName(schema, 'runMigrations')`) → `TypeError`; папки `folder` или файла `meta/_journal.json` в ней нет → `KitUsageError` (внутренний класс файла, наследник `Error`, `name = 'KitUsageError'`; CLI переводит его в `USAGE`, задача 10) «runMigrations: нет журнала drizzle-kit в <folder>».
   2. `new pg.Pool({connectionString: url, max: 1, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS})` (`pg` — `await loadPg()`), `pool.on('error')` — no-op.
   3. `countApplied(pool, schema)`: сначала `select to_regclass($1) is not null as exists` с `<schema>.__migrations` (идентификатор в кавычках), если таблицы нет — 0, иначе `select count(*)::int as count from <schema>.__migrations`.
   4. `migrate` и `drizzle` — `await loadDrizzle()` (задача 4) на `drizzle(client)` выделенного клиента: `migrationsFolder: folder`, `migrationsSchema: schema`, `migrationsTable: MIGRATIONS_TABLE`. Клиент — `pool.connect()`, `release()` в `finally` (при ошибке соединения — `release(error)`).
   5. `applied = after − before`; `pool.end()` в `finally`.
   6. Лог: `info` `{schema, applied}` «runMigrations: готово»; `debug` `{schema, before}` перед применением. Адрес не логируется.
4. `moveJournal({url, from, to}, logger?)` → `Promise<{moved: number}>` (внутренняя, не реэкспортируется из `index.ts`; её вызывает CLI):
   1. Обе схемы — `assertServiceName` (`drizzle` проходит формат); `from === to` → `TypeError`.
   2. Один клиент, одна транзакция:
      - `to_regclass('<from>.__drizzle_migrations')` пусто → `COMMIT`, `{moved: 0}` (повтор после переноса — без ошибки);
      - создать журнал назначения, если нет (структура журнала Drizzle):
        ```sql
        CREATE TABLE IF NOT EXISTS "<to>"."__migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
        ```
      - перенести строки, которых ещё нет по `hash`, в порядке `created_at`:
        ```sql
        INSERT INTO "<to>"."__migrations" (hash, created_at)
        SELECT s.hash, s.created_at FROM "<from>"."__drizzle_migrations" s
        WHERE NOT EXISTS (SELECT 1 FROM "<to>"."__migrations" t WHERE t.hash = s.hash)
        ORDER BY s.created_at;
        ```
        `moved` — `rowCount`;
      - `DROP TABLE "<from>"."__drizzle_migrations"`; затем `DROP SCHEMA "<from>"` в точке сохранения: ошибка `2BP01` (схема не пуста) — откат к точке сохранения, схема остаётся.
   3. Лог `info` `{from, to, moved}`.

### Контракты
- `runMigrations` выполняется под ролью владельца (`DATABASE_MIGRATOR_URL`); владелец имеет `CREATE` на БД (задача 6), поэтому `CREATE SCHEMA IF NOT EXISTS` драйвера проходит.
- Повторный запуск — `{applied: 0}`.

### Ошибки и логи
- Ошибки `pg` и Drizzle — как есть (CLI переводит, задача 10). SQL миграций и адрес не логируются.

### Тесты
Задача 9.

### Критерии приёмки
- После `runMigrations` в БД нет схемы `drizzle`; журнал — `<schema>.__migrations`.

### Проверка
- задача 9.

## Task 8: Фикстура схемы и миграций пакета

### Назначение
Тестовая схема сервиса `kit` для уровня I: таблица компании под строгим RLS и таблица без тенанта. Миграции генерирует `drizzle-kit` (как в сервисе) — проверка, что `tenantPolicy` даёт нужный SQL. В фазе 6 сюда добавятся таблица идемпотентности и функция очистки (задача 32).

### Шаги
1. `test/fixtures/database/schema.ts` (`Skill: none — фикстура теста, TypeScript схемы Drizzle; соглашения nestjs-code test`): `pgSchema('kit')` (в `test/**` lint AC-9.4 не действует); таблица `note`: `id text primary key`, `tenant` — `tenantColumn()`, `body text not null`, `occurred_at` — `timestamp with time zone`, nullable (для `ifNewer`, AC-4.13), `counter integer not null default 0`; политика `tenantPolicy` на `tenant`. Таблица `setting`: `key text primary key`, `value text not null` (без тенанта — для `readGlobal`). Импорт `tenantColumn`/`tenantPolicy` — из `../../../src/database/tenant.js` (файл без `pg`).
2. `test/fixtures/database/drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './test/fixtures/database/schema.ts'`, `out: './test/fixtures/database/migrations'`, `schemaFilter: ['kit']`, `strict: true`, `verbose: true`, `entities.roles: false` (роли — `prepareDatabase`). URL БД генерации не нужен.
3. `pnpm db:fixtures` → `migrations/0000_<имя>.sql` + `meta/`. **Первую строку `CREATE SCHEMA "kit";` заменить на `CREATE SCHEMA IF NOT EXISTS "kit";`** — схему заранее создаёт `prepareDatabase` (задача 6), иначе `runMigrations` падает 42P06; так же сделано у O (`verdeect-orchestrator/apps/orchestrator/drizzle/0000_tables.sql:1`; у I строка без правки — `verdeect-identity/apps/identity/drizzle/0001_tables.sql:1`). Снимок `meta/` при этом не меняется. Проверить вручную: в SQL есть `ENABLE ROW LEVEL SECURITY` и `CREATE POLICY "tenant_isolation" … current_setting('app.tenant', true)`.
4. `pnpm exec drizzle-kit generate --config test/fixtures/database/drizzle.config.ts --custom --name force_grants` → `0001_force_grants.sql`; содержимое:
   ```sql
   ALTER TABLE "kit"."note" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   GRANT SELECT, INSERT, UPDATE, DELETE ON "kit"."note", "kit"."setting" TO "kit_app";
   ```
5. `.prettierignore` уже исключает `test/fixtures/` — сгенерированные файлы Prettier не трогает; правок не нужно. Для миграций потребителя (`test/consumer/minimal/drizzle/`, задача 37) строка добавляется в задаче 37.

### Контракты
- Схема фикстуры — `kit` = имя сервиса `globalSetup` (`startTestStack({service: 'kit'})`, задача 16).

### Ошибки и логи
Нет.

### Тесты
Используются задачами 9, 16, 24.

### Критерии приёмки
- `pnpm db:fixtures` повторно — «No schema changes» (миграции актуальны).

### Проверка
- `pnpm db:fixtures`; `make lint`.

## Task 9: Тесты AC-4.6 (роли) и AC-4.7 (журнал)

### Назначение
Эквивалентность O `fr-21-roles` (атрибуты, повтор), O `ac-10-8-migrate` и I `migrations` (повтор — 0) в обобщённом виде.

### Шаги
1. `test/support/postgres.ts` (`Skill: nestjs-code test integration support postgres (CREATE)`):
   - `adminQuery(url, sql, params?)` — короткий `pg.Client`, строки результата;
   - `createDatabase(name)` / `dropDatabase(name)` на `inject('kitPostgresUrl')` (`DROP DATABASE … WITH (FORCE)`);
   - `databaseUrl(base, {database, user?, password?})` — новый URL на основе адреса суперпользователя;
   - `postgresContainerId(service)` — `docker ps -q --filter label=verdeect.kit.service=<service>` (для `pg_dump`);
   - имена БД тестов — с префиксом файла и случайным суффиксом (файлы не мешают друг другу).
2. `test/integration/database/ac-4-6-prepare-database.spec.ts` (`Skill: nestjs-code test integration database prepare-database (CREATE)`), `describe('UC-12: подготовка БД')`, своя БД и сервис `kitprep`:
   - `AC-4.6: роли kitprep_owner (LOGIN, NOBYPASSRLS), kitprep_app (LOGIN, NOBYPASSRLS, не суперпользователь), kitprep_directory (NOLOGIN, BYPASSRLS) созданы` — по `pg_roles`;
   - `AC-4.6: схема kitprep принадлежит kitprep_owner, схемы drizzle нет`;
   - `AC-4.6: повторный prepareDatabase — без ошибок, created: [], атрибуты и владелец схемы прежние`;
   - `AC-4.6: kitprep_app входит с паролем, kitprep_directory — нет (NOLOGIN)`;
   - `§3.3: имя сервиса вне формата → TypeError без подключения к БД`.
   В `afterAll` — удалить БД и роли (`DROP ROLE` после `DROP OWNED`).
3. `test/integration/database/ac-4-7-migrations.spec.ts` (`Skill: nestjs-code test integration database migrations (CREATE)`), `describe('UC-1: миграции')`, своя БД и сервис `kitmig`, папка — фикстура задачи 8 (схема в ней `kit`, поэтому тест готовит сервис `kit` в своей отдельной БД; роли `kit_*` общие для кластера — пароль тот же, что задаёт тест):
   - `AC-4.7: runMigrations пишет журнал в kit.__migrations, схема drizzle не создаётся, applied = числу миграций`;
   - `AC-4.7: повторный runMigrations — applied: 0`;
   - `AC-4.7: pg_dump -n kit + восстановление в пустую подготовленную БД + runMigrations — applied: 0` — `docker exec <контейнер> pg_dump -U postgres -n kit <БД>` → `psql` в новую БД через `docker exec -i`; перед восстановлением — `prepareDatabase` на новой БД;
   - `AC-4.7: moveJournal переносит drizzle.__drizzle_migrations в kit.__migrations, схема drizzle удалена, повтор — moved: 0` — журнал источника создаётся **под ролью `kit_owner`** (у неё `CREATE` на БД; иначе `DROP TABLE`/`DROP SCHEMA` в `moveJournal` под владельцем падают 42501): `CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations …` с двумя строками, хеши которых **нет** в `kit.__migrations` (иначе `moved: 0`);
   - `AC-4.7: в журнале назначения строки не дублируются при совпадении hash`;
   - `§3.3: папка без meta/_journal.json → Error с путём папки`.

### Требования
- AC-4.6, AC-4.7 (prd.md §5.4); §3.3 строки `prepareDatabase`, `runMigrations`.

### Ошибки и логи
Тесты пароли не выводят; `pg_dump` — без пароля в аргументах (суперпользователь контейнера, локальный сокет).

### Критерии приёмки
- Оба файла зелёные; БД и роли тестов удаляются в `afterAll`.

### Проверка
- `make test-module M='database'` (Docker).

## Риски
- Риск: роли кластерные — `kit_*` из теста AC-4.7 пересекутся с `globalSetup` фазы 4, а повторный `prepareDatabase` меняет пароль ролей на свой. Mitigation: в этой фазе `globalSetup` ролей не создаёт — конфликта нет. В фазе 4 (задача 16) файл AC-4.7 переводится на `createScratchDatabase()` (роли `kit_*` и пароли прогона не трогаются), а БД для восстановления дампа готовится внутренней `grantDatabaseAccess`, не `prepareDatabase`.

## Чек-лист фазы
- Задачи 4–9 выполнены; `make lint analyse test test-integration` зелёные.
