<!-- aif:plan-mode:ultra -->
# Ultra-план реализации: E4 База данных и идемпотентность (`@verdeect/kit/database`, `@verdeect/kit/idempotency`)

Mode: ultra
Branch: feature/e4-database-idempotency
Created: 2026-11-10

## Original Request
Реализуй этап roadmap «E4 База данных и идемпотентность» по пакету требований requirements/0000-kit/ (ревизия r8, PRD v1.13).

Скоуп этапа: AC-4.1–AC-4.18; сквозной AC-9.5 для очистки идемпотентности; prd.md §3.3 целиком (KitDatabaseModule, DbContext, Db.transaction/read/readGlobal/afterCommit/setLocal, tenantColumn и tenantPolicy строгой модели, prepareDatabase с ролями _owner/_app/_directory, runMigrations с журналом в схеме сервиса, CLI db prepare/migrate/move-journal, newId и ulid, реэкспорт распознавания ошибок, deleteInBatches, runExclusive, occurredAtColumn и ifNewer, метрика пула), §3.3а целиком (createIdempotencyTable, KitIdempotencyModule, @Idempotent с tenantFromBody, интерсептор и очистка через runExclusive), §6 (фабрика таблицы идемпотентности; [ASSUMPTION] колонок — по таблицам O, колонка вне O — только с требованием); §3.8 — строки и поля с этапом E4 (startTestStack — prepareDatabase и migrations, createScratchDatabase, countQueries, assertStrictTenantIsolation, assertAppRoleIsNotOwner, workerScope.tenant — формат по 01 §5.2, уточни у меня, если неоднозначно); подпути ./database и ./idempotency в exports и в проверках AC-1.1, AC-1.2 (без pg — ошибка импорта); проект-потребитель (AC-9.1) — таблица компании под строгим RLS и assertStrictTenantIsolation; README (формула 2 × DB_POOL_MAX × реплики, реестр префиксов id) и CHANGELOG [Unreleased]. Перенос кода — по requirements/0000-kit/files/inventory.md: эталон O (db, drizzle.provider, database.module, pool-options, migrator, prepare-database, ids, batches, http/idempotency), pg-errors — I; тесты эквивалентности — из таблицы §2 (O ac-10-2-rls, db, fr-21-roles, ac-10-8-migrate, connection-lost, http/shared/idempotency, ac-2-2-idempotency, idempotency-cleanup.int; I rls, read-pool, after-commit, migrations). Репозитории сервисов — только чтение. Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION; код сервиса, расходящийся с prd.md, не переносится как есть (P0: только строгий RLS, без режима «пустой тенант видит всё», кроме outbox). Решения E3, которые касаются E4: модули kit закрываются хуками Nest — пулы БД в onApplicationShutdown (шаг 4), очистка идемпотентности — в beforeApplicationShutdown (шаг 3), отдельных участников KitLifecycle не регистрируют (README «Жизненный цикл», ARCHITECTURE.md); Db помечает ошибку срока пула именем пула (main/read), фильтр /http перестаёт писать pool: 'unknown' в verdeect_db_pool_wait_timeouts_total (AC-4.5); isPoolTimeout/isConnectionError/isUniqueViolation уже есть во внутреннем модуле из E3 — /database их реэкспортирует, не дублирует; коды IDEMPOTENCY_* уже в kitErrors, интерсептор бросает DomainError; заголовки идемпотентности в OpenAPI — по метаданным @Idempotent (§3.5), снимок потребителя обновляется; модуль приложения импортирует KitConfigModule.forRoot, тесты с другими опциями логгера — отдельным файлом (nestjs-pino 5.3). Уже реализованные этапы E1–E3 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня. Фазы должны оставлять проект в рабочем состоянии: тесты зелёные после каждой фазы.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5): U — `test/unit/{internal,database,idempotency,http,testing,observability,package}`; I — `test/integration/{database,idempotency,testing,cli}`; C — `test/consumer/minimal`, `test/consumer/no-testcontainers`; R — `test/package`. Уровня T в E4 нет (AC-4.18 «< 1 с» — уровень I по PRD).
- Logging: verbose — `debug` на создании пулов, откате транзакции, пачках, шагах `begin`/`complete` идемпотентности, `runExclusive` «занято»; `info` — итоги `prepareDatabase`, `runMigrations`, `moveJournal`, прохода очистки, закрытия пулов; `warn` — срок пула, ошибки простаивающих клиентов, `IDEMPOTENCY_*`, брошенная `in_progress`; `error` — упавшие задачи `afterCommit`, сбой `complete`/`release`, сбой очистки. Только `pino`/`nestjs-pino` (логгер Nest), без `console.*` (NFR-8, AC-9.4). Не логируются: адреса БД, пароли, параметры SQL, ключ `Idempotency-Key` целиком (только 8 знаков), тела ответов.
- Docs: no — `WARN [docs]` без обязательного чекпоинта `/aif-docs`. README, CHANGELOG и `docs/testing.md` всё равно обновляются задачей 39 (AC-9.3, «Library Package Scope» (7)).

## Roadmap Linkage
Milestone: "E4 База данных и идемпотентность"
Rationale: план реализует ровно скоуп вехи E4 из `.ai-factory/ROADMAP.md` (`/database` §3.3, `/idempotency` §3.3а, помощники `/testing` этапа E4, CLI `db`, AC-4.1–AC-4.18, AC-9.5 — очистка идемпотентности).

## Requirements Reconciliation

Authority (запрос пользователя, skill-context «Requirements Package Authority»): `requirements/0000-kit/prd.md` **v1.14 (ревизия r9, коммит `7d5e28a` — первый в ветке; решения вопросов планирования E4, KT-18)** > `requirements/0000-kit/files/inventory.md` > `.ai-factory/ROADMAP.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`, `rules/base.md`. Запрос ссылался на r8/v1.13; во время планирования чат kit выдал r9 (PRD v1.14): сверка `git diff` — отличия только в шапке, §3.3 (CLI), §3.3а (три строки), §3.8 (две строки), AC-4.8, AC-4.14, AC-4.17; md5 `763d4929b4c602cb2b632838f45ad6a3`, 557 строк. Код сервиса, расходящийся с PRD, не переносится как есть (P0).

