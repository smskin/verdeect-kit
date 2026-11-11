# Фаза 1: Основа — решения E4, зависимости и lint `/messaging`

Plan: [index.md](index.md)
Tasks: 1-3
Depends on: none

## Цель

До кода `/messaging` закрыть решения review E4, от которых зависит очистка outbox/inbox. Первое: соединение `runExclusive` возвращается в пул без сеансового состояния (`RESET ALL`), а TSDoc запрещает `SET` и `set_config(…, false)` внутри `fn`. Второе: `countQueries` получает колбэк на каждый запрос, он заменяет локальный `watchQueries`. Третье: мелочи CHANGELOG и TSDoc. Кроме того, в devDependencies появляются `amqplib` и `amqp-connection-manager` точных версий, а в lint — блок границ `src/messaging/**`.

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| `src/database/run-exclusive.ts` | `runExclusive` (весь файл, 50 строк): `withPoolClient(mainPoolOf(db), …)`, `pg_try_advisory_lock`, `finally` → `pg_advisory_unlock`, при сбое — `client.emit('error')` | место `RESET ALL` |
| `src/database/batches.ts:24-31` | `KitDeleteInBatchesOptions.connection` и его TSDoc | дополнение TSDoc (review E4) |
| `src/database/db.ts:134-160` | `withPoolClient` — `release(broken)` | сломанный клиент уничтожается пулом |
| `src/testing/count-queries.ts:30-…` | `countQueries(pool, fn)`, `KitCountablePool`, `textOf` | новая опция `onQuery` |
| `test/integration/idempotency/ac-4-14-cleanup.spec.ts:21-…, 186` | локальный `watchQueries(pool, fragment)` — сигнал первой пачки | заменить на `countQueries(…, {onQuery})` |
| `test/integration/database/ac-4-12-run-exclusive.spec.ts` | тесты AC-4.12 | новый случай «сеанс сброшен» |
| `CHANGELOG.md:86-100` | `### Fixed`; пустая строка внутри списка — стр. 96 | review E4 |
| `package.json` | `peerDependencies` уже содержат `amqplib ^2.2.0`, `amqp-connection-manager ^5.0.0` (optional); в devDependencies их нет; lock ставит `amqplib@2.3.0` через `autoInstallPeers` | точные dev-версии по `inventory.md` §3 |
| `test/unit/package/package-manifest.spec.ts:144-160` | точные версии devDependencies, список `dependencies` | проверка манифеста |
| `eslint.config.js:17-…, 57, 172-297` | `COMMON_PATTERNS` (запрет значений `amqplib`, `amqp-connection-manager`, `pg`…), `restrictedImports(extra, {allowAjv})`, блоки подпутей; блока `src/messaging/**` нет | границы `messaging` по ARCHITECTURE «Правила зависимостей» |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `src/database/run-exclusive.ts` | modify | `RESET ALL` после снятия блокировки; TSDoc — запрет `SET` / `set_config(…, false)` |
| `src/database/batches.ts` | modify | TSDoc `connection` — транзакции `Db` внутри `fn` берут другое соединение |
| `test/integration/database/ac-4-12-run-exclusive.spec.ts` | modify | случай «сеанс соединения сброшен» при `DB_POOL_MAX = 1` |
| `src/testing/count-queries.ts` | modify | третий параметр `options?: {onQuery?}` |
| `test/integration/testing/ac-4-15-count-queries.spec.ts` | modify | случай `onQuery` |
| `test/integration/idempotency/ac-4-14-cleanup.spec.ts` | modify | `watchQueries` → `countQueries(…, {onQuery})` |
| `CHANGELOG.md` | modify | `Fixed` без пустой строки; записи задач 1–2 |
| `package.json`, `pnpm-lock.yaml` | modify | devDependencies `amqplib` 2.2.0, `amqp-connection-manager` 5.0.1 |
| `test/unit/package/package-manifest.spec.ts` | modify | точные dev-версии двух пакетов |
| `eslint.config.js` | modify | блок `src/messaging/**`; текст запрета peer |

## Task 1: `runExclusive` сбрасывает сеанс соединения перед возвратом в пул

