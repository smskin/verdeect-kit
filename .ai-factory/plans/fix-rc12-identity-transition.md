# План реализации: выпуск `1.0.0-rc.12` — итоги перехода Identity (r30, PRD v1.35)

Mode: full
Branch: fix/rc12-identity-transition
Created: 2026-11-17

## Original Request
Выпуск 1.0.0-rc.12 по пакету требований requirements/0000-kit/ (ревизия r30, PRD v1.35). Ветка fix/rc12-identity-transition (r30 — первым коммитом). Выпуск — последний под @verdeect/kit на npmjs (переезд в GitLab — отдельной ревизией, в скоуп не входит).

Скоуп:
1. §3.1, §3.2: InvalidEnvironmentError.issues: readonly {key, message}[] — message схемы; страховка: фрагмент ≥ 8 символов строкового значения ключа верхнего уровня в message → «неверное значение (<code issue>)»; Error.message — только ключи; failStartup — issues в fatal-лог и extra GlitchTip; одна функция разбора ошибок окружения для всех команд CLI (заменить 5 копий в cli/commands/db, crypto, redis, rabbitmq, openapi), JSON {error: {code: 'INVALID_ENVIRONMENT', keys, issues}}, (root) везде; README — правило «message схемы без значения»; AC-1.3.
2. §3.8: подпуть ./testing/images {types, default} по образцу ./testing/timeout-scale, реэкспорт из /testing сохранить, imageRepository перенести в repo-conventions.ts; AC-9.6 на оба подпути, проба в test/consumer (import-check.mjs, ожидания ac-9-1-consumer).
3. §3.5: экспорт типов PageQuery (z.output<typeof PageQuerySchema>) и CursorValue из /http; проверка в тесте экспортов/типов.
4. §3.4: 406 PRECONDITION_FAILED на объявление своих очередей (<svc>, <svc>.retry, <svc>.dlq) — как TTL: при старте отказ MessagingStartupError MESSAGING_QUEUE_MISMATCH «очередь <имя> объявлена с другими параметрами — пересоздайте очередь», после запуска — error + GlitchTip, канал закрыт без повторов; MESSAGING_RETRY_TTL_MISMATCH для TTL сохранить; README «Как перейти»; AC-5.19.
5. §3.5 keyset: проверки timestamp без зоны (ISO без зоны), date (YYYY-MM-DD), numeric (десятичная строка или конечное число), real/double (конечное число), enum (enumValues); now/today/infinity/epoch/NaN — 422; прочие типы (массив, jsonb, interval, bigint mode bigint) — ошибка разработчика при вызове afterCursor; pageOf кодирует timestamp/date в ISO (проверить mode столбца); «Как перейти» — сортировка по неподдержанному типу теперь ошибка; AC-3.6.
6. AC-5.24 — текст уже по факту (закрытый порт), код не менять, только сверить имя/описание теста.
7. CHANGELOG [1.0.0-rc.12] с «Как перейти» (K-4: очередь, объявленная прежним кодом с другими параметрами, в т. ч. TTL .retry ≠ RABBITMQ_RETRY_SECONDS — пересоздать до первого запуска; курсор; issues в ошибке окружения), version 1.0.0-rc.12.

Тесты без реальных пауз; каждый новый тест должен падать на коде rc.11 — проверь и перечисли в отчёте; правки существующих тестов — «было → стало». Соседние репозитории — только чтение (git show/log/diff, без checkout, pull, fetch), их контуры не поднимать и не останавливать — только с разрешения их чата. Перед test-full — free -h, uptime (свободно ≥ 3 ГБ, load < 5), чужих verdeect-*-e2e и Testcontainers нет; иначе сообщи и не запускай. Источник истины — requirements/0000-kit/prd.md; код rc.11 — существующий, без переделок вне скоупа. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes. Уровни тестов — по столбцу AC в `prd.md` §5:
  - AC-1.3 — U (`test/unit/config`, `test/unit/cli`);
  - AC-2.9 (сопутствующий, `failStartup`) — U (`test/unit/observability`);
  - AC-3.6 — I (`test/integration/http`) и U (`test/unit/http/pagination.spec.ts`, `test-d` типов);
  - AC-5.19 — I (`test/integration/messaging`);
  - AC-9.6 — R (`test/package`), C (`test/consumer/minimal`), сопутствующий U `test/unit/package/package-manifest.spec.ts`;
  - AC-9.3 — R (README, CHANGELOG).