**Milestone scope:** AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5, AC-4.6, AC-4.7, AC-4.8, AC-4.9, AC-4.10, AC-4.11, AC-4.12, AC-4.13, AC-4.14, AC-4.15, AC-4.16, AC-4.17, AC-4.18; AC-9.5 (очистка идемпотентности); §3.3 и §3.3а целиком; §6 (строка `createIdempotencyTable`, `__migrations`); строки и поля §3.8 с этапом E4 (`startTestStack` — подготовка и `migrations`, `workerScope().tenant`, `createScratchDatabase`, `countQueries`, `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner`); части UC-5, UC-7, UC-9, UC-12, UC-14 (и UC-4, UC-6, UC-8 в объёме AC-4.x); растущие AC-1.1, AC-1.2 (подпути `./database`, `./idempotency`), AC-1.13 (подготовка БД с E4), AC-3.7/AC-3.8 (заголовки идемпотентности в OpenAPI, снимок потребителя); сквозные AC-9.1 (потребитель с БД), AC-9.3 (README, CHANGELOG), AC-9.4 (lint на новый код — без изменения правила).

Вне скоупа: `/messaging` (E5: outbox, inbox, relay, `createOutboxTable`; `assertStrictTenantIsolation` знает имя `outbox`, политику outbox проверит E5), `rabbitmq`/`redisPrefix` в `workerScope` (E5, E8), `/crypto` (E7), `/redis` (E8); AC-5.x–AC-8.x; AC-9.5 для relay, подписчика, лимитера.

`[OPEN]` §11: п. 3 (`BEGIN` + `set_config` одной посылкой) — не реализуется до замера, два запроса как O (задача 17); п. 1, 2 к E4 не относятся. Блокирующих вопросов нет.

`[ASSUMPTION]` §6 «колонки — по O, колонка вне O — только с требованием»: колонки идемпотентности — O + `tenant` nullable (§6) + `response_location` (§6 «ответ (статус, тело, `Location`)», §3.3а «сохранённый ответ (статус, тело, `Location`)»); `actor` O → `subject` (§6 «область (`tenant?`, `subject`)»); `request_hash` → `fingerprint`, `status` → `state`, `response` → `response_body` (§6).

Решения (источник → задачи):