### Назначение
Решение E4 (KT-22 п. 4): `runExclusive` передаёт в `fn` соединение, которое держит блокировку. Очистка outbox/inbox (задача 29) удаляет пачки на нём (`deleteInBatches({connection})`), второе соединение не берёт, поэтому работает при `DB_POOL_MAX = 1`. Если `fn` оставит на соединении сеансовую настройку (`SET statement_timeout`, `set_config('app.x', …, false)`), её получит следующий запрос пула, в том числе под другим тенантом. Предложение review E4: `RESET ALL` перед возвратом в пул и явный запрет в TSDoc.

### Шаги
1. `src/database/run-exclusive.ts` (`Skill: nestjs-code generic src/database/run-exclusive.ts (MODIFY)`):
   1. В `finally` после успешного `pg_advisory_unlock` выполнить `await client.query('RESET ALL')`. Порядок фиксирован: `fn` → unlock → `RESET ALL` → возврат клиента (`withPoolClient`). `DISCARD ALL` **не** используется: он снимает advisory-блокировки сеанса до `unlock` и закрывает подготовленные выражения драйвера.
   2. Если `RESET ALL` бросил — `logger.warn({key, err: sanitizeError(error)}, 'runExclusive: сбросить сеанс не удалось')` и `client.emit('error', …)`, как при сбое `unlock`. `withPoolClient` вызывает `release(broken)`, пул уничтожает клиента.
   3. При сбое `unlock` `RESET ALL` не выполняется: клиент уже помечен сломанным.
   4. В ветке «занято» (`{ran: false}`) `fn` не вызывался, сеанс не менялся — `RESET ALL` не нужен.
   5. TSDoc `runExclusive` дополнить абзацем: «Внутри `fn` на переданном соединении запрещены `SET` (без `LOCAL`) и `set_config(…, false)`: сеансовые настройки — тенант `app.tenant` в том числе — пережили бы `fn`. Перед возвратом в пул пакет выполняет `RESET ALL`. Настройки транзакции — `SET LOCAL` или `set_config(…, true)` внутри транзакции (`deleteInBatches` делает это сам)».
   6. Шапку файла дополнить: «review E4: RESET ALL перед возвратом соединения».
2. `src/database/batches.ts` (`Skill: nestjs-code generic src/database/batches.ts (MODIFY)`): TSDoc поля `connection` дополнить: «Транзакции `Db` (`db.transaction`, `db.read`) внутри `fn` `runExclusive` идут на других соединениях пула. На соединении блокировки работают только пачки этого вызова». Код не меняется.

### Контракты
- Сигнатура `runExclusive` не меняется. Меняется поведение: после возврата соединения в пул значения `current_setting` равны значениям по умолчанию сервера.
- Значения настроек в лог не пишутся. В логе — только `key` и `sanitizeError`.

### Ошибки и логи
- `warn` `runExclusive: сбросить сеанс не удалось` (`key`, `err`) — клиент уничтожается.
- `debug` не добавляется.

### Тесты
`test/integration/database/ac-4-12-run-exclusive.spec.ts` (`Skill: nestjs-code test integration database run-exclusive (MODIFY)`), новый случай:
- `AC-4.12: сеанс соединения блокировки сброшен перед возвратом в пул (DB_POOL_MAX = 1)`. Стенд — `createTestDb({poolMax: 1})` из `test/support/database.ts`.
  1. `runExclusive(db, 'kit-test:reset', async (c) => { await c.query("set statement_timeout = 1234"); await c.query("select set_config('app.leak', 'x', false)"); })`.
  2. Затем `const { rows } = await testDb.main.query("select current_setting('statement_timeout') as st, current_setting('app.leak', true) as leak")` — основной пул (`runExclusive` берёт соединение из `mainPoolOf(db)`), при `poolMax: 1` это то же соединение. `readGlobal` не годится: он идёт в пул чтения с `statement_timeout=5000`.
  3. Ожидание: `st` — значение по умолчанию сервера (`'0'`), `leak` — `''` или `null`.
- Существующие случаи AC-4.12 остаются зелёными.

### Критерии приёмки
- После `runExclusive` следующий запрос того же соединения не видит сеансовых настроек `fn`.
- TSDoc запрещает `SET` и `set_config(…, false)` внутри `fn`.

### Проверка
- `make test-integration FILTER='AC-4.12'` — зелёный.
- `make lint`.

## Task 2: `countQueries` — колбэк на каждый запрос

