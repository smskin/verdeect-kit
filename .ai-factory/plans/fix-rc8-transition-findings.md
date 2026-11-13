# План реализации: выпуск `1.0.0-rc.8` — итоги rc.7 (r23, PRD v1.28)

Mode: full
Branch: fix/rc8-transition-findings
Created: 2026-11-13

## Original Request
Реализуй выпуск 1.0.0-rc.8 по пакету требований requirements/0000-kit/ (ревизия r23, PRD v1.28). Скоуп — изменения v1.28 относительно v1.27: subscriber.on — опция {unknownVersion: 'skip' | 'dlq'} на type (разные значения у on одного type — ошибка регистрации), 'dlq' — <svc>.dlq с x-dlq-reason: version, error-лог, consumed{result: 'dlq'}, captureThrottled, у onReplica опции нет (§3.4, AC-5.22); createTestDb({url, service, max?}) → {db, pools: {main, read}, close()} — без статического pg в графе /testing (§3.8, AC-4.19); README — KIT_DB_CONNECTION_TIMEOUT_MS ≠ DB_POOL_ACQUIRE_TIMEOUT_MS; тип KitOutboxTrace в PRD (уже экспортирован); redact — только простой объект и TypeError на имена (уже в коде — сверить с текстом, тест AC-4.14); повтор идемпотентности с Content-Type первого ответа, nullable-колонка content_type в createIdempotencyTable (NULL — прежнее поведение; снимок drizzle-kit и миграции фикстуры/потребителя обновить), тест на строку, число и toJSON (§3.3а, §6, AC-4.14); UNKNOWN_COMMAND — JSON {error} в stdout, список в stderr (уже в коде — сверить, AC-9.7); CHANGELOG [1.0.0-rc.8] с «Как перейти» (колонка content_type — миграция сервиса, unknownVersion), version 1.0.0-rc.8. Источник истины — requirements/0000-kit/prd.md. На каждый пункт — тест с ID AC, где возможно — сначала падающий на старом коде. Тесты без реальных пауз, сроки не поднимать. Уже реализованный код не переделывать без требования. Соседние репозитории — только чтение. Перед make test-full — free -h и uptime: available ≥ 3 ГБ, load < 5. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes. Тесты — по уровням AC (`prd.md` §5): AC-5.22, AC-4.14, AC-4.19 — I (`test/integration/<подпуть>` на `startTestStack`), AC-9.7 — U (`test/unit/cli`), тип опции — `*.test-d.ts`. В каждой паре «Na — тест, Nb — код» тест пишется первым и запускается на старом коде. Падение (или ошибка компиляции из-за отсутствующей опции) фиксируется в отчёте реализации. Реальных пауз нет: ожидание — `waitUntil` или опрос со сроком × `TEST_TIMEOUT_SCALE`. Сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino` и адаптеры пакета, без `console.*` (NFR-8, AC-9.4). Тела сообщений и ответов, ключи идемпотентности целиком и адреса БД в логи не попадают. Конкретные строки — в задачах.
- Docs: no — без обязательного чекпоинта `/aif-docs` (`WARN [docs]`). README, CHANGELOG и версию обновляют задачи 5–6 («Library Package Scope» (7), AC-9.3).
- Настройки взяты из плана rc.7: запрос задаёт тесты на каждый пункт, остальное не менялось.

## Roadmap Linkage
Milestone: "none"
Rationale: вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по итогам rc.7 (G14), отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.28 (r23) > ответ пользователя на вопрос плана (пустой ответ, см. ниже) > текст запроса > `ARCHITECTURE.md` / `DESCRIPTION.md`. Скоуп — изменения v1.28 относительно v1.27 (шапка 1.28: PL-69, review). Код rc.7 — существующий: расширять, не переписывать.

| Решение | Источник | Проверка |
|---|---|---|
| `on(E, h, {unknownVersion?: 'skip' \| 'dlq'})`, умолч. `'skip'`, значение — свойство `type`: у всех `on` одного `type` одно значение, иначе `TypeError` регистрации. Значение вне `'skip' \| 'dlq'` — `TypeError` (как `dedupe`). У `onReplica` опции нет — всегда пропуск | §3.4 стр. 131, AC-5.22 | 1a/1b |
| `'dlq'`: неподписанная версия → `<svc>.dlq` с `x-dlq-reason: version`. Дальше: `error`-лог `{id, type, version}`, `verdeect_events_consumed_total{type, result: 'dlq'}` +1, `captureThrottled`. Обработчик не вызывается, inbox не занимается, `skipped` не растёт | §3.4 стр. 131, AC-5.22 | 1a/1b |
| `'version'` — новое значение в перечне `x-dlq-reason` §3.4 | §3.4 стр. 131 | 1a, README (5) |
| `createTestDb({url, service, max?})` → `{db, pools: {main, read}, close()}`. `pools` — те же `pg.Pool`, что внутри `db`. `max` — целое ≥ 1, умолч. 10, иначе `TypeError`. `close()` закрывает оба. `pg` — только тип и динамический `import()` (граф `/testing` без статического `pg`, AC-1.2) | §3.8 стр. 189, AC-4.19; `TypeError` для `max` — ответ пользователя KT-87 | 3a/3b |
| `KIT_DB_CONNECTION_TIMEOUT_MS` ≠ `DB_POOL_ACQUIRE_TIMEOUT_MS` — только README | §3.8 стр. 189 | 5 |
| `KitOutboxTrace` уже экспортирован из `/testing` (`src/testing/index.ts:32`), README уже описывает (стр. 1034) — новых задач нет | §3.8 стр. 189 | существующий код |
| `redact` — поля скрываются только у простого объекта (`Object.prototype` или `null`); имена с `.`/`[`/пустые → `TypeError`. Код (`isPlainObject`, декоратор) и тесты (`ac-4-14-redact.spec.ts`: массив, toJSON, имена) уже есть — сверить, не переписывать | §3.3а стр. 118, AC-4.14 | 2a (сверка) |
| Повтор отдаёт тело в той же сериализации и с тем же `Content-Type`, что первый ответ, при любом теле. **Найденная причина:** drizzle `jsonb.mapFromDriverValue` повторно делает `JSON.parse` строки, поэтому строка `'42'` при повторе становится числом 42 (`text/plain` → `application/json`). Пустой ответ (`undefined`) хранится как `null` → повтор `null` с `application/json` | §3.3а стр. 118, AC-4.14 | 2a/2c |
| Колонка `content_type text` nullable в `createIdempotencyTable`. `NULL` — запись до колонки: повтор по-прежнему (как rc.7, ветка без изменений) | §6 стр. 525, §3.3а | 2b/2c |
| «Та же сериализация» у JSON-тела (объект, массив) — равенство JSON: ключи в порядке jsonb, как в rc.7 (jsonb нормализует объект: ключи по длине, затем по байтам, без пробелов). Побайтовой идентичности с первым ответом нет — для неё пришлось бы менять тип колонки тела (§6), этого не делаем. Побайтово совпадают не-JSON тела (строка, `text/*`). Тест: объект и массив сравниваются после `JSON.parse`; строка и число — тело и `Content-Type` как есть | ответ пользователя KT-87 (13.11.2026); уточнение формулировки PRD — в следующей ревизии | 2a/2c |
| **Пустой ответ** (обработчик вернул `undefined`): `response_body` — SQL NULL, `content_type = ''`. Повтор — пустое тело без `Content-Type`. `NULL` остаётся только у старых записей | ответ пользователя на вопрос плана | 2a/2c |
| `UNKNOWN_COMMAND`: код 1, stdout — одна JSON-строка `{error}`, список — в stderr. Код (`src/cli/run.ts:79–92`) и тест уже есть; проверки «ровно одна строка stdout» в тесте нет — добавить | §3.8 стр. 199, AC-9.7 | 4 |
| Версия `1.0.0-rc.8`, CHANGELOG с «Как перейти»: миграция `content_type` у сервиса, `unknownVersion` | G14, NFR-5, запрос | 6 |

Комбинации подписчика по `unknownVersion` (AC-5.22):

| Конверт | Регистрация | Итог |
|---|---|---|
| (T, v2) | `on(T v1)` (умолч. `'skip'`) | ack, `skipped{T,"2"}` +1, `debug` (как rc.7) |
| (T, v2) | `on(T v1, h, {unknownVersion: 'dlq'})` | `<svc>.dlq`, `x-dlq-reason: version`, `error`-лог, `consumed{T, dlq}` +1, `captureThrottled`, обработчика и inbox нет, `skipped` 0 |
| (T, v1) | `on(T v1, h, {unknownVersion: 'dlq'})` | обработчик v1 (опция не влияет) |
| (T, v2) | `on(T v1, …, 'dlq')` и `on(T v2, …, 'dlq')` | обработчик v2 |
| (U, любая) | `U` не подписан | DLQ `unsubscribed` (как сейчас, опция не влияет) |
| — | `on(T v1, {unknownVersion: 'dlq'})` + `on(T v2)` (умолч. `'skip'`) | `TypeError` регистрации |
| (T, v2) | `onReplica(T v1)` | пропуск, `skipped` +1 (как rc.7) |

Комбинации повтора идемпотентности (AC-4.14, §3.3а):

| Первый ответ обработчика | Хранится `response_body` / `content_type` | Повтор |
|---|---|---|
| простой объект / массив | JSON / `application/json; charset=utf-8` | то же тело и `Content-Type` |
| строка `'42'` | `"42"` / `text/plain; charset=utf-8` | строка `42`, `text/plain` (сейчас — число) |
| число `42` | `42` / `application/json; charset=utf-8` | `42`, `application/json` |
| экземпляр класса с `toJSON` | результат `toJSON` / `application/json; charset=utf-8` | тот же JSON |
| строка при `@Header('Content-Type', 'text/csv')` | `"a,b"` / `text/csv` | `a,b`, `text/csv` |
| `undefined` (пусто) | SQL NULL / `''` | пустое тело, без `Content-Type` |
| запись до колонки | любое / `NULL` | как rc.7 (тело через drizzle, `Content-Type` не ставится) |

## Commit Plan
- **Commit 1** (после 1a–1b): `feat(messaging): unknownVersion у subscriber.on, x-dlq-reason: version (AC-5.22)`
- **Commit 2** (после 2a–2c): `feat(idempotency): повтор с Content-Type первого ответа, колонка content_type (AC-4.14)`
- **Commit 3** (после 3a–3b, 4): `feat(testing): createTestDb({max}) и pools; тест UNKNOWN_COMMAND (AC-4.19, AC-9.7)`
- **Commit 4** (после 5–6): `docs: README, CHANGELOG 1.0.0-rc.8, version 1.0.0-rc.8`

## Tasks

### Фаза 1: `/messaging` — `unknownVersion`

- [ ] **Task 1a: тесты AC-5.22 `unknownVersion`** — §3.4, AC-5.22
  - **Skill:** nestjs-code test integration messaging ac-5-22-version-dispatch (MODIFY) → `test/integration/messaging/ac-5-22-version-dispatch.spec.ts`; nestjs-code test integration messaging ac-5-22-unknown-version-dlq (CREATE) → `test/integration/messaging/ac-5-22-unknown-version-dlq.spec.ts`; nestjs-code test integration messaging support (MODIFY) → `test/support/messaging.ts`; nestjs-code test integration messaging ac-5-7-dlq-retry (MODIFY) → `test/integration/messaging/ac-5-7-dlq-retry.spec.ts` (только вынос `dlqReason`); nestjs-code test unit messaging ac-5-22-unknown-version (CREATE) → `test/unit/messaging/ac-5-22-unknown-version.test-d.ts`; `vitest.integration.config.ts` (MODIFY, конфиг)
  - Случай DLQ с проверкой `captureThrottled` (первый тест ниже) — в отдельном файле `ac-5-22-unknown-version-dlq.spec.ts` с `initFakeSentry`. Файл добавляется в `ISOLATED` конфига `vitest.integration.config.ts` с комментарием `// initFakeSentry — процесс-глобальный Sentry.` (правило «Fast Test Suites» (3)). Остальные тесты ниже (v1, регистрация, неверное значение) — в `ac-5-22-version-dispatch.spec.ts` без Sentry; файл остаётся в `shared`.
  - `support/messaging.ts`: потребитель `TestConsumerDlq` по образцу `TestConsumer`, `on(TestNoteCreated, h, {unknownVersion: 'dlq'})`. Рядом — `TestConsumerDlqV2`: `on(TestNoteCreatedV2, h, {unknownVersion: 'dlq'})`, пишет `received`. Существующий `TestConsumerV2` не подходит: он регистрируется с умолчанием `'skip'` и вместе с `TestConsumerDlq` даст `TypeError` регистрации. Если нужен — помощник чтения `kit.dlq` с заголовком `x-dlq-reason` (взять из `ac-5-7-dlq-retry.spec.ts`, не дублировать: вынести в support и переиспользовать в обоих файлах).
  - Тесты: первый — в `ac-5-22-unknown-version-dlq.spec.ts` (`describe('UC-6: unknownVersion: dlq')`), остальные четыре — в новом `describe('unknownVersion')` файла `ac-5-22-version-dispatch.spec.ts`:
    - `AC-5.22: on(E v1, h, {unknownVersion: 'dlq'}): конверт v2 — в DLQ с x-dlq-reason: version, обработчик не вызван, в inbox нет, skipped не растёт`. Дополнительно — `consumed{type, result: 'dlq'}` = 1, `error`-строка `memoryLogger` с `type`, `version`, `id`. `captureThrottled` — через `test/support/fake-sentry.ts`, как в `ac-5-7-dlq-retry.spec.ts`: ровно одно событие;
    - `AC-5.22: unknownVersion: 'dlq' — конверт v1 обработан как обычно`;
    - `AC-5.22: unknownVersion: 'dlq' у on v1 и on v2 — каждый получает свою версию`: приложение с провайдерами `[TestConsumerDlq, TestConsumerDlqV2]`, конверт v1 → обработчик v1, конверт v2 → обработчик v2, DLQ пуст;
    - `AC-5.22: разные unknownVersion у on одного type — ошибка регистрации`: `detachedSubscriber()`, `on(v1, h, {unknownVersion: 'dlq'})`, затем `on(v2, h)` → `TypeError`. В обратном порядке — тоже `TypeError`. `'dlq'` у обоих — без ошибки;
    - `AC-5.22: unknownVersion вне 'skip' | 'dlq' — TypeError`.
  - `ac-5-22-unknown-version.test-d.ts`: `on(E, h, {unknownVersion: 'dlq'})` компилируется; `// @ts-expect-error` — `unknownVersion: 'drop'` и `onReplica(E, h, {unknownVersion: 'dlq'})`.
  - `test/integration/messaging/ac-5-7-dlq-retry.spec.ts` перечня значений `x-dlq-reason` не содержит (на каждую причину — свой `it`), поэтому не меняется. Исключение — вынос `dlqReason` (стр. 32) в `test/support/messaging.ts`: параметром идёт `broker`, вызовы в файле обновляются.
  - На старом коде падает: опции нет (ошибка типов), v2 подтверждается без DLQ.
  - Логи: нет.

- [ ] **Task 1b: `unknownVersion` в `KitSubscriber`** — §3.4, AC-5.22 (depends on 1a)
  - **Skill:** nestjs-code generic src/messaging/subscriber.ts (MODIFY)
  - `on(event, handler, options: {dedupe?, unknownVersion?: 'skip' | 'dlq'})`. Проверка значения — рядом с `dedupe`: `TypeError('KitSubscriber.on: unknownVersion <v> — \'skip\' или \'dlq\'')`.
  - `Registered` — поле `unknownVersion` (у `onReplica` — всегда `'skip'`). В `register` для `on`: если в реестре есть запись того же `type` с другим `unknownVersion` → `TypeError('KitSubscriber.on: у обработчиков <type> разные unknownVersion — значение одно на type')`.
  - `Lookup` `{kind: 'version'}` несёт `unknownVersion` найденного `type`. `lookupHandler` берёт его у любой записи `type`: значения одинаковы по построению.
  - `handle`: `'skip'` — ветка rc.7 без изменений. `'dlq'` — `this.finish(envelope.type, envelope.id, delivery, () => this.toDlq(msg, 'version', envelope.id, envelope.type, delivery, {version: envelope.version}))`. В `DlqOptions` (стр. 95–101: сейчас только `report`, `invalid`, `fields`, `error`) — поле `version?: number`; `error`-строка `reportDlq` — `{id, type, reason, fields, delivery, ...(options.version === undefined ? {} : {version: options.version})}`. `'version'` добавить в `PARSE_REASONS`, чтобы `captureThrottled` шёл по общему пути с ключом `messaging-dlq:<type>:version`. Метрика `consumed{result: 'dlq'}` идёт через `finish`.
  - `handleReplica` не меняется.
  - TSDoc `on`: опция, умолчание, «одно значение на `type`», README-совет (учётные события, которые нельзя потерять; переигрывание из DLQ). Шапка файла — ссылка на v1.28.
  - Логи: `error` «messaging: сообщение в DLQ» `{id, type, version, reason: 'version', delivery}` — существующая строка `reportDlq` с полем `version`. Тело не логируется.
  - Готово, когда: 1a, `pnpm typecheck` и `test/integration/messaging` зелёные.

### Фаза 2: `/idempotency` — `Content-Type` повтора

- [ ] **Task 2a: тесты AC-4.14 — сериализация и `Content-Type` повтора** — §3.3а, §6, AC-4.14
  - **Skill:** nestjs-code test integration idempotency ac-4-14-content-type (CREATE) → `test/integration/idempotency/ac-4-14-content-type.spec.ts`; nestjs-code test integration idempotency support (MODIFY) → `test/integration/idempotency/support.ts`
  - `support.ts`, `EchoController` (`@Idempotent()`, под guard'ом), маршруты:
    - `POST /text` — строка `'42'`;
    - `POST /number` — число `42`;
    - `POST /stamp` — экземпляр `Stamp` с `toJSON` (уже есть класс, стр. 99), без `redact`;
    - `POST /csv` — `@Header('Content-Type', 'text/csv')`, строка `'a,b'`;
    - `POST /empty` — `undefined`.
    Счётчик — общий `handlers`.
  - `describe('UC-7: Idempotency-Key, Content-Type повтора')`, для каждого маршрута тест `it.each`. В `it.each`, кроме пяти новых, — существующие маршруты `/echo` (объект `{n, body}`) и `/secret-list` (массив; `redact` массив не меняет), чтобы покрыть строку таблицы «простой объект / массив» (§3.3а: «при любом теле (объект, массив, строка, число, пустое)»). Новых маршрутов для них не нужно. Пример заголовка: `AC-4.14: строка — повтор совпадает с первым ответом по телу и Content-Type`. Проверяются `statusCode`, тело, `headers['content-type']`, `Idempotent-Replayed: true`, `handlers.calls === 1`. Тело (KT-87): у объекта, массива и `toJSON` (`/echo`, `/secret-list`, `/stamp`) — `JSON.parse(payload)` первого ответа и повтора равны; у строки, числа, `text/csv` и пустого (`/text`, `/number`, `/csv`, `/empty`) — сырой `payload` совпадает побайтово.
  - `AC-4.14: content_type хранится`: `select content_type from kit.idempotency_key` — `text/plain; charset=utf-8` у `/text`, `''` у `/empty`.
  - `AC-4.14: запись без content_type (до колонки) — повтор как раньше`: первый запрос `/number`, затем `update kit.idempotency_key set content_type = null` через `adminQuery`, повтор → 201, тело `42`, `Idempotent-Replayed: true`.
  - `Content-Type` в каждом случае сравнивается между первым ответом и повтором, а не с литералом: к своему типу без `charset` Fastify дописывает `; charset=utf-8` (`text/csv` → `text/csv; charset=utf-8`). Литерал проверяется только в колонке `content_type`.
  - Сверка `redact` (§3.3а v1.28): `ac-4-14-redact.spec.ts` уже покрывает простой объект, массив, `toJSON` и имена — не менять. Если находится расхождение с текстом стр. 118 — в отчёт и вопрос пользователю.
  - На старом коде падает: колонки `content_type` нет; `/text` повтор — `application/json`; `/empty` повтор — `null`.
  - Логи: нет.

- [ ] **Task 2b: колонка `content_type` и миграции** — §6, AC-4.14 (depends on 2a)
  - **Skill:** nestjs-code generic src/idempotency/table.ts (MODIFY); миграции — команды drizzle-kit (без skill)
  - `table.ts`: `contentType: text('content_type')` (nullable) после `responseLocation`; TSDoc `createIdempotencyTable` — «`content_type` — `Content-Type` первого ответа; `''` — пустой ответ; `NULL` — запись до колонки». Шапка — ссылка на v1.28.
  - Фикстура: `pnpm db:fixtures` → новая миграция `test/fixtures/database/migrations/0008_*.sql` (`ALTER TABLE "kit"."idempotency_key" ADD COLUMN "content_type" text`) и снимок `meta/0008_snapshot.json`. Повтор `pnpm db:fixtures` — «No schema changes».
  - Потребитель: на месте `drizzle-kit generate` не работает — в `test/consumer/minimal/package.json` вместо пакета заглушка `"@verdeect/kit": "file:__TARBALL__"`, а сам потребитель ставится во временную копию (`test/package/support/consumer-project.ts`). Поэтому миграция генерируется во временной копии `test/consumer/minimal` с установленным упакованным архивом, подготовленной так же, как в `consumer-project.ts`. Можно и иначе: взять `0008_*.sql` фикстуры и заменить в нём схему на `consumer`. Обратно переносятся `drizzle/0006_*.sql`, `drizzle/meta/0006_snapshot.json` и запись в `_journal.json`. Образец — коммит bcb1888: колонка `attempt`, у потребителя это миграция 0002. Повторный generate в той же копии должен ответить «No schema changes». Права `<svc>_app` на новую колонку: `GRANT` табличный — фикстура `test/fixtures/database/migrations/0003_idempotency_purge.sql:3`, потребитель `test/consumer/minimal/drizzle/0001_force_grants_purge.sql:3` (`GRANT SELECT, INSERT, UPDATE, DELETE ON … idempotency_key TO <svc>_app`). Новая колонка покрыта, custom-миграция с `GRANT` не нужна.
  - `<svc>_directory` колонку не видит: `GRANT SELECT (ctid, created_at)` из `idempotencyPurgeSql` не меняется.
  - Логи: нет.
  - Готово, когда: `pnpm typecheck` зелёный, миграции применяются в `startTestStack` (прогон 2a доходит до проверок поведения).

- [ ] **Task 2c: сохранение и повтор `Content-Type`** — §3.3а, AC-4.14 (depends on 2b)
  - **Skill:** nestjs-code generic src/idempotency/idempotency.interceptor.ts (MODIFY)
  - Сохранение (`run`, после обработчика) — `contentType` первого ответа:
    - заголовок ответа уже задан (`reply.getHeader('content-type')`: `@Header` Nest ставит до перехватчиков, `reply.type()` в обработчике) — его значение, только если `typeof header === 'string'`, как уже сделано с `location` в `run` (`typeof header === 'string' ? header : null`). Число или массив → правила ниже;
    - иначе `body === undefined` → `''`;
    - иначе строка → `'text/plain; charset=utf-8'`;
    - иначе → `'application/json; charset=utf-8'` (так Fastify выбирает тип по умолчанию).
    Тело для хранилища — по-прежнему `redacted(body ?? null, …)`: явный `null`, не `undefined`. Drizzle пропускает `undefined`-ключи в `.set()`, а `null` в `jsonb` пишет как SQL NULL. Поэтому JSON `null` и пустой ответ в `response_body` хранятся одинаково (SQL NULL), а различаются только `content_type` (`application/json…` или `''`).
  - `completeWithRetry`: поле `contentType` в `response` и `.set`. `begin`, ветка переиспользования истёкшей/брошенной строки: `contentType: null`.
  - Чтение (`begin`, `select`): добавить `contentType: t.contentType` и `bodyText: sql<string | null>\`${t.responseBody}::text\``. Сырой текст jsonb — без повторного `JSON.parse` drizzle. В `BeginResult` `replay` — поле `contentType: string | null`.
  - Повтор:
    - `contentType === null` — ветка rc.7 без изменений (`row.body`, без `Content-Type`);
    - `''` — `undefined`, без `Content-Type`;
    - иначе — `reply.header('Content-Type', contentType)` и `JSON.parse(bodyText)` (`bodyText === null` → `null`).
    Статус, `Location`, `Idempotent-Replayed` — как сейчас.
  - TSDoc класса и шапка — повтор в той же сериализации и с тем же `Content-Type` (§3.3а v1.28).
  - Логи: `debug` «идемпотентность: begin» дополнить `{contentType}` только для `replay` (значение заголовка, без тела).
  - Готово, когда: 2a, весь `test/integration/idempotency` и `test/unit/idempotency` (если есть) зелёные.

### Фаза 3: `/testing` — `createTestDb({max})` и `pools`

- [ ] **Task 3a: тесты AC-4.19 `max` и `pools`** — §3.8, AC-4.19
  - **Skill:** nestjs-code test integration testing ac-4-19-create-test-db (MODIFY) → `test/integration/testing/ac-4-19-create-test-db.spec.ts`
  - Тесты:
    - `AC-4.19: createTestDb({max: 1}) — у pools.main и pools.read по одному соединению, второй одновременный запрос ждёт`. Клиент берётся через `pools.main.connect()`, запускается `db.transaction(…)`. Опросом со сроком проверяется `pools.main.waitingCount === 1` и что транзакция не завершена. После `release()` транзакция завершается, `pools.main.totalCount === 1`. Так же для `pools.read` — через `db.readGlobal((r) => r.execute(sql\`select 1\`))`, пул чтения без транзакции. `db.read` требует тенанта (`TenantRequiredError`) и здесь не подходит. Без пауз. Срок ожидания в очереди pg-pool ограничен `connectionTimeoutMillis` = `CONNECTION_TIMEOUT_MS` (5000 мс, `src/database/timeouts.ts`, передаётся в `buildPools`), независимо от масштабированного срока опроса. Поэтому клиент отпускается сразу, как только опрос увидит `waitingCount === 1` и незавершённую транзакцию. Дальше тест проверяет, что транзакция (и `readGlobal`) завершилась успешно, а не отклонена с «timeout exceeded when trying to connect»;
    - `AC-4.19: countQueries(pools.main, …) считает запросы db.transaction` — `countQueries(pools.main, () => db.transaction(ctx, async (tx) => { await tx.execute(sql\`select 1\`); await tx.execute(sql\`select 1\`); }))`. В возвращённом `queries` ровно две записи `select 1`; `BEGIN`, `set_config` и `COMMIT` по числу не проверяются. Тот же вызов на `pools.read` — ноль записей `select 1`;
    - `AC-4.19: max вне целого ≥ 1 (0, 1.5) — TypeError`;
    - существующий тест `close()` дополнить: `pools.main.ended` и `pools.read.ended` — `true`.
  - Существующие тесты файла не менять.
  - Граф `/testing` без статического `pg` уже проверяется тестом `test/package/ac-1-1-package.spec.ts:294` — `AC-1.1: dist/testing не импортирует amqplib и messaging/index статически` (нет `database/pg.js` в графе; уровень T). Новый тест не нужен. В задаче 7 (`make test-full`) убедиться, что он зелёный.
  - На старом коде падает: `pools` нет, `max` игнорируется.
  - Логи: нет.

- [ ] **Task 3b: `createTestDb({max})` → `pools`** — §3.8, AC-4.19 (depends on 3a)
  - **Skill:** nestjs-code generic src/testing/create-test-db.ts (MODIFY)
  - Опция `max?: number`: `Number.isInteger(max) && max >= 1`, иначе `TypeError('createTestDb: max — целое ≥ 1')`. Умолчание — `POOL_MAX` (10).
  - `KitTestDb` — поле `readonly pools: KitPools`: `import type { KitPools } from '../database/pools.js'` (`src/database/pools.ts:20`). Тип стирается и в граф не попадает. Возвращается объект `buildPools` — те же пулы, что переданы в `Db`.
  - TSDoc: `pools` — для `countQueries`, `totalCount`, прямых запросов; `max` — размер каждого пула; срок соединения — `KIT_DB_CONNECTION_TIMEOUT_MS`, это не `DB_POOL_ACQUIRE_TIMEOUT_MS`.
  - Логи: `debug` «createTestDb: пулы созданы» `{service, max}`; адрес не логируется.
  - Готово, когда: 3a, `pnpm typecheck` и `test/integration/testing` зелёные.

### Фаза 4: CLI — сверка AC-9.7

- [ ] **Task 4: тест UNKNOWN_COMMAND — одна JSON-строка в stdout** — §3.8 стр. 199, AC-9.7
  - **Skill:** nestjs-code test unit cli ac-9-7-help (MODIFY) → `test/unit/cli/ac-9-7-help.spec.ts`
  - В тесте `AC-9.7: неизвестная команда …` добавить: `stdout.trimEnd().split('\n')` — ровно одна строка, она разбирается как `{error: {code: 'UNKNOWN_COMMAND', message}}`, `stderr` не содержит `UNKNOWN_COMMAND`.
  - Код `src/cli/run.ts` по сверке уже соответствует — не менять. Если тест падает, исправить `runCli` минимально и отметить в отчёте.
  - Логи: нет.

### Фаза 5: документация и выпуск

- [ ] **Task 5: README** — §3.3а, §3.4, §3.8, AC-9.3 (depends on 1b, 2c, 3b)
  - **Skill:** none (Markdown)
  - `README.md`:
    - `/messaging`, `subscriber.on` — три места README:
      1. абзац «**Версии событий.**» (стр. 513): по умолчанию `'skip'`, как сейчас. `unknownVersion: 'dlq'` → `<svc>.dlq` с `x-dlq-reason: version`, `error`-лог, `consumed{result: 'dlq'}`, `captureThrottled`. Значение одно на `type`, `onReplica` — всегда пропуск. `'dlq'` — для учётных событий; переигрывание из DLQ — после того, как сервис научится новой версии;
      2. список ошибок разбора с `captureThrottled` (стр. 517) — добавить `version`;
      3. таблица `x-dlq-reason` (стр. 519–528) — строка `` | `version` | версия конверта не подписана при `unknownVersion: 'dlq'` | ``;
    - `/idempotency` — два места README:
      1. стр. 416 («возвращает сохранённые статус, тело и `Location` с `Idempotent-Replayed: true`»): добавить `Content-Type` и «в той же сериализации, что первый ответ; записи без `content_type` (до миграции) — как раньше». Рядом — заметка: колонка `content_type` требует миграции сервиса (`drizzle-kit generate`);
      2. стр. 432 (`redact`, «Ответ-массив и не объект сохраняются как есть»): поля скрываются только у простого объекта; массив, строка, число, `Date`, `Buffer`, экземпляр класса (в т. ч. с `toJSON`) — как есть;
    - `/testing`, `createTestDb` (стр. 679, 1039–1041): `createTestDb({url, service, max?})` → `{db, pools: {main, read}, close()}`. `KitTestDb` — с `pools`. `KIT_DB_CONNECTION_TIMEOUT_MS` — срок установки соединения в CLI, миграциях и `createTestDb`. Это не `DB_POOL_ACQUIRE_TIMEOUT_MS`: тот — срок взятия соединения пулом приложения. Тест «пул приложения не отдаёт соединение» берёт значение из окружения приложения или умолчания `envDatabase`.
  - Логи: нет.

- [ ] **Task 6: CHANGELOG и версия** — G14, NFR-5 (depends on 5)
  - **Skill:** none (Markdown, JSON)
  - `CHANGELOG.md`: заголовок `## [1.0.0-rc.8] - 2026-11-13` (ASCII-дефис, как `## [1.0.0-rc.7] - 2026-11-13`) сразу под `## [Unreleased]`, разделы в порядке rc.7:
    - `### Changed`: повтор идемпотентности с `Content-Type` и сериализацией первого ответа;
    - `### Added`: `unknownVersion` у `subscriber.on`, `x-dlq-reason: version`; `createTestDb({max})` и `pools`; колонка `content_type`;
    - «Как перейти»:
      1. миграция `content_type` в схеме сервиса (`drizzle-kit generate` после обновления пакета; без неё запросы с `Idempotency-Key` падают на несуществующей колонке);
      2. `unknownVersion` — по умолчанию поведение rc.7, `'dlq'` — по желанию для событий, которые нельзя потерять;
      3. `createTestDb` — новое поле, старый код работает.
  - `package.json`: `"version": "1.0.0-rc.8"`.
  - Логи: нет.

### Фаза 6: проверка

- [ ] **Task 7: полная проверка** (depends on 1b, 2c, 3b, 4, 6)
  - Команды по одной (правило пользователя: без `&&`):
    1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
    2. `pnpm db:fixtures` — «No schema changes»; затем `git status --short test/fixtures/database test/consumer/minimal/drizzle` показывает только новые миграции задачи 2b;
    3. `free -h` и `uptime`: available ≥ 3 ГБ, load < 5. Иначе — стоп и сообщить пользователю;
    4. `make test-full` (I, T, R, C — потребитель на упакованном архиве с новой миграцией).
  - Падения не маскировать подъёмом сроков; правки существующих тестов — только по изменению поведения v1.28, каждая — в отчёт (файл, было → стало, основание).
  - Соседние репозитории не трогать.

## Traceability

| UC/AC | Задачи | Тест |
|---|---|---|
| UC-6, AC-5.22 (`unknownVersion`, `x-dlq-reason: version`) | 1a, 1b | `test/integration/messaging/ac-5-22-unknown-version-dlq.spec.ts` — `AC-5.22: on(E v1, h, {unknownVersion: 'dlq'}) …`; `test/integration/messaging/ac-5-22-version-dispatch.spec.ts` — `AC-5.22: unknownVersion: 'dlq' — конверт v1 …`, `AC-5.22: unknownVersion: 'dlq' у on v1 и on v2 …`, `AC-5.22: разные unknownVersion …`, `AC-5.22: unknownVersion вне …`; `test/unit/messaging/ac-5-22-unknown-version.test-d.ts` |
| UC-7, AC-4.14 (Content-Type и сериализация повтора, `content_type`) | 2a, 2b, 2c | `test/integration/idempotency/ac-4-14-content-type.spec.ts` — `AC-4.14: объект/массив/строка/число/toJSON/text/csv/пусто — повтор совпадает …`, `AC-4.14: запись без content_type …` |
| UC-7, AC-4.14 (`redact` — простой объект, имена) | 2a (сверка) | `test/integration/idempotency/ac-4-14-redact.spec.ts` (существующий) |
| UC-14, AC-4.19 (`max`, `pools`) | 3a, 3b | `test/integration/testing/ac-4-19-create-test-db.spec.ts` — `AC-4.19: createTestDb({max: 1}) …`, `AC-4.19: countQueries(pools.main, …) …`, `AC-4.19: max вне …` |
| AC-9.7 (`UNKNOWN_COMMAND`) | 4 | `test/unit/cli/ac-9-7-help.spec.ts` — `AC-9.7: неизвестная команда …` |
| §3.8 `KitOutboxTrace` | — | существующий экспорт `src/testing/index.ts`, README стр. 1034 |
| AC-9.3 (README, CHANGELOG) | 5, 6 | `make test-full` (уровень R) |