| Решение | Источник | Задачи |
|---|---|---|
| `workerScope().tenant` — случайный слаг `w<VITEST_POOL_ID>-<8 hex>` формата claim `tenant`, один на воркер; `tenantId` — фабрика сервиса; полей E5/E8 в типе нет | PRD v1.14 §3.8 (KT-18 п. 1) | 14, 16 |
| Очистка: функция `<svc>.idempotency_purge(batch int) returns int` `SECURITY DEFINER`, владелец `<svc>_directory`, `search_path`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO <svc>_app`; текст — `idempotencyPurgeSql(pgSchema)`, имена только идентификаторами после проверки `^[a-z][a-z0-9_]{1,31}$`; нет функции — отказ запуска с текстом про `idempotencyPurgeSql`; `assertStrictTenantIsolation` проверяет функцию | PRD v1.14 §3.3а, §3.8, AC-4.8, AC-4.14 (KT-18 п. 2–3) | 26, 29, 32, 33, 34, 35, 36, 37 |
| CLI `db prepare --service <svc>`; без флага или неверный формат — `{error: {code: 'USAGE'}}`, выход 1; `prepareEnvSchema` не меняется | PRD v1.14 §3.3, AC-4.17 | 10, 11 |
| `@Idempotent` без проверенного принципала — 500 `INTERNAL_ERROR`, `error`-лог, одно событие GlitchTip, обработчик не вызывается; README: только с `VerdeectAuthGuard` | PRD v1.14 §3.3а, AC-4.14 | 28, 34, 39 |
| Решение E3: модули kit закрываются хуками Nest — пулы в `onApplicationShutdown` (шаг 4), очистка идемпотентности и пачки `Db` — в `beforeApplicationShutdown` (шаг 3); участников `KitLifecycle` не регистрируют | E3, README «Жизненный цикл», ARCHITECTURE | 17, 18, 29 |
| Решение E3 + KT-19 п. 3: срок пула учитывается **на уровне пула** — при ошибке получения соединения (обёртка `connect` экземпляров основного пула и пула чтения): `verdeect_db_pool_wait_timeouts_total{pool: main\|read}` и `captureThrottled`, ошибка помечается учтённой (`tagPoolTimeout`); учитываются и `Db`, и прямые запросы `DRIZZLE`/`DRIZZLE_READ`; фильтр `/http` отвечает 503 + `Retry-After: 1` без метрики и GlitchTip — событие одно; `pool: 'unknown'` не остаётся нигде | E3; AC-4.5; KT-19 п. 3 | 3, 17, 18, 22, 24 |
| `/database` реэкспортирует `isUniqueViolation`/`isConnectionError`/`isPoolTimeout` из `internal/pg-errors.ts` (E3), не дублирует | §3.3; E3 | 22 |
| `/idempotency` бросает `DomainError` с кодами `IDEMPOTENCY_*` словаря `kitErrors` (E3) | §3.3а; E3 | 28 |
| `drizzle-orm/node-postgres` импортирует `pg` статически → грузится ленивым `import()` (`loadDrizzle`) в асинхронных функциях; статический импорт значения запрещён lint; `index.ts` подпутей первым импортирует модуль с синхронной проверкой `requirePeer` (`./pg.js`, `./peer.js`) — текст AC-1.2 называет свой подпуть; **top-level await в статическом графе `/database` и `/idempotency` нет** (П15) | AC-1.2; ARCHITECTURE «Правила зависимостей»; разведка `drizzle-orm/node-postgres/driver.js` | 1, 4, 22, 30, 38 |
| `/testing` без `pg` импортируется (BFF): код БД в `startTestStack`, `createScratchDatabase` грузится динамически при вызове | NFR-3; AC-1.2 (`/testing` — только `testcontainers`) | 12, 13, 38 |
| P0: только строгий RLS; I-режим «пустой тенант видит всё» не переносится; `Db.read` без тенанта — `TenantRequiredError` (у O/I — тихое чтение без тенанта) | P0; §3.3 | 5, 17 |
| `runExclusive` — `pg_try_advisory_lock(hashtextextended(key, 0))` на выделенном соединении; O `job-lock` (Redis) не переносится | §3.3 | 20 |
| `newId`/`ulid` — эталон O (`internal/ids.ts`), проверка префикса `^[a-z]{2,5}$` | §3.3, AC-4.9; ARCHITECTURE `internal/ids.ts` | 2 |

**Решения плана вне формулировок PRD** — рассмотрены чатом kit в KT-19 (10.11.2026): приняты как есть, П2 и П8 — с условиями (внесены ниже); `requirements/0000-kit/README.md` — «PRD v1.14» (коммит `1e4bb0e`):

| # | Решение | Обоснование | Задачи |
|---|---|---|---|
| П1 | Ключи `provide` `startTestStack`: `kitDatabaseUrl` (роль `<svc>_app`), `kitDatabaseOwnerUrl`, `kitDatabaseAdminUrl`, `kitDatabaseService`, `kitDatabaseTemplate`; БД `<svc>` — копия шаблона `<svc>_template`; при `postgres: true` подготовка всегда, миграции — при `migrations` (путь от `cwd`); `migrations` без `postgres` — `TypeError` | §3.8 «адреса — `provide`», AC-4.18 | 12 |
| П2 | `prepareDatabase` дополнительно: `GRANT CONNECT, CREATE ON DATABASE` владельцу, `CONNECT` приложению, `GRANT USAGE ON SCHEMA` приложению и directory; схема `drizzle` не создаётся; права на таблицы — SQL-миграцией сервиса (как O). **KT-19 п. 1:** `<svc>_app` не получает `CREATE` ни на БД, ни на схему; проверяет `assertAppRoleIsNotOwner`, тест AC-4.6 | эталон O; AC-4.7; KT-19 п. 1 (принято с условием) | 6, 15, 16 |
| П3 | Результаты CLI: `prepare` → `{database, roles, created}`, `migrate` → `{schema, applied}`, `move-journal` → `{from, to, moved}`; коды ошибок `USAGE`, `INVALID_ENVIRONMENT` (`keys`), `DATABASE_UNAVAILABLE`, `DB_COMMAND_FAILED` (`sqlState`); текст ошибки `pg` не выводится | AC-4.17 «без адресов и паролей» | 10 |
| П4 | `move-journal`: перенос строк по `hash` в `<to>.__migrations`, удаление `<from>.__drizzle_migrations` и пустой схемы `<from>` в одной транзакции; повтор — `moved: 0` | §3.3 | 7 |
| П5 | `deleteInBatches({db, sql, …})`: `sql` — функция размера пачки → SQL с одной строкой и целой колонкой `deleted`; пачка — `Db.transaction` с системным контекстом (`tenant: null`, `channel: 'system'`); `Db` отслеживает проходы и прекращает новые пачки на шаге 3 | §3.3 «`Db` отслеживает идущие пачки»; эталоны O/I | 17, 19 |
| П6 | Уникальность области — `UNIQUE NULLS NOT DISTINCT (tenant, subject, key)` вместо PK (PK по nullable-колонке невозможен); `subject` — `user:<sub>`, `agent:<sub>`, `service:<client_id>` (виды субъектов не пересекаются) | §6 «PK по области и ключу» + `tenant?` | 26, 28 |
| П7 | `Idempotency-Key` — формат O `^[\x21-\x7E]{1,200}$`, иначе 422 `VALIDATION_FAILED` `path: Idempotency-Key`; сохраняются только успешные ответы (ошибка обработчика — строка удаляется, повтор выполняется заново); статус — `@HttpCode` или POST 201; `complete` — один повтор (O) | эталон O | 28 |
| П8 | Метрика очистки AC-9.5 (KT-19 п. 2 и ответ на вопрос AC-2.11): одна общая метрика пакета `verdeect_cleanup_runs_total{table, result}` в `kitMetrics`, `result`: `ok` / `partial` (упёрся в `maxBatches`, записи старше срока остались) / `error`; `table` — имя таблицы без схемы, только таблицы пакета (`idempotency_key`; E5 — `outbox`, `inbox`); проход без блокировки метрику не меняет; `verdeect_cleanup_deleted_total` **нет** — число удалённых строк в `info`-логе прохода (`service`, `replica`, `table`, `deleted`); правило `VerdeectCleanupFailing`: `increase(verdeect_cleanup_runs_total{result=~"error\|partial"}[2h]) > 0` с порогом `verdeect_kit_threshold:cleanup_runs` по `service`, аннотация различает `error` и `partial`; тест AC-2.11 (vmalert) проходит | AC-9.5, NFR-8, AC-2.11; KT-19 п. 2 | 25, 29, 34, 37 |
| П9 | Расписание очистки — первый проход сразу после старта (`onApplicationBootstrap`), затем раз в час (`setInterval`, `unref`); ключ `runExclusive` — `verdeect-kit:idempotency-cleanup:<схема>`; пачка 1000, не больше 100 пачек за проход (O) | эталон O `@Cron` раз в час; `@nestjs/schedule` не peer kit; AC-9.5 в потребителе | 29 |
| П10 | OpenAPI: `Idempotency-Key` — параметр заголовка (`required` по опции, `pattern` O), `Idempotent-Replayed` — заголовок успешного ответа, ошибки 409/422 и 400 (при `required`) | §3.5 «заголовки идемпотентности — `@Idempotent`» | 31, 37 |
| П11 | `KitDatabaseModule` внедряет `HealthRegistry` и `KIT_METRICS` необязательно: без `createHttpApp` (контекст CLI сервиса) — без проб и метрики; пробы `database` и `database-read` — критичные, `select 1` на своём пуле | §3.3 «пробы обоих пулов (критичные)» | 18 |
| П12 | `assertStrictTenantIsolation(db, …)`, `assertAppRoleIsNotOwner(db)` — `db` — соединение роли приложения (объект с `query`: `pg.Pool`/`Client`); колонка тенанта — `tenant`; `outbox` — исключение по имени (политика и FORCE обязательны, счёт строк не проверяется до E5) | §3.8 | 15, 35 |
| П13 | `countQueries(pool, fn)` → `{result, count, queries}`; считает все запросы пула за время `fn` (обёртка `query` выданных клиентов) | §3.8 | 23 |
| П15 | Отступление от ARCHITECTURE «`await loadPeer` на верхнем уровне» для `/database` и `/idempotency`: синхронный `requirePeer` (новая внутренняя функция `src/internal/peer.ts`) + ленивый `import()` `pg` и драйвера. Причина: `drizzle-kit` 0.31.11 грузит схему сервиса через `require` (tsx), а ESM с top-level await даёт `ERR_REQUIRE_ASYNC_MODULE`; текст и момент ошибки AC-1.2 не меняются; проверка — `drizzle-kit generate` в потребителе (задача 38). Сообщается чату kit (итерация 3 `/aif-improve`) | §3.3 «SQL генерирует `drizzle-kit`»; AC-1.2 | 4, 22, 30, 38 |
| П14 | `Db`, `DbTx`, `DbReader`, `TenantRequiredError`, `AfterCommitInReadOnlyError`, `AfterCommitTask`, `KitPrepareDatabaseOptions/Result`, `KitDeleteInBatchesOptions`, `KitIdempotencyTable`, `KitIdempotentOptions`, `KitScratchDatabase`, `KitWorkerScope`, `KitQueryable`, `KitTenantIsolationOptions`, `KitCountablePool` — имена типов и ошибок пакета (§3 «точные типы уточняет реализация») | §3; rules/base.md «Именование» | 5–36 |

Сочетания поведения `@Idempotent` (§3.3а; каждое — тест задачи 33 или 34):

| Принципал | `tenantFromBody` | Поле в теле | Область (`tenant`, `subject`) | Проверка |
|---|---|---|---|---|
| нет (нет guard'а) | любое | любое | — → 500, обработчик не вызван, GlitchTip 1 | AC-4.14 «без guard'а» |
| user | нет / есть | любое | (`principal.tenant`, `user:<sub>`); поле тела игнорируется | AC-4.14 «подложный tenant» |
| agent | нет / есть | любое | (`principal.tenant`, `agent:<sub>`) | U `scopeOf` |
| service | нет | — | (`null`, `service:<client_id>`) | AC-4.14 «без поля tenant» |
| service | `'tenant'` | непустая строка | (значение, `service:<client_id>`) | AC-4.14 «две компании» |
| service | `'tenant'` | нет / пусто / не строка | (`null`, `service:<client_id>`), без ошибки | U `scopeOf` |

| Ключ | Состояние строки | Тело | Результат |
|---|---|---|---|
| нет, `required: false` | — | — | обработчик без идемпотентности |
| нет, `required: true` | — | — | 400 `IDEMPOTENCY_KEY_REQUIRED` |
| не по формату | — | — | 422 `VALIDATION_FAILED` (`Idempotency-Key`) |
| есть | нет / старше 24 ч / `in_progress` старше 5 мин | — | выполнение, ответ сохраняется (2xx) |
| есть | `in_progress` моложе 5 мин | то же | 409 `IDEMPOTENCY_IN_PROGRESS` |
| есть | любая не просроченная | другое | 422 `IDEMPOTENCY_KEY_REUSED` |
| есть | `done` | то же | сохранённые статус, тело, `Location` + `Idempotent-Replayed: true` |
| есть | новая, обработчик бросил | — | ошибка дальше, строка удалена, повтор выполняется заново |

Проверка на реальных артефактах: проект-потребитель (задача 37) генерирует миграции настоящим `drizzle-kit` по `tenantPolicy` и `createIdempotencyTable`, кладёт `idempotencyPurgeSql` в SQL-миграцию, мигрирует через `startTestStack`, проходит `assertStrictTenantIsolation` и показывает метрику и лог очистки из процесса `bootstrapService`.

## Architecture and Decisions
- Слои (ARCHITECTURE «Правила зависимостей»): `database` → `observability`, `config`, `internal`; `idempotency` → `database`, `http`, `observability`, `config`, `internal`; `http` читает метаданные `@Idempotent` из `internal/metadata.ts`, не импортируя `idempotency`; `testing` импортирует `database` только динамически.
- Файлы подпути `database`: `pg.ts`, `tenant.ts`, `prepare-database.ts`, `migrations.ts`, `db.ts`, `kit-database.module.ts`, `batches.ts`, `run-exclusive.ts`, `if-newer.ts`, `index.ts`; `idempotency`: `table.ts`, `idempotent.decorator.ts`, `idempotency.interceptor.ts`, `kit-idempotency.module.ts`, `peer.ts`, `index.ts`; `internal`: `ids.ts`, `metadata.ts`; `testing`: `scratch-database.ts`, `worker-scope.ts`, `tenant-isolation.ts`, `count-queries.ts`; `cli/commands/db.ts`.
- `Db` — класс без декораторов Nest, собирается фабрикой модуля: тесты I строят его на пулах напрямую (`test/support/database.ts`), HTTP-тесты передают окружение внутренним `setPreparsedEnv(schema, parseEnv(schema, env))` перед `createTestApp` (механизм `bootstrapService`) — без `vi.stubEnv`, проект `shared`. В `isolated` — только два файла с процесс-глобальным состоянием (Sentry, `process.exit`).
- Фикстура БД пакета `test/fixtures/database` (схема `kit`, сгенерирована `drizzle-kit` 0.31.11 из `devDependencies`) — миграции `globalSetup` уровня I.

## Phase Index
1. [Фаза 1: Основа — манифест, lint, internal](phase-01-foundation.md) — Tasks 1-3
2. [Фаза 2: Схема, подготовка БД и миграции](phase-02-schema-migrations.md) — Tasks 4-9
3. [Фаза 3: CLI verdeect-kit db](phase-03-cli-db.md) — Tasks 10-11
4. [Фаза 4: Тестовый контур БД](phase-04-test-stack.md) — Tasks 12-16
5. [Фаза 5: Db, KitDatabaseModule и подпуть /database](phase-05-db-module.md) — Tasks 17-24
6. [Фаза 6: Подпуть /idempotency](phase-06-idempotency.md) — Tasks 25-34
7. [Фаза 7: assertStrictTenantIsolation](phase-07-tenant-isolation.md) — Tasks 35-36
8. [Фаза 8: Проект-потребитель и проверки архива](phase-08-consumer-package.md) — Tasks 37-38
9. [Фаза 9: README, CHANGELOG, docs](phase-09-docs.md) — Task 39

## Cross-Phase Dependencies
- Фаза 2 зависит от задач 1 (`drizzle-kit`, lint) и 2 (`ids` нужен позже, но ветка lint — сразу).
- Фаза 3 (CLI) — от задач 6, 7: команды вызывают `prepareDatabase`, `runMigrations`, `moveJournal`.
- Фаза 4 — от задач 4, 6, 7, 8: `startTestStack` готовит БД теми же функциями и мигрирует фикстуру; задача 16 переводит тест AC-4.7 (задача 9) на `createScratchDatabase`.
- Фаза 5 — от задач 3 (метка пула), 5 (`DbContext`), 4 (`pg.ts`) и фазы 4 (`kitDatabaseUrl`, фикстура мигрирована в `globalSetup`).
- Фаза 6 — от задач 3 (`metadata.ts`), 17–22 (`Db`, `deleteInBatches`, `runExclusive`, `/database`), 13 (`createScratchDatabase` в тесте без функции), 24 (`createDbApp`).
- Фаза 7 — от задач 15 (файл, `KitQueryable`), 13, 26, 32 (таблица и функция в фикстуре).
- Фаза 8 — от задач 22, 23, 29–31, 35 (всё публичное E4 в архиве).
- Фаза 9 — от всех: имена экспортов сверяются с итоговыми `index.ts`.

## Tasks

### Фаза 1: Основа — манифест, lint, `internal`
- [ ] Task 1: `drizzle-kit` в devDependencies, `db:fixtures`, lint границ `database`/`idempotency` и запрет `drizzle-orm/node-postgres` ([details](phase-01-foundation.md#task-1-манифест-и-lint-новых-подпутей))
- [ ] Task 2: `newId`, `ulid` в `src/internal/ids.ts` + U AC-4.9 ([details](phase-01-foundation.md#task-2-newid-и-ulid-в-internal)) (depends on 1)
- [ ] Task 3: `internal/metadata.ts` и метка пула `tagPoolTimeout`/`poolTimeoutOf` ([details](phase-01-foundation.md#task-3-ключ-метаданных-idempotent-и-пометка-пула-в-ошибке)) (depends on 1)

### Фаза 2: Схема, подготовка БД и миграции
- [ ] Task 4: `requirePeer` и `src/database/pg.ts` — синхронная проверка `pg`, ленивый драйвер Drizzle ([details](phase-02-schema-migrations.md#task-4-загрузчик-pg-и-драйвера-drizzle)) (depends on 1)
- [ ] Task 5: `DbContext`, `tenantColumn`, `tenantPolicy` ([details](phase-02-schema-migrations.md#task-5-dbcontext-tenantcolumn-tenantpolicy)) (depends on 1)
- [ ] Task 6: `prepareDatabase` и `grantDatabaseAccess` ([details](phase-02-schema-migrations.md#task-6-preparedatabase)) (depends on 4)
- [ ] Task 7: `runMigrations` и `moveJournal` ([details](phase-02-schema-migrations.md#task-7-runmigrations-и-movejournal)) (depends on 4)
- [ ] Task 8: Фикстура схемы и миграций `test/fixtures/database` ([details](phase-02-schema-migrations.md#task-8-фикстура-схемы-и-миграций-пакета)) (depends on 1, 5)
- [ ] Task 9: I AC-4.6 (роли, повтор) и AC-4.7 (журнал, дамп, перенос) ([details](phase-02-schema-migrations.md#task-9-тесты-ac-46-роли-и-ac-47-журнал)) (depends on 6, 7, 8)

### Фаза 3: CLI `verdeect-kit db`
- [ ] Task 10: `src/cli/commands/db.ts` — `prepare --service`, `migrate`, `move-journal` ([details](phase-03-cli-db.md#task-10-команда-db)) (depends on 6, 7)
- [ ] Task 11: I AC-4.17 ([details](phase-03-cli-db.md#task-11-тест-ac-417)) (depends on 8, 9, 10)

### Фаза 4: Тестовый контур БД
- [ ] Task 12: `startTestStack` — подготовка, `migrations`, шаблон, ключи `provide` ([details](phase-04-test-stack.md#task-12-подготовка-бд-в-startteststack)) (depends on 4, 6, 7)
- [ ] Task 13: `createScratchDatabase` ([details](phase-04-test-stack.md#task-13-createscratchdatabase)) (depends on 6, 12)
- [ ] Task 14: `workerScope` (`tenant` — слаг) ([details](phase-04-test-stack.md#task-14-workerscope))
- [ ] Task 15: `assertAppRoleIsNotOwner` в `src/testing/tenant-isolation.ts` ([details](phase-04-test-stack.md#task-15-assertapproleisnotowner))
- [ ] Task 16: экспорты `/testing`, `globalSetup` с миграциями, тесты AC-4.18, AC-1.13, AC-4.6, AC-4.7, `workerScope` ([details](phase-04-test-stack.md#task-16-экспорты-globalsetup-пакета-и-тесты-фазы)) (depends on 8, 9, 12, 13, 14, 15)

### Фаза 5: `Db`, `KitDatabaseModule` и подпуть `/database`
- [ ] Task 17: `Db` — `transaction/read/readGlobal/afterCommit/setLocal`, `withPoolClient` ([details](phase-05-db-module.md#task-17-db)) (depends on 3, 4, 5)
- [ ] Task 18: `KitDatabaseModule`, `DRIZZLE`, `DRIZZLE_READ`, учёт срока на уровне пула, пробы, шаг 4 ([details](phase-05-db-module.md#task-18-kitdatabasemodule)) (depends on 3, 4, 17)
- [ ] Task 19: `deleteInBatches` ([details](phase-05-db-module.md#task-19-deleteinbatches)) (depends on 2, 17)
- [ ] Task 20: `runExclusive` ([details](phase-05-db-module.md#task-20-runexclusive)) (depends on 17)
- [ ] Task 21: `occurredAtColumn`, `ifNewer` ([details](phase-05-db-module.md#task-21-occurredatcolumn-и-ifnewer))
- [ ] Task 22: `src/database/index.ts`, `exports["./database"]`, фильтр `/http` без `pool: 'unknown'`, U AC-1.2 ([details](phase-05-db-module.md#task-22-публичный-database-exports-фильтр-http)) (depends on 2, 3, 4, 5, 6, 7, 17, 18, 19, 20, 21)
- [ ] Task 23: `countQueries` ([details](phase-05-db-module.md#task-23-countqueries)) (depends on 16)
- [ ] Task 24: I AC-4.1–4.5, 4.10–4.13, 4.15, 4.16 ([details](phase-05-db-module.md#task-24-тесты-i-фазы)) (depends on 16, 17, 18, 19, 20, 21, 22, 23)

### Фаза 6: Подпуть `/idempotency`
- [ ] Task 25: метрика `verdeect_cleanup_runs_total` и правило `VerdeectCleanupFailing` (AC-9.5, AC-2.11) ([details](phase-06-idempotency.md#task-25-метрика-очистки-и-правило-алерта-ac-95-ac-211))
- [ ] Task 26: `createIdempotencyTable`, `idempotencyPurgeSql` ([details](phase-06-idempotency.md#task-26-createidempotencytable-и-idempotencypurgesql)) (depends on 5)
- [ ] Task 27: `@Idempotent` ([details](phase-06-idempotency.md#task-27-idempotent)) (depends on 3)
- [ ] Task 28: интерсептор и хранилище ([details](phase-06-idempotency.md#task-28-интерсептор-и-хранилище)) (depends on 3, 17, 22, 26, 27)
- [ ] Task 29: `KitIdempotencyModule` — проверка функции, очистка ([details](phase-06-idempotency.md#task-29-kitidempotencymodule)) (depends on 17, 18, 19, 20, 22, 25, 26, 28)
- [ ] Task 30: `peer.ts`, `src/idempotency/index.ts`, `exports["./idempotency"]` ([details](phase-06-idempotency.md#task-30-peerts-публичный-idempotency-exports)) (depends on 26, 27, 29)
- [ ] Task 31: заголовки идемпотентности в OpenAPI ([details](phase-06-idempotency.md#task-31-заголовки-идемпотентности-в-openapi)) (depends on 3)
- [ ] Task 32: фикстура — таблица идемпотентности и функция очистки ([details](phase-06-idempotency.md#task-32-фикстура-бд--таблица-идемпотентности-и-функция)) (depends on 8, 26)
- [ ] Task 33: U — `idempotencyPurgeSql`, отпечаток и область, OpenAPI, граф AC-1.2 ([details](phase-06-idempotency.md#task-33-тесты-u)) (depends on 26, 27, 28, 30, 31, 32)
- [ ] Task 34: I AC-4.14 (HTTP, очистка, без функции) и AC-9.5 ([details](phase-06-idempotency.md#task-34-тесты-i-ac-414-и-ac-95)) (depends on 13, 14, 24, 25, 29, 30, 32)

### Фаза 7: `assertStrictTenantIsolation`
- [ ] Task 35: `assertStrictTenantIsolation` с проверкой функции очистки ([details](phase-07-tenant-isolation.md#task-35-assertstricttenantisolation)) (depends on 15, 26)
- [ ] Task 36: I AC-4.8 — фикстура на каждое нарушение ([details](phase-07-tenant-isolation.md#task-36-тест-ac-48)) (depends on 13, 16, 32, 35)

### Фаза 8: Проект-потребитель и проверки архива
- [ ] Task 37: потребитель — таблица компании под строгим RLS, миграции с `idempotencyPurgeSql`, `assertStrictTenantIsolation`, AC-9.5, снимок OpenAPI ([details](phase-08-consumer-package.md#task-37-потребитель-с-бд-и-идемпотентностью)) (depends on 12, 13, 14, 15, 22, 23, 29, 30, 31, 35)
- [ ] Task 38: AC-1.1, AC-1.2, AC-9.1 на архиве ([details](phase-08-consumer-package.md#task-38-проверки-архива-rc)) (depends on 22, 30, 37)

### Фаза 9: README, CHANGELOG, docs
- [ ] Task 39: README, CHANGELOG `[Unreleased]`, `docs/testing.md`, AC-9.3 ([details](phase-09-docs.md#task-39-документация-e4)) (depends on 1–38)

## Traceability

| UC / AC | Задачи | Тест (файл → название) |
|---|---|---|
| AC-4.1 (UC-5) | 5, 17, 24 | `test/integration/database/ac-4-1-transaction.spec.ts` → `AC-4.1: transaction ставит ровно один set_config…`, `AC-4.1: значение не переживает транзакцию…` |
| AC-4.2 (UC-4) | 17, 18, 24 | `ac-4-2-read.spec.ts` → `AC-4.2: read без тенанта → TenantRequiredError…`, `AC-4.2: запрос дольше 5 с в readGlobal → отмена 57014` |
| AC-4.3 (UC-5) | 17, 24 | `ac-4-3-after-commit.spec.ts` → `AC-4.3: задачи после COMMIT…`, `AC-4.3: afterCommit в read → AfterCommitInReadOnlyError` |
| AC-4.4 (UC-4) | 17, 18, 24 | `ac-4-4-connection-lost.spec.ts` → `AC-4.4: 2 × DB_POOL_MAX обрывов до BEGIN — пул не исчерпан…` |
| AC-4.5 (UC-4) | 3, 17, 18, 22, 24 | `test/unit/internal/pg-errors.spec.ts` → `AC-4.5: tagPoolTimeout…`; `ac-4-5-pool-timeout.spec.ts` → `AC-4.5: исчерпание основного пула через Db.transaction…{pool="main"} +1`, `AC-4.5: исчерпание … прямым запросом через DRIZZLE…`, `…DRIZZLE_READ → pool="read" +1`, `AC-4.5: HTTP … 503 … событие GlitchTip ровно одно`; `test/unit/http/ac-3-3-exception-filter.spec.ts` → `AC-3.3: срок пула → 503…; метрику пишет пул /database (AC-4.5)` |
| AC-4.6 (UC-1, UC-12) | 6, 9, 15, 16 | `ac-4-6-prepare-database.spec.ts` → `AC-4.6: роли … созданы`, `AC-4.6: повторный prepareDatabase — … created: []`, `AC-4.6: assertAppRoleIsNotOwner проходит под kitprep_app`, `AC-4.6: kitprep_app без CREATE на базе и схеме…`, `AC-4.6: assertAppRoleIsNotOwner падает после GRANT CREATE ON DATABASE…` / `…ON SCHEMA…` |
| AC-4.7 (UC-1) | 7, 9, 16 | `ac-4-7-migrations.spec.ts` → `AC-4.7: runMigrations пишет журнал в kit.__migrations, схема drizzle не создаётся…`, `AC-4.7: pg_dump -n kit + восстановление…`, `AC-4.7: moveJournal переносит…` |
| AC-4.8 (UC-1) | 5, 26, 35, 36 | `test/integration/testing/ac-4-8-strict-isolation.spec.ts` → `AC-4.8: note с tenantPolicy и FORCE…`, `AC-4.8: таблица без политики → падает`, `…без FORCE…`, `…нестрогая политика…`, `…функции idempotency_purge нет…`, `…без SECURITY DEFINER…`, `…владелец не kit_directory…`, `…у PUBLIC есть EXECUTE…` |
| AC-4.9 (UC-5) | 2, 22 | `test/unit/internal/ac-4-9-ids.spec.ts` → `AC-4.9: newId('fil') — fil_ + 26 знаков Crockford`, `AC-4.9: префикс вне ^[a-z]{2,5}$ → TypeError` |
| AC-4.10 (UC-4) | 22, 24 | `ac-4-10-pg-errors.spec.ts` → `AC-4.10: isUniqueViolation … cause 3`, `AC-4.10: isConnectionError — обрыв tcpProxy.break…` |
| AC-4.11 (UC-8, UC-9) | 17, 19, 24, 29, 34 | `ac-4-11-delete-in-batches.spec.ts` → `AC-4.11: shouldContinue = false…`, `AC-4.11: Db.beforeApplicationShutdown во время пачки…`; `ac-4-14-cleanup.spec.ts` → `AC-4.11: остановка во время прохода…` |
| AC-4.12 (UC-9) | 20, 24 | `ac-4-12-run-exclusive.spec.ts` → `AC-4.12: одновременно — fn ровно раз…`, `AC-4.12: исключение в fn — блокировка снята…` |
| AC-4.13 (UC-6) | 21, 24 | `ac-4-13-if-newer.spec.ts` → `AC-4.13: событие старее … updated: 0`, `…новее…`, `…NULL…` |
| AC-4.14 (UC-7) | 26–34 | `test/integration/idempotency/ac-4-14-idempotency.spec.ts` (все случаи AC-4.14 HTTP, в т. ч. `…без guard'а — 500 … GlitchTip ровно одно`); `ac-4-14-cleanup.spec.ts` → `AC-4.14: очистка под kit_app удаляет записи старше 24 ч двух компаний и запись без компании…`; `ac-4-14-missing-purge-function.spec.ts` → `AC-4.14: без функции idempotency_purge createTestApp отказывает…`, `AC-4.14: bootstrapService без функции — fatal через failStartup…`; U `idempotency-purge-sql.spec.ts`, `fingerprint.spec.ts` |
| AC-4.15 (UC-4, UC-14) | 23, 24 | `test/integration/testing/ac-4-15-count-queries.spec.ts` → `AC-4.15: transaction с одним запросом домена — count 4…` |
| AC-4.16 (UC-5) | 17, 24 | `ac-4-16-set-local.spec.ts` → `AC-4.16: имя вне ^app\.[a-z_]{1,48}$ → TypeError`, `AC-4.16: значение со ' передаётся параметром…` |
| AC-4.17 (UC-12) | 10, 11 | `test/integration/cli/ac-4-17-db-commands.spec.ts` → `AC-4.17: db prepare --service kitcli…`, `AC-4.17: db prepare без --service → USAGE`, `AC-4.17: db prepare --service Kit_1 → USAGE…`, `AC-4.17: … DATABASE_UNAVAILABLE…`, `AC-4.17: db migrate…`, `AC-4.17: db move-journal…` |
| AC-4.18 (UC-14) | 12, 13, 16 | `test/integration/testing/ac-4-18-scratch-database.spec.ts` → `AC-4.18: createScratchDatabase — пустая мигрированная БД за < 1 с` |
| AC-9.5 (NFR-8) | 25, 29, 34, 37 | `test/unit/observability/ac-2-8-metrics.spec.ts` → `AC-9.5: kitMetrics — verdeect_cleanup_runs_total…`; `ac-4-14-cleanup.spec.ts` → `AC-9.5: обычный проход → result="ok"…`, `AC-9.5: … → result="partial"`, `AC-9.5: ошибка БД … → result="error"…`; `test/package/ac-2-11-alert-rules.spec.ts` (правило `VerdeectCleanupFailing`, vmalert); `test/integration/idempotency/ac-9-5-cleanup-observability.spec.ts` → `AC-9.5: проход очистки…`; `test/consumer/minimal/src/observability.spec.ts` → `AC-9.5: после старта — лог «очистка идемпотентности: проход»…` |
| AC-1.1 (UC-16) | 22, 30, 38 | `test/unit/package/package-manifest.spec.ts` → `AC-1.1: exports — ровно …./database…./idempotency…`; `test/package/ac-1-1-package.spec.ts` → состав архива; `test/package/ac-9-1-consumer.spec.ts` → `AC-1.1: /testing без условия development…` |
| AC-1.2 (UC-1) | 1, 4, 22, 30, 33, 38 | `test/unit/database/ac-1-2-database-without-pg.spec.ts`; `test/unit/idempotency/ac-1-2-idempotency-peer.spec.ts`; `test/package/ac-1-1-package.spec.ts` → `AC-1.2: dist/database и dist/idempotency не импортируют pg … статически`; `test/package/ac-9-1-consumer.spec.ts` → `AC-1.2: без pg … /database — «@verdeect/kit/database требует pg…»` |
| AC-1.13 (UC-14) | 12, 16 | `test/integration/testing/ac-1-13-postgres.spec.ts` → `AC-1.13: startTestStack({postgres: true}) без migrations — роли … и схема есть, таблиц нет` |
| AC-3.7, AC-3.8 (UC-14) | 31, 33, 37 | `test/unit/http/ac-3-7-openapi-idempotency.spec.ts`; `test/consumer/minimal/src/openapi.spec.ts` → `AC-3.8: снимок…` (`operations: 2`) |
| AC-9.1 (UC-1, UC-16) | 37, 38 | `test/consumer/minimal/src/database.spec.ts` → `AC-9.1: assertStrictTenantIsolation({schema: 'consumer'}) проходит…`, `AC-9.1: startTestStack подготовил и мигрировал БД…`; `test/package/ac-9-1-consumer.spec.ts` → `AC-9.1: проект-потребитель проходит свои тесты…` |
| AC-9.3 | 39 | `test/package/ac-9-3-docs.spec.ts` → `AC-9.3: README — API каждого выпущенного подпути`, `…CHANGELOG…каждый экспорт…`, `…правила развёртывания` (формула), `…реестр префиксов id` |
| AC-9.4 | 1 (правило не меняется) | `test/package/ac-9-4-lint-rules.spec.ts` — существующий; `make lint` на новом коде |
| UC-5 | 2, 5, 17, 24 | AC-4.1, AC-4.3, AC-4.9, AC-4.16 |
| UC-7 | 26–34 | AC-4.14 |
| UC-9 | 19, 20, 29 | AC-4.11, AC-4.12, AC-4.14 (очистка одной репликой) |
| UC-12 | 6, 10, 11 | AC-4.6, AC-4.17 |
| UC-14 | 12–16, 23, 35 | AC-4.15, AC-4.18, AC-1.13 |