### Назначение
Review E4: тест «остановка во время прохода» (`ac-4-14-cleanup.spec.ts`) держит свою копию обёртки клиентов `watchQueries`, чтобы получить сигнал первой пачки без паузы. Та же техника понадобится очистке outbox/inbox (задача 31). Публичный помощник `countQueries` (§3.8) получает опцию `onQuery`, локальная копия удаляется.

### Шаги
1. `src/testing/count-queries.ts` (`Skill: nestjs-code generic src/testing/count-queries.ts (MODIFY)`):
   1. Новый экспортируемый тип `KitCountQueriesOptions {readonly onQuery?: (text: string) => void}`. TSDoc: «Вызывается синхронно до отправки каждого запроса пула за время `fn` с текстом SQL без параметров. Исключение колбэка не прерывает запрос, а пробрасывается из `countQueries` после `fn`».
   2. Сигнатура: `countQueries<T>(pool, fn, options?: KitCountQueriesOptions)`.
   3. В обёртке `client.query` после `queries.push(text)` вызвать `options?.onQuery?.(text)` внутри `try/catch`. Первое исключение сохранить в `callbackError`. После `fn` (в том числе неуспешной) — если `fn` прошла успешно, а `callbackError` есть, бросить его.
2. `src/testing/index.ts` (`Skill: nestjs-code generic src/testing/index.ts (MODIFY)`) — `export type { KitCountQueriesOptions }`. README (`Skill: none — документация`) — строка из «Контракты».
3. `test/integration/idempotency/ac-4-14-cleanup.spec.ts` (`Skill: nestjs-code test integration idempotency cleanup (MODIFY)`):
   1. Удалить функцию `watchQueries` (стр. 21–…).
   2. Случай «остановка во время прохода» переписать так:
      ```ts
      let signal!: () => void;
      const firstBatch = new Promise<void>((resolve) => { signal = resolve; });
      const { queries } = await countQueries(mainPoolOf(stand.app.get(Db)), async () => {
          const run = stand.cleanup.run({ batchSize: 2, maxBatches: 100 });
          await firstBatch;
          await stand.cleanup.beforeApplicationShutdown();
          await run;
      }, { onQuery: (text) => { if (text.includes('idempotency_purge')) { signal(); } } });
      ```
   3. Проверка числа пачек `expect(purge.count()).toBe(1)` (стр. ~197, держатель `watchQueries` удалён) → `expect(queries.filter((t) => t.includes('idempotency_purge'))).toHaveLength(1)`. Остальные проверки случая (метрика `interrupted`, оставшиеся строки) не менять.

### Контракты
- Без `options` поведение и результат прежние (`{result, count, queries}`).
- Публичная поверхность `/testing` растёт: тип `KitCountQueriesOptions` и параметр. Нужны TSDoc, CHANGELOG и README **в этой задаче**: `test/package/ac-9-3-docs.spec.ts` (`make pack-check`) требует каждый экспорт `src/testing/index.ts` в README `## API` и в CHANGELOG `[Unreleased]`. README `### @verdeect/kit/testing` + строка `` `KitCountQueriesOptions` ``; строка CHANGELOG (задача 3) называет и `` `KitCountQueriesOptions` ``.

### Ошибки и логи
Нет (помощник тестов).

### Тесты
- `test/integration/testing/ac-4-15-count-queries.spec.ts` (`Skill: nestjs-code test integration testing count-queries (MODIFY)`), случай `AC-4.15: onQuery получает текст каждого запроса по порядку` — `queries` и тексты из колбэка совпадают.
- `ac-4-14-cleanup.spec.ts` зелёный без `watchQueries`.

### Критерии приёмки
- В репозитории нет `watchQueries` (`grep -rn watchQueries test src` — пусто).

### Проверка
- `make test-integration FILTER='AC-4.1[45]'`.

## Task 3: Зависимости AMQP, lint `src/messaging/**`, CHANGELOG

### Назначение
NFR-3: `amqplib` 2.2.0 и `amqp-connection-manager` 5.0.1 уже объявлены опциональными peer, но точных версий в devDependencies нет. Тесты сейчас получили бы `amqplib@2.3.0` из `autoInstallPeers`. ARCHITECTURE «Правила зависимостей»: `messaging` импортирует значения только из `observability`, `config`, `internal`, а из `database` — только `import type`. Значения `database` грузятся динамическим `import()` в `forRoot` (решение П5). Ещё нужны мелочи review E4 в CHANGELOG.

