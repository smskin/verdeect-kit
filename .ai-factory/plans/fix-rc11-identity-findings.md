# План реализации: выпуск `1.0.0-rc.11` — находки Identity и Orchestrator (r28–r29, PRD v1.33–v1.34)

Mode: full
Branch: fix/rc11-identity-findings
Created: 2026-11-16

## Original Request
Выпуск 1.0.0-rc.11 по пакету требований requirements/0000-kit/ (ревизия r28, PRD v1.33). Ветка fix/rc11-identity-findings (r28 — первым коммитом).

Скоуп:
1. §3.4 OutboxStore.add(tx, Event, {subjectId, data, tenant?}): 'none' — всегда null при любом тенанте транзакции, явный tenant у 'none' — TypeError; 'required' — tenant вызова или тенант DbContext, пусто — TypeError, явный ≠ непустого тенанта транзакции — TypeError до записи; откат транзакции; AC-5.15.
2. §3.4, §6 политика RLS outbox: при tenantNullable: true — вторая политика outbox_tenantless_insert (permissive, FOR INSERT, WITH CHECK (tenant IS NULL)); outbox_tenant_isolation без изменений; у NOT NULL — одна политика, миграции не меняются; §3.8 assertStrictTenantIsolation — две политики при nullable, иная или лишняя — ошибка; новая миграция drizzle-kit фикстуры test/fixtures/database (nullable); README «Как перейти» — сервису с tenantNullable сгенерировать миграцию; AC-4.8.
3. §3.3 DbContext.actor — поля string | null, add пишет actor как задан (null — null, незаданный — пропуск); AC-5.2.
4. §3.2 backgroundFailed(job, err, logger), backgroundSucceeded(job, logger) в /observability по образцу /home/administrator/projects/verdeect2/verdeect-orchestrator apps/orchestrator/src/shared/observability/background-failures.ts (main 5b74b27, только git show) — без закрытого списка job, формат job ^[a-z][a-z0-9_.-]{1,63}$; метрика verdeect_background_failures_total{job} и правило шаблона алертов increase(...[15m]) > 0 (AC-2.11); применить: relay — сбой прохода (вместо captureThrottled('outbox-relay:db')), успешный проход закрывает серию, правило «5 неудач строки» не меняется; очистка outbox/inbox — messaging-cleanup, очистка идемпотентности — idempotency-cleanup (вместо captureError на каждом проходе), {ran: false} серию не меняет; README — pending/lag замирают при недоступной БД, сигнал — метрика серии; AC-2.16 (U), AC-5.24 (I).
5. Дефект теста AC-3.9 (CI №37): test/timing/http/ac-3-9-shutdown.spec.ts, ws-тест — вместо опроса /ok с паузой ждать события: фикстура test/fixtures/http/shutdown-app.mjs пишет строку «http: server.close» перед server.close, тест ждёт её, затем один пробник /ok → ECONNREFUSED, «ws: 1001 отправлен» раньше «http: server.close»; polled.okRefused в ws-тесте убрать; сроки не увеличивать; тест должен падать при нарушенном порядке шага 2 (мутация).
6. docs/releasing.md: аннотированный тег — git commit -am "chore(release): X.Y.Z", git tag -a vX.Y.Z -m "X.Y.Z", push main и тега; строка rc.1 — git tag -a; проверка git cat-file -t vX.Y.Z → tag.
7. CHANGELOG [1.0.0-rc.11] с «Как перейти» (миграция outbox при tenantNullable; Orchestrator — orchestrator_background_failures_total → verdeect_background_failures_total), version 1.0.0-rc.11.

