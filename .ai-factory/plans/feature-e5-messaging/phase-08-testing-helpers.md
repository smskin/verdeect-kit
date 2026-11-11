# Phase 8: Помощники `/testing` — `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`

Plan: [index.md](index.md)
Tasks: 32-34
Depends on: Phase 3 (Tasks 11, 12), Phase 5 (Tasks 19–21), Phase 6 (Tasks 25, 26 — `TestConsumer`)

## Objective

§3.8, строки этапа E5:

- `expectOutbox(tx, Event, {subjectId?, data?})` проверяет запись события в текущей транзакции. После успешной проверки он дописывает `<type>.v<version>` в файл своего воркера в каталоге прогона.
- `startTestStack({outboxEvents})` создаёт каталог прогона (путь передаётся через `provide`). При `KIT_OUTBOX_COVERAGE=1` его teardown вызывает `assertOutboxCoverage(outboxEvents)`: объединяет файлы воркеров и падает со списком непокрытых типов. Без переменной проверка не выполняется.
- `publishTestEvent(Event, data, opts?)` отправляет конверт `01` §7.1 в exchange.
- `waitForInbox(id, {timeoutMs})` ждёт обработки без `sleep` в тесте.

`/testing` не импортирует `/messaging` статически (без `amqplib` `/testing` грузится).

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `src/testing/start-test-stack.ts:25-60, 271-…` | `TestStackOptions`, `ProvidedContext`, teardown | `outboxEvents`, каталог прогона |
| `src/testing/worker-scope.ts` | `workerScope()`, `VITEST_POOL_ID`, `inject` (задача 12) | файл воркера, vhost |
| `src/testing/index.ts` | явный список экспортов | новые экспорты |
| O `test/support/bus.ts` (98) | `platformEnvelope`, `publishEvent`, `waitInbox` — опрос `orchestrator.inbox` | эталон `publishTestEvent`/`waitForInbox` |
| `src/messaging/envelope.ts`, `define-event.ts` (задача 5) | `EnvelopeSchema`, `buildEnvelope`, `KitEvent` | конверт; `/testing` импортирует `envelope.ts`/`define-event.ts` напрямую — в них нет `peer.ts` и `amqplib` |
| `src/internal/outbox-policy.ts` | `OUTBOX_TABLE`, `INBOX_TABLE` | имена таблиц |
| `src/internal/ids.ts` | `newId` | id конверта |
| `src/internal/rabbitmq-definitions.ts` | `EVENTS_EXCHANGE` | exchange |
| `src/internal/peer.ts` | `loadPeer` | `amqplib`, `pg` — при вызове |
| PRD §3.8 | `expectOutbox` — «после успешной проверки дописывает»; `teardown` при `KIT_OUTBOX_COVERAGE=1` (задаётся в `make test-integration` и CI) | контракт |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/testing/outbox-coverage.ts` | create | `expectOutbox`, `assertOutboxCoverage`, запись и сбор покрытия |
| `src/testing/test-events.ts` | create | `publishTestEvent`, `waitForInbox` |
| `src/testing/start-test-stack.ts` | modify | `outboxEvents`, каталог прогона, `kitOutboxCoverageDir`, вызов покрытия в teardown |
| `src/testing/index.ts` | modify | экспорты |
| `Makefile` | modify | `KIT_OUTBOX_COVERAGE=1` в `test-integration` |
| `test/unit/testing/outbox-coverage.spec.ts`, `test/integration/testing/ac-5-13-*.spec.ts` | create | U, I |

## Task 32: `expectOutbox`, `assertOutboxCoverage`, `outboxEvents`

### Intent
§3.8, GAP-2 ревью r1, UC-14 шаг 5 и А1, AC-5.13. Каждое публикуемое событие должно иметь тест, который видит его строку outbox в транзакции use-case.

### Implementation Steps
1. `src/testing/outbox-coverage.ts` (`Skill: nestjs-code generic src/testing/outbox-coverage.ts (CREATE)`). Шапка: «expectOutbox, assertOutboxCoverage (prd.md §3.8 E5, GAP-2, UC-14, AC-5.13). Покрытие — файлы воркеров в каталоге прогона startTestStack; teardown при KIT_OUTBOX_COVERAGE=1».
2. Ключ покрытия: `coverageKey(event) = \`${event.type}.v${event.version}\``.
3. `expectOutbox<E extends KitEvent>(tx: DbTx, event: E, expected: {subjectId?: string; data?: Partial<z.input<E['data']>>} = {}): Promise<void>`:
   1. Схема: `inject('kitDatabaseService')` — схема = имя сервиса (`prepareDatabase`, E4). Нет → `TypeError('expectOutbox: startTestStack запущен без postgres')`.
   2. Строки **этой транзакции** — `const result = await tx.execute(sql\`select id, subject_id, tenant, data from ${sql.raw(quoteIdentifier(schema))}.${sql.raw(quoteIdentifier(OUTBOX_TABLE))} where type = ${event.type} and version = ${event.version} and xmin = pg_current_xact_id()::xid order by seq\`)`, строки — `result.rows` (`DbTx` — node-postgres, `execute` возвращает `QueryResult`) (решение П16). Параметрами идут только `type`, `version` (и `subjectId`, если задан); идентификаторы — только `sql.raw(quoteIdentifier(…))`: обычная подстановка `${…}` в шаблоне Drizzle стала бы параметром (`from $1.outbox` — ошибка 42601). Образец — `src/idempotency/kit-idempotency.module.ts:160`; `OUTBOX_TABLE` — из `src/internal/outbox-policy.ts`. Приведение `xid8 → xid` проверить на PostgreSQL 17. Если его нет — `xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text`. Строки других транзакций (в том числе уже закоммиченные тестами раньше) не учитываются.
   3. Фильтр `subjectId` (если задан).
   4. Проверки — через `expect` из `vitest` (`const { expect, inject } = await loadPeer<typeof Vitest>('vitest', 'testing')` **внутри** `expectOutbox`, как `src/testing/scratch-database.ts:81`; не на верхнем уровне — `start-test-stack.ts` импортирует `outbox-coverage.ts`, и `/testing` без `vitest` перестал бы импортироваться до проверки `testcontainers`). Так же — `inject` внутри `publishTestEvent` и `waitForInbox` (задача 33):
      - строк ≥ 1 — `expect(rows, \`expectOutbox: нет строки ${key}${subject} в транзакции\`).not.toHaveLength(0)`;
      - `data` каждой подходящей строки проходит `event.data` (`safeParse`) — иначе `expect.fail` с путями;
      - `expected.data` задан → хотя бы одна строка `toMatchObject(expected.data)`; сообщение vitest показывает расхождение.
   5. Только после всех проверок — `appendFileSync(join(dir, \`w${VITEST_POOL_ID ?? '0'}.txt\`), key + '\n')`, `dir = workerCoverageDir ?? inject('kitOutboxCoverageDir')`, где `workerCoverageDir` задаёт `/** @internal */ export function setWorkerCoverageDir(dir: string | undefined): void` (модульная переменная; нужна тесту пакета задачи 34 — у `globalSetup` пакета нет `outboxEvents`). Каталога нет (стек без `outboxEvents`) — запись пропускается: покрытие не включено. Упавшая проверка до записи не доходит (AC-5.13 «упавший `expectOutbox` покрытия не даёт»).