- Каждый новый тест пишется первым и запускается на коде rc.11. Падение (ошибка импорта, типа или поведения) фиксируется в отчёте реализации: файл, тест, как упал. Исключение известно заранее: AC-5.24 — тест не меняется (задача 9), запуск на rc.11 не нужен.
- Правки существующих тестов — только по изменению поведения v1.35, каждая в отчёт: файл, тест, «было → стало», основание.
- Реальных пауз нет. Брокер в AC-5.19 — настоящий контейнер стенда; ожидания — по событиям логов и существующим окнам наблюдения файла `ac-5-19-broker-down.spec.ts`, сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino`/`Logger` Nest, без `console.*` (NFR-8, AC-9.4). Конкретные строки — в задачах.
- Docs: no. Обязательного чекпоинта `/aif-docs` нет (`WARN [docs]`). README, `AGENTS.md`, `ARCHITECTURE.md`, CHANGELOG и версию обновляют задачи 10–11 («Library Package Scope» (7), AC-9.3).
- Настройки — как в rc.11 (ответ пользователя от 17.11.2026).

## Roadmap Linkage
Milestone: "none"
Rationale: вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по итогам перехода Identity (ID-76) и сверке KT-133 (G14). Отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.35 (r30) > ответы пользователя на вопросы плана (17.11.2026) > текст запроса > `ARCHITECTURE.md` / `DESCRIPTION.md`.

Скоуп — изменения v1.35 относительно v1.34:
- §3.1 `parseEnv` (стр. 63), §3.2 `failStartup` (стр. 86);
- §3.4 `KitMessagingModule.forRoot` — расхождение аргументов своих очередей (стр. 130);
- §3.5 keyset и типы `PageQuery`, `CursorValue` (стр. 149);
- §3.8 `TEST_IMAGES` — подпуть `./testing/images` (стр. 185);
- AC-1.3, AC-3.6, AC-5.19, AC-5.24 (только сверка), AC-9.6;
- сопутствующие проверки: AC-2.9, AC-9.3, AC-1.1 (состав `exports`).

Код rc.11 — существующий: расширять, не переписывать. Вне скоупа: переезд в GitLab, объединение классов `CommandError` команд CLI.

**Расхождение с буквой PRD (решение пользователя, вопрос 3, 17.11.2026).** PRD стр. 149: «`pageOf` кодирует значения `timestamp`/`date` в том же формате ISO». `pageOf(rows, limit, keyOf)` не знает типов столбцов, а JS `Date` у `timestamptz`, `timestamp` и `date` неразличим. Решено: сигнатура `pageOf` не меняется, ключи `timestamp`/`date` берутся через `cursorTimestamp` (R9). Текст PRD — сообщить чату «`@verdeect/kit`» в отчёте; файлы `requirements/` план не меняет.

**Q1 — решён (ответ пользователя 17.11.2026): вариант (а).** `PgCustomColumn`, у которого `getSQLType()` оканчивается на `citext` (со схемой или без, например `identity"."citext`), проверяется как строка (та же проверка, что `text`/`varchar`). Прочие пользовательские типы — ошибка разработчика в `afterCursor`. Текст PRD (стр. 149, `cursorTimestamp`) поправят в следующей ревизии, код не ждёт. Контекст вопроса — Identity сортирует по такому столбцу:
- `verdeect-identity/apps/identity/src/shared/database/columns.ts:10` — `citext` = `customType<{ data: string }>`, `dataType()` возвращает `'identity"."citext'`;
- `account.email` (`account-service/schema/account.schema.ts:7`, unique);
- `afterCursor([account.email], query.cursor, 'asc')` в `account-service/repositories/account.repository.ts:105`.

На rc.11 это работает (неизвестный тип не проверялся). Без решения после задачи 6 список аккаунтов Identity упал бы. Решение внесено в R8, таблицу комбинаций, тесты задачи 6 и «Как перейти» задачи 11.

| # | Решение | Источник | Задачи |
|---|---|---|---|
| R1 | `InvalidEnvironmentError.issues` — `readonly {readonly key: string; readonly message: string}[]`. **Ответ пользователя: запись на каждый issue zod**, в порядке issues. `key` — тот же путь, что в `keys` (полный через точку, без пути — `(root)`). `keys` — уникальные `key` из `issues` в порядке первого появления (как сейчас). Конструктор принимает `issues`, `keys` выводятся из них; `Error.message` — «Неверное окружение: <keys через запятую>», как сейчас. Тип записи — публичный `KitEnvironmentIssue` | §3.1 стр. 63, AC-1.3; ответ пользователя | 1 |
| R2 | Страховка в `parseEnv`. Для issue с путём проверяется строковое значение ключа верхнего уровня: `env[первый сегмент пути]`, если это строка. **Ответ пользователя: для `(root)` — все строковые значения переданного `env`.** Проверка: значение длиной ≥ 8, и в `message` есть хотя бы одна его подстрока длиной 8 (скользящее окно). Тогда `message` = «неверное значение (<issue.code>)», например «неверное значение (custom)». Значение короче 8 — без замены. Нестроковые значения не проверяются. ponytail-комментарий: окно 8 символов — O(длина значения) проверок `includes` на issue, для окружения сервиса достаточно | §3.1 стр. 63; запрос п. 1; ответ пользователя | 1 |
| R3 | `failStartup` для `InvalidEnvironmentError`: `fatal`-лог `{code, keys, issues}` с прежним текстом; событие GlitchTip — тег `code` как сейчас и `extra: {issues}`. Текстов zod, кроме `issues` после страховки, нет | §3.2 стр. 86 | 2 |
| R4 | CLI. Новый файл `src/cli/environment.ts` — одна функция разбора ошибки окружения для всех команд: `environmentFailure(error)` возвращает для `InvalidEnvironmentError` объект `{code: 'INVALID_ENVIRONMENT', message: 'Неверное окружение', keys, issues}`, иначе `undefined`. **Ответ пользователя: поле `message` остаётся.** Команды разбирают свои схемы через `parseEnv` из `src/config/parse-env.ts`: статический импорт файла без зависимостей, CLI по-прежнему грузится без `pg`, `ioredis`, `amqplib`. Пять копий разбора (`db.ts` — `invalidEnvironment` и локальная `parseEnv`; `crypto.ts`, `redis.ts`, `rabbitmq.ts`, `openapi.ts` — блоки в `createLogger`) удаляются. `failureOf` каждой команды (у `openapi` — ветка в `openapiCommand`) сначала вызывает `environmentFailure`. Поэтому и `InvalidEnvironmentError` из модуля сервиса при `openapi --module` даёт тот же JSON. `(root)` — из `parseEnv` | §3.1 стр. 63, AC-1.3; запрос п. 1; ответ пользователя | 3 |
| R5 | Проверки хешей без zod остаются в командах (`CommandError` с `INVALID_ENVIRONMENT`), к `keys` добавляются `issues` — по записи на ключ. **Ответ пользователя:** `rabbitmq definitions` — `message` записи «ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)» (общий `message` ошибки прежний, с именами ключей); `redis acl` — «ожидается sha256 hex (64 символа)» (общий `message` прежний, «Неверное окружение»). Значений в тексте нет | AC-1.3 («любой команды CLI»); ответ пользователя | 3 |
| R6 | Подпуть `./testing/images`: запись `exports` `{types: './dist/testing/images.d.ts', default: './dist/testing/images.js'}` сразу после `./testing/timeout-scale`, перед `./testing`. `src/testing/images.ts` — только `TEST_IMAGES`, без импортов. `imageRepository` переносится в `src/testing/repo-conventions.ts` (единственный пользователь в `src/`), экспорт из файла для unit-теста, не из `index.ts`. Реэкспорт `TEST_IMAGES` из `/testing` сохраняется | §3.8 стр. 185, AC-9.6 | 4 |
| R7 | `/http`: `export type { CursorValue, Page, PageQuery }`. `PageQuery` — `z.output<typeof PageQuerySchema>` в `pagination.ts` с TSDoc | §3.5 стр. 149 | 5 |
| R8 | `afterCursor` — проверка курсора по типу столбца (`columnType` Drizzle 0.45), список поддержанных — закрытый: `PgTimestamp`/`PgTimestampString` с зоной — строгая ISO 8601 с зоной (как сейчас); без зоны — строгая ISO 8601 без `Z` и смещения; `PgDate`/`PgDateString` — `YYYY-MM-DD` с проверкой календарной даты; `PgUUID` — UUID; целые (`PgInteger`, `PgSmallInt`, `PgSerial`, `PgSmallSerial`, `PgBigInt53`, `PgBigSerial53`) — безопасное целое; `PgNumeric`, `PgNumericNumber` — десятичная строка `^[+-]?\d+(\.\d+)?$` или конечное число; `PgReal`, `PgDoublePrecision` — конечное число; `PgBoolean`; `PgText`, `PgVarchar`, `PgChar` и **`PgCustomColumn` с `getSQLType()`, оканчивающимся на `citext`** (ответ пользователя, Q1) — строка; `PgEnumColumn`, `PgEnumObjectColumn` — строка из `enumValues` столбца. Особые значения (`now`, `today`, `infinity`, `epoch`, `NaN`) не проходят форматы — 422 без отдельного списка. Несовпадение — 422 `VALIDATION_FAILED` `path: cursor` до запроса к БД, как сейчас. Любой другой `columnType` (`PgArray`, `PgJson`, `PgJsonb`, `PgInterval`, `PgBigInt64`, `PgBigSerial64`, **`PgNumericBigInt` — ответ пользователя: не поддержан**, `PgTime`, `PgInet`, `PgCidr`, `PgMacaddr*`, `PgPoint*`, `PgLine*`, `PgCustomColumn` с иным типом) — `Error` «afterCursor: столбец <name> (<columnType>) не поддержан курсором keyset». Ошибка — при каждом вызове, в том числе с `cursor = null`, сразу после проверки уникального последнего ключа. Приведение параметра в SQL: `timestamptz`/`timestamp` — как сейчас, `date` — `::date`, остальные — без приведения | §3.5 стр. 149, AC-3.6; ответ пользователя | 6 |
| R9 | **Ответ пользователя: `cursorTimestamp` для трёх типов.** `cursorTimestamp(col)`: `timestamptz` — прежний SQL (`to_char(col AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`); `timestamp` без зоны — `to_char(col, 'YYYY-MM-DD"T"HH24:MI:SS.US')`; `date` — `to_char(col, 'YYYY-MM-DD')`; иначе `TypeError` «cursorTimestamp: столбец <name> — не timestamp, timestamptz или date». Работает при любом `mode` столбца: значение берётся из БД, а не из JS `Date` (у `mode: 'date'` микросекунды теряются, а `JSON.stringify(Date)` даёт ISO с `Z`; у `mode: 'string'` текст PostgreSQL с пробелом — не ISO). Сигнатура и код `pageOf` не меняются; TSDoc `pageOf` — ключи `timestamp`/`timestamptz`/`date` берите через `cursorTimestamp` | §3.5 стр. 149; ответ пользователя | 6 |
| R10 | `MESSAGING_QUEUE_MISMATCH`. В `setupQueues` (`subscriber.ts`) каждое из трёх объявлений (`q.main`, `q.retry`, `q.dlq`) обёрнуто одинаково. Ответ брокера 406 (`code === 406`): у `.retry` с `x-message-ttl` в тексте ответа — прежний `MESSAGING_RETRY_TTL_MISMATCH`, иначе — `MessagingStartupError('MESSAGING_QUEUE_MISMATCH', 'очередь <имя> объявлена с другими параметрами — пересоздайте очередь', {queue: <имя>})`. Другие ошибки пробрасываются как сейчас. Временная очередь реплики — не «своя очередь» PRD, не меняется. Дальше путь общий с TTL, кода в `rabbit-connection.ts` нет: `onSetupFailed` уже обрабатывает любой `MessagingStartupError` как фатальный. При старте — отказ `onApplicationBootstrap`, после запуска — `error`-лог, `captureError`, канал без повторов. `failStartup` второе событие не шлёт (`captureError` помнит отправленные). `MessagingStartupCode` — плюс `'MESSAGING_QUEUE_MISMATCH'` | §3.4 стр. 130, AC-5.19 | 7 |
| R11 | Тексты README и CHANGELOG «Как перейти» по очередям. В README нет раздела «Как перейти»: текст идёт пунктом в «Развёртывание» рядом со «Сменой TTL `.retry`» и ссылкой из «Сообщений». Порядок: остановить реплики, разобрать или переложить сообщения, удалить очередь, запустить. В CHANGELOG — раздел `### Как перейти` выпуска | §3.4 стр. 130; запрос п. 4, 7 | 10, 11 |

Комбинации объявления своих очередей (R10):

| Очередь | Ответ брокера | Когда | Итог |
|---|---|---|---|
| `<svc>.retry` | 406, текст с `x-message-ttl` | старт, брокер доступен | отказ `MESSAGING_RETRY_TTL_MISMATCH` (как rc.11) |
| `<svc>.retry` | 406 по другому аргументу | старт | отказ `MESSAGING_QUEUE_MISMATCH`, `queue: <svc>.retry` |
| `<svc>` | 406 | старт | отказ `MESSAGING_QUEUE_MISMATCH`, `queue: <svc>` |
| `<svc>.dlq` | 406 | старт | отказ `MESSAGING_QUEUE_MISMATCH`, `queue: <svc>.dlq` |
| любая своя | 406 | после запуска (подключение позже старта) | `error`-лог «rabbitmq: фатальная ошибка настройки канала, повторов не будет», одно событие GlitchTip, новых объявлений нет |
| любая своя | не 406 | любое | как rc.11 (сбой настройки, повтор) |

Комбинации типа столбца курсора (R8, R9):

| Тип столбца | Значение ключа принимается | 422 (примеры) | Ключ для `keyOf` |
|---|---|---|---|
| `timestamptz` | ISO с зоной | `42`, `"abc"`, `"now"`, `"2026-11-10"` | `cursorTimestamp` |
| `timestamp` | ISO без зоны | `"now"`, `"…Z"`, `"…+03:00"`, `"epoch"` | `cursorTimestamp` |
| `date` | `YYYY-MM-DD` | `"infinity"`, `"today"`, `"2026-02-30"`, `"2026-11-10T00:00:00"` | `cursorTimestamp` |
| `numeric` (string, number) | десятичная строка, конечное число | `"abc"`, `"NaN"`, `"1e3"`, `true` | значение строки |
| `real`, `double precision` | конечное число | `"1.5"`, `"NaN"` | значение строки |
| enum | строка из `enumValues` | вне списка, `1` | значение строки |
| `uuid`, целые, `boolean`, строки | как rc.11 | как rc.11 | значение строки |
| `citext` (`customType`, Q1) | строка | `42`, `true` | значение строки |
| массив, `jsonb`, `json`, `interval`, `bigint`/`numeric` в режиме `bigint`, иной `customType`, прочие | — | — | `Error` при вызове `afterCursor` |

## Commit Plan
- **Commit 0** — выполнен: d22fb68 `docs(requirements): r30 — PRD v1.35, итоги перехода Identity`. Повторять не нужно.
- **Commit 1** (после 1–3): `feat(config): issues в ошибке окружения, единый разбор окружения CLI (AC-1.3)`
- **Commit 2** (после 4): `feat(testing): подпуть testing/images (AC-9.6)`
- **Commit 3** (после 5–6): `feat(http): типы PageQuery и CursorValue, проверка курсора по типу столбца (AC-3.6)`
- **Commit 4** (после 7–9): `fix(messaging): MESSAGING_QUEUE_MISMATCH при расхождении аргументов своих очередей (AC-5.19)`
- **Commit 5** (после 10): `docs: README, AGENTS.md, ARCHITECTURE.md — rc.12`
- **Commit 6** (после 11): `chore(release): 1.0.0-rc.12` (только `CHANGELOG.md` и `package.json`, как `dd5b27d`)

## Tasks

### Фаза 1: ошибка окружения — `/config`, `/observability`, CLI

- [x] **Task 1: `InvalidEnvironmentError.issues` и страховка от значения** — §3.1 стр. 63, AC-1.3, R1, R2
  - **Skill:** nestjs-code generic src/config/parse-env.ts (MODIFY); nestjs-code generic src/config/index.ts (MODIFY); nestjs-code test unit config ac-1-3-parse-env (MODIFY) → `test/unit/config/ac-1-3-parse-env.spec.ts`, `test/unit/config/support.ts`
  - Тесты (сначала, на rc.11), `ac-1-3-parse-env.spec.ts`:
    - `AC-1.3: z.undefined({error: 'IDENTITY_PORT заменён на PORT'}) → issues [{key: 'IDENTITY_PORT', message: 'IDENTITY_PORT заменён на PORT'}]`. Схема — `defineEnv` с этим ключом, `env` с `IDENTITY_PORT: '3000'`. На rc.11 `issues` нет — падает;
    - `AC-1.3: superRefine с текстом, содержащим значение ключа (≥ 8 символов) → message «неверное значение (custom)», значения нет в message, keys, issues и JSON.stringify(error)`. Ключ `DATABASE_URL` = `'postgres://u:SECRET_MARKER_9@h/db'`, `superRefine` добавляет issue с путём `['DATABASE_URL']` и текстом, куда вставлен фрагмент значения из 8 символов (`SECRET_M`). На rc.11 падает (нет `issues`);
    - `AC-1.3: ошибка уровня корня с фрагментом значения любого ключа → key (root), message заменён` (ответ пользователя R2). `superRefine` без пути, в тексте — 8 символов значения `REDIS_URL`;
    - `AC-1.3: значение короче 8 символов в message — message схемы без замены`. `PORT: 'abc'`, текст `superRefine` «PORT abc — не число» остаётся;
    - `AC-1.3: несколько issue одного ключа — запись на каждый issue, keys без дублей`. Пример `LIST.0` (min и regex) из теста «несколько ошибок»: в `issues` две записи `LIST.0`, у каждой `message` схемы;
    - `AC-1.3: Error.message — только имена ключей` — существующий тест «InvalidEnvironmentError — code …» уже проверяет `message`. Добавить `expect(error.message).not.toContain(<message issue>)`.
  - `support.ts`, `expectKeysOnly`: в строку проверки добавить `JSON.stringify(error.issues)`, плюс проверка `issues` по ключу. «Было → стало»: существующие тесты AC-1.3 теперь проверяют и `issues`. На rc.11 `JSON.stringify(undefined)` даёт `undefined` — проверка подстрок проходит, падают новые тесты.
  - Код `parse-env.ts`:
    - тип `KitEnvironmentIssue` с TSDoc полей;
    - класс — поле `issues`, конструктор по R1, TSDoc: значений нет, `message` схемы после страховки; TSDoc конструктора — принимает `issues` (`KitEnvironmentIssue[]`), `keys` выводятся из них, `message` записи — без значения ключа (сервисы создают ошибку сами: BFF `env.ts`, Platform `run-cli.ts`, `owner-db.ts`, Orchestrator `run-cli.ts`, `env.schema.ts`);
    - внутренние функции: путь issue (как `issueKeys`), страховка `safeMessage` по R2, построение `issues`;
    - `parseEnv` передаёт `env` в построение `issues`. Ошибка zod по-прежнему не сохраняется в `cause` и полях;
    - шапка файла — v1.35.
  - `config/index.ts`: `export type { KitEnvironmentIssue }`.
  - Логи: нет (чистая функция).

- [x] **Task 2: `failStartup` — `issues` в fatal-логе и `extra` GlitchTip** — §3.2 стр. 86, AC-2.9, R3 (depends on 1)
  - **Skill:** nestjs-code generic src/observability/fail-startup.ts (MODIFY); nestjs-code test unit observability ac-2-9-fail-startup (MODIFY) → `test/unit/observability/ac-2-9-fail-startup.spec.ts`
  - Тесты (сначала):
    - тест стр. 60 «AC-2.9: InvalidEnvironmentError — fatal (60) только с именами ключей …» переименовать в «… с именами ключей и issues, без значения; событие с extra.issues отправлено до exit(1)». Ошибка — `new InvalidEnvironmentError([{key: 'METRICS_PORT', message: 'ожидается порт'}, {key: 'DATABASE_URL', message: 'ожидается URL'}])`. Ожидания: запись лога с `keys` и `issues`, в `delivered[0].body` — `extra.issues` с теми же записями. «Было → стало» (конструктор по R1 и новое поле, основание §3.2 стр. 86). На rc.11 падает: конструктор rc.11 примет массив объектов как `keys`, а `issues` в логе нет;
    - тест стр. 155: аргумент конструктора → `[{key: 'PORT', message: 'ожидается число'}]`. «Было → стало», основание R1;
    - `AC-1.3: ошибка parseEnv с текстом superRefine, содержащим значение ключа → в fatal-логе и событии issues с «неверное значение (custom)», значения нет`. Ошибка — из `parseEnv` (схема с `superRefine`, как в задаче 1, значение `DATABASE_URL` с `SECRET_MARKER_9`). Проверки: в записи лога и в `delivered[0].body` есть `issues` с заменённым `message`, подстроки `SECRET_MARKER_9` нет ни в логе, ни в событии. На rc.11 падает: `issues` нет.
  - Код: в ветке `InvalidEnvironmentError` функции `logFailure` — поле `issues` в `fatal`. `failStartup` передаёт в `captureError` `extra: {issues}` только для `InvalidEnvironmentError`, тег `code` как сейчас. TSDoc `failStartup` — `issues`. Шапка — v1.35.
  - Логи: `fatal({code, keys, issues}, 'Неверное окружение — запуск остановлен')`.

- [x] **Task 3: CLI — одна функция разбора ошибки окружения** — §3.1 стр. 63, AC-1.3, R4, R5 (depends on 1)
  - **Skill:** nestjs-code generic src/cli/environment.ts (CREATE); nestjs-code generic src/cli/commands/db.ts, crypto.ts, redis.ts, rabbitmq.ts, openapi.ts (MODIFY — одна правка в пяти связанных файлах одного каталога); nestjs-code test unit cli ac-1-3-cli-environment (CREATE) → `test/unit/cli/ac-1-3-cli-environment.spec.ts`; nestjs-code test unit cli redis-acl-command, ac-5-10-rabbitmq-command (MODIFY); nestjs-code test integration cli ac-5-10-rabbitmq-definitions (MODIFY)
  - Тесты (сначала, на rc.11 — ошибка импорта `src/cli/environment.js` и нет `issues`):
    - `AC-1.3: ошибка окружения каждой команды CLI — JSON {error: {code: 'INVALID_ENVIRONMENT', message, keys, issues}}, значения нет в stdout и stderr`. `it.each` по командам с `LOG_LEVEL = 'loud-SECRET_MARKER_CLI'`:
      - `openapiCommand(['--out', <tmp>])` — окружение через `vi.stubEnv` (команда читает `process.env`; unit-файлы изолированы);
      - `dbCommand(['prepare', '--service', 'svc'], {cwd, write, env})`;
      - `rabbitmqCommand(['definitions', '--services', 'svc-a'], …)`;
      - `redisCommand(['acl', '--services', 'svc-a', '--out', 'users.acl'], …)`;
      - `cryptoCommand(['generate-secret'], …)`.
      - Ожидания: код 1; `error.keys` содержит `LOG_LEVEL`; в `error.issues` есть запись `LOG_LEVEL` с непустым `message`; `SECRET_MARKER_CLI` нет в stdout и в записи `process.stderr` (шпион, как в `redis-acl-command.spec.ts` стр. 110–121).
    - `AC-1.3: environmentFailure — ошибка уровня корня → keys ['(root)'], issues [{key: '(root)', …}]`. Ошибка — из `parseEnv` схемы с `superRefine` без пути. Для не-`InvalidEnvironmentError` — `undefined`;
    - `AC-1.3: environmentFailure — текст superRefine со значением ключа → в JSON issues «неверное значение (custom)», значения нет`. Ошибка — из `parseEnv` (значение `DATABASE_URL` с `SECRET_MARKER_9`). В `JSON.stringify(environmentFailure(error))` нет `SECRET_MARKER_9`, у записи `DATABASE_URL` заменённый `message`. На rc.11 — ошибка импорта.
  - Код:
    - `src/cli/environment.ts` (CREATE): шапка — назначение, `prd.md §3.1 v1.35, AC-1.3`, ARCHITECTURE «CLI». `environmentFailure(error)` по R4, TSDoc. Импорт `InvalidEnvironmentError` — статический из `../config/parse-env.js`;
    - `src/cli/commands/db.ts` (MODIFY): удалить `invalidEnvironment` и локальную `parseEnv`, импорт `zod` оставить, если нужен схеме логгера. Вызовы — `parseEnv` из `../../config/parse-env.js`. В `failureOf` первой — ветка `environmentFailure`;
    - `crypto.ts`, `redis.ts`, `rabbitmq.ts`, `openapi.ts` (MODIFY): блок `safeParse` в `createLogger` → `parseEnv`. `failureOf` (у `openapi` — ветка `catch` в `openapiCommand`) — сначала `environmentFailure`;
    - `redis.ts`, `rabbitmq.ts`: проверка хешей — в `extra` плюс `issues` по R5, тексты записей — константы рядом с проверкой;
    - шапки пяти файлов — v1.35, AC-1.3.
  - Правки существующих тестов («было → стало», основание R4/R5):
    - `test/unit/cli/redis-acl-command.spec.ts` стр. 80–86 (`toEqual`): плюс `issues: [{key: 'REDIS_PASSWORD_HASH_BFF_APP', message: 'ожидается sha256 hex (64 символа)'}]`;
    - `test/unit/cli/ac-5-10-rabbitmq-command.spec.ts` стр. 72–79 и тест стр. 279 (`toEqual`): плюс `issues` с текстом R5;
    - `test/integration/cli/ac-5-10-rabbitmq-definitions.spec.ts` стр. 178–185 (`toEqual`): плюс `issues`;
    - `toMatchObject` (`ac-4-17-db-commands.spec.ts` стр. 167, `ac-5-10-rabbitmq-command.spec.ts` стр. 104) не меняются.
  - Логи: строка `{level: 'error', …failure}` в stderr — как сейчас, теперь с `issues`.

### Фаза 2: подпуть `@verdeect/kit/testing/images`

- [x] **Task 4: `./testing/images`, `imageRepository` в `repo-conventions.ts`** — §3.8 стр. 185, AC-9.6, R6
  - **Skill:** nestjs-code generic src/testing/images.ts (MODIFY); nestjs-code generic src/testing/repo-conventions.ts (MODIFY); none (JSON) → `package.json`; nestjs-code test unit testing test-images (MODIFY) → `test/unit/testing/test-images.spec.ts`; nestjs-code test unit package package-manifest (MODIFY) → `test/unit/package/package-manifest.spec.ts`; nestjs-code test unit package ac-9-6-timeout-scale (MODIFY) → `test/package/ac-9-6-timeout-scale.spec.ts`; nestjs-code test unit package ac-9-1-consumer (MODIFY) → `test/package/ac-9-1-consumer.spec.ts`; none (JS потребителя) → `test/consumer/minimal/import-check.mjs`
  - Тесты (сначала, на rc.11):
    - `package-manifest.spec.ts`: тест стр. 53 «exports — ровно …» — плюс `./testing/images` после `./testing/timeout-scale`, имя теста дополнить. Новый тест `AC-9.6: ./testing/images — {types, default} перед ./testing` по образцу стр. 131. На rc.11 оба падают;
    - `ac-9-6-timeout-scale.spec.ts`: `describe` — «подпути testing/timeout-scale и testing/images», шапка — v1.35. Новые тесты:
      - `AC-9.6: exports содержит ./testing/images с условиями types и default`;
      - `AC-9.6: dist/testing/images.js без импортов` — `specifiersOf` пуст;
      - `AC-9.6: проект-потребитель импортирует @verdeect/kit/testing/images без условия development` — `node -e` печатает `TEST_IMAGES.postgres` → `postgres:17.11-alpine3.24`.
      - На rc.11 падают (нет записи, файла и разрешения);
    - `import-check.mjs`: `probe` получает ожидаемый тип экспорта (по умолчанию `'function'`), новая проба `images:` — `@verdeect/kit/testing/images`, экспорт `TEST_IMAGES`, тип `'object'`. Шапка — плюс `/testing/images`;
    - `ac-9-1-consumer.spec.ts` стр. 94–110: в обеих ожидаемых строках — `images:ok` после `timeout-scale:ok`, имя теста стр. 94 — «… /testing/timeout-scale и /testing/images — ok». «Было → стало», основание AC-9.6 v1.35;
    - `test-images.spec.ts`: импорт `imageRepository` — из `../../../src/testing/repo-conventions.js`. «Было → стало», основание R6.
  - Код:
    - `package.json`, `exports`: запись по R6;
    - `images.ts`: удалить `imageRepository`; шапка — подпуть `@verdeect/kit/testing/images` без условия `development` (AC-9.6), файл без импортов;
    - `repo-conventions.ts`: функция `imageRepository` (TSDoc `@internal`), импорт из `./images.js` — только `TEST_IMAGES`.
  - Проверка: `make test-package` (pack-check) в задаче 12.
  - Логи: нет.

### Фаза 3: `/http` — типы и курсор

- [x] **Task 5: типы `PageQuery` и `CursorValue` из `/http`** — §3.5 стр. 149, R7
  - **Skill:** nestjs-code generic src/http/pagination.ts (MODIFY); nestjs-code generic src/http/index.ts (MODIFY); nestjs-code test unit http ac-3-6-page-types (CREATE) → `test/unit/http/ac-3-6-page-types.test-d.ts`; nestjs-code generic test/consumer/minimal/src/service/items.controller.ts (MODIFY)
  - Тесты (сначала, на rc.11 — ошибка компиляции: типов нет в `/http`):
    - `ac-3-6-page-types.test-d.ts`, импорт из `../../../src/http/index.js`:
      - `AC-3.6: PageQuery — {cursor?: string; limit: number}` — `expectTypeOf` на равенство выходу схемы и на `limit: number` (умолчание учтено);
      - `AC-3.6: CursorValue — string | number | boolean | null`.
    - потребитель: в `items.controller.ts` тип параметра `query` — `PageQuery` из `@verdeect/kit/http` вместо `z.output<…>`. Тест `AC-1.1: типы пакета проверяются tsc потребителя` (`ac-9-1-consumer.spec.ts`) на архиве rc.11 падает.
  - Код: `pagination.ts` — тип `PageQuery` с TSDoc; `index.ts` — `export type { CursorValue, Page, PageQuery }`.
  - Логи: нет.

- [x] **Task 6: курсор keyset — новые типы столбцов, неподдержанный тип, `cursorTimestamp` для `timestamp`/`date`** — §3.5 стр. 149, AC-3.6, R8, R9 (depends on 5)
  - Q1 решён: `citext` — строка, иной `customType` — ошибка (R8).
  - **Skill:** nestjs-code generic src/http/pagination.ts (MODIFY); nestjs-code test unit http pagination (MODIFY) → `test/unit/http/pagination.spec.ts`; nestjs-code test integration http ac-3-6-keyset (MODIFY) → `test/integration/http/ac-3-6-keyset.spec.ts`
  - API zod 4 для ISO без зоны и даты (`z.iso.datetime` с `local`, `z.iso.date`) сверить через Context7: принимает ли `local: true` строку с `Z`. Если да — отдельная проверка «нет `Z` и смещения». Тест — по R8.
  - Тесты unit (сначала, на rc.11), `pagination.spec.ts`; таблица `typed` дополняется столбцами `timestamp` без зоны (режимы `string` и `date`), `date` (оба режима), `numeric`, `real`, `doublePrecision`, `pgEnum`; отдельная таблица неподдержанных типов:
    - `AC-3.6: afterCursor — timestamp без зоны, date, numeric, real/double, enum: верное значение проходит, неверное (now, today, infinity, epoch, NaN, ISO с зоной у timestamp, 2026-02-30, вне enum) → 422 path: cursor` — `pass`/`fail` по таблице комбинаций. На rc.11 падает: типы не проверялись, `fail` не бросает;
    - `AC-3.6: сортировка по столбцу массива, jsonb, json, interval, bigint и numeric в режиме bigint → Error afterCursor при вызове, в том числе без курсора`. На rc.11 ошибки нет;
    - `AC-3.6: date — параметр с приведением ::date` (SQL `dialect.sqlToQuery`);
    - `AC-3.6: столбец citext (customType, dataType 'citext' и 'identity"."citext') — строка проходит, 42 и true → 422 path: cursor; customType другого типа → Error afterCursor`. Столбцы — `customType<{data: string}>` в самом тесте. На rc.11 падает: 422 нет (тип не проверялся), ошибки иного `customType` нет;
    - тест стр. 110 «AC-3.6 (К23): cursorTimestamp …» → «… cursorTimestamp — timestamptz (UTC, микросекунды), timestamp без зоны (микросекунды) и date (YYYY-MM-DD); другой столбец — TypeError»: проверка SQL трёх видов, `TypeError` на `text`. «Было → стало», основание R9. На rc.11 падает (`TypeError` у `timestamp`).
    - Существующий `pass`/`fail` (стр. 119) не меняется.
  - Тесты integration (сначала, на rc.11), `ac-3-6-keyset.spec.ts`. В `beforeAll` — тип `"${SCHEMA}".kind as enum ('a', 'b')` и таблица `typed (id text primary key, at timestamp not null, day date not null, amount numeric not null, kind "${SCHEMA}".kind not null, payload jsonb not null)`. Drizzle-таблица — `schema.table` и `schema.enum`. Очистка — в `beforeEach`:
    - `AC-3.6: курсор с ключом timestamp = "now", date = "infinity", numeric = "abc", enum вне списка → 422 path: cursor без запроса к БД` — по образцу теста стр. 193 (`countQueries`, `DomainError`, `count = 0`), плюс `today`, `epoch`, `"NaN"`. На rc.11 — запрос уходит в БД, ошибка pg;
    - `AC-3.6: сортировка по столбцу jsonb → ошибка afterCursor` — `Error` (не `DomainError`) с текстом R8, запросов 0;
    - `AC-3.6: курсор по столбцу citext проходится до конца без дублей, неверное значение (42) → 422 path: cursor без запроса к БД`. В `beforeAll` — `create extension if not exists citext` (схема `public`) и таблица `names (email citext primary key)`, Drizzle-столбец — `customType` с `dataType` `'citext'`. Строки с разным регистром (`a@x`, `B@x`, `c@x` …), обход `(email)` `asc` с `limit 2` — каждая строка ровно раз. Если расширение `citext` в образе `TEST_IMAGES.postgres` недоступно — стоп и сообщить пользователю. На rc.11 первая часть проходит, падает вторая (422 нет — значение уходит в БД);
    - `AC-3.6: страница по столбцу timestamp проходится до конца без дублей` — 6 строк в одну миллисекунду с разными микросекундами, порядок `id` обратен микросекундам (как тест стр. 160). Ключ — `cursorTimestamp(typed.at)`, обход `(at, id)` `desc` и `asc` с `limit 2`. Плюс тот же обход по `(day, id)` для `date`. На rc.11 — `TypeError` у `cursorTimestamp`.
  - Код `pagination.ts`:
    - `fitsColumn` → проверка по закрытому списку R8: функция-классификатор `cursorKind(col)` возвращает вид (`timestamptz`, `timestamp`, `date`, `uuid`, `integer`, `numeric`, `float`, `boolean`, `string`, `enum`) или `null`; у `PgCustomColumn` — `string`, если `getSQLType()` оканчивается на `citext`, иначе `null`;
    - `afterCursor`: после проверки уникальности — проверка, что у каждого столбца вид не `null`, иначе `Error` R8; `value()` — `::date` для `date`;
    - `cursorTimestamp` — по R9;
    - TSDoc `afterCursor`, `cursorTimestamp`, `pageOf` — по R8, R9; шапка — v1.35;
    - ponytail-комментарий у списка: закрытый список `columnType` Drizzle 0.45, новый тип Drizzle — ошибка до явного добавления.
  - Логи: нет (422 пишет фильтр исключений `warn`).

### Фаза 4: `/messaging` — расхождение аргументов своих очередей

- [x] **Task 7: `MESSAGING_QUEUE_MISMATCH`** — §3.4 стр. 130, AC-5.19, R10
  - **Skill:** nestjs-code generic src/messaging/errors.ts (MODIFY); nestjs-code generic src/messaging/subscriber.ts (MODIFY); nestjs-code test integration messaging ac-5-19-retry-ttl (MODIFY) → `test/integration/messaging/ac-5-19-retry-ttl.spec.ts`; nestjs-code test integration messaging ac-5-19-broker-down (MODIFY) → `test/integration/messaging/ac-5-19-broker-down.spec.ts`
  - Тесты (сначала, на rc.11), `ac-5-19-retry-ttl.spec.ts` — `it.each` по образцу существующего теста (стенд `createSubscriberApp`, `memoryLogger`, `resetQueues`, удаление очереди в `finally`). Ожидания каждого случая — как у теста TTL: `MessagingStartupError`, `startupCode`, точный текст, `startupDetails()` = `{queue}`, одна строка «фатальная ошибка …», нет «канал открывается заново» и «попытка подключения не удалась», отказ в пределах одной паузы от «соединение установлено»:
    - `AC-5.19: очередь kit уже объявлена с другим x-dead-letter-exchange → отказ запуска MESSAGING_QUEUE_MISMATCH «очередь kit объявлена с другими параметрами — пересоздайте очередь», без цикла переподключений` — `kit` объявлена с `deadLetterExchange: 'other'`;
    - тот же шаблон для `kit.dlq` (объявлена с `messageTtl: 1000`) и для `kit.retry` с прежним TTL и другим `deadLetterRoutingKey` (отличие от TTL-случая: код `MESSAGING_QUEUE_MISMATCH`).
    - На rc.11 падает: 406 пробрасывается как обычная ошибка, `MessagingStartupError` нет, идут повторы.
    - Существующий тест TTL не меняется.
  - `ac-5-19-broker-down.spec.ts`. Параметризовать тест стр. 67 нельзя: стенд один на `describe` (`proxy.break()` до `createOutboxApp` в `beforeAll`, один `proxy.restore()` в тесте), после первого случая приложение подключено. Поэтому:
    - тело и имя теста TTL (стр. 67) не меняются;
    - `const sentry = initFakeSentry()` переносится из первого `describe` (стр. 32) на уровень файла: `Sentry.init` глобален для процесса, второй вызов перехватил бы транспорт первого блока;
    - второй `describe` «UC-6: аргументы очереди после старта» со своим стендом по образцу `beforeAll`/`afterAll` первого: свой `memoryLogger`, `BrokerClient`, `tcpProxy` с `proxy.break()` до `createOutboxApp`, `resetQueues`, `truncateFixtures`;
    - тест `AC-5.19: очередь kit с другим x-dead-letter-exchange при подключении после старта → error + GlitchTip, канал подписчика закрыт, новых попыток объявить топологию нет`: до `proxy.restore()` объявить `kit` с `deadLetterExchange: 'other'`, затем `sentry.delivered.length = 0`. Проверки — как в тесте TTL: одна строка FATAL уровня 50, не меньше одного события Sentry, `isChannelReady('subscriber') === false`, шпион `assertQueue` по `kit` — 1 за то же окно наблюдения;
    - `afterAll` закрывает приложение и прокси, удаляет `kit`;
    - файл остаётся в списке `isolated` (`vitest.integration.config.ts:25`).
    - На rc.11 новый тест падает: объявления повторяются.
    - «Было → стало»: тест TTL не меняется, `initFakeSentry` — на уровне файла, добавлен блок. Основание — §3.4 стр. 130 («после запуска — как TTL»).
  - Код:
    - `errors.ts`: в `MessagingStartupCode` — `'MESSAGING_QUEUE_MISMATCH'`, TSDoc класса — новый код; шапка — v1.35;
    - `subscriber.ts`: `is406TtlMismatch` → две проверки: «406» и «406 с `x-message-ttl`». В `setupQueues` — общая внутренняя функция «объявить свою очередь» по R10 для трёх очередей. TSDoc и шапка — v1.35.
  - Логи: прежние строки `rabbitmq-connection` — «rabbitmq: фатальная ошибка настройки канала, повторов не будет» с `code`. Отказ запуска — `failStartup` с `startupDetails()` `{queue}`.

- [x] **Task 8: тест `MessagingStartupError` с новым кодом** — AC-5.19, R10 (depends on 7)
  - **Skill:** nestjs-code test unit messaging errors (MODIFY) → `test/unit/messaging/errors.spec.ts`
  - Тест: `AC-5.19: MessagingStartupError MESSAGING_QUEUE_MISMATCH — startupCode, startupDetails() {queue}`. На rc.11 — ошибка типа литерала кода (typecheck Vitest не охватывает `*.spec.ts`, поэтому проверка — `pnpm typecheck`; в отчёт).
  - Логи: нет.

- [x] **Task 9: AC-5.24 — сверка имени и описания теста** — AC-5.24 (PRD v1.35: «закрытый порт — `ECONNREFUSED` сразу, без ожидания срока»)
  - Без кода. Сверить `test/integration/messaging/ac-5-24-background-failures.spec.ts`: шапка стр. 1–4 («закрытый порт `tcpProxy.break()`: подключение сразу получает `ECONNREFUSED`, срока драйвера нет») и имя теста стр. 136 («закрытый порт, `tcpProxy.break` — `ECONNREFUSED`») совпадают с AC-5.24 v1.35. `blackhole` в файле нет. Ожидаемый итог — без правок. Расхождение — стоп и сообщить пользователю. Итог — в отчёт.

### Фаза 5: документация и выпуск

- [x] **Task 10: README, AGENTS.md, ARCHITECTURE.md** — §3.1, §3.4, §3.5, §3.8 v1.35, AC-9.3 (depends on 1–7)
  - **Skill:** none (Markdown)
  - `README.md`:
    1. «Конфигурация окружения» (стр. 67–124): `issues` (R1) и страховка (R2). **Правило для схем сервиса:** `message` без значения ключа, например `z.undefined({error: 'IDENTITY_PORT заменён на PORT'})`. Значение длиной ≥ 8, попавшее в `message`, пакет заменит на «неверное значение (<code>)»;
    2. «Наблюдаемость», `failStartup` — `issues` в fatal-логе и `extra.issues`;
    3. «CLI сервиса» и строки кодов ошибок (стр. 441, 488, 848, 1104): `INVALID_ENVIRONMENT` — `keys` и `issues`, без пути — `(root)`;
    4. «HTTP», «Пагинация» (стр. 405): типы ключей по таблице комбинаций R8 (`citext` — строка); неподдержанный тип — ошибка `afterCursor`; `cursorTimestamp` для `timestamptz`, `timestamp`, `date` (R9); типы `PageQuery`, `CursorValue`;
    5. «Сообщения» (стр. 621): расхождение аргументов своих очередей — `MESSAGING_QUEUE_MISMATCH`, ссылка на «Развёртывание»;
    6. «Развёртывание» (после пункта «Смена TTL `.retry`»): пункт «Как перейти: очередь, объявленная прежним кодом сервиса с другими параметрами» (R11) — в том числе TTL `.retry` ≠ `RABBITMQ_RETRY_SECONDS` (умолчание 30). До первого запуска нового кода пересоздать: остановить реплики, разобрать или переложить сообщения, удалить очередь, запустить;
    7. «Подпути» (стр. 54): строка `/testing/images` — rc.12, `TEST_IMAGES` без условия `development`, для unit-теста совпадения тегов;
    8. `## API`:
       - `/config` (стр. 933): `InvalidEnvironmentError` — `{code, keys, issues}`, конструктор `new InvalidEnvironmentError(issues)` (`[{key, message}]`, `keys` выводятся), `KitEnvironmentIssue`;
       - `/http` (стр. 1001): `PageQuery`, `CursorValue` в обратных кавычках (`ac-9-3-docs.spec.ts:119`), `afterCursor`/`cursorTimestamp` по R8/R9;
       - `/messaging` (стр. 1078): `MESSAGING_QUEUE_MISMATCH`;
       - `/testing` (стр. 1127): `TEST_IMAGES` — и в `@verdeect/kit/testing/images`.
  - `AGENTS.md`:
    - строка «Состояние» (стр. 21): последний опубликованный выпуск — `1.0.0-rc.11`, готовится `1.0.0-rc.12`;
    - дерево стр. 45–46: `images` — ещё подпуть `./testing/images` (types + default, без импортов);
    - таблица файлов (стр. 107–110): строки `src/cli/environment.ts` (`environmentFailure` — разбор ошибки окружения команд CLI) и `src/testing/images.ts` (подпуть `@verdeect/kit/testing/images`, `TEST_IMAGES`).
  - `.ai-factory/ARCHITECTURE.md`:
    - стр. 112: комментарий `images.ts` — ещё и подпуть `"./testing/images"` (types + default, без импортов, AC-9.6), как стр. 115;
    - стр. 236: исключения из «`./testing` без `default`» — `./testing/timeout-scale` и `./testing/images` (без импортов);
    - дерево стр. 122–125: `cli/environment.ts` — разбор ошибки окружения команд.
  - Проверка: `pnpm vitest run -c vitest.package.config.ts test/package/ac-9-3-docs.spec.ts` (после задачи 11 — и CHANGELOG).
  - Логи: нет.

- [x] **Task 11: CHANGELOG и версия** — G14, NFR-5 (depends on 10)
  - **Skill:** none (Markdown, JSON)
  - `CHANGELOG.md`: `## [1.0.0-rc.12] - 2026-11-17` под `## [Unreleased]`, по образцу rc.11:
    - строка-источник: «Итоги перехода Identity ID-76, сверка KT-133 (PRD v1.35, r30). Последний выпуск под `@verdeect/kit` на npmjs.»;
    - `### Added`:
      - `/config`: `InvalidEnvironmentError.issues` и тип `KitEnvironmentIssue`;
      - `/http`: типы `PageQuery`, `CursorValue`;
      - подпуть `@verdeect/kit/testing/images` (`TEST_IMAGES`);
      - `/messaging`: код `MESSAGING_QUEUE_MISMATCH`;
    - `### Changed`:
      - страховка `message` от значения;
      - конструктор `InvalidEnvironmentError` принимает `issues` (`KitEnvironmentIssue[]`), `keys` выводятся из них;
      - `failStartup` — `issues` и `extra.issues`;
      - CLI — `issues` и `(root)` у всех команд;
      - курсор — `timestamp`, `date`, `numeric`, `real`/`double`, enum; неподдержанный тип — ошибка `afterCursor`; `cursorTimestamp` для `timestamp`/`date`;
      - 406 на объявление своих очередей — отказ запуска;
    - `### Fixed`: CLI — ошибка уровня корня давала пустой ключ вместо `(root)` (`db`, `openapi`, `crypto`, `redis`, `rabbitmq`);
    - `### Как перейти`:
      - **K-4, очереди:** очередь `<svc>`, `<svc>.retry` или `<svc>.dlq`, объявленная прежним кодом сервиса с другими параметрами (в том числе TTL `.retry` ≠ `RABBITMQ_RETRY_SECONDS`, умолчание 30), — пересоздать до первого запуска по README «Развёртывание». Иначе — отказ запуска `MESSAGING_QUEUE_MISMATCH` или `MESSAGING_RETRY_TTL_MISMATCH`;
      - **курсор:** сортировка keyset по массиву, `jsonb`, `interval`, `bigint`/`numeric` в режиме `bigint` теперь ошибка `afterCursor`; пользовательский тип (`customType`) — тоже ошибка, кроме `citext` (проверяется как строка). Ключи `timestamp`/`date` — через `cursorTimestamp`: курсор из `Date` (ISO с `Z`) столбца без зоны и `date` теперь 422;
      - **ошибка окружения:** `message` своих схем — без значения ключа. Разбор JSON CLI и логов отказа может читать `issues`;
      - **`new InvalidEnvironmentError`:** сервисы, которые создают ошибку сами, передают `[{key, message}]` вместо `[key]`; `message` — без значения ключа.
  - `package.json`: `"version": "1.0.0-rc.12"`.
  - Логи: нет.

### Фаза 6: проверка

- [x] **Task 12: полная проверка** (depends on 1–11)
  - Команды по одной (правило пользователя: без `&&`):
    1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
    2. `free -h`, `uptime`, `docker ps --format '{{.Names}} {{.Label "com.docker.compose.project"}} {{.Label "org.testcontainers"}}'`: available ≥ 3 ГБ, load < 5, нет чужих `verdeect-*-e2e` и контейнеров Testcontainers. Иначе — стоп и сообщить пользователю, `test-full` не запускать;
    3. `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check).
  - Падения не маскировать подъёмом сроков. Правки существующих тестов — только по изменению поведения v1.35, каждая в отчёт.
  - Отчёт:
    - новые тесты с итогом на rc.11 (как упал);
    - правки существующих тестов «было → стало»;
    - итог сверки AC-5.24;
    - расхождение PRD стр. 149 с решением R9 — поправят в следующей ревизии (ответ пользователя 17.11.2026), код не ждёт.
  - Соседние репозитории не трогать.

## Traceability

| UC/AC | Задачи | Тест |
|---|---|---|
| UC-3, AC-1.3 (`parseEnv`) | 1 | `test/unit/config/ac-1-3-parse-env.spec.ts` — `AC-1.3: z.undefined(…) → issues …`, `AC-1.3: superRefine с текстом, содержащим значение …`, `AC-1.3: ошибка уровня корня с фрагментом …`, `AC-1.3: значение короче 8 …`, `AC-1.3: несколько issue одного ключа …` |
| UC-3, AC-2.9 (`failStartup`) | 2 | `test/unit/observability/ac-2-9-fail-startup.spec.ts` — `AC-2.9: InvalidEnvironmentError — fatal (60) с именами ключей и issues …`, `AC-1.3: ошибка parseEnv с текстом superRefine, содержащим значение ключа …` |
| UC-12, AC-1.3 (CLI) | 3 | `test/unit/cli/ac-1-3-cli-environment.spec.ts` — `AC-1.3: ошибка окружения каждой команды CLI …`, `AC-1.3: environmentFailure — ошибка уровня корня …`, `AC-1.3: environmentFailure — текст superRefine со значением ключа …`; `redis-acl-command.spec.ts`, `ac-5-10-rabbitmq-command.spec.ts`, `ac-5-10-rabbitmq-definitions.spec.ts` (`issues` хешей) |
| UC-14, AC-9.6 | 4 | `test/package/ac-9-6-timeout-scale.spec.ts` — три теста `AC-9.6: … testing/images …`; `test/package/ac-9-1-consumer.spec.ts` (`images:ok`); `test/unit/package/package-manifest.spec.ts` — `AC-9.6: ./testing/images …` |
| UC-4, §3.5 (типы) | 5 | `test/unit/http/ac-3-6-page-types.test-d.ts`; `test/package/ac-9-1-consumer.spec.ts` — `AC-1.1: типы пакета проверяются tsc потребителя` |
| UC-4, AC-3.6 | 6 | `test/unit/http/pagination.spec.ts` — `AC-3.6: afterCursor — timestamp без зоны, date, numeric …`, `AC-3.6: сортировка по столбцу массива, jsonb …`, `AC-3.6: date — параметр с приведением ::date`, `AC-3.6: столбец citext …`, `AC-3.6 (К23): cursorTimestamp — …`; `test/integration/http/ac-3-6-keyset.spec.ts` — `AC-3.6: курсор с ключом timestamp = "now" …`, `AC-3.6: сортировка по столбцу jsonb …`, `AC-3.6: страница по столбцу timestamp …`, `AC-3.6: курсор по столбцу citext …` |
| UC-6, AC-5.19 | 7, 8 | `test/integration/messaging/ac-5-19-retry-ttl.spec.ts` — `AC-5.19: очередь kit … MESSAGING_QUEUE_MISMATCH …` (+ `kit.dlq`, `kit.retry`); `test/integration/messaging/ac-5-19-broker-down.spec.ts` — `AC-5.19: очередь kit с другим x-dead-letter-exchange при подключении после старта …`; `test/unit/messaging/errors.spec.ts` |
| UC-5, UC-9, AC-5.24 | 9 | `test/integration/messaging/ac-5-24-background-failures.spec.ts` — без правок (сверка) |
| AC-9.3 (README, CHANGELOG) | 10, 11 | `test/package/ac-9-3-docs.spec.ts` (`make test-full`, уровень R) |