Тесты без реальных пауз; каждый новый тест должен падать на коде rc.10 — проверь и перечисли в отчёте. Соседние репозитории — только чтение (git show/log/diff, без checkout, pull, fetch), их контуры не трогать. Перед test-full — free -h, uptime (свободно ≥ 3 ГБ, load < 5), чужих verdeect-*-e2e и Testcontainers нет. Источник истины — requirements/0000-kit/prd.md; код rc.10 — существующий, без переделок вне скоупа. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes. Уровни тестов — по столбцу AC в `prd.md` §5:
  - AC-4.8, AC-5.2, AC-5.15, AC-5.24 — I (`test/integration/<подпуть>`);
  - AC-2.16 — U (`test/unit/observability`);
  - AC-2.11, AC-9.3, NFR-6 — R (`test/package`);
  - AC-3.9 — T (`test/timing/http`).
  - Каждый новый тест пишется первым и запускается на коде rc.10. Падение (ошибка импорта, типа или поведения) фиксируется в отчёте реализации: файл, тест, как упал. Исключения — заранее известны и тоже идут в отчёт:
    - AC-5.2: строка с `null` в `actor` на rc.10 во время выполнения уже пишется верно (`{...ctx.actor}` сохраняет `null` и пропускает незаданный ключ). Падение на rc.10 даёт проверка типов: новый `test-d` (задача 4) не компилируется — у полей `actor` в rc.10 нет `| null`.
    - AC-3.9 (ws): поведение rc.10 верное, исправляется тест. Вместо «падает на rc.10» — мутация порядка шага 2 (задача 10): тест падает на мутанте, мутация откатывается.
  - Реальных пауз нет. Недоступная БД в AC-5.24 — закрытый порт: `tcpProxy.break()` (соединения разорваны, порт не слушает) — подключение сразу получает `ECONNREFUSED`, ожидания срока драйвера нет; восстановление — `restore()` на том же порту (поправка пользователя 16.11.2026: не `blackhole()`). Паузы relay — подменённые часы `RelayTimers`, как в `test/timing/messaging/ac-5-16-relay-backoff.spec.ts`. Сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino`/`Logger` Nest, без `console.*` (NFR-8, AC-9.4). Конкретные строки — в задачах.
- Docs: no. Обязательного чекпоинта `/aif-docs` нет (`WARN [docs]`). README, `AGENTS.md`, `docs/releasing.md`, CHANGELOG и версию обновляют задачи 11–13 («Library Package Scope» (7), AC-9.3).
- Настройки — как в rc.10 (ответ пользователя от 16.11.2026).

## Roadmap Linkage
Milestone: "none"
Rationale: вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по находкам Identity (ID-68, ID-69) и Orchestrator (OR-214, К35), сверка KT-120 (G14). Отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.34 (r29; v1.34 закрепила ответы пользователя R6, R7, R9 и метку `task`) > ответы пользователя на вопросы плана (16.11.2026) > текст запроса > `ARCHITECTURE.md` / `DESCRIPTION.md`. Образец Orchestrator (`5b74b27:apps/orchestrator/src/shared/observability/background-failures.ts`) — только справочный материал. Где он расходится с PRD (закрытый список `BACKGROUND_JOB`, метрика `orchestrator_*`, параметр `message`, Nest `Logger`), действует PRD.

Скоуп — изменения v1.33–v1.34 относительно v1.32:
- §3.2: `backgroundFailed`, `backgroundSucceeded`, `kitMetrics`;
- §3.3: `DbContext`;
- §3.3а: очистка идемпотентности;
- §3.4: `createOutboxTable`, `OutboxStore.add`, relay, очистка;
- §3.8: `assertStrictTenantIsolation`;
- §6: RLS `outbox`;
- AC-2.16, AC-4.8, AC-5.2, AC-5.15, AC-5.24;
- сопутствующие проверки: AC-2.11, AC-2.8, AC-9.3, NFR-6.

Вне PRD, по запросу:
- тест AC-3.9 (п. 5, дефект CI №37);
- `docs/releasing.md` (п. 6).

Код rc.10 — существующий: расширять, не переписывать.

| # | Решение | Источник | Задачи |
|---|---|---|---|
| R1 | Вторая политика `outbox_tenantless_insert` есть только у таблицы `createOutboxTable(schema, {tenantNullable: true})`: `pgPolicy` с `as: 'permissive'`, `for: 'insert'`, `to: 'public'`, `withCheck` — константа `OUTBOX_TENANTLESS_INSERT_SQL = 'tenant IS NULL'` (через `sql.raw`, как `OUTBOX_POLICY_SQL`), `using` не задаётся. Имя и SQL — в `src/internal/outbox-policy.ts` (их читает и `/testing`). `outbox_tenant_isolation` не меняется. У таблицы `NOT NULL` политика одна, SQL её миграции прежний | §3.4 стр. 128, §6 стр. 529 | 1 |
| R2 | Под тенантом `acme` вставка строки с `null` проходит: политики permissive складываются по ИЛИ, вторая пропускает `tenant IS NULL`. Строка не видна под `acme` (`USING` первой политики), `INSERT` без `RETURNING`. Строка `other` — 42501 (обе `WITH CHECK` ложны). Под пустым тенантом видно всё (relay, очистка) | §3.4 стр. 128, AC-4.8 | 1, 2 |
| R3 | `assertStrictTenantIsolation` для `outbox` берёт `attnotnull` колонки `tenant` из того же запроса к `pg_attribute`. `NOT NULL` — ровно одна политика `outbox_tenant_isolation` (как сейчас). Nullable — ровно две: та же `outbox_tenant_isolation` и `outbox_tenantless_insert` (`PERMISSIVE`, `cmd = INSERT`, `roles = {public}`, `qual` пустой, `with_check` после `normalize` = `tenantisnull`). Сообщения — по политике, чтобы тексты существующих тестов не менялись: (а) нет или не та `outbox_tenant_isolation` — прежнее «`outbox: политика не по createOutboxTable (outbox_tenant_isolation)`»; (б) nullable без верной `outbox_tenantless_insert` — «`outbox: политика не по createOutboxTable (outbox_tenantless_insert)`»; (в) `outbox_tenantless_insert` у `NOT NULL` — «`outbox: лишняя политика outbox_tenantless_insert (tenant NOT NULL)`»; (г) любая другая политика — «`outbox: лишняя политика <имя>`». Нет ни одной политики — прежнее «`outbox: нет политики`» | §3.8 стр. 197, AC-4.8 | 2 |
| R4 | `OutboxStore.add(tx, Event, {subjectId, data, tenant?})`, `tenant?: string`. `tenant` вызова «задан» ≡ `input.tenant !== undefined` (буква PRD стр. 129): `''` — задан и пуст. Пусто — `''` или `null`. Проверки идут до `afterCommit` и `INSERT`, исключение откатывает транзакцию сервиса. Комбинации — таблица ниже | §3.4 стр. 129, AC-5.15 | 3 |
| R5 | `DbContext.actor`: `clientId`, `accountId`, `memberId`, `onBehalfOf` — `string \| null` (необязательные), `channel: string`. `add` пишет копию `actor` как задана: `null` — `null`, незаданный ключ — пропуск, без удаления и дополнения полей. Код `add` (`{ ...ctx.actor }`) уже так делает, меняются тип, TSDoc и тест | §3.3 стр. 95, AC-5.2 | 4 |
| R6 | **Ответ пользователя 16.11.2026: счётчик процесса.** Файл `src/observability/background-failures.ts`. Серия (`Map<task, failures>`) и итоги сбоев по `task` (`Map<task, total>`, только растут) живут в памяти модуля — как серия по PRD. `backgroundFailed`: проверка `task`, `total + 1`, `failures + 1`. Первый сбой серии — `captureError(err)` (внутри `sanitizeError`; уже отправленная ошибка повторно не уходит) и `logger.error({task, err: sanitizeError(err)}, 'фоновая задача: сбой')`. Следующие — `logger.warn({task, failures, err: sanitizeError(err)}, 'фоновая задача: сбой повторяется')` без события. `backgroundSucceeded`: проверка `task`. Нет серии — ничего. Есть — серия удаляется, `logger.info({task, failures}, 'фоновая задача: серия сбоев закрыта')`. `kitMetrics` регистрирует в реестре экземпляра `Counter` `verdeect_background_failures_total{task}` с `collect()`: при каждом `/metrics` выставляет итоги из счётчика процесса (API `collect`/`reset`/`inc` `@prometheus-io/client` сверить через Context7). Поля в `KitMetrics` нет: значения задаёт только `backgroundFailed`. Два приложения в одном процессе видят одни числа — так задумано, это TSDoc и README. Тесты меряют прирост. ponytail-комментарий: серия и счёт — на процесс, при N репликах до N событий на серию (README) | §3.2 стр. 81, 84; ответ пользователя | 5 |
| R7 | **Ответ пользователя: pino-стиль.** Публичный тип `KitBackgroundLogger` — объект с методами `error`, `warn`, `info` вида (поля, сообщение). Подходят pino-логгер и внутренние `MessagingLog`/`CleanupLog`. Nest `Logger` — через адаптер сервиса (пример в README). Формат `task` — `^[a-z][a-z0-9_.-]{1,63}$`, иначе `TypeError` с именем функции, у обеих функций. Закрытого списка `task` нет | §3.2 стр. 81; ответ пользователя | 5 |
| R8 | Relay: проход — `drain()` в `iterate()`. Исключение (ошибка БД при выборке или отметке) — `backgroundFailed('outbox-relay', error, this.log)` вместо `log.error('outbox: ошибка БД relay')` и `captureThrottled('outbox-relay:db')`, затем `nextBackoff()`, как сейчас. `drain()` без исключения — `backgroundSucceeded('outbox-relay', this.log)`, в том числе когда пачку прервала неудача публикации строки (`failed: true`): это правило строки («5 неудач строки» — `reportFailure`, не меняется). Нет соединения или канала (`Infinity`) — прохода нет, функции не вызываются. Метрики `verdeect_outbox_*` при сбое замирают (код `refreshStats` не меняется), это README | §3.4 стр. 131, AC-5.24 | 7 |
| R9 | **Ответ пользователя: проход целиком.** Очистка сообщений: ошибка `runExclusive` (замок не взят из-за БД) или хотя бы одной таблицы — один `backgroundFailed('messaging-cleanup', <первая ошибка прохода>, this.log)` за проход. `backgroundSucceeded` — только если проход выполнен (`ran: true`) и все таблицы без ошибки. `{ran: false}` (замок у другой реплики) и остановка — ни одной функции. `verdeect_cleanup_runs_total{table, result: 'error'}` — по таблице, как сейчас. Ошибка таблицы больше не пишет свой `error`-лог и не вызывает `captureError`: `debug({table, err}, 'очистка сообщений: ошибка таблицы')`, ошибка уходит в итог прохода. Очистка идемпотентности: ошибка прохода — `backgroundFailed('idempotency-cleanup', …)` вместо `log.error` + `captureError`, выполненный проход — `backgroundSucceeded`, `{ran: false}` — ничего. Расписание (R9 rc.10) не меняется | §3.3а стр. 117, §3.4 стр. 134, AC-5.24; ответ пользователя | 8, 9 |
| R10 | Правило `VerdeectBackgroundFailures` в `alerts/verdeect-kit.rules.yml` — по виду `VerdeectEventsDlq` (стр. 56–69, левая часть по второй метке): `sum by (service, task) (increase(verdeect_background_failures_total[15m])) > on (service) group_left () (max by (service) (verdeect_kit_threshold:background_failures) or on (service) (max by (service) (sum by (service, task) (increase(verdeect_background_failures_total[15m]))) * 0))`. Это значит: прирост больше порога, порог по умолчанию 0, переопределение `verdeect_kit_threshold:background_failures` по `service`, `severity: warning`, `summary`/`description` по-русски с `task` | §3.2 стр. 84, AC-2.11 | 6 |
| R11 | AC-3.9 (ws). В переопределённом `httpServer.close` фикстура сначала пишет в stdout строку `{"msg":"http: server.close","listening":<bool>}`, затем вызывает исходный `close`. Строка пишется до `close` (stdout в pipe на Linux синхронный), поэтому тест может подключиться раньше, чем слушатель закрыт: соединение в очереди listen ядра сбрасывается `server.close()` — `ECONNRESET` с `handshake` (как описано в `ac-3-9-shutdown.spec.ts` стр. 84–88). Тест ждёт строку событием `data` stdout ребёнка (без опроса и `sleep`), затем `probeNewConnection`: `ECONNREFUSED` — успех; `ECONNRESET` с `handshake` — сразу, без паузы, второй пробник, он должен дать `ECONNREFUSED`; иное — падение. Порядок — индекс строки «ws: 1001 отправлен» в выводе меньше индекса «http: server.close». `poll`/`polled.okRefused` в ws-тесте не используются. Тест `plain` не меняется | запрос п. 5; §3.2 v1.30 шаг 2 | 10 |
| R12 | `docs/releasing.md`, шаг 4: `git commit -am "chore(release): X.Y.Z"`, `git tag -a vX.Y.Z -m "X.Y.Z"`, `git push origin main`, `git push origin vX.Y.Z`, затем проверка `git cat-file -t vX.Y.Z` → `tag` (иначе тег лёгкий: удалить и поставить аннотированный). «Первый выпуск», шаг 2: `git tag -a v1.0.0-rc.1 -m "1.0.0-rc.1"`. Фрагмент `'git tag v'` в `test/package/ac-9-3-docs.spec.ts:212` после правки не найдётся. Он меняется на `'git tag -a v'`, добавляется `'git cat-file -t'`: новая проверка падает на тексте rc.10 | запрос п. 6; NFR-6 | 12 |

Комбинации `OutboxStore.add` (R4):

| `Event.tenant` | тенант `DbContext` | `tenant` вызова | Итог |
|---|---|---|---|
| `'none'` | пусто | не задан | строка и конверт `tenant: null` |
| `'none'` | `acme` | не задан | строка и конверт `tenant: null` (вставка — по `outbox_tenantless_insert`) |
| `'none'` | любой | задан (в том числе `''`) | `TypeError` до записи, откат |
| `'required'` | `acme` | не задан | `tenant: 'acme'` |
| `'required'` | пусто | не задан / пусто | `TypeError`, откат, строки домена нет |
| `'required'` | пусто | `acme` | `tenant: 'acme'` (политика пропускает при пустом тенанте) |
| `'required'` | `acme` | `acme` | `tenant: 'acme'` |
| `'required'` | `acme` | `other` | `TypeError` до записи, откат |
| `'required'` | `acme` | `''` | `TypeError` до записи, откат (tenant вызова задан и пуст) |

Комбинации серии (R6, R8, R9):

| Событие | Серия | Лог | GlitchTip | Метрика |
|---|---|---|---|---|
| первый сбой | 1 | `error` | одно | +1 |
| повторный сбой | +1 | `warn` с `failures` | нет | +1 |
| успех при открытой серии | закрыта | `info` с `failures` | нет | — |
| успех без серии | — | нет | нет | — |
| пропуск (`{ran: false}`, нет канала relay) | без изменений | нет | нет | — |
| сбой после закрытия | 1 | `error` | одно (новое) | +1 |

## Commit Plan
- **Commit 0** — выполнен: 83ac1ae `docs(requirements): r28 — PRD v1.33, находки Identity и К35` (`requirements/0000-kit/prd.md`, `requirements/0000-kit/README.md`, `requirements/INDEX.md`). Повторять не нужно.
- **Commit 0а** (до задачи 1, только по команде пользователя): `docs(requirements): r29 — PRD v1.34, вопросы плана rc.11` — `requirements/0000-kit/prd.md`, `requirements/0000-kit/README.md`, `requirements/INDEX.md`. Затем отдельным коммитом — план и логи `aif-improve`.
- **Commit 1** (после 1–4): `fix(messaging): тенант на вызов OutboxStore.add, политика outbox_tenantless_insert, null в actor (AC-5.15, AC-4.8, AC-5.2)`
- **Commit 2** (после 5–9): `feat(observability): backgroundFailed/backgroundSucceeded, verdeect_background_failures_total — relay и очистки (AC-2.16, AC-5.24, AC-2.11)`
- **Commit 3** (после 10): `test(http): AC-3.9 ws — ожидание server.close событием вместо опроса`
- **Commit 4** (после 11–12): `docs: README, AGENTS.md, releasing — rc.11, аннотированный тег`
- **Commit 5** (после 13): `chore(release): 1.0.0-rc.11` (только `CHANGELOG.md` и `package.json`, как dc08a1a)

## Tasks

### Фаза 1: `/messaging` — тенант outbox и RLS

- [ ] **Task 1: политика `outbox_tenantless_insert` и миграция фикстуры** — §3.4 стр. 128, §6 стр. 529, R1, R2
  - **Skill:** nestjs-code generic src/internal/outbox-policy.ts (MODIFY); nestjs-code generic src/messaging/tables.ts (MODIFY); nestjs-code test unit messaging tables (MODIFY) → `test/unit/messaging/tables.spec.ts`; миграция — команда `pnpm db:fixtures` (без Skill)
  - Тест (сначала, на rc.10), `tables.spec.ts`:
    - `AC-4.8: createOutboxTable({tenantNullable: true}) — две политики: outbox_tenant_isolation (ALL) и outbox_tenantless_insert (permissive, INSERT, public, WITH CHECK tenant IS NULL)`;
    - `AC-4.8: createOutboxTable() и {tenantNullable: false} — одна политика outbox_tenant_isolation`.
    - Проверка — по `getTableConfig(table).policies`: имя, `as`, `for`, `to`, SQL `withCheck`.
    - На rc.10 первый тест падает (политика одна).
  - Код:
    - `outbox-policy.ts`: константы `OUTBOX_TENANTLESS_INSERT_POLICY = 'outbox_tenantless_insert'` и `OUTBOX_TENANTLESS_INSERT_SQL = 'tenant IS NULL'`, TSDoc (§3.4 v1.33), шапка файла — ссылка на v1.33.
    - `tables.ts`: `outboxTable` получает признак nullable и добавляет вторую `pgPolicy` только при нём. `createOutboxTable` передаёт признак из ветки `tenantNullable === true`. Типы перегрузок `KitOutboxTableStrict`/`KitOutboxTableNullable` не меняются (тест `ac-5-21-outbox-table.test-d.ts` зелёный). TSDoc `createOutboxTable` и перегрузки nullable — вторая политика и её смысл (R2). Шапка — v1.33.
    - API `pgPolicy` drizzle-orm (`for: 'insert'` без `using`) сверить через Context7.
  - Миграция: `pnpm db:fixtures` генерирует `test/fixtures/database/migrations/0009_*.sql` и снимок `meta/0009_snapshot.json`, `_journal.json` обновляется. В SQL — `CREATE POLICY "outbox_tenantless_insert" ON "kit"."outbox" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant IS NULL)`. Сгенерированный файл не править. Если drizzle-kit спрашивает имя или пишет что-то кроме этой политики — стоп и сообщить пользователю. Изменения — в отчёт.
  - Потребитель `test/consumer/minimal` — `createOutboxTable(consumer)` без опции, его миграции не меняются (R1).
  - Логи: нет.

- [ ] **Task 2: `assertStrictTenantIsolation` — две политики при nullable** — §3.8 стр. 197, AC-4.8, R3 (depends on 1)
  - **Skill:** nestjs-code test integration testing ac-4-8-strict-isolation (MODIFY) → `test/integration/testing/ac-4-8-strict-isolation.spec.ts`; nestjs-code generic src/testing/tenant-isolation.ts (MODIFY)
  - Тесты (сначала, на rc.10; scratch-БД через существующий `withScratch`, DDL — администратором, проверка — под `kit_app`):
    - `AC-4.8: outbox createOutboxTable({tenantNullable: true}) с двумя политиками проходит` — фикстура `kit` после миграции 0009. Существующий тест стр. 196 «outbox из createOutboxTable (схема kit) — проходит» и есть эта проверка: переименовать, добавив «две политики при nullable tenant», в отчёт. На rc.10 (код проверки rc.10 и миграции задачи 1) он падает: у nullable `outbox` две политики, rc.10 требует одну;
    - `AC-4.8: под тенантом acme вставка строки outbox с tenant null проходит, строка не видна; вставка строки other — 42501`. Стенд — не `withScratch` (его `check` получает только `run`, пула `kit_app` нет), а приём теста стр. 49–75: свой `createScratchDatabase()`, `pg.Client` по `scratch.url` (роль `kit_app`), `client.end()` и `scratch.drop()` в `finally`. Под `kit_app` в транзакции с `set_config('app.tenant', 'acme', true)`: `insert … tenant null` успешен, `select count(*) … where id = …` — 0. Отдельная транзакция: `insert … tenant 'other'` — `sqlStateOf` = `42501`. Под пустым тенантом строка `null` видна (1). Данные — уникальные `id`. Очистка — существующим порядком файла. На rc.10 первая вставка — 42501;
    - `AC-4.8: лишняя политика у outbox (CREATE POLICY outbox_extra … FOR SELECT USING (true)) → «outbox: лишняя политика outbox_extra»`;
    - `AC-4.8: nullable outbox без outbox_tenantless_insert (DROP POLICY) → «outbox: политика не по createOutboxTable (outbox_tenantless_insert)»`;
    - `AC-4.8: outbox_tenantless_insert с иным WITH CHECK (true) → «… (outbox_tenantless_insert)»`;
    - `AC-4.8: outbox NOT NULL (ALTER COLUMN tenant SET NOT NULL на пустой таблице) с outbox_tenantless_insert → «outbox: лишняя политика outbox_tenantless_insert (tenant NOT NULL)»`;
    - `AC-4.8: outbox NOT NULL без outbox_tenantless_insert (SET NOT NULL + DROP POLICY outbox_tenantless_insert) — проходит`.
    - Существующие тесты стр. 207–237 («политика tenantPolicy вместо исключения», «USING (true) outbox_all», «без FORCE») остаются зелёными без правок (R3). Тест стр. 207 теперь даёт ещё и (г) «лишняя политика tenant_isolation» — `toThrow` по подстроке проходит.
    - Тест стр. 239–243 «outbox без политики» после миграции 0009 упадёт: `DROP POLICY outbox_tenant_isolation` оставляет `outbox_tenantless_insert`, и сообщение — (а), а не «нет политики». Правка: в его DDL добавить `DROP POLICY outbox_tenantless_insert ON kit.outbox`, ожидаемый текст не меняется. В отчёт «было → стало, основание R3».
  - Код `tenant-isolation.ts`:
    - запрос таблиц выбирает и `a.attnotnull`;
    - `policyViolations` передаёт признак в `outboxPolicyViolations`;
    - новая `outboxPolicyViolations(policies, tenantNotNull)` разбирает политики по имени по R3: (а)–(г) — каждое нарушение своей строкой;
    - печатная форма `with_check` PostgreSQL 17 — `(tenant IS NULL)`, сравнение через `normalize` (без скобок и регистра);
    - импорт имени политики — из `../internal/outbox-policy.js` (`/testing` не грузит `/messaging`);
    - TSDoc `assertStrictTenantIsolation`: у `outbox` при nullable `tenant` — ещё `outbox_tenantless_insert`, иная или лишняя политика — ошибка. Шапка — v1.33.
  - Проверка потребителя: `test/consumer/minimal/src/database.spec.ts` вызывает `assertStrictTenantIsolation` на `NOT NULL` outbox — по R3 проходит без изменений (`make test-package`).
  - Логи: нет.

- [ ] **Task 3: `OutboxStore.add` — тенант на вызов** — §3.4 стр. 129, AC-5.15, R4 (depends on 1)
  - **Skill:** nestjs-code test integration messaging ac-5-15-outbox-tenant (MODIFY) → `test/integration/messaging/ac-5-15-outbox-tenant.spec.ts`; nestjs-code generic src/messaging/outbox-store.ts (MODIFY)
  - Тесты (сначала, на rc.10), по строкам таблицы R4. Стенд и проверки строки и конверта — как в файле сейчас (`createOutboxApp`, `outboxRows`, `BrokerClient`):
    - `AC-5.15: 'none' в транзакции с тенантом acme → строка и конверт tenant: null` — заменяет существующий тест стр. 50 «'none' с тенантом — TypeError, откат». Поведение изменено PRD v1.33, в отчёт «было → стало, основание §3.4 стр. 129». На rc.10 — `TypeError`;
    - `AC-5.15: 'none' с явным tenant → TypeError, откат (строки домена нет)` — при тенанте контекста `null` и `acme`. На rc.10 при `null` строка пишется (параметра нет);
    - `AC-5.15: 'required' с явным slug acme в транзакции с пустым тенантом → строка и конверт tenant: acme`. На rc.10 — `TypeError`;
    - `AC-5.15: 'required' с явным чужим slug other в транзакции acme → TypeError до записи, откат`. На rc.10 — строка с `acme`;
    - `AC-5.15: 'required' с явным acme в транзакции acme → tenant: acme`;
    - `AC-5.15: 'required' с tenant: '' → TypeError, откат` — при пустом тенанте контекста и при `acme` (R4: `''` задан и пуст);
    - в тест «'none' с явным tenant» добавить случай `tenant: ''` → `TypeError`;
    - существующий тест стр. 35 («'required' без тенанта в DbContext — TypeError, строки домена нет») не меняется.
  - Код `add`:
    - тип третьего аргумента — плюс `readonly tenant?: string`;
    - ветки по R4 — плоско, ранние `throw`; «задан» — `input.tenant !== undefined`;
    - тексты: `'none'` с явным — «событие <type> без компании (tenant: 'none') — tenant вызова не задаётся»; `'required'` пусто — прежний текст, дополненный «и tenant вызова не задан»; чужой — «событие <type>: tenant вызова не совпадает с тенантом транзакции», без значений слагов (как остальные тексты `add`: только имена и пути).
    - в `INSERT` — вычисленный тенант. `afterCommit` — после проверок, как сейчас.
    - TSDoc `add` и класса — тенант строки по R4, `@throws`. Шапка — v1.33.
  - Логи: `debug({type, id}, 'outbox: строка добавлена')` — как сейчас.

- [ ] **Task 4: `DbContext.actor` — поля `string | null`** — §3.3 стр. 95, AC-5.2, R5
  - **Skill:** nestjs-code generic src/database/tenant.ts (MODIFY); nestjs-code test unit database ac-5-2-db-context (CREATE) → `test/unit/database/ac-5-2-db-context.test-d.ts`; nestjs-code test integration messaging ac-5-2-outbox-row (MODIFY) → `test/integration/messaging/ac-5-2-outbox-row.spec.ts`
  - Тесты (сначала, на rc.10):
    - `ac-5-2-db-context.test-d.ts`: `AC-5.2: DbContext принимает actor {clientId: null, channel: 'system'}` и все четыре поля `null`; `channel: null` — `@ts-expect-error`. На rc.10 — ошибка компиляции (`pnpm typecheck` / typecheck Vitest);
    - `ac-5-2-outbox-row.spec.ts`: `AC-5.2: контекст с actor {clientId: null, channel: 'system'} → в строке outbox и в конверте clientId: null; ключа accountId нет; EnvelopeSchema принимает конверт`. Проверки: `outboxRows` — `actor` строго равен `{clientId: null, channel: 'system'}`; тело из брокера — `'clientId' in actor` и `actor.clientId === null`, `'accountId' in actor === false`, `EnvelopeSchema.parse(body)` без ошибки. На rc.10 во время выполнения проходит (R5, Settings): в отчёт — «падает только тип».
  - Код `tenant.ts`: четыре поля — `readonly clientId?: string | null` и т. д., TSDoc интерфейса — `null` пишется как `null`, незаданный ключ — пропуск, пакет поля не удаляет и не дополняет. `outbox-store.ts` не меняется (`{ ...ctx.actor }`). Проверить `pnpm typecheck`: другие места, где читается `actor` (`src/http/kit-http-core.module.ts`, `src/testing/test-events.ts`, `src/testing/create-test-app.ts`), компилируются. Если где-то нужен сужающий код — стоп и сообщить (вне скоупа).
  - Логи: нет.

### Фаза 2: серия сбоев фоновых задач

- [ ] **Task 5: `backgroundFailed`, `backgroundSucceeded`, `KitBackgroundLogger`, метрика** — §3.2 стр. 81, 84, AC-2.16, R6, R7
  - **Skill:** nestjs-code test unit observability ac-2-16-background-failures (CREATE) → `test/unit/observability/ac-2-16-background-failures.spec.ts`; nestjs-code generic src/observability/background-failures.ts (CREATE); nestjs-code generic src/observability/metrics.ts (MODIFY); nestjs-code generic src/observability/index.ts (MODIFY); nestjs-code test unit observability ac-2-8-metrics (MODIFY) → `test/unit/observability/ac-2-8-metrics.spec.ts`
  - Тест (сначала, на rc.10 — ошибка импорта). `@sentry/nestjs` — `vi.mock`, как в `ac-2-6-capture-throttled.spec.ts` (unit-файлы изолированы по умолчанию). Логгер — запись вызовов `error`/`warn`/`info` в массив. Метрика — `kitMetrics({service: 'kit-test'}).registry.getSingleMetricAsString` / `getMetricsAsJSON`, прирост от значения до теста. У каждого теста свой `task` (счётчик процесса общий). Каждый вызов `backgroundFailed` — новый `new Error(...)`: `captureError` не шлёт уже отправленный объект, и с одной ошибкой тест «одно событие» прошёл бы на реализации, которая зовёт `captureError` на каждом сбое:
    - `AC-2.16: три сбоя подряд → одно событие GlitchTip, verdeect_background_failures_total{task} = 3, логи error, warn, warn (warn с failures 2 и 3)`;
    - `AC-2.16: backgroundSucceeded закрывает серию (info с failures), новый сбой — второе событие и error`;
    - `AC-2.16: серии разных task независимы`;
    - `AC-2.16: backgroundSucceeded без открытой серии — без лога`;
    - `AC-2.16: task вне формата (A, a, 'a b', 65 символов) → TypeError у обеих функций`; `a.b-c_1` — проходит;
    - `AC-2.16: в лог и событие уходит sanitizeError(err)` — ошибка с SQL-параметрами в `cause`, как в `ac-2-6`: в поле `err` — очищенная форма.
  - Код `background-failures.ts` — по R6/R7. Шапка: `prd.md §3.2 v1.34, AC-2.16`, эталон — O `background-failures.ts` (5b74b27), отличия: функции вместо класса, `task` по формату вместо списка, метрика `verdeect_`, логгер pino-стиля, сообщения пакета. Внутренняя функция для `metrics.ts` — итоги по `task` (TSDoc `@internal`, не экспортируется из `index.ts`). TSDoc публичных экспортов и полей `KitBackgroundLogger`.
  - `metrics.ts`: `Counter` `verdeect_background_failures_total`, `labelNames: ['task']`, `help: 'Сбои фоновых задач (backgroundFailed) по task'`, `registers`, `collect()` по R6. Шапка — v1.34. Строку шапки (стр. 3) «Глобального реестра нет: два приложения в процессе не смешиваются» поправить: у метрик экземпляра свой реестр, кроме `verdeect_background_failures_total` — там итоги процесса (R6).
  - `index.ts`: `export { backgroundFailed, backgroundSucceeded }`, `export type { KitBackgroundLogger }`.
  - `ac-2-8-metrics.spec.ts`: в `KIT_PACKAGE_METRICS` — `verdeect_background_failures_total`.
  - Логи: строки R6 — в коде функций.

- [ ] **Task 6: правило алерта `VerdeectBackgroundFailures`** — §3.2 стр. 84, AC-2.11, R10 (depends on 5)
  - **Skill:** none (YAML) → `alerts/verdeect-kit.rules.yml`, `test/fixtures/alerts/verdeect-kit.test.yml`, `test/fixtures/alerts/service-override.rules.yml`; nestjs-code test unit package ac-2-11-alert-rules (MODIFY) → `test/package/ac-2-11-alert-rules.spec.ts`
  - Тест (сначала): в `ac-2-11-alert-rules.spec.ts` — `expect(names).toHaveLength(9)`, в `THRESHOLDS` — `verdeect_kit_threshold:background_failures`. На rc.10 тест «правило на каждую метрику» падает после задачи 5 (метрика без правила). Длина 8 на коде rc.10 тоже: 9 ≠ 8.
  - **Решено PRD v1.34 (r29, KT-122): метка `task`, не `job`.** `job` при сборе ставят Prometheus и vmagent (имя задания сбора), метка приложения переименовалась бы в `exported_job` (§3.2 стр. 81). Правило и фикстуры — по `task`.
  - Правило — по R10: выражение по виду `VerdeectEventsDlq` (стр. 56–69), место в файле — после `VerdeectIdempotencyLateCompletions` (стр. 135–150).
  - Шапка файла правил (стр. 13–14), перечень имён порогов: добавить `:background_failures`.
  - Фикстуры vmalert — по образцу серий `verdeect_idempotency_late_completions_total` (`verdeect-kit.test.yml` стр. 114–132): ряд `{service="j", task="outbox-relay"}` с ростом → алерт с меткой `task`; ряд с переопределением порога `service="k"` → нет алерта. Запись порога — в `service-override.rules.yml`.
  - Проверка: `pnpm vitest run -c vitest.package.config.ts test/package/ac-2-11-alert-rules.spec.ts` (нужен Docker vmalert, как сейчас).
  - Логи: нет.

- [ ] **Task 7: relay — серия `outbox-relay`** — §3.4 стр. 131, AC-5.24, R8 (depends on 5)
  - **Skill:** nestjs-code test integration messaging ac-5-24-background-failures (CREATE) → `test/integration/messaging/ac-5-24-background-failures.spec.ts`; nestjs-code generic src/messaging/outbox-relay.ts (MODIFY); nestjs-code generic vitest.integration.config.ts (MODIFY)
  - Тест (сначала, на rc.10). Файл изолирован: `initFakeSentry` — в список `ISOLATED` с причиной «initFakeSentry — process-global Sentry». Стенд:
    - `tcpProxy(appUrl())` и `createTestDb({url: proxy.url, poolMax: 2})` из `test/support/database.ts` — как в `test/integration/database/ac-4-4-connection-lost.spec.ts` стр. 39–40. `acquireTimeoutMs` не уменьшать: при закрытом порте отказ — `ECONNREFUSED` сразу, срок не наступает;
    - `OutboxStore` и `OutboxRelay` создаются напрямую, как в `test/timing/messaging/ac-5-16-relay-backoff.spec.ts`: поддельное соединение с готовым каналом, управляемые `RelayTimers` (пауза — по `tick()` теста), `log` — запись в память;
    - `kitMetrics({service: 'kit'})` — для чтения `verdeect_background_failures_total{task="outbox-relay"}`.
    - Тест: `AC-5.24: БД недоступна (закрытый порт, tcpProxy.break — ECONNREFUSED) — N = 3 прохода relay → одно событие GlitchTip, verdeect_background_failures_total{task="outbox-relay"} = 3; после restore успешный проход закрывает серию (info); новый сбой — второе событие`. Проходы считаются по `pauses` управляемых часов. Ожидание — существующий `waitUntil` по событию (длина `pauses`/логов), без `sleep`.
    - На rc.10: `captureThrottled` даёт одно событие за 60 с, но метрики нет и после восстановления второго события нет — тест падает.
  - Код `iterate()` — по R8: в `catch` — `backgroundFailed('outbox-relay', error, this.log)`. После `drain()` без исключения — `backgroundSucceeded('outbox-relay', this.log)`. Импорт `captureThrottled` убрать, если больше не нужен (`captureError` для «5 неудач строки» остаётся). Импорт — из `../observability/background-failures.js`. Шапка — v1.34.
  - Логи: из `backgroundFailed`/`backgroundSucceeded`. Прежняя строка `error` «outbox: ошибка БД relay» удаляется (заменена серией).

- [ ] **Task 8: очистка сообщений — серия `messaging-cleanup`** — §3.4 стр. 134, AC-5.24, R9 (depends on 5, 7)
  - **Skill:** nestjs-code test integration messaging ac-5-24-background-failures (MODIFY) → `test/integration/messaging/ac-5-24-background-failures.spec.ts`; nestjs-code generic src/messaging/cleanup.ts (MODIFY)
  - Тесты (сначала, в файле задачи 7). `MessagingCleanup` создаётся напрямую по `MessagingCleanupDeps`: `db` — через прокси, `database` — `{runExclusive, deleteInBatches}` из `src/database/index.ts`, схема `kit`, таблицы фикстуры, `backgroundLoops: false`, вызовы — `cleanup.run()`:
    - `AC-5.24: проход очистки с ошибкой БД → серия messaging-cleanup (одно событие, error); повторный сбой — без события, warn`. БД — закрытый порт (`proxy.break()`, `ECONNREFUSED` сразу);
    - `AC-5.24: проход с занятым замком ({ran: false}) серию не меняет и не закрывает`. После двух сбоев `restore()` прокси, замок `messagingCleanupLockKey('kit')` держит `runExclusive` на втором `createTestDb()` (напрямую, без прокси) с `barrier` — как тест «одна реплика за раз» в `ac-5-12-cleanup.spec.ts` стр. 88–113. `run()` → `{ran: false}`, без `info` закрытия. Замок снят, БД доступна — `run()` закрывает серию (`info` с `failures: 2`), событий по-прежнему одно;
    - `AC-5.24: ошибка одной таблицы (REVOKE DELETE ON kit.outbox) — сбой прохода, inbox очищен, успеха нет`. Как `ac-5-12-cleanup.spec.ts` стр. 166: серия +1, `verdeect_cleanup_runs_total{table="outbox",result="error"}` +1, `{table="inbox",result="ok"}` +1.
    - На rc.10: `captureError` на каждом проходе — два события, нет `warn` — падает.
  - Код `cleanup.ts` — по R9. `cleanTable` возвращает ошибку таблицы (или `undefined`), без `error`-лога и `captureError`. Вместо них — `debug({table, err: sanitizeError(error)}, 'очистка сообщений: ошибка таблицы')`. `pass()`: `catch` `runExclusive` и первая ошибка таблиц — `backgroundFailed('messaging-cleanup', …)`. Итог прохода для расписания: ошибка — `'error'`, как сейчас для исключения. Расписание после ошибки таблицы — как после ошибки (час), раньше было `'done'` (тоже час) — без изменения интервала. Выполненный проход без ошибок — `backgroundSucceeded`. `'busy'` и `stopped` — ни одной функции. Метрика по таблицам — как сейчас. Импорт `captureError` убрать. Шапка — v1.34. `run()` возвращает `{ran: outcome === 'done'}` (стр. 147), поэтому ошибка таблицы теперь даёт `{ran: false}`. TSDoc `run()`: «`false` — замок у другой реплики, остановка или ошибка прохода». В тестах задачи занятый замок отличать от сбоя по логам: `debug` «очистка сообщений: другая реплика», нет `error`/`warn` серии. Одного `ran` для этого мало.
  - Логи: `debug` ошибки таблицы. Серия — `backgroundFailed`. `info` прохода таблицы — как сейчас.

- [ ] **Task 9: очистка идемпотентности — серия `idempotency-cleanup`** — §3.3а стр. 117, R9 (depends on 5)
  - **Skill:** nestjs-code generic src/idempotency/kit-idempotency.module.ts (MODIFY); nestjs-code test integration idempotency ac-4-14-cleanup (MODIFY) → `test/integration/idempotency/ac-4-14-cleanup.spec.ts`
  - Тест (сначала, на rc.10): `AC-5.24: ошибка прохода очистки идемпотентности → серия idempotency-cleanup: error, затем warn с failures 2; выполненный проход закрывает серию (info); verdeect_background_failures_total{task="idempotency-cleanup"} +2`.
    - Общую БД `kit` не трогать (проект `shared`, параллельные файлы). Ошибка — scratch-БД и функция с `RAISE EXCEPTION`, как существующий тест стр. 111–129 (`createScratchDatabase`, `createStand({url: scratch.url})`, `adminAt`).
    - Серия общая на процесс, а в `shared` модули общие между файлами (`isolate: false`): прежний сбой (в том числе тест стр. 111) мог оставить серию открытой. Начало теста — `cleanup.run()` обычного стенда (`createStand()`), закрывает возможную серию. Затем два `broken.cleanup.run()` — `error`, затем `warn` с `failures: 2` у логгера `broken`. Затем `cleanup.run()` обычного стенда — `info` «фоновая задача: серия сбоев закрыта» с `failures: 2` у его логгера.
    - Логи — `createStand({overrides: [{provide: KIT_LOGGER, useValue: memoryLogger().logger}]})` (`memoryLogger` из `test/support/messaging.ts`; `IdempotencyCleanup` берёт `KIT_LOGGER`, `kit-idempotency.module.ts` стр. 88).
    - Метрика — прирост по `broken.metrics` (счётчик процесса).
    - Без `initFakeSentry`: файл в проекте `shared`, событие не проверяется (проверено AC-2.16 и AC-5.24 relay).
    - Существующий тест стр. 111 «AC-9.5: ошибка БД во время прохода → result="error", error-лог, captureError» переименовать в «… → result="error", серия idempotency-cleanup». В отчёт «было → стало, основание §3.3а стр. 117».
    - На rc.10 — нет `warn` и метрики, падает.
  - Код: `CleanupLog` и адаптер (стр. 60–67) — плюс `warn`. В `pass()` — `catch`: метрика `cleanupRuns` `error` как сейчас и `backgroundFailed('idempotency-cleanup', error, this.log)` вместо `log.error` + `captureError`. После выполненного прохода — `backgroundSucceeded`. `'busy'` — ничего. Импорт `captureError` убрать. Шапка — v1.34.
  - Логи: из функций серии. `info` прохода — как сейчас.

### Фаза 3: тест AC-3.9

- [ ] **Task 10: AC-3.9 ws — ожидание `server.close` событием, мутация** — R11
  - **Skill:** nestjs-code generic test/fixtures/http/shutdown-app.mjs (MODIFY); nestjs-code test timing http ac-3-9-shutdown (MODIFY) → `test/timing/http/ac-3-9-shutdown.spec.ts`
  - Фикстура: в переопределённом `httpServer.close` (стр. 44–52) первой строкой — запись в stdout `{"msg":"http: server.close","listening":…}` с переводом строки, затем прежнее. Шапку фикстуры дополнить (R11).
  - Тест ws (стр. 245–276):
    - вместо `poll` — промис «строка `"http: server.close"` появилась в выводе». Обработчик `data` stdout в `start()` уже копит `output`. Добавить в `Started` функцию «ждать строку с фрагментом»: проверка накопленного и подписка на `data`, отказ по `exited`;
    - после строки — `probeNewConnection(app.port)` → `code === 'ECONNREFUSED'`. Если `ECONNRESET` с `handshake`, сразу без паузы второй пробник → `ECONNREFUSED` (R11, гонка с очередью listen). Иное — падение;
    - порядок: индекс `"ws: 1001 отправлен"` в `output()` больше −1 и меньше индекса `"http: server.close"`;
    - `polled.okRefused` и вызов `poll` убрать. Ожидания кода 1001, `listening: true`, выхода 0 в срок, отсутствия `SHUTDOWN_TIMEOUT` — оставить;
    - имя теста — прежнее; `TIMEOUT_MS`, `DRAIN_MS`, `POLL_MS` не менять.
  - Мутация (обязательно, в отчёт): в `src/observability/lifecycle.ts` (шаг 2, стр. ~182) временно поменять этапы 2a/2b местами (участник `http` пакета раньше участников сервиса). Запустить `pnpm vitest run -c vitest.timing.config.ts test/timing/http/ac-3-9-shutdown.spec.ts -t "WebSocket"` — тест падает (порядок строк или 1005), вывод — в отчёт. Откатить мутацию (`git diff src/observability/lifecycle.ts` пуст), повторный прогон — зелёный.
  - Логи: строка stdout фикстуры.

### Фаза 4: документация и выпуск

- [ ] **Task 11: README и AGENTS.md** — §3.2–§3.8 v1.33, AC-9.3 (depends on 1–9)
  - **Skill:** none (Markdown)
  - `README.md`:
    1. «Наблюдаемость» (стр. 125–210, рядом с абзацем `captureError`/`captureThrottled` стр. 208): `backgroundFailed(task, err, logger)` / `backgroundSucceeded(task, logger)`:
       - серия (таблица R6);
       - формат `task`, закрытого списка нет;
       - пропуск прохода — не вызывать ни одну;
       - серия на процесс — при N репликах до N событий;
       - логгер pino-стиля, адаптер Nest `Logger` — короткий пример в тексте;
       - метка `task`, а не `job`: `job` при сборе ставят Prometheus и vmagent (имя задания сбора), метка приложения стала бы `exported_job` (§3.2 v1.34);
       - счётчик сбоев — на процесс, как серия: два приложения в одном процессе показывают одно значение (`collect()`), тесты сравнивают прирост;
       - метрика `verdeect_background_failures_total{task}` и правило `VerdeectBackgroundFailures` (порог `verdeect_kit_threshold:background_failures`);
       - `task` пакета: `outbox-relay`, `messaging-cleanup`, `idempotency-cleanup`.
    2. «Сообщения» (стр. 481–581; политика outbox — стр. 508, `add` и `actor` — стр. 535, очистка — стр. 578):
       - вторая политика `outbox_tenantless_insert` при `tenantNullable: true` (R1, R2);
       - сервису с `tenantNullable: true` — сгенерировать миграцию `drizzle-kit generate` после обновления пакета (у `NOT NULL` миграции не меняются);
       - `add(tx, Event, {subjectId, data, tenant?})` — таблица R4 кратко;
       - `actor` — `null` пишется как `null`, незаданный ключ пропускается;
       - relay: при недоступной БД `verdeect_outbox_pending`/`verdeect_outbox_lag_seconds` замирают на последнем значении, сигнал аварии — `verdeect_background_failures_total{task="outbox-relay"}`;
       - очистка — серия `messaging-cleanup`.
    3. «Идемпотентность» (абзац очистки — стр. 479): очистка — серия `idempotency-cleanup`.
    4. «Тесты сервиса» (стр. 639+), `assertStrictTenantIsolation`: у nullable `outbox` — две политики, иная или лишняя — ошибка.
    5. Раздел `## API`:
       - `### @verdeect/kit/observability` (стр. 905): строки `backgroundFailed`, `backgroundSucceeded`, `KitBackgroundLogger` в обратных кавычках (иначе падает `test/package/ac-9-3-docs.spec.ts:119`);
       - `### @verdeect/kit/messaging` (стр. 1010): описание `OutboxStore` — `add(…, {tenant?})`; `createOutboxTable` (стр. 1017) — вторая политика при `true`;
       - `### @verdeect/kit/testing`: `assertStrictTenantIsolation` — две политики;
       - `### @verdeect/kit/database`: `DbContext` — `actor` с `null`.
  - `AGENTS.md`, строка «Состояние» (стр. 21): последний опубликованный выпуск — `1.0.0-rc.10`, готовится `1.0.0-rc.11`.
  - Проверка: `pnpm vitest run -c vitest.package.config.ts test/package/ac-9-3-docs.spec.ts` (после задачи 13 — и CHANGELOG).
  - Логи: нет.

