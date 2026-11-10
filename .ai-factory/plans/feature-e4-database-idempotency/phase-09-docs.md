# Фаза 9: README, CHANGELOG, docs

Plan: [index.md](index.md)
Tasks: 39
Depends on: Phases 1–8 (Tasks 1–38)

## Цель

AC-9.3 и правило «Library Package Scope» (7): изменение публичной поверхности E4 (подпути `/database`, `/idempotency`, помощники `/testing`, CLI `db`, метрики очистки, ключи `provide`) — README, CHANGELOG `[Unreleased]`, `docs/testing.md`. Версия не меняется (G14: выпуск `1.0.0-rc.1` после E8).

## Свидетельства из кода

| Путь | Разделы | Зачем |
|---|---|---|
| `README.md` | «Подпути», «Конфигурация окружения», «HTTP», «Тесты сервиса» (стр. 260–309, «После E1 `startTestStack` не готовит БД…»), «Развёртывание» (формула `2 × DB_POOL_MAX × реплики` уже есть), «Реестр префиксов id» (стр. 323), «API» | дополнение |
| `CHANGELOG.md` | `[Unreleased]` → `### Added`, `### Changed` | записи E4 |
| `docs/testing.md` | «Проекты интеграционного конфига» | новые файлы `isolated` |
| `test/package/ac-9-3-docs.spec.ts` | проверки README/CHANGELOG | должны пройти; при проверке перечня подпутей — дополнить |

## Task 39: Документация E4

### Шаги
(`Skill: none — документация (Markdown)`; тест — `nestjs-code test unit package docs (MODIFY)` при правке `ac-9-3-docs.spec.ts`)
1. `README.md`:
   - «Подпути» — строки `/database` (E4, требует `pg`), `/idempotency` (E4, требует `pg`);
   - новый раздел «База данных»: `KitDatabaseModule.forRoot({schema})` (пулы, `DRIZZLE`, `DRIZZLE_READ`, пробы `database`/`database-read`, закрытие — шаг 4), `DbContext`, `Db.transaction/read/readGlobal/afterCommit/setLocal` (один `set_config`; `read` без тенанта — `TenantRequiredError`; `afterCommit` — только для того, что можно потерять), строгий RLS (`tenantColumn`, `tenantPolicy`, SQL-миграция `FORCE ROW LEVEL SECURITY` и `GRANT … TO <svc>_app` — пример из фикстуры), `prepareDatabase` и роли, `runMigrations` (журнал `<svc>.__migrations`), `deleteInBatches` (форма `sql` — строка с колонкой `deleted`; строки компаний — только функцией `SECURITY DEFINER`), `runExclusive` (держит соединение — `DB_POOL_MAX ≥ 2`), `occurredAtColumn`/`ifNewer`, `newId`/`ulid`, `isUniqueViolation`/`isConnectionError`/`isPoolTimeout`; метрика `verdeect_db_pool_wait_timeouts_total{pool}` — пишет `Db`, фильтр `/http` отвечает 503 (срок собственного пула сервиса — без метрики);
   - новый раздел «Идемпотентность»: таблица `createIdempotencyTable`, миграция с `idempotencyPurgeSql` — пример `test/consumer/minimal/drizzle/0001_force_grants_purge.sql`; нет функции — отказ запуска; `@Idempotent({required, tenantFromBody})` **только с `VerdeectAuthGuard`** (без принципала — 500); область ключа (user/agent — компания и `sub`, service — `client_id` и поле тела); ответы 400/409/422, `Idempotent-Replayed`, `Location`; очистка раз в час и при старте, одна реплика; метрики `verdeect_cleanup_runs_total{table,result}`, `verdeect_cleanup_deleted_total{table}`;
   - «CLI»: `db prepare --service <svc>` (`DATABASE_ADMIN_URL`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`), `db migrate --folder --schema` и `db move-journal --from drizzle --to <svc>` (`DATABASE_MIGRATOR_URL`); вывод и коды ошибок `USAGE`, `INVALID_ENVIRONMENT`, `DATABASE_UNAVAILABLE`, `DB_COMMAND_FAILED`;
   - «Тесты сервиса»: заменить фразу «После E1 … не готовит БД» — `startTestStack({postgres, migrations})` готовит БД (`prepareDatabase`, миграции, шаблон); таблица ключей `inject` — `kitDatabaseUrl`, `kitDatabaseOwnerUrl`, `kitDatabaseAdminUrl`, `kitDatabaseService`, `kitDatabaseTemplate`; `createScratchDatabase`, `workerScope().tenant` (слаг компании воркера, `tenantId` — фабрика сервиса), `countQueries`, `assertStrictTenantIsolation` (после вставки данных фабриками), `assertAppRoleIsNotOwner`;
   - «Развёртывание»: порядок `db prepare --service` → `db migrate` при каждом выкате; переход сервиса — `db move-journal`; строка формулы `2 × DB_POOL_MAX × реплики` уже есть — не меняется (её ищет AC-9.3);
   - «Реестр префиксов id»: строки не добавляются (реестр — префиксы сервисов; `cmp` потребителя — пример теста); перед таблицей — фраза «id создаёт `newId(prefix)` из `/database`».
   - «API» — подразделы `@verdeect/kit/database`, `@verdeect/kit/idempotency`; `@verdeect/kit/testing` — новые экспорты.
2. `CHANGELOG.md` `[Unreleased]`: первая строка — «… `/database`, `/idempotency` и CLI `db` (этап E4, PRD v1.14)»; `### Added` — по строке на каждый экспорт `/database`, `/idempotency`, новые экспорты `/testing`, CLI `db`, метрики `verdeect_cleanup_*`, ключи `inject`; `### Changed` — `startTestStack` готовит БД при `postgres: true` (опция `migrations`); фильтр `/http` больше не считает срок пула (`pool: 'unknown'` удалён, метрику пишет `Db` с меткой `main`/`read`).
3. `docs/testing.md` «Проекты интеграционного конфига»: два файла `isolated` E4 с причинами (задача 34); фикстура `test/fixtures/database` и `pnpm db:fixtures`.
4. `test/package/ac-9-3-docs.spec.ts` (MODIFY): в `ENTRY_POINTS` (стр. 10–15) добавить `src/database/index.ts` и `src/idempotency/index.ts` — проверки «API каждого выпущенного подпути» и «каждый экспорт в CHANGELOG» охватят новые экспорты; формула `2 × DB_POOL_MAX × реплики` и реестр префиксов (`PREFIXES`) уже проверяются, не меняются.

### Критерии приёмки
- `make test` (AC-9.3) и `make pack-check` зелёные; каждый новый экспорт есть в README и CHANGELOG.

### Проверка
- `make lint test`.

## Чек-лист фазы
- Задача 39 выполнена.
