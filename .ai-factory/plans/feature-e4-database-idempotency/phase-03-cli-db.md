# Фаза 3: CLI `verdeect-kit db`

Plan: [index.md](index.md)
Tasks: 10-11
Depends on: Phase 2 (Tasks 6, 7)

## Цель

Команды `db prepare --service <svc>`, `db migrate --folder <путь> --schema <svc>`, `db move-journal --from <схема> --to <svc>` (§3.3 PRD v1.14, AC-4.17, UC-12): разбирают только свои ключи окружения, результат — одна строка JSON в stdout и код 0, ошибка — JSON `{error: {code, …}}` без адресов и паролей и код 1. Логи — pino в stderr (`entry: 'cli'`), как у команды `openapi`.

## Свидетельства из кода

| Путь | Символы | Зачем |
|---|---|---|
| `src/cli/main.ts` | `COMMANDS`, `main` | регистрация команды; динамический импорт обработчика |
| `src/cli/commands/openapi.ts` | `CommandError`, `createLogger`, `parseOptions`, `openapiCommand(args, context)` | образец обработчика, JSON-ошибки, контекст `write` для теста |
| `src/config/cli-schemas.ts` | `prepareEnvSchema`, `migrateEnvSchema` | ключи окружения команд |
| `src/internal/pg-errors.ts` | `isConnectionError` | код `DATABASE_UNAVAILABLE` |
| O `src/cli/run-cli.ts:60-85` | `db:prepare`, `migrate`: `{ok, …}` / `{ok: false, error: {code, message}}` | эталон; по PRD — без поля `ok`, формат как у `openapi` |
| `test/unit/cli/ac-3-7-openapi-command.spec.ts` | вызов обработчика в процессе с `write` | образец теста |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/cli/commands/db.ts` | create | `dbCommand` и подкоманды |
| `src/cli/main.ts` | modify | запись `db` в `COMMANDS` |
| `test/integration/cli/ac-4-17-db-commands.spec.ts` | create | AC-4.17 |

## Task 10: Команда `db`

### Назначение
Единственный рекомендуемый способ подготовить БД и применить миграции в развёртывании (UC-12 шаг 3) и перенести журнал при переходе сервиса.

### Шаги
1. Создать `src/cli/commands/db.ts` (`Skill: nestjs-code generic src/cli/commands/db.ts (CREATE)`). Шапка: «Команда verdeect-kit db prepare|migrate|move-journal (prd.md §3.3 v1.14, AC-4.17, UC-12). Эталон — O run-cli.ts (db:prepare, migrate). Подпути пакета — динамическим import() (ARCHITECTURE «CLI»); окружение — только prepareEnvSchema / migrateEnvSchema».
2. Тип контекста `DbCommandContext` — как `OpenApiCommandContext` (`cwd`, `write`) плюс `env` (по умолчанию `process.env`) — тест передаёт окружение без `vi.stubEnv`.
3. Класс ошибки `CommandError(code, message, extra)` — свой в файле (как в `openapi.ts`; общий модуль ради двух классов не заводится).
4. Логгер: та же схема, что `createLogger` в `openapi.ts` (`LOG_LEVEL`, `REPLICA_ID` из `envBase`), `service: 'verdeect-kit'`, `entry: 'cli'` → stderr.
5. `dbCommand(args, context?)`: первый позиционный аргумент — подкоманда; нет или неизвестная → `USAGE` «подкоманда db: prepare, migrate, move-journal».
6. `prepare`:
   - опции `parseArgs` `strict: true`: `--service` (строка). Нет флага → `USAGE` «нужна опция --service <svc>»; формат вне `^[a-z][a-z0-9-]{1,31}$` (`assertServiceName` из `internal/service-name.js` — динамический импорт) → `USAGE` «--service: имя сервиса вне формата ^[a-z][a-z0-9-]{1,31}$» (значение флага в текст не включать);
   - окружение — `prepareEnvSchema.safeParse(env)`; ошибка → `INVALID_ENVIRONMENT` с `keys` (только имена, как в `openapi.ts`);
   - `prepareDatabase({service, adminUrl: DATABASE_ADMIN_URL, ownerPassword: DB_OWNER_PASSWORD, appPassword: DB_APP_PASSWORD}, logger)` (динамический импорт `../../database/prepare-database.js`);
   - stdout — `{database, roles, created}`.
7. `migrate`: опции `--folder`, `--schema` (обе обязательны → иначе `USAGE`); окружение `migrateEnvSchema`; `runMigrations({url: DATABASE_MIGRATOR_URL, folder: resolve(cwd, folder), schema}, logger)`; stdout — `{schema, applied}`.
8. `move-journal`: опции `--from`, `--to` (обязательны); окружение `migrateEnvSchema`; `moveJournal({url: DATABASE_MIGRATOR_URL, from, to}, logger)`; stdout — `{from, to, moved}`.
9. Перевод ошибок (функция `failureOf(error)`, порядок проверок важен — ошибки `pg` тоже обычные `Error`):
   1. `CommandError` — его `code`, `message`, `extra`;
   2. `isConnectionError(error)` (из `internal/pg-errors.js`, динамически) → `DATABASE_UNAVAILABLE` «БД недоступна»;
   3. ошибка проверки формата пакета — **только** `TypeError` (имя сервиса — `assertServiceName`, схема — `runMigrations`/`moveJournal`) и `KitUsageError` → `USAGE` с их текстом (тексты не содержат адресов). `KitUsageError` — внутренний класс в `src/database/migrations.ts` (`name = 'KitUsageError'`), его бросает проверка папки «нет журнала drizzle-kit в <folder>» (задача 7 — вместо `Error`); распознаётся по `name`, без импорта значения;
   4. иначе → `DB_COMMAND_FAILED` «команда db завершилась ошибкой» и `sqlState` — поле `code` ошибки `pg`, если это строка из 5 знаков; текст ошибки `pg` (может содержать имя роли и хост) **не выводится**.
   - stderr — JSON-строка `{level: 'error', …failure}` (как `openapi`), stdout — `{error: failure}`, код 1.
10. `src/cli/main.ts`: в `COMMANDS` — `db: async () => (await import('./commands/db.js')).dbCommand` (запись, без изменения разбора).

### Контракты
- Ключи окружения — только `prepareEnvSchema`/`migrateEnvSchema` и `LOG_LEVEL`, `REPLICA_ID` логгера.
- Пароли и адреса — ни в stdout, ни в stderr (проверка в тесте по подстроке).

### Ошибки и логи
- `info` — итог подкоманды (`prepareDatabase`/`runMigrations`/`moveJournal` логируют сами); `debug` `{command: 'db', sub}` в начале.
- Ошибки — `error`-строка JSON в stderr без значения окружения.
- GlitchTip CLI пакета не использует (CLI без `initSentry`; ошибки — код выхода и JSON).

### Тесты
Задача 11.

### Критерии приёмки
- `node dist/cli/main.js db prepare` без флага печатает `{"error":{"code":"USAGE",…}}` и выходит с 1.

### Проверка
- `make build`, затем вручную `node dist/cli/main.js db` → `USAGE`, код 1.

## Task 11: Тест AC-4.17

### Шаги
1. `test/integration/cli/ac-4-17-db-commands.spec.ts` (`Skill: nestjs-code test integration cli db-commands (CREATE)`), обработчик вызывается в процессе с `write` и `env` (без `vi.stubEnv` → проект `shared`); `process.stderr.write` — `vi.spyOn` с восстановлением; БД — своя на файл (`test/support/postgres.ts`), сервис `kitcli`. `describe('UC-12: CLI db')`:
   - `AC-4.17: db prepare --service kitcli — {database, roles, created} в stdout, код 0; повтор — created: []`;
   - `AC-4.17: db prepare без --service → {error: {code: 'USAGE'}}, код 1`;
   - `AC-4.17: db prepare --service Kit_1 → {error: {code: 'USAGE'}}, код 1, значение флага не в выводе`;
   - `AC-4.17: db prepare без DB_APP_PASSWORD → INVALID_ENVIRONMENT, keys содержит DB_APP_PASSWORD, значений нет`;
   - `AC-4.17: db prepare с недоступной БД (порт 1) → DATABASE_UNAVAILABLE, код 1; адрес, пароль и хост не в stdout и stderr`;
   - `AC-4.17: db migrate --folder <копия фикстуры> --schema kitcli на подготовленной БД — {schema: 'kitcli', applied > 0}; повтор — applied: 0`. Папка — копия `test/fixtures/database/migrations` во временный каталог, в SQL и `meta/*.json` строки `"kit_owner"`, `"kit_app"`, `"kit_directory"` заменены на `"kitcli_owner"`, `"kitcli_app"`, `"kitcli_directory"`, затем `"kit"` — на `"kitcli"` (копия включает `0003_idempotency_purge.sql` задачи 32 с `ALTER FUNCTION … OWNER TO "kit_directory"`; роли `kit_*` кластера этот файл не трогает); `DATABASE_MIGRATOR_URL` — роль `kitcli_owner` с паролем, который тест передал в `db prepare`;
   - `AC-4.17: db migrate без --schema → USAGE`; `--folder` без журнала → `USAGE` с путём папки;
   - `AC-4.17: db move-journal --from drizzle --to kitcli — {moved: 2}; повтор — moved: 0` — журнал источника создаётся под ролью `kitcli_owner` (`CREATE SCHEMA drizzle`, `CREATE TABLE drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)` и две строки с хешами, которых нет в `kitcli.__migrations`): владелец удаляет таблицу и схему без 42501;
   - `AC-4.17: неверный пароль владельца → DB_COMMAND_FAILED с sqlState 28P01, без текста ошибки pg`.
2. Временный каталог миграций удаляется в `afterAll`.

### Требования
AC-4.17, UC-12, §3.3 строка CLI (v1.14).

### Критерии приёмки
- Все случаи зелёные; ни одна строка вывода не содержит паролей и адреса (проверка `not.toContain` по паролю, хосту и порту).

### Проверка
- `make test-module M='cli'`.

## Риски
- Риск: роли кластерные — `kitcli_*` от этого файла остаются между прогонами. Mitigation: `afterAll` — `DROP OWNED BY` и `DROP ROLE` ролей `kitcli_*`, `DROP DATABASE … WITH (FORCE)`.

## Чек-лист фазы
- Задачи 10–11 выполнены; `make lint analyse test test-integration` зелёные.