- [ ] **Task 12: `docs/releasing.md` — аннотированный тег** — R12
  - **Skill:** none (Markdown); nestjs-code test unit package ac-9-3-docs (MODIFY) → `test/package/ac-9-3-docs.spec.ts`
  - Тест (сначала): в списке фрагментов `NFR-6: docs/releasing.md …` (стр. 211–222) `'git tag v'` → `'git tag -a v'`, плюс `'git cat-file -t'`. На тексте rc.10 падает.
  - `docs/releasing.md`:
    - шаг 4 (стр. 27–34) — команды R12 и абзац «проверка: `git cat-file -t vX.Y.Z` выводит `tag`; `commit` — тег лёгкий: удалить локально (`git tag -d`) и в origin (`git push origin :refs/tags/vX.Y.Z`), поставить `git tag -a`»;
    - «Первый выпуск», шаг 2 (стр. 86) — `git tag -a v1.0.0-rc.1 -m "1.0.0-rc.1"`.
  - Логи: нет.

- [ ] **Task 13: CHANGELOG и версия** — G14, NFR-5 (depends on 10, 11, 12)
  - **Skill:** none (Markdown, JSON)
  - `CHANGELOG.md`: `## [1.0.0-rc.11] - 2026-11-16` под `## [Unreleased]`, по образцу rc.10:
    - строка-источник: «Находки Identity ID-68, ID-69 и Orchestrator OR-214, К35, сверка KT-120 (PRD v1.33–v1.34, r28–r29).»
    - `### Added` — имена экспортов в виде `` `Name` ``:
      - `backgroundFailed`, `backgroundSucceeded`, `KitBackgroundLogger`;
      - метрика `verdeect_background_failures_total{task}` и правило `VerdeectBackgroundFailures`;
      - `OutboxStore.add(…, {tenant?})`;
      - политика `outbox_tenantless_insert`.
    - `### Changed`:
      - `'none'` — всегда `null` при любом тенанте транзакции (раньше — ошибка при тенанте);
      - `'required'` — `tenant` вызова;
      - `actor` с `null`;
      - `assertStrictTenantIsolation` — две политики при nullable;
      - relay и очистки — серия сбоев вместо `captureThrottled`/`captureError` на каждом проходе;
      - ошибка таблицы очистки сообщений — `debug` и сбой прохода.
    - `### Fixed`: тест AC-3.9 (ws) без опроса; `docs/releasing.md` — аннотированный тег.
    - `### Как перейти`:
      - сервис с `createOutboxTable(…, {tenantNullable: true})` генерирует миграцию `drizzle-kit generate` — новая политика `outbox_tenantless_insert` (у `NOT NULL` миграций нет);
      - вызовы `add` события `'none'` в транзакции с тенантом теперь пишут строку с `null` — уберите обходы (транзакция без тенанта ради события);
      - Orchestrator: `orchestrator_background_failures_total` → `verdeect_background_failures_total` (метка `job` → `task`: обновить свои запросы и панели; правило алерта — из шаблона пакета, своё снять), класс `BackgroundFailures` → функции пакета;
      - сигнал аварии relay при недоступной БД — метрика серии, а не `verdeect_outbox_*`.
  - `package.json`: `"version": "1.0.0-rc.11"`.
  - Логи: нет.

