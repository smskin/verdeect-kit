# План реализации: выпуск `1.0.0-rc.7` — находки переходов rc.6 (r22, PRD v1.27)

Mode: full
Branch: fix/rc7-transition-findings
Created: 2026-11-13

## Original Request
Реализуй выпуск 1.0.0-rc.7 по пакету требований requirements/0000-kit/ (ревизия r21, PRD v1.26). Скоуп — изменения v1.26 относительно v1.25, по пунктам а–л сообщения KT-73 из этого диалога: deriveKeys и тип KitDerivedKey (AC-7.6); @Idempotent({redact}) (AC-4.14); первое подключение — RABBITMQ_RECONNECT_SECONDS, литеральный name: в assertRepoConventions, глобальные extraProviders; метка COMMENT ON DATABASE и удаление копии и шаблона БД только с меткой, отказ с подсказкой POSTGRES_DB (AC-1.14); shutdownDeadline от начала остановки, внутренний remainingMs() в KitLifecycle (AC-5.11, T); перегрузки createOutboxTable по tenantNullable (AC-5.21); обработчик по паре (type, version), неподписанная версия — ack без обработки и verdeect_events_skipped_total (UC-6 А8, AC-5.22); JSON-парсер в configureFastify — только тест и README (AC-3.12); /testing — подпуть ./testing/timeout-scale с условием default (AC-9.6), workerScope().rabbitmq.adminUrl (AC-1.15), declareEventsExchange (AC-5.10), expectOutbox({app, traceId}) (AC-5.13), createTestDb, KIT_DB_CONNECTION_TIMEOUT_MS, messagingCleanupLockKey (AC-4.19); CLI — формат хеша в INVALID_ENVIRONMENT и --help (AC-5.10, AC-9.7); строки README по пункту л; CHANGELOG [1.0.0-rc.7] с разделом «Как перейти», version 1.0.0-rc.7. Источник истины — requirements/0000-kit/prd.md. На каждый пункт — тест с ID AC; где возможно, сначала тест, падающий на старом коде. Тесты без реальных пауз (правило Test Speed Regressions), сроки не поднимать. Уже реализованный код не переделывать без требования. Соседние репозитории — только чтение: файлы не менять, ветку не переключать, git только log/show/diff, их контуры не поднимать. Перед make test-full — free -h и uptime: available ≥ 3 ГБ, load < 5. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5): U — `test/unit/<подпуть>`, I — `test/integration/<подпуть>` на `startTestStack`, T — `test/timing/<подпуть>`, C — `test/consumer/minimal`, R — `test/package`. Порядок в каждой паре задач «Na — тест, Nb — код»: тест пишется первым и запускается на старом коде; падение (или ошибка компиляции из-за отсутствующего экспорта) фиксируется в отчёте реализации. Реальных пауз в тестах нет: часы — `vi.useFakeTimers()` или подмена `performance.now`, ожидание результата — сигналом или опросом со сроком × `TEST_TIMEOUT_SCALE`. Реальное ожидание допустимо только там, где оно само предмет проверки: срок обработчиков 2 с в T-тесте AC-5.11, срок соединения пула в AC-4.19. Сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino` и адаптеры пакета, без `console.*` (NFR-8, AC-9.4). Значения окружения, секреты, ключи и пароли в логи не попадают. Конкретные строки — в каждой задаче.
- Docs: no — без обязательного чекпоинта `/aif-docs` (`WARN [docs]`). README, CHANGELOG и версию обновляют задачи 15–16 («Library Package Scope» (7), AC-9.3).

## Roadmap Linkage
Milestone: "none"
Rationale: все вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по находкам переходов (G14), отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.27 (r22) > ответы KT-75 (закреплены в PRD v1.27) > решения KT-76 (уточнения PRD — в следующей ревизии) > пункты а–л KT-73 > `ARCHITECTURE.md` / `DESCRIPTION.md`. Скоуп — изменения v1.26 и v1.27 относительно v1.25. Код прошлых выпусков — существующий: расширять, не переписывать.

| Решение | Источник | Проверка |
|---|---|---|
| `deriveKeys` → `{version, key}` в порядке `keys`, HKDF-SHA256, соль пустая, 32 байта, `info = verdeect-<svc>:<purpose>:mac`; проверки — одна внутренняя функция с `createCipher` | §3.6, AC-7.6 | задачи 1a/1b |
| `redact` — копия тела в хранилище, поля верхнего уровня → `null`; ответ клиенту без изменений; массив и не объект — как есть | §3.3а, AC-4.14 | 2a/2b |
| `redact` — имена проверяются при объявлении `@Idempotent`: пустое имя или имя с `.` или `[` → `TypeError` «redact — только поля верхнего уровня» (иначе `['data.secret']` молча сохранит секрет); уточнение PRD — в следующей ревизии | KT-76 п. 4 | 2a/2b |
| Первое подключение — общий срок `RABBITMQ_RECONNECT_SECONDS` на подключение и настройку канала. **Найдено расхождение:** сейчас два срока идут подряд (`subscriber.ts`, `awaitStartupOutcome`), худший случай — 2 × срок. Исправление кода по §3.4, правки PRD не нужно | §3.4 (стр. 129), KT-76 п. 2 | 5a/5b |
| При пропуске неподписанной версии растёт только `verdeect_events_skipped_total`, `verdeect_events_consumed_total` не растёт | KT-76 п. 3 | 6a/6b |
| Логика CLI — `runCli` в `src/cli/run.ts`, `main.ts` только вызывает его (unit-тест справки) | KT-76 п. 3 | 14a/14c |
| `createTestDb` — пулы на 10 соединений (умолчание `DB_POOL_MAX`), срок соединения `KIT_DB_CONNECTION_TIMEOUT_MS` (5000 мс); `service` проверяется и пишется в лог | KT-76 п. 3 | 13a/13c |
| Параллельные прогоны одного сервиса на одном внешнем PostgreSQL не поддерживаются — README, защиты в коде нет | KT-76 п. 3 | 11b, 15 |
| `/testing` не импортирует `kit-database.module.ts`: пулы — внутренняя функция `src/database/pools.ts` без `@nestjs/*`, общая для `KitDatabaseModule` и `createTestDb`; `expectOutbox({app})` — через `Db`/`mainPoolOf` | KT-77 | 12b, 13a (граф `dist/testing`), 13b, 13c |
| Правки существующих тестов — только при изменении поведения по PRD v1.27, каждая — в отчёт (файл, было → стало, основание) | KT-77 | 6b, 7b, весь план |
| AC-3.12: если `application/json` повторно регистрируется без ошибки — код не меняется, тест на факт, расхождение — в отчёт | KT-77 | 8 |
| `shutdownDeadline = min(max(1000, T − D − 3000), остаток − 3000)`; остаток < 3000 → 0; остаток считается от сигнала или `close()`, внутренняя функция без публичного API | §3.4, AC-5.11 | 4a/4b/4c |
| T-тест AC-5.11: 5 с шага 2 — сдвиг часов `KitLifecycle`, срок обработчиков 2 с — реальный; формула и граница — U на подменённых таймерах | ответ KT-75 | 4a, 4b |
| `createOutboxTable`: две перегрузки, `KitOutboxTable` — объединение, снимок drizzle-kit не меняется | §3.4, AC-5.21 | 3a/3b, задача 17 (`pnpm db:fixtures` без diff) |
| Обработчик по (`type`, `version`) для `on` **и** `onReplica`; неподписанная версия → ack, `debug`, `verdeect_events_skipped_total{type, version}`; повтор пары — ошибка | §3.4 (стр. 131–132), UC-6 А8, AC-5.22 | 6a/6b |
| AC-2.11: `verdeect_events_skipped_total` — явное исключение в тесте правил со ссылкой на §3.4, правила алерта нет | AC-2.11 v1.27 | 6a |
| `outbox.events` уникальны по (`type`, `version`); `OutboxStore.add` пишет `version` определения; relay ищет определение по паре; неизвестная пара → `subject.kind = 'unknown'`, `warn` раз на пару | §3.4 (стр. 128), AC-5.23 | 7a/7b |
| `messagingCleanupLockKey(schema)` → `'verdeect-kit:messaging-cleanup:<schema>'`; очистка вызывает ту же функцию, поведение не меняется | §3.8 (стр. 189), AC-4.19 | 13a/13b |
| Метка `COMMENT ON DATABASE … IS 'verdeect-kit startTestStack'` у `<svc>_template` и `<svc>`; с меткой — пересоздать, без метки — отказ с `POSTGRES_DB`; `teardown` удаляет только помеченные | §3.8 (стр. 185), AC-1.14 | 11a/11b |
| `UNKNOWN_COMMAND`: JSON `{error}` в stdout, как раньше; список команд и форм — в stderr; код 1 (уточнение PRD — в следующей ревизии) | AC-9.7, KT-76 п. 3 | 14a/14c |
| `assertRepoConventions`, литеральный `name:` и `name:` с `${…}` — код и тест уже есть (v1.25); новых задач нет | §3.8 | существующий тест (см. Traceability) |
| `createTestApp` `extraProviders` уже глобальные (`KitTestExtrasModule`, `global: true`) — только README | §3.8 | задача 15 |

Комбинации подписчика (AC-5.22, AC-5.23):

| Пара в конверте | Регистрация | Итог |
|---|---|---|
| (T, v1) | `on(T v1)` | обработчик v1, inbox (при `dedupe: 'inbox'`) |
| (T, v2) | только `on(T v1)` | ack, inbox не занят, обработчика нет, не DLQ, `skipped{T, "2"}` +1, `debug` |
| (T, v2) | `on(T v1)` и `on(T v2)` | обработчик v2 |
| (U, любая) | `U` не подписан | DLQ `unsubscribed` (как сейчас) |
| (T, v2) | только `onReplica(T v1)` | ack, обработчика нет, `skipped` +1 |
| повторный `on`/`onReplica` той же пары | — | `TypeError` регистрации |

## Commit Plan
- **Commit 1** (после 1–2): `feat(crypto,idempotency): deriveKeys и @Idempotent({redact}) (AC-7.6, AC-4.14)`
- **Commit 2** (после 3–7): `feat(messaging): версии событий по паре, срок остановки от начала, тип tenant (AC-5.11, AC-5.21–AC-5.23)`
- **Commit 3** (после 8–13): `feat(testing): timeout-scale, adminUrl, declareEventsExchange, expectOutbox({app}), createTestDb, метка БД (AC-1.14, AC-1.15, AC-3.12, AC-4.19, AC-5.10, AC-5.13, AC-9.6)`
- **Commit 4** (после 14): `feat(cli): справка --help и формат хеша в INVALID_ENVIRONMENT (AC-5.10, AC-9.7)`
- **Commit 5** (после 15–16): `docs: README, CHANGELOG 1.0.0-rc.7, version 1.0.0-rc.7`

## Tasks

### Фаза 1: `/crypto` (пункт а)

- [ ] **Task 1a: тест AC-7.6 `deriveKeys`** — §3.6, AC-7.6
  - **Skill:** nestjs-code test unit crypto ac-7-6-derive-keys (CREATE) → `test/unit/crypto/ac-7-6-derive-keys.spec.ts`
  - `describe('UC-10: deriveKeys')`, тесты `AC-7.6: …`:
    - две версии `ENCRYPTION_KEYS` (порядок 2, 1) → два элемента в том же порядке с их `version`, `key` — `Buffer` длиной 32;
    - контрольный вектор: секрет — байты 1..32 в base64url (как в `ac-7-3-test-vector.spec.ts`), `service` `svc-a`, `purpose` `session-mac`. Ожидаемый ключ — hex-литерал, посчитанный однострочником на сыром `node:crypto` `hkdfSync` (однострочник — в комментарии теста, как в AC-7.3);
    - ключ не равен ключу шифра `createCipher` того же `service` и `purpose`. Эталон ключа шифра — `hkdfSync` с `info = verdeect-<svc>:<purpose>` в тесте, плюс прямое сравнение `info` вектора;
    - неверный `purpose`, неверный `service`, неверные `keys` (нет секрета, дубликат версии) → `TypeError` с путём (`keys.0.secret`). Сообщение начинается с `deriveKeys:` и не содержит значения секрета.
  - На старом коде падает: экспорта `deriveKeys` нет.
  - Логи: нет (чистая функция).

- [ ] **Task 1b: `deriveKeys` и `KitDerivedKey`** — §3.6, AC-7.6 (depends on 1a)
  - **Skill:** nestjs-code generic src/crypto/cipher.ts (MODIFY); nestjs-code generic src/crypto/index.ts (MODIFY)
  - `cipher.ts`: проверки `service`, `purpose`, `keys` из тела `createCipher` вынести во внутреннюю функцию файла. Она принимает имя вызывающего (для префикса сообщения) и опции и возвращает проверенные ключи. `createCipher` и `deriveKeys` вызывают её; тексты ошибок `createCipher` не меняются.
  - `deriveKeys({service, keys, purpose})` возвращает readonly-массив `KitDerivedKey` (`{version: number, key: Buffer}`, readonly-поля) в порядке `keys`. Ключ — HKDF-SHA256: IKM — декодированные base64url-байты секрета, соль пустая, длина 32, `info = verdeect-<service>:<purpose>:mac`. Без кеша и Nest-модуля.
  - TSDoc: назначение (подпись cookie, печати, коды подтверждения), ротация «подпись — первым ключом, проверка — всеми».
  - `index.ts`: экспорт `deriveKeys` и `export type KitDerivedKey`.
  - Шапка `cipher.ts` — дополнить ссылкой на AC-7.6.
  - Логи: нет. Секреты и ключи никуда не пишутся.
  - Готово, когда: 1a и весь `test/unit/crypto` зелёные.

### Фаза 2: `/idempotency` (пункт б)

- [ ] **Task 2a: тест AC-4.14 `redact`** — §3.3а, AC-4.14
  - **Skill:** nestjs-code test integration idempotency ac-4-14-redact (CREATE) → `test/integration/idempotency/ac-4-14-redact.spec.ts`; nestjs-code test integration idempotency support (MODIFY) → `test/integration/idempotency/support.ts`
  - `support.ts`: в `EchoController` (под `VerdeectAuthGuard`) добавить два маршрута:
    - `POST /secret` с `@Idempotent({redact: ['secret']})`: ставит `Location: /secret/<n>`, отвечает 201 `{id, secret: 'sk_<случайная строка>'}`;
    - `POST /secret-list` с `@Idempotent({redact: ['secret']})`: отвечает массивом `[{secret: …}]`.
    Счётчик вызовов — общий `handlers`.
  - `describe('UC-7: Idempotency-Key, redact')`, тесты:
    - `AC-4.14: первый ответ содержит secret, в response_body хранилища подстроки секрета нет`. Проверка — `select response_body::text from kit.idempotency_key` через `adminQuery`;
    - `AC-4.14: повтор — 201, тот же Location, secret: null, Idempotent-Replayed: true, обработчик вызван один раз`;
    - `AC-4.14: ответ-массив сохраняется как есть`: колонка содержит исходный массив, повтор отдаёт его же;
    - `AC-4.14: redact с пустым именем, с '.' (data.secret) или '[' (items[0]) — TypeError «redact — только поля верхнего уровня» при объявлении @Idempotent` (без стенда, вызов декоратора напрямую; KT-76 п. 4).
  - На старом коде падает: в колонке есть секрет, повтор отдаёт секрет.
  - Логи: нет.

- [ ] **Task 2b: `@Idempotent({redact})`** — §3.3а, AC-4.14 (depends on 2a)
  - **Skill:** nestjs-code generic src/internal/metadata.ts (MODIFY); nestjs-code generic src/idempotency/idempotent.decorator.ts (MODIFY); nestjs-code generic src/idempotency/idempotency.interceptor.ts (MODIFY)
  - `metadata.ts`: в `KitIdempotentOptions` поле `redact?: readonly string[]` с TSDoc: имена полей верхнего уровня, один уровень, без путей, для одноразовых секретов в ответе.
  - Декоратор: опция передаётся в метаданные. Имена `redact` проверяются при объявлении, как `tenantFromBody`: пустое имя или имя с `.` или `[` → `TypeError('@Idempotent: redact — только поля верхнего уровня')` (KT-76 п. 4).
  - Перехватчик, шаг сохранения ответа: клиенту уходит исходное тело. В `completeWithRetry` передаётся копия:
    - тело — простой объект (не `null`, не массив): поверхностная копия, где каждое поле из `redact`, если оно есть в объекте, заменено на `null`;
    - иначе — тело как есть.
    Статус и `Location` не меняются. Повтор отдаёт сохранённую копию — существующая ветка replay без изменений.
  - Логи: `debug` «idempotency: поля ответа скрыты в хранилище» `{fields: число скрытых полей}`, без имён значений.
  - Готово, когда: 2a и весь `test/integration/idempotency` зелёные.

### Фаза 3: `/messaging` (пункты в, д, е, ж)

- [ ] **Task 3a: тест типов AC-5.21** — §3.4, AC-5.21
  - **Skill:** nestjs-code test unit messaging ac-5-21-outbox-table (CREATE) → `test/unit/messaging/ac-5-21-outbox-table.test-d.ts`
  - `expectTypeOf`, сравнение с `string` и `string | null`:
    - `$inferSelect['tenant']` у `createOutboxTable(s)` и `createOutboxTable(s, {tenantNullable: false})` — `string`;
    - у `createOutboxTable(s, {tenantNullable: true})` — `string | null`;
    - оба варианта присваиваются `KitOutboxTable` и принимаются полем `outbox.table` в `KitMessagingModuleOptions`.
  - На старом коде падает: у варианта по умолчанию `tenant` — `string | null`.
  - Проверка, что тест типов реально исполняется (KT-77): `vitest.config.ts` включает `typecheck` (`enabled: true`, `include: ['test/unit/**/*.test-d.ts']`), `tsconfig.json` включает `test` — файл проверяют и Vitest, и `pnpm typecheck` (`make analyse`, входит в `make ci`). При реализации временно заменить одно ожидание на заведомо неверный тип и убедиться, что `pnpm exec vitest run test/unit/messaging/ac-5-21-outbox-table.test-d.ts` и `pnpm typecheck` падают; затем вернуть. Результат — в отчёт.

- [ ] **Task 3b: перегрузки `createOutboxTable`** — §3.4, AC-5.21 (depends on 3a)
  - **Skill:** nestjs-code generic src/messaging/tables.ts (MODIFY); nestjs-code generic src/messaging/kit-messaging.module.ts (MODIFY); nestjs-code generic src/messaging/outbox-store.ts (MODIFY); nestjs-code generic src/messaging/cleanup.ts (MODIFY); nestjs-code generic src/messaging/config.ts (MODIFY)
  - `tables.ts`: две сигнатуры-перегрузки и одна реализация.
    - Без опций или с `tenantNullable: false` (литеральный тип `false` или `undefined`) — тип таблицы с колонкой `tenant` `notNull`.
    - С `tenantNullable: true` — с nullable-колонкой.
    - Рантайм-определение колонок (DDL) не меняется: `text('tenant')` или `.notNull()`, `version` `integer` `NOT NULL` без умолчания.
    - `KitOutboxTable` — объединение двух типов. TSDoc перегрузок — «select даёт string / string | null».
  - Внутренние поля, которые держат таблицу, — `src/messaging/outbox-store.ts` (`table`, `tx.insert(…)` около стр. 122 и запросы захвата), `src/messaging/cleanup.ts` (стр. 41, 54), `src/messaging/config.ts` (стр. 20) — типизируются nullable-вариантом. Единственное приведение публичного объединения к нему, с комментарием, — там, где `kit-messaging.module.ts` читает опции `forRoot` (вместе с `outboxTenantNullable`). Relay таблицу не держит, только `OutboxClaimedRow`. Проверка `MESSAGING_TENANT_NOT_NULLABLE` в `eventsOf` остаётся.
  - Поправить ошибки компиляции, которые даст сужение типа, в `src/**`, `test/**` и `test/consumer/minimal`: проверки `tenant` на `null` у таблицы по умолчанию. Список правок — в отчёт: это материал для «Как перейти».
  - Логи: нет.
  - Готово, когда: `pnpm typecheck`, 3a и `test/unit/messaging` зелёные. `pnpm db:fixtures` не меняет файлы `test/fixtures/database/migrations` и `test/consumer/minimal/drizzle`; проверка `git status` — в задаче 18.

- [ ] **Task 4a: U-тесты срока остановки AC-5.11** — §3.4, AC-5.11
  - **Skill:** nestjs-code test unit messaging ac-5-11-shutdown-deadline (CREATE) → `test/unit/messaging/ac-5-11-shutdown-deadline.spec.ts`; nestjs-code test unit observability kit-lifecycle (MODIFY) → `test/unit/observability/kit-lifecycle.spec.ts`
  - `ac-5-11-shutdown-deadline.spec.ts`, чистая функция срока из `src/messaging/topology.ts`, `describe('UC-8: shutdownDeadline')`:
    - `AC-5.11: умолчания и быстрый шаг 2 — 7000` (T = 15000, D = 5000, остаток 10000);
    - `AC-5.11: T = 10000, D = 0, шаг 2 = 5 с — 2000` (остаток 5000);
    - `AC-5.11: остаток 2999 — 0`, `остаток 3000 — 0`;
    - `AC-5.11: нижняя граница 1000 действует только на первую часть формулы` (T − D − 3000 < 1000 при большом остатке → 1000);
    - `AC-5.11: остаток неизвестен (остановка не через KitLifecycle) — max(1000, T − D − 3000)`.
  - `kit-lifecycle.spec.ts` (уже на `vi.useFakeTimers()`), в describe `close()` и «по сигналу»:
    - `AC-5.11: остаток считается от close()` — после `close()` и сдвига таймеров на drain + 1000 внутренняя функция остатка даёт T − drain − 1000;
    - то же от `SIGTERM`;
    - до начала остановки остаток неизвестен.
    Часы — поддельный `performance.now`, который ставит существующий в файле `vi.useFakeTimers()`: Vitest 5.0.4 без `toFake` подменяет и `performance`. Время двигается только через `vi.advanceTimersByTimeAsync`, `vi.spyOn(performance, 'now')` в этом файле нет.
  - На старом коде падает: у функции срока нет параметра остатка, внутренней функции остатка нет.

- [ ] **Task 4b: T-тест AC-5.11 «шаг 2 = 5 с»** — §3.4, AC-5.11 (T) (depends on 4a)
  - **Skill:** nestjs-code test timing messaging ac-5-11-shutdown (MODIFY) → `test/timing/messaging/ac-5-11-shutdown.spec.ts`
  - Новый `it('AC-5.11: шаг 2 длится 5 с при SHUTDOWN_TIMEOUT_MS=10000 — обработчик дольше 2 с возвращает сообщение, остановка ≤ 10 с, сторож не срабатывает')`:
    - приложение — как в соседнем тесте «обработчик дольше shutdownDeadline», окружение `SHUTDOWN_TIMEOUT_MS=10000`, `SHUTDOWN_DRAIN_MS=0`;
    - в `KitLifecycle` (`app.get`) регистрируется участник шага 2. Он сдвигает подменённый `performance.now` на +5000 мс и сразу завершается — реального ожидания нет. Подмена: `vi.spyOn(performance, 'now')` возвращает реальное время плюс накопленный сдвиг, восстанавливается в `afterEach`;
    - обработчик в режиме `block`, сообщение доставлено, дальше `close()`;
    - проверки: реальная длительность `close()` < 4000 × `TEST_TIMEOUT_SCALE` (срок 2000, а не 7000), реальная длительность ≤ 10000 × scale, в логе есть «срок остановки подписчика вышел», сообщение вернулось в очередь `kit`, строки `SHUTDOWN_TIMEOUT` нет.
  - На старом коде падает: срок 7000, `close()` дольше 4 с.

- [ ] **Task 4c: срок обработчиков от начала остановки** — §3.4, AC-5.11 (depends on 4a, 4b)
  - **Skill:** nestjs-code generic src/observability/lifecycle.ts (MODIFY); nestjs-code generic src/messaging/topology.ts (MODIFY); nestjs-code generic src/messaging/rabbit-connection.ts (MODIFY); nestjs-code generic src/messaging/kit-messaging.module.ts (MODIFY)
  - `lifecycle.ts`: `KitLifecycle` запоминает момент начала остановки по `performance.now`, как `elapsed()`. Момент ставится один раз: при первом сигнале в `onSignal` или при первом `close()` в `start`, кто раньше. Экспортируемая из файла внутренняя функция остатка (не реэкспортируется из `src/observability/index.ts`, TSDoc `@internal`) возвращает `SHUTDOWN_TIMEOUT_MS − прошедшее` или `undefined`, если остановка не начата. Публичных методов класса не добавлять.
  - `topology.ts`: функция срока принимает окружение и необязательный остаток. Срок = `min(max(1000, T − D − 3000), остаток − 3000)`; остаток < 3000 → 0; остаток неизвестен → `max(1000, T − D − 3000)`. 3000 — существующие константы закрытия канала и соединения.
  - `rabbit-connection.ts`: опция `deadlineMs` заменяется функцией срока без аргументов. Её вызывает `shutdownDeadline()` при первом обращении — это начало шага 3. При сроке 0 ожидание завершается сразу.
  - `kit-messaging.module.ts`: сейчас модуль `KitLifecycle` не внедряет (шапка: «KitLifecycle не нужен» — обновить), фабрика `KIT_RABBIT_CONNECTION` (около стр. 446–454) получает только `KIT_MESSAGING_ENV` и `KIT_MESSAGING_LOG`. Фабрика дополнительно внедряет `KitLifecycle` (экспорт `KitCoreModule`) как необязательную зависимость, проверяет его `requireKitCore(lifecycle, 'KitMessagingModule')` и передаёт в `RabbitConnection` функцию срока: она вызывает функцию срока `topology.ts` с окружением и внутренней функцией остатка этого `KitLifecycle`. Путь `listen: false` не меняется.
  - TSDoc функции срока — формула §3.4 дословно.
  - Логи: `debug` «messaging: срок обработчиков при остановке» `{deadlineMs, remainingMs}` при первом вычислении. Существующий `warn` «срок остановки подписчика вышел» не меняется.
  - Готово, когда: 4a, 4b, `test/timing/messaging/ac-5-11-shutdown.spec.ts` и `test/unit/observability` зелёные.

- [ ] **Task 5a: тест общего срока первого подключения** — §3.4 (стр. 129), AC-5.4
  - **Skill:** nestjs-code test unit messaging ac-5-4-first-connect-deadline (CREATE) → `test/unit/messaging/ac-5-4-first-connect-deadline.spec.ts`
  - `vi.useFakeTimers()`. `KitSubscriber` собирается напрямую из `KitSubscriberDeps` (`src/messaging/subscriber.ts`, стр. 66–87): `service`, `replica`, `dedupe: 'none'`, `retrySeconds`, `reconnectSeconds: 5`, логгер в память и заглушка соединения, приведённая к `RabbitConnection`. Заглушка реализует методы, которые `onApplicationBootstrap` вызывает до `awaitStartupOutcome` (стр. 176–204: `createChannel` и `consume` канала), а также `firstAttempt` (разрешается `connected` через 4500 мс) и `channelOutcome` (не разрешается никогда). До запуска регистрируется один обработчик через `on`.
  - `AC-5.4: первое подключение и настройка канала укладываются в один RABBITMQ_RECONNECT_SECONDS`: `onApplicationBootstrap` завершается после сдвига таймеров на 5000 мс и не ждёт 9500. Уровень U, без брокера.
  - На старом коде падает: ожидание до 0,9 + 1 срока.

- [ ] **Task 5b: один срок первого подключения** — §3.4 (стр. 129) (depends on 5a)
  - **Skill:** nestjs-code generic src/messaging/subscriber.ts (MODIFY)
  - `awaitStartupOutcome`: один таймер срока на обе стадии (подключение, затем исход настройки канала) вместо двух подряд. Остальное без изменений: при `failed`/`timeout` запуск продолжается, `fatal` (`MESSAGING_RETRY_TTL_MISMATCH`) — отказ.
  - Логи: `debug` «messaging: первое подключение — срок вышел, запуск продолжается» `{reconnectSeconds}` при таймауте.
  - Готово, когда: 5a, `test/integration/messaging/ac-5-19-*.spec.ts` и `test/integration/messaging/connection.spec.ts` зелёные.

- [ ] **Task 6a: тесты AC-5.22 и исключение AC-2.11** — §3.4, UC-6 А8, AC-5.22, AC-2.11
  - **Skill:** nestjs-code test integration messaging ac-5-22-version-dispatch (CREATE) → `test/integration/messaging/ac-5-22-version-dispatch.spec.ts`; nestjs-code test integration messaging support (MODIFY) → `test/support/messaging.ts`; nestjs-code test unit observability ac-2-8-metrics (MODIFY) → `test/unit/observability/ac-2-8-metrics.spec.ts`; nestjs-code test package ac-2-11-alert-rules (MODIFY) → `test/package/ac-2-11-alert-rules.spec.ts`
  - `test/support/messaging.ts`:
    - фикстура `TestNoteCreatedV2` — тот же `type` `kit.note.created`, `version: 2`, схема `data` отличается от v1 одним новым обязательным полем;
    - отдельный `@Injectable()` провайдер `TestConsumerV2`: в `onModuleInit` регистрирует `on(TestNoteCreatedV2, …)` и считает вызовы. `TestConsumer` (стр. ~212) не меняется: его ставит `createSubscriberApp` во всех спеках сообщений;
    - `ac-5-22-version-dispatch.spec.ts` собирает приложения через экспортируемый `createMessagingApp` (стр. ~57): провайдеры `[TestConsumer]` — для сценариев «только v1», `[TestConsumer, TestConsumerV2]` — для «v1 и v2»; сценарии реплики — существующий `ReplicaConsumer` (v1, стр. ~276) без изменений.
  - `ac-5-22-version-dispatch.spec.ts`, `describe('UC-6: версии событий')`:
    - `AC-5.22: обработчик v1, конверты v1 и v2 — вызван только для v1, v2 подтверждено, inbox без v2, DLQ пуст, skipped{type, version="2"} = 1`. Конверт v2 — через `publishEnvelope(testEnvelope({version: 2, …}))`, метрика — из реестра `KIT_METRICS`, DLQ — счёт сообщений `<svc>.dlq`;
    - `AC-5.22: конверт v2 с data, проходящими схему v1, обработчику v1 не попадает`;
    - `AC-5.22: обработчики v1 и v2 — каждый получает свою версию`;
    - `AC-5.22: повторный on той же пары — ошибка регистрации`, `AC-5.22: on v1 и on v2 одного type — без ошибки`;
    - `AC-5.22: onReplica v1, конверт v2 — обработчик не вызван, skipped +1`, `AC-5.22: повторный onReplica той же пары — ошибка`;
    - `AC-5.22: в debug-логе пропуска есть type, version, id` (`memoryLogger`).
  - `ac-2-8-metrics.spec.ts`: `verdeect_events_skipped_total` — в списке `KIT_PACKAGE_METRICS`.
  - `ac-2-11-alert-rules.spec.ts`:
    - явный список исключений из одного элемента `verdeect_events_skipped_total` с комментарием «пропуск неподписанной версии ожидаем на время перехода — prd.md §3.4, AC-5.22, AC-2.11 v1.27»;
    - ожидаемое число метрик 7, правило проверяется для всех, кроме исключения;
    - отдельный `it('AC-2.11: verdeect_events_skipped_total без правила алерта')`.
  - На старом коде падает: повторный `on` другой версии — ошибка, v2 уходит обработчику v1, метрики нет.

- [ ] **Task 6b: выбор обработчика по паре и `verdeect_events_skipped_total`** — §3.4, UC-6 А8, AC-5.22 (depends on 6a)
  - **Skill:** nestjs-code generic src/messaging/define-event.ts (MODIFY); nestjs-code generic src/messaging/subscriber.ts (MODIFY); nestjs-code generic src/observability/metrics.ts (MODIFY)
  - `define-event.ts`: внутренняя функция ключа пары (`type` + `version`). Экспортируется из файла с TSDoc `@internal`, не реэкспортируется из `index.ts`. Её используют подписчик (6b) и outbox (7b).
  - `metrics.ts`: поле `eventsSkipped` в `KitMetrics`, `Counter` `verdeect_events_skipped_total`, метки `type`, `version`, реестр приложения, TSDoc.
  - `subscriber.ts`, для `on` и `onReplica`:
    - реестры обработчиков — по ключу пары; повтор пары — `TypeError` «KitSubscriber.on: обработчик <type> v<version> уже зарегистрирован»;
    - привязки очередей — по множеству уникальных `type`;
    - разбор: `type` не подписан ни в одной версии → DLQ `unsubscribed`, как сейчас. `type` подписан, версии нет → ack без inbox, без проверки `data` и `tenant`, без вызова, не DLQ. Плюс `eventsSkipped` с меткой `version` строкой и `debug` «messaging: версия события не подписана — подтверждено без обработки» `{id, type, version}`;
    - в очереди реплики — то же, через путь подтверждения реплики.
  - `eventsConsumed` для пропуска не увеличивается: PRD задаёт только `skipped`.
  - Шапка `subscriber.ts`: ссылка на AC-5.22.
  - Существующие тесты (KT-77): тексты и поля меняются, только если поведение меняется по PRD v1.27. Каждая такая правка — в отчёт строкой «файл — было → стало — основание (раздел PRD, AC)». Тест, который падает без изменения поведения по PRD, — признак ошибки кода, а не повод править тест.
  - Готово, когда: 6a и весь `test/integration/messaging` зелёные.

- [ ] **Task 7a: тест AC-5.23 outbox по паре** — §3.4 (стр. 128), AC-5.23
  - **Skill:** nestjs-code test integration messaging ac-5-23-outbox-versions (CREATE) → `test/integration/messaging/ac-5-23-outbox-versions.spec.ts`
  - `describe('UC-5: outbox — версии событий')`:
    - `AC-5.23: outbox.events с E v1 и v2 — обе пары записываются OutboxStore.add и публикуются со своей version; подписчик с обработчиками v1 и v2 получает каждую своим обработчиком`;
    - `AC-5.23: повтор пары в outbox.events — TypeError при сборке модуля`;
    - `AC-5.23: строка с version вне outbox.events публикуется с subject.kind = 'unknown', warn один раз на пару`. Строку вставить в outbox напрямую SQL, по образцу `ac-5-2-outbox-row.spec.ts`.
  - На старом коде падает: две версии одного type — `TypeError` «указано дважды».

- [ ] **Task 7b: outbox и relay по паре** — §3.4 (стр. 128), AC-5.23 (depends on 6b, 7a)
  - **Skill:** nestjs-code generic src/messaging/kit-messaging.module.ts (MODIFY); nestjs-code generic src/messaging/outbox-store.ts (MODIFY); nestjs-code generic src/messaging/outbox-relay.ts (MODIFY)
  - `eventsOf` — карта по ключу пары из 6b. Повтор пары — `TypeError` «KitMessagingModule: событие <type> v<version> указано дважды»; проверка `MESSAGING_TENANT_NOT_NULLABLE` — на каждое определение.
  - `OutboxStore.add` — поиск объявленного события по паре переданного определения (текст ошибки «не объявлено» дополнить версией). `version` строки — из определения, как сейчас.
  - Relay: определение ищется по паре (`type`, `version`) строки. Множество для однократного `warn` — по паре; текст «outbox: пара события вне outbox.events — subject.kind unknown» `{type, version}`.
  - Существующие тесты (KT-77), в том числе `ac-5-2-outbox-row.spec.ts` (warn раз на тип) и `test/unit/messaging/ac-5-15-forroot.spec.ts` (`/указано дважды/`): тексты и поля меняются, только если поведение меняется по PRD v1.27 (§3.4, AC-5.23 — warn раз на пару). Каждая правка — в отчёт строкой «файл — было → стало — основание».
  - Готово, когда: 7a, `ac-5-2-outbox-row.spec.ts` и весь `test/integration/messaging` зелёные.

### Фаза 4: `/http` (пункт з)

- [ ] **Task 8: тест AC-3.12 — парсер и 413 в `configureFastify`** — §3.5, AC-3.12 (I); кода не меняет
  - **Skill:** nestjs-code test integration http ac-3-12-configure-fastify (CREATE) → `test/integration/http/ac-3-12-configure-fastify.spec.ts`
  - Приложение через `createHttpApp` с `http`:
    - `configureFastify` регистрирует парсер `application/octet-stream` (тело как `Buffer`) и хук `onRoute`: `bodyLimit` 16 байт у маршрута `/upload`;
    - `exceptionFilter` — фильтр сервиса по образцу `ServiceFilter` из `ac-3-14-exception-filter.spec.ts`: при `HttpException` 413 и `request.routeOptions.url === '/upload'` отвечает `DomainError` сервиса `UPLOAD_TOO_LARGE` (статус 413 в словаре), остальное делегирует `KitExceptionFilter`.
  - Тесты:
    - `AC-3.12: addContentTypeParser('application/octet-stream') в configureFastify работает` — маршрут получает длину тела;
    - `AC-3.12: тело больше предела /upload — код сервиса со статусом 413`;
    - `AC-3.12: тело больше общего bodyLimit на другом маршруте — PAYLOAD_TOO_LARGE пакета`;
    - `AC-3.12: повторная регистрация application/json в configureFastify роняет запуск FST_ERR_CTP_ALREADY_PRESENT` — подтверждает строку README.
  - Ожидаемо зелёный на старом коде: пункт без кода. В отчёте — «не падал (кода нет)».
  - Если повторная регистрация `application/json` в `configureFastify` запуск **не** роняет (KT-77): код не менять, тест проверяет фактическое поведение (заголовок — по факту), строку README о `FST_ERR_CTP_ALREADY_PRESENT` в задаче 15 не писать как утверждение, а сообщить расхождение с PRD §3.5 в отчёте — PRD и README поправит владелец.

### Фаза 5: `/testing` (пункты в, г, и)

- [ ] **Task 9a: тесты AC-9.6 `./testing/timeout-scale`** — §3.8, AC-9.6 (R)
  - **Skill:** nestjs-code test package ac-9-6-timeout-scale (CREATE) → `test/package/ac-9-6-timeout-scale.spec.ts`; nestjs-code test unit package package-manifest (MODIFY) → `test/unit/package/package-manifest.spec.ts`; create-ts-file (MODIFY) → `test/consumer/minimal/vitest.config.ts`; create-ts-file (MODIFY) → `test/consumer/minimal/import-check.mjs`
  - `ac-9-6-timeout-scale.spec.ts`, на упакованном архиве, по образцу `ac-1-1-package.spec.ts`:
    - `AC-9.6: exports содержит ./testing/timeout-scale с условиями types и default`;
    - `AC-9.6: граф импортов dist/testing/timeout-scale.js — только node:*`: обход статических и динамических импортов, как в `ac-1-1`;
    - `AC-9.6: проект-потребитель импортирует подпуть без условия development`.
  - `package-manifest.spec.ts`: в списке ключей `exports` — `./testing/timeout-scale` и его форма `{types, default}`.
  - `test/consumer/minimal/vitest.config.ts`: импорт `TEST_TIMEOUT_SCALE` из `@verdeect/kit/testing/timeout-scale`, тайм-ауты конфига умножаются на него.
  - `import-check.mjs`: подпуть `testing/timeout-scale` — `ok` без условий; `/testing` без `development` — по-прежнему `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  - На старом коде падает: подпути нет.

- [ ] **Task 9b: подпуть `./testing/timeout-scale`** — §3.8, AC-9.6 (depends on 9a)
  - **Skill:** nestjs-code generic src/testing/timeout-scale.ts (MODIFY); правка `package.json` (конфиг, без skill)
  - `package.json` `exports`: ключ `./testing/timeout-scale` → `types` `./dist/testing/timeout-scale.d.ts`, `default` `./dist/testing/timeout-scale.js`. Ставится перед `./testing`. `./testing` — по-прежнему только `development`.
  - `timeout-scale.ts`: `readTimeoutScale(env?)` — по умолчанию `process.env`. Импортов, кроме `node:*`, нет (сейчас их нет совсем). Шапка — ссылка на AC-9.6 и правило «граф только node:*». `/testing` реэкспортирует `TEST_TIMEOUT_SCALE`, как раньше.
  - Логи: нет.
  - Готово, когда: 9a, `make pack-check` и publint/attw в нём зелёные.

- [ ] **Task 10a: тесты AC-1.15 и AC-5.10 `declareEventsExchange`** — §3.8, AC-1.15, AC-5.10 (I)
  - **Skill:** nestjs-code test integration testing ac-1-15-worker-admin-url (CREATE) → `test/integration/testing/ac-1-15-worker-admin-url.spec.ts`; nestjs-code test integration messaging ac-5-10-topic-permissions (MODIFY) → `test/integration/messaging/ac-5-10-topic-permissions.spec.ts`; nestjs-code test integration messaging connection (MODIFY) → `test/integration/messaging/connection.spec.ts`; nestjs-code test timing messaging channel-restore (MODIFY) → `test/timing/messaging/channel-restore.spec.ts`; nestjs-code test integration support broker (MODIFY) → `test/support/broker.ts`; nestjs-code test unit testing worker-scope (MODIFY) → `test/unit/testing/worker-scope.test-d.ts`; nestjs-code test unit testing worker-scope (MODIFY) → `test/unit/testing/worker-scope.spec.ts`
  - `ac-1-15-worker-admin-url.spec.ts`: `AC-1.15: workerScope().rabbitmq.adminUrl подключается и объявляет exchange в vhost воркера`. Подключение amqplib к `adminUrl`, `assertExchange` временного exchange; через management API (`brokerAdmin`) exchange найден в `workerScope().rabbitmq.vhost`. Exchange удаляется в `afterAll`.
  - `ac-5-10-topic-permissions.spec.ts`: вызовы `broker.declareEventsExchange()` (стр. 26, 47) заменить на экспорт `declareEventsExchange()` из `src/testing/index.js`. Оба существующих теста остаются (стр. 30, 45); тест на стр. 45 переименовать в `AC-5.10: после удаления exchange и declareEventsExchange() публикация воркера по своему префиксу проходит, по чужому — ACCESS_REFUSED`. Новых сценариев нет.
  - `connection.spec.ts`, `channel-restore.spec.ts` — на экспорт. В `test/support/broker.ts` метод `declareEventsExchange` удалить.
  - `worker-scope.test-d.ts`: у `rabbitmq` есть поле `adminUrl: string`.
  - `worker-scope.spec.ts`, тест `AC-5.18: rabbitmq — vhost и url записи воркера VITEST_POOL_ID` (около стр. 34): фикстура воркеров получает `publishes: []`, ожидаемый объект — `adminUrl` воркера, заголовок — `AC-5.18, AC-1.15: rabbitmq — vhost, url и adminUrl записи воркера VITEST_POOL_ID`.
  - На старом коде падает: экспорта и поля нет.

- [ ] **Task 10b: `adminUrl` и `declareEventsExchange()`** — §3.8, AC-1.15, AC-5.10 (depends on 10a)
  - **Skill:** nestjs-code generic src/testing/worker-scope.ts (MODIFY); nestjs-code generic src/testing/rabbitmq-admin.ts (MODIFY); nestjs-code generic src/testing/start-test-stack.ts (MODIFY); nestjs-code generic src/testing/test-events.ts (MODIFY); nestjs-code generic src/testing/index.ts (MODIFY)
  - `worker-scope.ts`: в `KitWorkerScope.rabbitmq` поле `adminUrl` (TSDoc: администратор vhost воркера, полные права, как в `kitRabbitmqWorkers`). Геттер отдаёт его из записи воркера.
  - `rabbitmq-admin.ts`: в `KitRabbitWorker` поле `publishes` (readonly-массив префиксов из `startTestStack`), заполняется в `prepareWorkerVhosts`.
  - `start-test-stack.ts`: передать `publishes` в `prepareWorkerVhosts`. Новых ключей `provide` нет.
  - `test-events.ts`: `declareEventsExchange()` без аргументов.
    - amqplib — динамическим `import()`, как у `publishTestEvent`.
    - Подключение к `adminUrl` воркера, `assertExchange` `verdeect.events` (`topic`, durable).
    - Через management API (`rabbitAdminFromProvided` с `kitRabbitmqManagementUrl` и `adminUrl`) заново выдаёт topic-права пользователю воркера (имя = vhost) по `topicPermissionsOf(publishes)`. Без `publishes` — `write ^$`, как в definitions.
    - TSDoc: зачем — RabbitMQ удаляет topic-права вместе с exchange.
  - `index.ts`: экспорт `declareEventsExchange`.
  - Логи: нет (помощник тестов). Ошибки management API — исключением с кодом ответа, без пароля.
  - Готово, когда: 10a зелёные; `test/unit/package` и `ac-1-1` (нет статического amqplib в `dist/testing`) зелёные.

- [ ] **Task 11a: тест AC-1.14 — метка БД** — §3.8, AC-1.14 (I)
  - **Skill:** nestjs-code test integration testing ac-1-14-database-label (CREATE) → `test/integration/testing/ac-1-14-database-label.spec.ts`
  - Внешний сервер — контейнер globalSetup через `startTestStack({service: 'kitlabel', postgres: {adminUrl: inject('kitPostgresUrl')}})(project)`, `project` — фейк как в `ac-1-13-postgres.spec.ts`. `afterAll` — `dropDatabase` обеих баз и `dropServiceRoles`.
  - Тесты `describe('UC-14: метка БД startTestStack')`:
    - `AC-1.14: шаблон и копия получают COMMENT 'verdeect-kit startTestStack'` (`shobj_description(oid, 'pg_database')`);
    - `AC-1.14: повторный прогон после прерванного проходит`: первый запуск без `teardown`, второй запуск успешен, `teardown` второго удаляет обе базы;
    - `AC-1.14: база kitlabel без метки — запуск падает, текст содержит имя базы и POSTGRES_DB, база не удалена`;
    - то же для `kitlabel_template` без метки;
    - `AC-1.14: teardown не удаляет базу без метки`: после запуска метка снимается `COMMENT ON DATABASE … IS NULL`, после `teardown` база существует.
  - На старом коде падает: метки нет; повторный запуск падает на `copy`.

- [ ] **Task 11b: метка, пересоздание и удаление баз `startTestStack`** — §3.8, AC-1.14 (depends on 11a)
  - **Skill:** nestjs-code generic src/testing/start-test-stack.ts (MODIFY)
  - Внутренняя функция «свежая база» для `<svc>_template` (шаг `create-template`) и `<svc>` (шаг `copy`, `TEMPLATE <svc>_template`). Путь общий для внешнего и контейнерного PostgreSQL. Порядок:
    - база есть, метка равна `verdeect-kit startTestStack` → `DROP DATABASE IF EXISTS … WITH (FORCE)`;
    - база есть без метки → `Error` «БД <name> уже есть и создана не startTestStack; у service-контейнера CI POSTGRES_DB не должен совпадать с <svc> (используйте postgres)», ничего не удаляется;
    - `CREATE DATABASE`, затем `COMMENT ON DATABASE … IS 'verdeect-kit startTestStack'`.
    Метка читается через `shobj_description(oid, 'pg_database')` по `pg_database`.
  - `teardown`: обе базы удаляются `DROP DATABASE IF EXISTS … WITH (FORCE)` только при метке. Без метки — пропуск с записью в stderr.
  - Конкурентность: два параллельных прогона одного сервиса на одном внешнем сервере не поддерживаются — внешний сервер только для тестов (README, задача 15). Защиты нет.
  - Логи (stderr, как у существующих шагов): «startTestStack: БД <name> осталась от прерванного прогона — пересоздаётся», «startTestStack: БД <name> без метки — не удаляется».
  - Готово, когда: 11a, `ac-1-13-postgres.spec.ts`, `ac-1-14-external-stack.spec.ts`, `ac-4-18-scratch-database.spec.ts` зелёные.

- [ ] **Task 12a: тесты AC-5.13 `expectOutbox({app, traceId})`** — §3.8, AC-5.13 (I, C)
  - **Skill:** nestjs-code test integration testing ac-5-13-expect-outbox (MODIFY) → `test/integration/testing/ac-5-13-expect-outbox.spec.ts`; nestjs-code test consumer outbox-coverage (MODIFY) → `test/consumer/minimal/outbox-coverage/coverage.spec.ts`
  - Интеграционный файл:
    - `AC-5.13: use-case со своей транзакцией — после COMMIT expectOutbox({app, traceId}) находит строку и засчитывает покрытие`. Транзакция — `app.get(Db).transaction` с `ctx` и уникальным `traceId` (`newId`), внутри `OutboxStore.add`. Ключ покрытия записан;
    - `AC-5.13: строка того же типа с другим traceId не засчитывается — без своей строки expectOutbox падает`, покрытие не записано;
    - `AC-5.13: data не по ожиданию — падает, покрытие не записано`.
  - Проект-потребитель: сценарий «use-case со своей транзакцией засчитывается». Транзакция с `traceId` теста, затем `expectOutbox({app, traceId}, …)`; событие попадает в итог `assertOutboxCoverage`.
  - Форма с `tx` не меняется: существующие тесты без правок.
  - На старом коде падает: перегрузки нет.

- [ ] **Task 12b: перегрузка `expectOutbox({app, traceId}, Event, expected)`** — §3.8, AC-5.13 (depends on 12a)
  - **Skill:** nestjs-code generic src/testing/outbox-coverage.ts (MODIFY)
  - Первый аргумент — `DbTx` или `{app, traceId}`. Отличие — по наличию полей `app` и `traceId`. Две сигнатуры-перегрузки с TSDoc.
  - Форма `{app, traceId}`:
    - строки читаются через основной пул приложения — тот же, на котором построен `DRIZZLE`: `app.get(Db)` и `mainPoolOf` из `../database/db.js`. `/testing` не импортирует `kit-database.module.ts` (KT-77), `pg` остаётся динамическим. Чтение — в короткой транзакции с явным `set_config('app.tenant', '', true)`. Пустой тенант — исключение строгой модели для outbox (`OUTBOX_POLICY_SQL`);
    - условие: `type`, `version`, `trace_id = traceId`, при наличии — `subject_id`, порядок `seq`;
    - проверка `data` по схеме, сравнение `expected.data` и запись покрытия — общая с формой `tx` внутренняя функция, которую вынести из текущего тела;
    - пустой `traceId` — `TypeError`.
  - Форма `tx` по поведению не меняется (`xmin = pg_current_xact_id()`).
  - Логи: нет (помощник тестов). Сообщения `expect` — как сейчас.
  - Готово, когда: 12a и весь `test/integration/testing` зелёные.

- [ ] **Task 13a: тест AC-4.19 `createTestDb`** — §3.8, AC-4.19 (I)
  - **Skill:** nestjs-code test integration testing ac-4-19-create-test-db (CREATE) → `test/integration/testing/ac-4-19-create-test-db.spec.ts`
  - `describe('UC-14: createTestDb')`:
    - `AC-4.19: чтение read only и statement_timeout 5 с, как у модуля`: через пул чтения `db` показать `default_transaction_read_only = on` и `statement_timeout = 5s`;
    - `AC-4.19: пока createTestDb().db держит runExclusive(db, messagingCleanupLockKey(schema)), проход очистки приложения — {ran: false} без ожидания`. Стенд — `createCleanupStand` из `test/support/messaging.ts` (как в `ac-5-12-cleanup.spec.ts`). Внутри колбэка `runExclusive(db, messagingCleanupLockKey('kit'), …)` на `db` публичного `createTestDb` вызывается `run()` провайдера `MessagingCleanup` стенда; ожидание — `{ran: false}`, промис завершён до освобождения блокировки. Публичный `createTestDb` импортируется из `src/testing/index.js`; одноимённый помощник `test/support/database.ts` (другой контракт: `poolMax`, `acquireTimeoutMs`, пулы и метрики; около 15 файлов) в этом файле не импортируется и не меняется;
    - `AC-4.19: соединение к tcpProxy без ответа падает не позже KIT_DB_CONNECTION_TIMEOUT_MS × TEST_TIMEOUT_SCALE`: `tcpProxy` в режиме без ответа, `createTestDb({url: proxy})`, транзакция отклоняется, время в пределах `KIT_DB_CONNECTION_TIMEOUT_MS × scale + 1000`. Реальное ожидание — срок драйвера, предмет AC;
    - `close()` закрывает оба пула.
  - `test/package/ac-1-1-package.spec.ts` (nestjs-code test package ac-1-1-package (MODIFY)), в тесте `AC-1.1: dist/testing не импортирует amqplib и messaging/index статически`: статический граф `dist/testing/index.js` не содержит `database/kit-database.module.js` (KT-77). Существующие проверки графа проходят без новых исключений.
  - На старом коде падает: экспортов нет.

- [ ] **Task 13b: общая сборка пулов и ключ очистки** — §3.8, AC-4.19 (depends on 13a)
  - **Skill:** nestjs-code generic src/database/pools.ts (CREATE); nestjs-code generic src/database/kit-database.module.ts (MODIFY); nestjs-code generic src/database/pg.ts (MODIFY — только TSDoc константы); nestjs-code generic src/internal/outbox-policy.ts (MODIFY); nestjs-code generic src/messaging/cleanup.ts (MODIFY)
  - `src/database/pools.ts` (новый, без импортов `@nestjs/*`, KT-77): внутренняя функция построения пулов. Принимает `{url, max, connectionTimeoutMs, metrics?, log}`, где `log` — объект с `warn` и `debug` (поля, сообщение). Создаёт основной пул и пул чтения с теми же обработчиками `error`/`connect`, тем же `instrumentPoolTimeouts` (переносится сюда вместе с `READ_POOL_OPTIONS` и `READ_STATEMENT_TIMEOUT_MS`) и теми же текстами логов. Импорты — только `./pg.js`, `../internal/pg-errors.js`, типы `/observability`, `sanitizeError`, `captureThrottled`. Тип `KitPools` (основной пул и пул чтения) объявляется здесь; `kit-database.module.ts` реэкспортирует его как тип — `test/support/database.ts` (стр. 10, 19) не меняется; `create-test-db.ts` берёт тип из `pools.ts`. Из `src/database/index.ts` не реэкспортируется.
  - `kit-database.module.ts`: `createPools` становится тонкой обёрткой — зовёт функцию `pools.ts` с `DATABASE_URL`, `DB_POOL_MAX`, `DB_POOL_ACQUIRE_TIMEOUT_MS` и логгером модуля (Nest `Logger('KitDatabase')`). Поведение модуля и `test/support/database.ts` (использует `createPools`) не меняется.
  - `outbox-policy.ts`: `messagingCleanupLockKey(schema)` → `'verdeect-kit:messaging-cleanup:<schema>'`, TSDoc «аргумент — схема таблиц outbox/inbox (обычно = имя сервиса)».
  - `cleanup.ts`: ключ — через `messagingCleanupLockKey(schema)`, строка та же. `run()` и `pass()` возвращают `Promise<{ran: boolean}>`: после остановки — `{ran: false}`, параллельный вызов отдаёт промис текущего прохода, итог `runExclusive` — как есть. Цикл по интервалу итог игнорирует.
  - `test/integration/messaging/ac-5-12-cleanup.spec.ts` (nestjs-code test integration messaging ac-5-12-cleanup (MODIFY)): строку `LOCK_KEY` (стр. 11) заменить на `messagingCleanupLockKey('kit')`.
  - Логи: существующий `debug` «очистка сообщений: другая реплика» сохраняется.
  - Готово, когда: `test/integration/database`, `ac-5-12-cleanup.spec.ts` и `ac-9-5-messaging-observability.spec.ts` зелёные.

- [ ] **Task 13c: `createTestDb`, `KIT_DB_CONNECTION_TIMEOUT_MS`, `messagingCleanupLockKey` в `/testing`** — §3.8, AC-4.19 (depends on 13b)
  - **Skill:** nestjs-code generic src/testing/create-test-db.ts (CREATE); nestjs-code generic src/testing/index.ts (MODIFY)
  - `create-test-db.ts`:
    - `createTestDb({url, service})` возвращает `{db: Db, close()}`;
    - `service` проверяется `assertServiceName` и идёт в лог;
    - `pg` и `drizzle` — динамическими загрузчиками пакета (`loadPg`/`loadDrizzle`), без статического импорта peer;
    - пулы — функцией из `src/database/pools.ts` (13b) с `max` = умолчание `DB_POOL_MAX` (10), `connectionTimeoutMs` = `KIT_DB_CONNECTION_TIMEOUT_MS` и логгером `createTestDb`. Импорта `kit-database.module.ts` нет (KT-77);
    - `Db` (из `../database/db.js`) собирается из двух пулов и драйвера `loadDrizzle()` тем же объектом опций, что в `KitDatabaseModule` (`kit-database.module.ts`, около стр. 192); нового построителя нет;
    - `close()` закрывает оба пула.
    - `KIT_DB_CONNECTION_TIMEOUT_MS` — реэкспорт той же константы `CONNECTION_TIMEOUT_MS` из `src/database/pg.ts`, не копия.
    - TSDoc: «только для тестов сервиса» (вторая «реплика» с `runExclusive`).
  - `index.ts`: экспорт `createTestDb`, `KIT_DB_CONNECTION_TIMEOUT_MS`, `messagingCleanupLockKey` (из `src/internal/outbox-policy.ts`), тип результата `KitTestDb`.
  - Логи: `debug` через логгер Nest «createTestDb: пулы созданы» `{service}`, без URL.
  - Готово, когда: 13a и `ac-1-1-package.spec.ts` (граф `dist/testing`) зелёные.

### Фаза 6: CLI (пункт к)

- [ ] **Task 14a: тесты AC-5.10 (U) и AC-9.7** — AC-5.10, AC-9.7 (U)
  - **Skill:** nestjs-code test unit cli ac-5-10-rabbitmq-command (MODIFY) → `test/unit/cli/ac-5-10-rabbitmq-command.spec.ts`; nestjs-code test unit cli ac-9-7-help (CREATE) → `test/unit/cli/ac-9-7-help.spec.ts`
  - `ac-5-10-rabbitmq-command.spec.ts`: `AC-5.10: неверный хеш RABBITMQ_PASSWORD_HASH_<SVC> → выход 1, в stderr имя ключа и hash_password, значения нет`. Проверка текста «ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)».
  - Существующие проверки `message: 'Неверное окружение'` для ключей хеша — `ac-5-10-rabbitmq-command.spec.ts` около стр. 75 (`RABBITMQ_PASSWORD_HASH_SVC_B`) и 273 (`RABBITMQ_PASSWORD_HASH_DEV`), `test/integration/cli/ac-5-10-rabbitmq-definitions.spec.ts` около стр. 181 (`RABBITMQ_PASSWORD_HASH_KITCLI_B`, nestjs-code test integration cli ac-5-10-rabbitmq-definitions (MODIFY)): ожидаемый `message` — новый текст с именами ключей, `keys` без изменений, проверка отсутствия значения хеша остаётся. Путь `LOG_LEVEL`/`REPLICA_ID` и `redis-acl-command.spec.ts` не меняются.
  - `ac-9-7-help.spec.ts`, через `runCli` из `src/cli/run.ts` с перехватом stdout и stderr:
    - `AC-9.7: --help, help и без аргументов — код 0, в stdout каждая команда и каждая форма из таблицы CLI README (строка на форму)`. Ожидаемый список — литерал в тесте;
    - `AC-9.7: <команда> --help — формы команды, код 0` — для каждой из `openapi`, `db`, `rabbitmq`, `crypto`, `redis`;
    - `AC-9.7: неизвестная команда — UNKNOWN_COMMAND JSON в stdout, список команд и форм в stderr, код 1`.
  - На старом коде падает: файла `run.ts` нет, сообщение хеша — «Неверное окружение».

- [ ] **Task 14b: формат хеша в `INVALID_ENVIRONMENT`** — §3.4, AC-5.10 (depends on 14a)
  - **Skill:** nestjs-code generic src/cli/commands/rabbitmq.ts (MODIFY)
  - Неверные ключи `RABBITMQ_PASSWORD_HASH_*`: `message` — «<ключи через запятую>: ожидается вывод rabbitmqctl hash_password (base64, ≥ 44 символов)», `keys` — имена. Значений нет. Ошибки `LOG_LEVEL`/`REPLICA_ID` — без изменений.
  - Логи: stderr-строка ошибки — как сейчас, с новым `message`.

- [ ] **Task 14c: справка `verdeect-kit --help`** — §3.8, AC-9.7 (depends on 14a)
  - **Skill:** nestjs-code generic src/cli/run.ts (CREATE); nestjs-code generic src/cli/main.ts (MODIFY)
  - `run.ts`: таблица команд — одна на загрузку и справку: имя, ленивый загрузчик, формы строками, как в README:
    - `openapi --out <f> [--module <f>#<export>]`;
    - `db prepare --service <svc>`, `db migrate --folder <p> --schema <svc>`, `db move-journal --from <s> --to <svc>`;
    - `rabbitmq definitions --services <svc,…> [--publishes <svc>=<prefix>,…] [--admin <user>] [--out <f>]`;
    - `redis acl --services <svc,…> --out <f>`;
    - `crypto generate-secret [--bytes N]`.
  - `runCli(argv, io)`, где `io` — запись в stdout и stderr:
    - без позиционных аргументов, `help` или `--help` первым → список в stdout, 0;
    - `<команда> --help` → формы команды в stdout, 0, обработчик не грузится;
    - неизвестная команда → JSON `UNKNOWN_COMMAND` в stdout (текст как сейчас) и список в stderr, 1;
    - иначе — обработчик, как сейчас.
  - `main.ts`: только `process.exitCode = await runCli(process.argv.slice(2), stdout/stderr процесса)`. Шапку файла обновить.
  - Логи: нет (вывод CLI — данные).
  - Готово, когда: 14a и `test/unit/cli` зелёные.

### Фаза 7: документация и выпуск (пункты л, 3)

- [ ] **Task 15: README** — AC-9.3, «Library Package Scope» (7) (depends on 1b, 2b, 3b, 4c, 5b, 6b, 7b, 8, 9b, 10b, 11b, 12b, 13c, 14b, 14c)
  - Правка `README.md` (документация, без skill):
    - «Шифр» — `deriveKeys`, ротация: подпись первым ключом, проверка всеми. «Развёртывание» — та же строка ротации;
    - «Идемпотентность» — `redact`: ответ клиенту без изменений, в хранилище `null`, повтор отдаёт `null`; только поля верхнего уровня — пустое имя, `.` или `[` → `TypeError` при объявлении;
    - строка про `@UseGuards` (около стр. 326) — «на контроллере или методе»;
    - «Сообщения»:
      - первое подключение — один срок `RABBITMQ_RECONNECT_SECONDS`, при опоздании брокера запуск продолжается;
      - рецепт миграции существующей таблицы outbox: `ADD COLUMN version integer NOT NULL DEFAULT 1`, затем `DROP DEFAULT`;
      - тип `tenant` по `tenantNullable`;
      - версии: обработчик по паре, порядок перехода (подписаться на новую версию до того, как публикующий перестанет слать старую; рост `skipped` при нуле обработанных того же типа — подписчик отстал), публикующий пишет обе версии в `outbox.events`;
      - формула срока остановки;
      - inbox: у роли SELECT, INSERT, DELETE; любая блокировка строк (`FOR UPDATE`/`SHARE`/`KEY SHARE`, `ON CONFLICT DO UPDATE`) требует UPDATE, пакет их не использует;
      - метрика `verdeect_events_skipped_total{type, version}` — в описание метрик (абзац «Метрики») и в «Сообщения»; правила алерта нет;
    - «HTTP» — в `configureFastify` парсеры `application/json` и `x-www-form-urlencoded` не заменяются (`FST_ERR_CTP_ALREADY_PRESENT`); пример `exceptionFilter` для 413 по `request.routeOptions.url`; замена через `onModuleInit`/`removeContentTypeParser` не поддерживается; Фраза про `FST_ERR_CTP_ALREADY_PRESENT` пишется по фактическому результату теста задачи 8: если запуск не падает — README описывает наблюдаемое поведение, расхождение с PRD — в отчёт (KT-77).
    - «База данных» — переименование политики `tenant_isolation`: ручной `ALTER POLICY … RENAME TO` в миграции (drizzle-kit спрашивает интерактивно);
    - «Тестовый контур»:
      - внешний PostgreSQL только для тестов: роли `<svc>_owner`/`<svc>_app` общие, пароли меняются на каждом прогоне; метка баз и отказ без метки; пример service-контейнера CI с `POSTGRES_DB: postgres`;
      - `createTestApp` — `extraProviders` глобальные;
      - `workerScope().rabbitmq.adminUrl`, `declareEventsExchange()`;
      - `expectOutbox({app, traceId})`;
      - `createTestDb`, `KIT_DB_CONNECTION_TIMEOUT_MS`, `messagingCleanupLockKey(schema)` — только для тестов;
      - `@verdeect/kit/testing/timeout-scale` в `vitest.config.ts`;
      - `KIT_OUTBOX_COVERAGE=1` — только в полной цели `make`, не при фильтре файлов;
      - healthcheck брокера — `rabbitmq-diagnostics -q ping` или `check_port_connectivity` (cookie Erlang, совместимо с `definitions.json` без guest);
    - CLI — раздел «Справка» с выводом `verdeect-kit --help`; `UNKNOWN_COMMAND` — список в stderr; строка `INVALID_ENVIRONMENT` для `rabbitmq definitions`;
    - «API» — все новые экспорты: `deriveKeys`, `KitDerivedKey`, `declareEventsExchange`, `createTestDb`, `KitTestDb`, `KIT_DB_CONNECTION_TIMEOUT_MS`, `messagingCleanupLockKey`, `readTimeoutScale`; подпуть `testing/timeout-scale`.
  - Готово, когда: `test/package/ac-9-3-docs.spec.ts` зелёный.

- [ ] **Task 16: CHANGELOG `[1.0.0-rc.7]` и версия** — G14, NFR-5 (depends on 15)
  - Правка `CHANGELOG.md`, `package.json` (без skill):
    - запись `## [1.0.0-rc.7] - YYYY-MM-DD` под пустым `[Unreleased]`, дата — день выполнения задачи (формат по `ac-9-3-docs.spec.ts`, как `[1.0.0-rc.6] - 2026-11-13`);
    - строка-сводка: находки переходов rc.6, PRD v1.26–v1.27;
    - `### Changed` (с пометкой «ломающее для rc», где применимо): обработчик по паре (`on` и `onReplica`), неподписанная версия — ack и `skipped` вместо обработчика v1; outbox по паре, relay по паре; срок обработчиков от начала остановки; тип `tenant` по `tenantNullable` (у таблиц по умолчанию `string` — возможны ошибки компиляции у проверок на `null`); первое подключение — один срок; `UNKNOWN_COMMAND` — список в stderr; `INVALID_ENVIRONMENT` хеша — формат в тексте;
    - `### Added`: `deriveKeys`/`KitDerivedKey`; `redact` (имена — только поля верхнего уровня, иначе `TypeError`); метка баз `startTestStack`; `./testing/timeout-scale` и `readTimeoutScale`; `workerScope().rabbitmq.adminUrl`; `declareEventsExchange`; `expectOutbox({app, traceId})`; `createTestDb`/`KitTestDb`/`KIT_DB_CONNECTION_TIMEOUT_MS`/`messagingCleanupLockKey`; `verdeect_events_skipped_total`; `verdeect-kit --help`;
    - `### Как перейти`: поведение подписчика по версии (подписать обе версии на время перехода); срок остановки; тип `tenant`; новые экспорты; таблица outbox без умолчания `version` (рецепт README); service-контейнер CI с `POSTGRES_DB: postgres`. Список правок типов из задачи 3b — как пример.
  - `package.json` `version` → `1.0.0-rc.7`. Тег не ставится: его ставит мейнтейнер.
  - Готово, когда: `ac-9-3-docs.spec.ts` зелёный (заголовки, все экспорты в CHANGELOG).

- [ ] **Task 17: проверка** (depends on 16)
  - Команды, без skill:
    1. `free -h` и `uptime`: available ≥ 3 ГБ и load < 5. Иначе — ждать и сообщить пользователю, тесты не запускать.
    2. `pnpm db:fixtures`, затем `git status --short test/fixtures/database test/consumer/minimal/drizzle` — пусто (AC-5.21: снимок drizzle-kit не меняется).
    3. `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check). Итоги — по уровням.
  - Сроки тестов не поднимать; на загруженной машине только `TEST_TIMEOUT_SCALE`.
  - После — стоп: `/aif-verify --strict` и `/aif-review` по команде пользователя.

## Traceability

| Пункт KT-73 | UC / AC | Задачи | Тест (файл → заголовок) |
|---|---|---|---|
| а | UC-10, AC-7.6 | 1a, 1b | `test/unit/crypto/ac-7-6-derive-keys.spec.ts` → `AC-7.6: …` |
| б | UC-7, AC-4.14 | 2a, 2b | `test/integration/idempotency/ac-4-14-redact.spec.ts` → `AC-4.14: …` |
| в (первое подключение) | AC-5.4, §3.4 | 5a, 5b | `test/unit/messaging/ac-5-4-first-connect-deadline.spec.ts` |
| в (литеральный `name:`) | AC-1.8 | — (есть с v1.25) | `test/unit/testing/ac-1-8-repo-conventions.spec.ts` → `AC-1.8 v1.25: compose.e2e.yml со своим name: …` (оба случая) |
| в (`extraProviders`) | §3.8 | 15 | README (код и тест rc.6: `test/unit/http/ac-3-14-test-app-http.spec.ts`) |
| г | UC-14, AC-1.14 | 11a, 11b | `test/integration/testing/ac-1-14-database-label.spec.ts` |
| д | UC-8, AC-5.11 | 4a, 4b, 4c | `test/unit/messaging/ac-5-11-shutdown-deadline.spec.ts`, `test/unit/observability/kit-lifecycle.spec.ts`, `test/timing/messaging/ac-5-11-shutdown.spec.ts` → `AC-5.11: шаг 2 длится 5 с …` |
| е | UC-5, AC-5.21 | 3a, 3b, 17 | `test/unit/messaging/ac-5-21-outbox-table.test-d.ts`; `pnpm db:fixtures` без diff |
| ж | UC-6 А8, AC-5.22, AC-2.11 | 6a, 6b | `test/integration/messaging/ac-5-22-version-dispatch.spec.ts`; `test/package/ac-2-11-alert-rules.spec.ts`; `test/unit/observability/ac-2-8-metrics.spec.ts` |
| ж (KT-75) | UC-5, AC-5.23 | 7a, 7b | `test/integration/messaging/ac-5-23-outbox-versions.spec.ts` |
| з | UC-3, AC-3.12 | 8 | `test/integration/http/ac-3-12-configure-fastify.spec.ts` |
| и | AC-9.6 | 9a, 9b | `test/package/ac-9-6-timeout-scale.spec.ts`, `test/unit/package/package-manifest.spec.ts`, `test/consumer/minimal/vitest.config.ts` |
| и | UC-14, AC-1.15 | 10a, 10b | `test/integration/testing/ac-1-15-worker-admin-url.spec.ts` |
| и | AC-5.10 (I) | 10a, 10b | `test/integration/messaging/ac-5-10-topic-permissions.spec.ts` |
| и | UC-14, AC-5.13 | 12a, 12b | `test/integration/testing/ac-5-13-expect-outbox.spec.ts`, `test/consumer/minimal/outbox-coverage/coverage.spec.ts` |
| и | UC-14, AC-4.19 | 13a, 13b, 13c | `test/integration/testing/ac-4-19-create-test-db.spec.ts` |
| к | AC-5.10 (U) | 14a, 14b | `test/unit/cli/ac-5-10-rabbitmq-command.spec.ts` |
| к | AC-9.7 | 14a, 14c | `test/unit/cli/ac-9-7-help.spec.ts` |
| л | AC-9.3 | 15 | `test/package/ac-9-3-docs.spec.ts` |
| 3 | G14, NFR-5 | 16 | `test/package/ac-9-3-docs.spec.ts` |
