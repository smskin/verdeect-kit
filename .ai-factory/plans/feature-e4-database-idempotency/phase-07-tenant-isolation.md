# Фаза 7: `assertStrictTenantIsolation`

Plan: [index.md](index.md)
Tasks: 35-36
Depends on: Phase 4 (Tasks 13, 15, 16), Phase 6 (Tasks 26, 32)

## Цель

Помощник `/testing` для одного теста сервиса: каждая таблица с колонкой тенанта под строгой политикой и `FORCE`; под ролью приложения с пустым тенантом — 0 строк; знает `outbox` и политику идемпотентности; при таблице идемпотентности — функция `idempotency_purge` с `SECURITY DEFINER`, владельцем `<svc>_directory`, `search_path` и без `EXECUTE` у `PUBLIC` (§3.8 PRD v1.14, AC-4.8).

## Свидетельства из кода

| Путь | Символы | Зачем |
|---|---|---|
| `src/testing/tenant-isolation.ts` | `KitQueryable`, `assertAppRoleIsNotOwner` (задача 15) | файл продолжается |
| `src/database/tenant.ts`, `src/idempotency/table.ts` | выражения политик `tenantPolicy`, `createIdempotencyTable` | допустимые формы политик |
| O `test/integration/database/ac-10-2-rls.int-spec.ts`, `fr-21-roles.int-spec.ts` | `withRole` (BEGIN, `set_config`, ROLLBACK); проверки FORCE и функций `SECURITY DEFINER` | приёмы проверки |
| I `test/integration/database/rls.int-spec.ts` | «нет тенанта → все строки» | у I нестрогая модель — помощник должен её ловить |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/testing/tenant-isolation.ts` | modify | `assertStrictTenantIsolation`, `KitTenantIsolationOptions` |
| `src/testing/index.ts` | modify | экспорт |
| `test/integration/testing/ac-4-8-strict-isolation.spec.ts` | create | AC-4.8 |

## Task 35: `assertStrictTenantIsolation`

### Шаги
1. `src/testing/tenant-isolation.ts` (`Skill: nestjs-code generic src/testing/tenant-isolation.ts (MODIFY)`).
2. Опции `KitTenantIsolationOptions`: `schema: string`; `except?: readonly string[]` — имена таблиц, которые проверка пропускает целиком (TSDoc: «только таблицы, где колонка `tenant` не означает компанию; каждое исключение — с причиной в тесте сервиса»).
3. `assertStrictTenantIsolation(db: KitQueryable, options): Promise<void>` — `db` — соединение **роли приложения** (`kitDatabaseUrl`). Шаги (нарушения собираются, в конце — одна ошибка со списком):
   1. Таблицы с колонкой тенанта:
      ```sql
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant' AND NOT a.attisdropped
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') ORDER BY c.relname COLLATE "C";
      ```
      Нет ни одной такой таблицы и нет таблицы идемпотентности → нарушение «в схеме нет таблиц с колонкой tenant» (защита от ошибки в имени схемы).
   2. Для каждой (кроме `except`): `relrowsecurity` ложь → «<таблица>: RLS не включён»; `relforcerowsecurity` ложь → «<таблица>: нет FORCE ROW LEVEL SECURITY».
   3. Политики таблицы — `SELECT policyname, permissive, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2`. Нет ни одной → «нет политики». Каждая политика должна быть `PERMISSIVE`, `cmd = 'ALL'`, `qual` и `with_check` равны допустимой форме для таблицы после нормализации (удаление внешних скобок и пробелов, нижний регистр):
      - обычная таблица — форма `tenantPolicy`;
      - `idempotency_key` — форма `createIdempotencyTable`;
      - `outbox` — политика есть и FORCE включён; содержимое политики outbox проверяется в E5 (фабрика `createOutboxTable` появится там), шаг 4 к ней не применяется (исключение строгой модели — §2, ARCHITECTURE п. 5).
      Нормализованные строки обеих форм — константы файла; их значения взять из `pg_policies` БД фикстуры пакета (PostgreSQL 17 приводит выражения к виду вроде `(tenant = current_setting('app.tenant'::text, true))`) и записать дословно — тест задачи 36 падает, если форма не узнана. Иная политика → «<таблица>.<политика>: нестрогая политика».
   4. Под ролью приложения с пустым тенантом — 0 строк: в транзакции `BEGIN; SELECT set_config('app.tenant', '', true); SELECT count(*)::int FROM "<схема>"."<таблица>"; ROLLBACK` (каждая таблица кроме `outbox` и `except`); `count > 0` → «<таблица>: под ролью приложения с пустым тенантом видно N строк»; ошибка прав (`42501`) → «<таблица>: у роли приложения нет SELECT». Если в таблице нет строк, проверка всё равно проходит — README: тест сервиса вызывает помощник после вставки данных фабриками (как O `ac-10-2-rls`).
   5. Таблица `idempotency_key` есть в схеме → функция:
      ```sql
      SELECT p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.proname = 'idempotency_purge';
      ```
      Нет строки → «нет функции <схема>.idempotency_purge (idempotencyPurgeSql)»; `prosecdef` ложь → «… не SECURITY DEFINER»; владелец ≠ `<схема>_directory` → «… владелец <роль>, нужен <схема>_directory»; в `proconfig` нет элемента `search_path=…` → «… search_path не задан»; `public_execute` истина → «… EXECUTE у PUBLIC».
   6. Ошибка: `Error` «assertStrictTenantIsolation(<схема>): <нарушения через «; »»». Значений строк в тексте нет.
4. Транзакция шага 4 — на выделенном соединении, если `db` — пул (`connect` есть): взять клиента, `release` в `finally`; если `Client` — на нём.
5. `src/testing/index.ts`: `assertStrictTenantIsolation`, `export type KitTenantIsolationOptions`.

### Ошибки и логи
Только исключение; логов нет.

## Task 36: Тест AC-4.8

### Шаги
1. `test/integration/testing/ac-4-8-strict-isolation.spec.ts` (`Skill: nestjs-code test integration testing strict-isolation (CREATE)`), `describe('UC-1: строгий RLS')`. Каждый случай-нарушение — своя БД `createScratchDatabase()` (фикстура на нарушение), изменения — администратором, проверка — под ролью `kit_app`, `drop()` в `finally`:
   - `AC-4.8: note с tenantPolicy и FORCE — под kit_app с пустым тенантом 0 строк, с чужим — 0 строк` (строки `acme`/`globex` вставляет администратор);
   - `AC-4.8: фикстура пакета проходит assertStrictTenantIsolation (idempotency_key и функция — исключения строгой модели проходят)`;
   - `AC-4.8: таблица без политики → падает` (`CREATE TABLE kit.bare (tenant text not null)`, `ENABLE`+`FORCE` без политики);
   - `AC-4.8: без FORCE → падает` (`ALTER TABLE kit.note NO FORCE ROW LEVEL SECURITY`);
   - `AC-4.8: нестрогая политика (IS NULL OR …) → падает` (`DROP POLICY` + `CREATE POLICY … USING (nullif(current_setting('app.tenant', true), '') IS NULL OR tenant = current_setting('app.tenant', true))`);
   - `AC-4.8: под пустым тенантом видны строки (политика USING (true)) → падает` — форма политики и счёт строк оба дают нарушение;
   - `AC-4.8: таблица outbox с политикой и FORCE проходит (исключение строгой модели)`;
   - `AC-4.8: функции idempotency_purge нет → падает с idempotencyPurgeSql в тексте`;
   - `AC-4.8: функция без SECURITY DEFINER (ALTER FUNCTION … SECURITY INVOKER) → падает`;
   - `AC-4.8: владелец не kit_directory (ALTER FUNCTION … OWNER TO kit_owner) → падает`;
   - `AC-4.8: у PUBLIC есть EXECUTE (GRANT EXECUTE … TO PUBLIC) → падает`;
   - `AC-4.8: search_path сброшен (ALTER FUNCTION … RESET search_path) → падает`;
   - `AC-4.8: except пропускает таблицу`.

### Требования
AC-4.8 (v1.14), §3.8 строка `assertStrictTenantIsolation`.

### Проверка
- `make test-module M='testing'`.

## Риски
- Риск: нормализованная форма `qual` зависит от версии PostgreSQL. Mitigation: образ закреплён `TEST_IMAGES` (мажорная смена — мажор пакета, G14); при смене формы падает тест фикстуры пакета.

## Чек-лист фазы
- Задачи 35–36 выполнены; `make lint analyse test test-integration` зелёные.