### Фаза 5: проверка

- [ ] **Task 14: полная проверка** (depends on 1–13)
  - Команды по одной (правило пользователя: без `&&`):
    1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
    2. `free -h`, `uptime`, `docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}} {{.Label "org.testcontainers"}}'`: available ≥ 3 ГБ, load < 5, нет чужих `verdeect-*-e2e` и контейнеров Testcontainers. Иначе — стоп и сообщить пользователю;
    3. `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check).
  - Падения не маскировать подъёмом сроков. Правки существующих тестов — только по изменению поведения v1.33–v1.34, каждая — в отчёт (файл, было → стало, основание).
  - Отчёт: список новых тестов с итогом на rc.10 (как упал; исключения AC-5.2 runtime и AC-3.9 — с объяснением и итогом мутации).
  - Соседние репозитории не трогать.

## Traceability

| UC/AC | Задачи | Тест |
|---|---|---|
| UC-1, AC-4.8 (политика фабрики) | 1 | `test/unit/messaging/tables.spec.ts` — `AC-4.8: createOutboxTable({tenantNullable: true}) — две политики …`, `AC-4.8: createOutboxTable() … — одна политика` |
| UC-1, AC-4.8 (проверка и RLS) | 1, 2 | `test/integration/testing/ac-4-8-strict-isolation.spec.ts` — `AC-4.8: outbox … с двумя политиками проходит`, `AC-4.8: под тенантом acme вставка строки outbox с tenant null проходит …`, `AC-4.8: лишняя политика …`, `AC-4.8: nullable outbox без outbox_tenantless_insert …`, `AC-4.8: outbox_tenantless_insert с иным WITH CHECK …`, `AC-4.8: outbox NOT NULL … с outbox_tenantless_insert …`, `AC-4.8: outbox NOT NULL без outbox_tenantless_insert — проходит` |
| UC-5, UC-6, AC-5.15 | 3 | `test/integration/messaging/ac-5-15-outbox-tenant.spec.ts` — 6 тестов `AC-5.15: …` (R4) |
| UC-5, AC-5.2 | 4 | `test/unit/database/ac-5-2-db-context.test-d.ts`; `test/integration/messaging/ac-5-2-outbox-row.spec.ts` — `AC-5.2: контекст с actor {clientId: null, channel: 'system'} …` |
| UC-13, AC-2.16 | 5 | `test/unit/observability/ac-2-16-background-failures.spec.ts` — 6 тестов `AC-2.16: …` |
| AC-2.8 (метрики пакета) | 5 | `test/unit/observability/ac-2-8-metrics.spec.ts` |
| AC-2.11 (правило алерта) | 6 | `test/package/ac-2-11-alert-rules.spec.ts` (R, `make pack-check`) |
| UC-5, UC-9, AC-5.24 (relay) | 7 | `test/integration/messaging/ac-5-24-background-failures.spec.ts` — `AC-5.24: БД недоступна (закрытый порт, tcpProxy.break — ECONNREFUSED) — N = 3 прохода relay …` |
| UC-9, AC-5.24 (очистка сообщений) | 8 | тот же файл — `AC-5.24: проход очистки с ошибкой БД …`, `AC-5.24: проход с занятым замком …`, `AC-5.24: ошибка одной таблицы …` |
| UC-9, §3.3а (очистка идемпотентности) | 9 | `test/integration/idempotency/ac-4-14-cleanup.spec.ts` — `AC-5.24: ошибка прохода очистки идемпотентности …` |
| UC-8, AC-3.9 (ws, дефект CI №37) | 10 | `test/timing/http/ac-3-9-shutdown.spec.ts` — `AC-3.9: участник шага 2 закрывает WebSocket кодом 1001 …` + мутация шага 2 |
| NFR-6 (`docs/releasing.md`) | 12 | `test/package/ac-9-3-docs.spec.ts` — `NFR-6: docs/releasing.md …` |
| AC-9.3 (README, CHANGELOG) | 11, 13 | `make test-full` (уровень R) |