## Commit Plan
- **Commit 1** (после задач 1–3): `feat(internal): newId/ulid, ключ метаданных @Idempotent, метка пула; drizzle-kit и lint E4`
- **Commit 2** (после задач 4–9): `feat(database): tenantPolicy, prepareDatabase, runMigrations с журналом в схеме сервиса`
- **Commit 3** (после задач 10–11): `feat(cli): verdeect-kit db prepare --service, migrate, move-journal`
- **Commit 4** (после задач 12–16): `feat(testing): подготовка БД в startTestStack, createScratchDatabase, workerScope, assertAppRoleIsNotOwner`
- **Commit 5** (после задач 17–24): `feat(database): Db, KitDatabaseModule, deleteInBatches, runExclusive, ifNewer; подпуть ./database`
- **Commit 6** (после задач 25–34): `feat(idempotency): @Idempotent, интерсептор, очистка idempotency_purge, метрика и алерт очистки; подпуть ./idempotency`
- **Commit 7** (после задач 35–36): `feat(testing): assertStrictTenantIsolation с проверкой функции очистки`
- **Commit 8** (после задач 37–39): `test(consumer): БД и идемпотентность на архиве; docs: README и CHANGELOG E4`

## Definition of Done
- `make ci` зелёный (lint → analyse → test → test-integration → build → pack-check); `make test-timing` не затронут.
- Все AC скоупа — в Traceability с зелёными тестами; названия тестов начинаются с ID.
- `src/**` без `console.*`, без имён схем сервисов (AC-9.4); статических импортов `pg`/`drizzle-orm/node-postgres` нет.
- Итог `/goal` отправлен чату kit (KT-19: хеш коммита плана с решениями KT-19) вместе с П15 и просьбой поправить `ARCHITECTURE.md` (стр. 84, 91, 175, 270: `requirePeer` + ленивый `import()` для `/database` и `/idempotency`).
- README, CHANGELOG `[Unreleased]`, TSDoc у каждого нового экспорта; `version` не меняется (G14).