4. `assertOutboxCoverage(events: readonly KitEvent[]): void`:
   1. `dir` — модульная переменная `coverageDir`, её задаёт `startTestStack` в процессе `globalSetup`. Не задана → `TypeError('assertOutboxCoverage: вызывается из teardown startTestStack({outboxEvents})')`. Сигнатура PRD — `assertOutboxCoverage(events)`.
   2. Прочитать все `*.txt` каталога, собрать множество ключей.
   3. `missing = events.map(coverageKey).filter(k => !covered.has(k))`, дубликаты ключей в `events` убираются.
   4. `missing.length > 0` → `throw new Error(\`assertOutboxCoverage: события без успешного expectOutbox: ${missing.join(', ')}\`)`. Сообщение — в stderr до throw (Vite теряет текст ошибок globalSetup, как у `startTestStack`).
5. `start-test-stack.ts` (`Skill: nestjs-code generic src/testing/start-test-stack.ts (MODIFY)`):
   - `TestStackOptions` + `readonly outboxEvents?: readonly KitEvent[]` (TSDoc: «события, которые публикует сервис; при `KIT_OUTBOX_COVERAGE=1` teardown падает со списком событий без успешного `expectOutbox`, GAP-2»). `KitEvent` — `import type` из `../messaging/define-event.js`;
   - при `outboxEvents` (любой длины): `dir = mkdtempSync(join(tmpdir(), \`kit-outbox-${service}-\`))`, `setCoverageDir(dir)` (внутренняя функция `outbox-coverage.ts`), `project.provide('kitOutboxCoverageDir', dir)`; `ProvidedContext` + `kitOutboxCoverageDir?: string`;
   - teardown: **сначала** остановка контейнеров и удаление vhost, **затем** при `options.outboxEvents !== undefined && process.env.KIT_OUTBOX_COVERAGE === '1'` (без `outboxEvents` — пакет сам и сервисы без событий — проверка не выполняется даже с переменной) вызов `assertOutboxCoverage(outboxEvents)`. Ошибка покрытия выходит из teardown после освобождения ресурсов. Каталог удаляется (`rmSync recursive`) в `finally`;
   - без переменной — `debug`-строка в stderr не нужна; проверка молча не выполняется (PRD).