### Шаги
1. `package.json` (`Skill: none — манифест`): в `devDependencies` добавить `"amqplib": "2.2.0"`, `"amqp-connection-manager": "5.0.1"` (по алфавиту). Затем `pnpm install`, lock обновлён. Типы: `amqplib` 2.2.0 — проверить, что пакет содержит `index.d.ts` (в 2.3.0 он есть). Если в 2.2.0 его нет, добавить `@types/amqplib` точной версии, совместимой с 2.x, и записать это решение в шапку `src/messaging/rabbit-connection.ts` (задача 14). Проверка: `ls node_modules/amqplib/*.d.ts`. Версию API проверить по Context7 (`amqp-connection-manager`: `connect`, `ChannelWrapper.addSetup`, `cancelAll`, `consume`; `amqplib`: `ConfirmChannel.checkExchange`, `assertQueue`).
2. `test/unit/package/package-manifest.spec.ts` (`Skill: nestjs-code test unit package manifest (MODIFY)`): в проверку точных devDependencies добавить два пакета (`'2.2.0'`, `'5.0.1'`). Значения `peerDependencies` (`^2.2.0`, `^5.0.0`) не менять.
3. `eslint.config.js` (`Skill: none — конфиг ESLint`):
   1. Новый блок `files: ['src/messaging/**/*.ts']` на `restrictedImports([...], {allowAjv: false})`. Дополнительные шаблоны (`group`, `message` по-русски):
      - `../testing/*`, `../http/*`, `../idempotency/*`, `../redis/*`, `../crypto/*`, `../cli/*` — «messaging импортирует только observability, config, internal (ARCHITECTURE)»;
      - `../database/*` с `allowTypeImports: true` — «значения database — только динамическим import() в KitMessagingModule.forRoot (pg — только при outbox или inbox, AC-1.2)».
   2. Текст сообщения общего запрета peer (`COMMON_PATTERNS`, сейчас называет только `src/database/pg.ts`) расширить: «… — только requirePeer + import() при вызове (src/database/pg.ts, src/messaging/peer.ts) или loadPeer».
   3. Блоки `observability`, `http`, `database`, `idempotency` уже запрещают `../messaging/*` (`eslint.config.js:199, 221–222, 244, 261`), блок `cli` — статический `**/messaging/*` (стр. 285): не меняются. Команда CLI `rabbitmq` грузит только `internal/rabbitmq-definitions.js` динамическим `import()` — `no-restricted-imports` его не проверяет.
4. `CHANGELOG.md` (`Skill: none — Keep a Changelog`):
   1. В `### Fixed` убрать пустую строку внутри списка (стр. 96). Список становится сплошным.
   2. `### Fixed` + «`/database`: `runExclusive` сбрасывает сеанс соединения блокировки (`RESET ALL`) перед возвратом в пул; TSDoc запрещает `SET` и `set_config(…, false)` внутри `fn`».
   3. `### Changed` + «`/testing`: `countQueries(pool, fn, {onQuery})` и тип `KitCountQueriesOptions` — колбэк на каждый запрос».
   4. Пустые строки внутри списка `Changed` (стр. 81, 83) тоже убрать: тот же дефект форматирования.

### Ошибки и логи
Нет.

### Тесты
- `test/unit/package/package-manifest.spec.ts` — зелёный с новыми версиями.
- `test/package/ac-9-4-lint-rules.spec.ts` — существующий, без изменений.

### Критерии приёмки
- `pnpm why amqplib` показывает 2.2.0 в devDependencies.
- `make lint` зелёный.
- В CHANGELOG нет пустых строк внутри списков разделов.

### Проверка
- `make analyse`; `make lint`.

## Риски фазы
- Риск: `RESET ALL` сбрасывает `search_path`, заданный в URL соединения (`options=-c search_path=…`). Смягчение: `RESET` возвращает значение к умолчанию сеанса, а параметры из строки подключения и есть умолчание сеанса. Тест AC-4.12 и весь `test-integration` проверяют, что запросы `Db` после очистки работают.
- Риск: в `amqplib` 2.2.0 нет встроенных типов. Смягчение: шаг 1 задачи 3 — проверка и `@types/amqplib`.

## Чек-лист фазы
- Задачи 1–3 выполнены, `make lint`, `make analyse`, `make test`, `make test-integration` зелёные.
- В `index.md` отмечены задачи 1–3.