6. `Makefile` (`Skill: none — Makefile`): цель `test-integration` (стр. 98–99) `$(PNPM) test:integration` → `KIT_OUTBOX_COVERAGE=1 $(PNPM) test:integration`. `.github/workflows/ci.yml` вызывает `make test-integration` (job `test`) — workflow не меняется. Пакет сам `outboxEvents` в своём `globalSetup` не передаёт: событий пакета нет, фикстура покрытия — задача 34.
6а. `test/unit/testing/start-test-stack.spec.ts` (`Skill: nestjs-code test unit testing start-test-stack (MODIFY)`): случай `AC-5.13: KIT_OUTBOX_COVERAGE=1 без outboxEvents — teardown не бросает` (`vi.stubEnv` в этом файле unit-набора; фальшивый `project`, как у существующего случая AC-1.12).
7. `src/testing/index.ts` (`Skill: nestjs-code generic src/testing/index.ts (MODIFY)`): `export { assertOutboxCoverage, expectOutbox } from './outbox-coverage.js';`. В этой же задаче (`Skill: none — документация`) — README `### @verdeect/kit/testing` (строки `` `expectOutbox` ``, `` `assertOutboxCoverage` ``) и CHANGELOG `[Unreleased]` `Added` с теми же именами: `ac-9-3-docs.spec.ts` (`make pack-check`) иначе красный до задачи 37.

### Required Interfaces and Contracts
- `expectOutbox(tx, Event, {subjectId?, data?})`, `assertOutboxCoverage(events)` — §3.8.
- `tx` — `DbTx` (`import type` из `/database`).

### Error Handling and Logging
- Ошибки — утверждения vitest и `TypeError` с понятным текстом. Логов нет.

### Tests
Задача 34.

### Acceptance Criteria
- Успешный `expectOutbox` пишет ключ; упавший — нет.

### Verification
- Задача 34.

## Task 33: `publishTestEvent`, `waitForInbox`

### Intent
§3.8, UC-14 шаг 3, AC-5.13 «проверяют обработчик без `sleep`».

### Implementation Steps
1. `src/testing/test-events.ts` (`Skill: nestjs-code generic src/testing/test-events.ts (CREATE)`). Шапка: «publishTestEvent, waitForInbox (prd.md §3.8 E5, UC-14, AC-5.13). Эталон O test/support/bus.ts (publishEvent, waitInbox)».
2. `publishTestEvent<E extends KitEvent>(event: E, data: z.input<E['data']>, opts: {id?: string; tenant?: string | null; subjectId?: string; occurredAt?: Date; actor?: Record<string, unknown> | null; traceId?: string | null} = {}): Promise<Envelope<E>>`:
   1. `parsed = event.data.parse(data)` — неверные данные теста дают `ZodError` сразу.
   2. `tenant`: `opts.tenant` задан (в том числе `null`) → его значение, даже если оно нарушает признак. Так тесты AC-5.15 подписчика сервиса могут отправить нарушение. Иначе `'required'` → `workerScope().tenant`, `'none'` → `null`.
   3. Конверт: `{id: opts.id ?? newId('evt'), type, version, occurredAt: (opts.occurredAt ?? new Date()).toISOString(), tenant, actor: opts.actor ?? {channel: 'system'}, subject: {kind: event.subject, id: opts.subjectId ?? newId('tst')}, data: parsed, traceId: opts.traceId ?? null}`; `EnvelopeSchema.parse(envelope)`.
   4. Публикация: `amqplib` — `loadPeer('amqplib', 'testing')` при вызове; соединение — `inject('kitRabbitmqWorkers')[poolId − 1].adminUrl`, одно на воркер (мемоизация, `unref` сокета не нужен — `afterAll` не требуется: соединение закрывается на `process.exit` воркера). Confirm-канал `publish(EVENTS_EXCHANGE, type, Buffer.from(JSON.stringify(envelope)), {persistent: true, messageId: id, type, contentType: 'application/json', timestamp})` + `waitForConfirms()`.
   5. Возврат — `envelope` (типизированный `Envelope<E>`).
   TSDoc: «Конверт `01` §7.1 от имени администратора vhost воркера, как от relay другого сервиса».
3. `waitForInbox(id: string, options: {timeoutMs: number}): Promise<void>`:
   1. Схема — `inject('kitDatabaseService')`, адрес — `inject('kitDatabaseUrl')` (роль `<svc>_app`; inbox без RLS). `pg` — `loadPeer('pg', 'testing')`, `Client` на вызов.
   2. Опрос `select 1 from "<s>"."inbox" where id = $1` с шагом 20 мс до `timeoutMs × TEST_TIMEOUT_SCALE`. Это ожидание внешнего процесса, а не пауза теста; в тесте `sleep` не нужен.
   3. Срок вышел → `Error(\`waitForInbox: событие ${id} не обработано за ${timeoutMs} мс (нет строки в ${schema}.inbox)\`)`. `Client.end()` в `finally`.
   TSDoc: только для `dedupe: 'inbox'`. Для `'none'` ждать побочный эффект обработчика.
4. `src/testing/index.ts` (`Skill: nestjs-code generic src/testing/index.ts (MODIFY)`): `export { publishTestEvent, waitForInbox } from './test-events.js';`. В этой же задаче (`Skill: none — документация`) — README `### @verdeect/kit/testing` и CHANGELOG `Added` с `` `publishTestEvent` ``, `` `waitForInbox` `` (та же причина, что в задаче 32).

### Required Interfaces and Contracts
- `publishTestEvent(Event, data, opts?)`, `waitForInbox(id, {timeoutMs})` — §3.8.

### Error Handling and Logging
Нет логов; ошибки — понятный текст без паролей.

### Tests
Задача 34.

### Acceptance Criteria
- Обработчик сервиса проверяется `publishTestEvent` + `waitForInbox` без `sleep`.

### Verification
- Задача 34.

## Task 34: Тесты помощников — U и I (AC-5.13 на уровне пакета)

### Implementation Steps
1. `test/unit/testing/outbox-coverage.spec.ts` (`Skill: nestjs-code test unit testing outbox-coverage (CREATE)`):
   - `AC-5.13: assertOutboxCoverage объединяет файлы воркеров и падает со списком непокрытых`;
   - `AC-5.13: все покрыты — без ошибки; без каталога — TypeError`.
   Каталог — `mkdtemp`, внутренняя `setCoverageDir`.
2. `test/integration/testing/ac-5-13-expect-outbox.spec.ts` (`Skill: nestjs-code test integration testing expect-outbox (CREATE)`). Каталог покрытия у пакета не задан (`globalSetup` без `outboxEvents`): тест подставляет каталог внутренней `setWorkerCoverageDir(dir)` (задача 32) и сбрасывает её `setWorkerCoverageDir(undefined)` в `afterAll`: проект `shared` (`isolate: false`) иначе сохранил бы значение для следующих файлов.
   - `AC-5.13: expectOutbox находит строку события в транзакции и пишет ключ kit.note.created.v1 в файл воркера`;
   - `AC-5.13: упавший expectOutbox (нет строки / data не совпала) — ключ не записан`;
   - `AC-5.13: строка другой (закоммиченной) транзакции не засчитывается`;
   - `UC-14: publishTestEvent + waitForInbox — обработчик подписчика вызван, без sleep` (стенд `subscriber {inbox}` с `providers: [TestConsumer]` из `test/support/messaging.ts`, задача 26; до создания стенда — `await resetQueues()`, задача 21);
   - `UC-14: publishTestEvent — тенант воркера для 'required', null для 'none'; EnvelopeSchema`;
   - `UC-14: waitForInbox — срок вышел → ошибка с id`.
   Проверка teardown с `KIT_OUTBOX_COVERAGE=1` на уровне пакета — U (п. 1) и C (задача 36: проект-потребитель запускается с переменной и без неё).

### Tests
Перечислены.

### Acceptance Criteria
- Помощники §3.8 этапа E5 покрыты U и I; C — в фазе 9.

### Verification
- `make test FILTER='AC-5.13'`; `make test-integration FILTER='AC-5.13|UC-14'`.

## Phase Risks and Mitigations
- Риск: `inject` недоступен в процессе `globalSetup` при импорте `outbox-coverage.ts`. Смягчение: `inject` вызывается только внутри `expectOutbox`/`publishTestEvent` (в воркере), а не при загрузке модуля.
- Риск: `/testing` статически импортирует `messaging/envelope.ts`, а тот — `zod` и `internal`. Смягчение: в `envelope.ts`/`define-event.ts` нет `peer.ts`. Тест AC-1.1 (`test/package/ac-1-1-package.spec.ts`) проверяет, что граф `dist/testing` не содержит `amqplib` статически (задача 36).

## Phase Completion Checklist
- Задачи 32–34 выполнены; `make test`, `make test-integration` зелёные.
- `index.md` обновлён.
