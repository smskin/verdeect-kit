# План реализации: E7 Шифр секретов (`@verdeect/kit/crypto`)

Mode: full
Branch: feature/e7-crypto
Created: 2026-11-11

## Original Request
Реализуй этап roadmap «E7 Шифр секретов» по пакету требований requirements/0000-kit/ (ревизия r10, PRD v1.15).

Скоуп этапа: AC-7.1–AC-7.5; prd.md §3.6 целиком (createCipher({service, keys, purpose}) с HKDF-SHA256 и info verdeect-<svc>:<purpose>, encrypt/decrypt AES-256-GCM в формате v<N>:<iv>:<ct>:<tag> base64url с обязательным aad, DecryptError, needsReencrypt, generateSecret, CLI crypto generate-secret); envCrypto §3.1 — проверка ENCRYPTION_KEYS (base64url без =, ≥ 32 байт, без повтора версий); подпуть ./crypto в exports и в проверках AC-1.1, AC-1.2; README (порядок смены ключа шифра) и CHANGELOG [Unreleased]. Перенос кода — по requirements/0000-kit/files/inventory.md: эталон B session-cipher (версия ключа, AAD) + HKDF из O private-key-cipher; чтения старых форматов нет (P0, N9). Репозитории сервисов — только чтение. Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION. Мелочи из review после E5 (KT-24) — отдельными задачами в начале плана, вне скоупа crypto: openChannel в publishTestEvent (src/testing/test-events.ts) при отказе createConfirmChannel() после успешного connect() закрывает соединение, повторные попытки не копят соединения (тест); AC-3.9 (test/timing/http/ac-3-9-shutdown.spec.ts) — после отказа ECONNRESET сразу, без паузы, второй пробник требует ECONNREFUSED (закрыт именно слушатель). Тесты без реальных пауз (правило Test Speed Regressions). Уже реализованные этапы E1–E5 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня. Фазы должны оставлять проект в рабочем состоянии: тесты зелёные после каждой фазы.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5):
  - U — `test/unit/crypto`, `test/unit/cli`, `test/unit/config`, `test/unit/package`, `test/unit/testing`;
  - T — `test/timing/http` (только правка AC-3.9 из KT-24);
  - C — `test/consumer/minimal`, `test/consumer/no-testcontainers`;
  - R — `test/package`.
  - Уровня I у E7 нет: все AC-7.x — U. Реальных пауз в новых тестах нет (шифр синхронный, CLI вызывается в процессе).
- Logging: verbose.
  - Шифр (`src/crypto/cipher.ts`) — чистые функции без логгера: ошибки только исключениями (`DecryptError`, `TypeError`, `RangeError`) без открытого текста, `aad`, секретов и ключей (NFR-4).
  - CLI `crypto generate-secret`: `debug` — «crypto generate-secret: N байт» (число байт, без секрета) в stderr через `createLoggerOptions({entry: 'cli'})`; ошибка — JSON `{level: 'error', code, message}` в stderr, как у `rabbitmq` и `db`.
  - Только `pino`, без `console.*` (NFR-8, AC-9.4). Секрет в лог не попадает никогда — только в stdout результата.
- Docs: no — `WARN [docs]` без обязательного чекпоинта `/aif-docs`. README и CHANGELOG всё равно обновляет задача 11 (AC-9.3, «Library Package Scope» (7)).

## Roadmap Linkage
Milestone: "E7 Шифр секретов"
Rationale: план реализует ровно скоуп вехи E7 из `.ai-factory/ROADMAP.md` (`/crypto` §3.6, UC-10, AC-7.1–AC-7.5) плюс две правки после review E5 (KT-24), оговорённые в запросе.

## Requirements Reconciliation

Иерархия источников (запрос пользователя, skill-context «Requirements Package Authority»): `requirements/0000-kit/prd.md` **v1.16 (ревизия r11, коммит `8a92b65` — первый в ветке; вопросы планирования E7, KT-25)** > `requirements/0000-kit/files/inventory.md` > `.ai-factory/ROADMAP.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`, `rules/base.md`. Код сервиса, расходящийся с PRD, не переносится как есть (P0).

**Milestone scope:** AC-7.1, AC-7.2, AC-7.3, AC-7.4, AC-7.5; §3.6 целиком; `envCrypto` §3.1 (уже есть с E1 — проверяется тестом AC-7.5, код не переписывается); UC-10; растущие AC-1.1, AC-1.2 (подпуть `./crypto`); сквозные AC-9.1 (потребитель импортирует `/crypto`, CLI из архива), AC-9.3 (README, CHANGELOG), AC-9.4 (правило lint на новый `src/crypto/**` без изменений правила). Вне скоупа crypto, но в плане по запросу: KT-24 п. 1 (`publishTestEvent`, AC-5.13) и KT-24 п. 2 (AC-3.9).

Вне скоупа: `/redis` (E8), AC-8.x, AC-9.5 (E7 не добавляет фоновых операций). `[OPEN]` §11 п. 1–3 к E7 не относятся. `[ASSUMPTION]` §11 п. 4 (драйвер AMQP) и §6 (колонки outbox) к E7 не относятся.

**Эталоны (inventory §1, строка crypto):** B `verdeect-bff/packages/identity-client/src/crypto/session-cipher.ts` — версия ключа `v<N>`, AAD, версия из значения без перебора, первый ключ шифрует; O `verdeect-orchestrator/apps/orchestrator/src/modules/agent-token/domain/private-key-cipher.ts` — HKDF-SHA256 (соль пустая, 32 байта), base64url, строгие длины IV 12 и тега 16 (OR-102 п. 7), причина отказа. Тесты эквивалентности: B `session-cipher.spec.ts`, O `private-key-cipher.spec.ts` — переносятся и обобщаются в задаче 6. Не переносятся (P0, N9): base64 у B, строковая версия у O, перебор секретов у I, `null` вместо ошибки у B, `info` с фиксированной строкой сервиса, ключ без HKDF у B.

Решения (источник → задача):

| # | Решение | Источник | Задача |
|---|---|---|---|
| D1 | Исходный ключ HKDF — декодированные байты секрета `Buffer.from(secret, 'base64url')`; соль пустая; `info = verdeect-<svc>:<purpose>`; длина 32 байта; ключ выводится один раз на версию при создании шифра | §3.6 v1.16 (O брал UTF-8 строки — не переносится); AC-7.3 v1.16 | 4, 6 |
| D2 | `createCipher` проверяет `keys` той же схемой, что `envCrypto` (внутренний экспорт `encryptionKeysSchema` из `src/config/fragments.ts`, одно правило), ошибка — `TypeError` с путём (`keys.0.secret`), без значений; `service` — `assertServiceName(service, 'createCipher')` (`src/internal/service-name.ts`); `purpose` — `^[a-z][a-z0-9-]{1,31}$`, вне формата — `TypeError` | §3.6 (GAP-10, CE-2), rules/base.md «одна внутренняя функция» | 3, 4 |
| D3 | Формат значения `v<N>:<iv>:<ct>:<tag>`: `N` — версия ключа (`^[1-9]\d*$`, как `version` в `envCrypto`), части — алфавит base64url без `=`; IV — 12 байт, тег — 16 байт после декодирования, иначе `'format'`; пустой открытый текст допустим (`ct` — пустая строка, base64url нуля байт) | §3.6, AC-7.1; O OR-102 п. 7 | 4 |
| D4 | `decrypt`: порядок проверок `'format'` → `'unknown_version'` (версии нет в `keys`, перебора нет) → `'auth'` (тег GCM не сошёлся: другой `aad`, другой ключ, изменённый байт) | §3.6, AC-7.2 | 4 |
| D5 | `aad` — обязательная непустая строка (UTF-8); пустая — `TypeError` ошибки разработчика (не `DecryptError`) в `encrypt` и `decrypt` | §3.6 «aad обязателен» | 4 |
| D6 | `DecryptError extends Error`: `name = 'DecryptError'`, `readonly reason: 'format' \| 'unknown_version' \| 'auth'`, сообщение — фиксированный русский текст по причине, без значения, `aad`, открытого текста, ключа и `cause` | §3.6, AC-7.2, NFR-4, NFR-9 | 4 |
| D7 | `needsReencrypt(value)`: `true`, если версия значения ≠ версии `keys[0]` (в том числе версия, которой нет в `keys`); значение вне формата — `DecryptError('format')` | §3.6, AC-7.4 | 4 |
| D8 | `generateSecret(bytes = 32)`: целое ≥ 32, иначе `RangeError`; результат — `randomBytes(bytes).toString('base64url')` (без `=`). Верхней границы нет (§3.6 v1.16: «целое ≥ 32») | §3.6 | 4 |
| D9 | CLI `verdeect-kit crypto generate-secret [--bytes N]` → stdout одна строка `{"secret":"…"}\n`, выход 0; нет подкоманды, неизвестная опция, `--bytes` не целое ≥ 32 (`16`, `0`, `abc`) — `{"error":{"code":"USAGE",…}}`, выход 1 | §3.6 v1.16, AC-7.5; ARCHITECTURE «CLI» | 8 |
| D10 | Публичный экспорт `/crypto`: `createCipher`, `DecryptError`, `generateSecret` + типы `KitCipher`, `KitCipherOptions`, `DecryptErrorReason` (типы сигнатур — как `Kit*Options` других подпутей) | §3.6, rules/base.md «Структура модулей» | 4 |
| D11 | `src/crypto/**` импортирует только встроенные `node:*` (`node:crypto`; `node:os` приходит через `config/fragments.ts`), `zod`-схему из `../config/fragments.js` (не `config/index.js` — тот тянет `@nestjs/config`) и `../internal/service-name.js`; правило ESLint — в задаче 5 | ARCHITECTURE «Правила зависимостей» (`crypto` → `config`, `internal`, `node:crypto`; ❌ `crypto` → Nest-модулей) | 5 |
| D12 | Чтения старых форматов (`v1:` base64 B, `<version>:` строкой O, `v1` I `client-secret`) нет; переход сервисов — §10 (сессии пересоздаются, ключи генерируются заново) | P0, N9 | 4 |
| D13 | Контрольный вектор AC-7.3: IV фиксируется подменой `randomBytes` в тесте (`vi.mock('node:crypto', importOriginal)` в отдельном файле), без параметра в API пакета; ожидаемое значение вычислено один раз вне кода пакета (`hkdfSync` + `createCipheriv` из `node:crypto`) и хранится литералом | AC-7.3 v1.16, KT-25 п. 2 | 6 |
| D14 | Решения D1–D13 и задачи 1–2 приняты чатом kit (KT-26, 11.11.2026). Уточнения: `version` в `ENCRYPTION_KEYS` — целое ≥ 1 (тест AC-7.5 `version: 0`); типы `KitCipher`, `KitCipherOptions`, `DecryptErrorReason` экспортируются, в PRD их внесёт r12 — код не блокируется; в stdout CLI — только JSON, debug-лог в stderr без секрета (тест) | KT-26 | 4, 8, 9 |

Варианты `decrypt` (AC-7.1, AC-7.2, AC-7.4):

| Вход | Итог | Проверка |
|---|---|---|
| значение текущей версии, тот же `aad` | открытый текст | AC-7.1 |
| значение старой версии из `keys`, тот же `aad` | открытый текст | AC-7.4 |
| тот же `keys`, другой `aad` | `DecryptError('auth')` | AC-7.2 |
| изменён байт `ct`, `iv` или `tag` (длины верные) | `'auth'` | AC-7.2 |
| версия не в `keys` | `'unknown_version'` | AC-7.2 |
| не 4 части, не `v<N>`, символ вне base64url, IV ≠ 12 или тег ≠ 16 байт | `'format'` | AC-7.2 |
| другой `purpose` или `service` при том же секрете | `'auth'` | AC-7.3 |
| ключ выведен из UTF-8 строки секрета (способ O) | `'auth'` | AC-7.3 |
| пустой `aad` | `TypeError` | D5 |

## Architecture and Decisions
- Один файл `src/crypto/cipher.ts` (ARCHITECTURE.md, дерево `src/crypto/`) + точка входа `src/crypto/index.ts` с явным `export { … }`.
- `/crypto` без Nest-модуля: сервис создаёт шифр из `ConfigService` сам (`createCipher({service, keys: env.ENCRYPTION_KEYS, purpose})`) — PRD не называет модуль, лишнего экспорта нет.
- CLI: `src/cli/commands/crypto.ts` по образцу `rabbitmq.ts` (контекст `{write, env}`, `CommandError`, `parseArgs strict`), загрузка в `main.ts` — динамическим `import()`; команда работает без `pg`, `ioredis`, `amqplib` (ARCHITECTURE «CLI»).
- Версия пакета не меняется (G14: E1–E8 копятся в `[Unreleased]`).

## Tasks

### Фаза 1: Правки после review E5 (KT-24)

- [x] **Task 1: `openChannel` закрывает соединение при отказе `createConfirmChannel()`** — KT-24 п. 1, §3.8 (`publishTestEvent`), AC-5.13
  - **Skill:** nestjs-code generic src/testing/test-events.ts (MODIFY); тест — `nestjs-code test unit testing test-events (CREATE)`
  - `src/testing/test-events.ts`, `openChannel()`: после `amqp.connect(...)` обернуть `connection.createConfirmChannel()` в `try/catch`: при ошибке — `await connection.close().catch(() => undefined)` и повторный `throw error`. `model = connection` присваивать только после успешного создания канала (иначе `setTestEventsUrl` закрывает уже закрытое соединение). Обработчики `close`/`error` вешаются после успеха — как сейчас. Остальной код не менять.
  - Тест `test/unit/testing/test-events-open-channel.spec.ts`: `vi.mock('../../../src/internal/peer.js', async (importOriginal) => …)` по образцу `test/unit/messaging/ac-1-2-messaging-forroot-pg.spec.ts` — `loadPeer('amqplib', …)` возвращает подделку `{connect: vi.fn()}`; каждое `connect()` создаёт новое поддельное соединение (`EventEmitter` + `close: vi.fn().mockResolvedValue()`, `createConfirmChannel: vi.fn().mockRejectedValue(new Error('channel'))`). Адрес — `setTestEventsUrl('amqp://fake')` (без `inject` Vitest). Событие — `defineEvent({…, tenant: 'none'})` (без `workerScope`).
    - «AC-5.13: отказ createConfirmChannel после connect — соединение закрыто, ошибка проброшена»: `publishTestEvent` отклоняется с `'channel'`, у соединения `close` вызван 1 раз.
    - «AC-5.13: три неудачных вызова подряд — три connect, каждое соединение закрыто, открытых не остаётся»: `connect` вызван 3 раза, `close` у каждого из трёх — 1 раз.
    - «AC-5.13: после неудач успешный канал переиспользуется»: четвёртое `connect` отдаёт рабочий канал — `EventEmitter` (как поддельное соединение: `openChannel` вызывает `created.on('error')` и `created.once('close')`) с `publish: vi.fn()` и `waitForConfirms: vi.fn().mockResolvedValue(undefined)`, два следующих вызова — один `connect`.
    - `afterEach`: `setTestEventsUrl(undefined)`. Без таймеров и пауз.
  - Логи: нет (помощник тестов без логгера).
  - Готово, когда: `pnpm exec vitest run test/unit/testing/test-events-open-channel.spec.ts` зелёный; `make test-integration` для `ac-5-13-expect-outbox.spec.ts` без изменений.

- [x] **Task 2: AC-3.9 — второй пробник сразу после `ECONNRESET` требует `ECONNREFUSED`** — KT-24 п. 2, AC-3.9
  - **Skill:** nestjs-code test timing http ac-3-9-shutdown (MODIFY)
  - `test/timing/http/ac-3-9-shutdown.spec.ts`: в `poll()` при первом отказе (`probe.code !== null`) с `probe.code === 'ECONNRESET'` — сразу, без `sleep`, второй `probeNewConnection(app.port)`; сохранить в результат как `afterReset: Probe | null` (для `ECONNREFUSED` — `null`). Тип результата `beforeAll` расширить полем `afterReset`.
  - Случай «AC-3.9: новый запрос после шага 2 — отказ соединения …» переписать: `ECONNREFUSED` — успех; `ECONNRESET` допустим только при `handshake === true` **и** `afterReset?.code === 'ECONNREFUSED'` (закрыт именно слушатель, а не принятый сокет). Комментарий у проверки — почему второй пробник без паузы. Сообщение `expect` — `JSON.stringify({refusal, afterReset})`.
  - Новых пауз нет; `POLL_MS`, `DRAIN_MS`, `TIMEOUT_MS` не менять.
  - Логи: нет.
  - Готово, когда: `pnpm test:timing test/timing/http/ac-3-9-shutdown.spec.ts` зелёный 3 прогона подряд.

### Фаза 2: Шифр `/crypto`

- [x] **Task 3: внутренняя схема ключей шифра в `src/config/fragments.ts`** — §3.1 `envCrypto`, §3.6, D2 (depends on —)
  - **Skill:** nestjs-code generic src/config/fragments.ts (MODIFY)
  - Вынести схему массива из `envCrypto` в экспортируемую константу `encryptionKeysSchema` (`z.array(z.object({version, secret: encryptionSecret})).min(1).superRefine(uniqueBy('version'))`) с TSDoc `@internal` «одна проверка для envCrypto и createCipher (§3.6)»; `envCrypto.ENCRYPTION_KEYS = jsonValue(encryptionKeysSchema)`. В `src/config/index.ts` её **не** реэкспортировать (не публичный API). Поведение `envCrypto` не меняется.
  - Логи: нет.
  - Готово, когда: `test/unit/config/env-crypto.spec.ts` и `ac-1-6-define-env.test-d.ts` зелёные без правок.

- [x] **Task 4: `src/crypto/cipher.ts` и `src/crypto/index.ts` — `createCipher`, `DecryptError`, `generateSecret`** — §3.6, AC-7.1–AC-7.5, D1–D12 (depends on 3)
  - **Skill:** nestjs-code generic src/crypto/cipher.ts (CREATE); nestjs-code generic src/crypto/index.ts (CREATE)
  - Шапка: `// Шифр секретов /crypto (prd.md §3.6, UC-10, AC-7.1–AC-7.5). Эталон — B identity-client session-cipher.ts (версия ключа v<N>, AAD, версия из значения без перебора) + HKDF-SHA256 и строгие длины IV/тега из O private-key-cipher.ts (OR-102 п. 7). Старые форматы не читаются (P0, N9).`
  - Константы: `ALGORITHM = 'aes-256-gcm'`, `IV_BYTES = 12`, `TAG_BYTES = 16`, `KEY_BYTES = 32`, `PURPOSE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/`, `VALUE_PATTERN = /^v([1-9]\d*):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*):([A-Za-z0-9_-]+)$/`, `MIN_SECRET_BYTES = 32`.
  - Типы: `DecryptErrorReason = 'format' | 'unknown_version' | 'auth'`; `KitCipherOptions {readonly service: string; readonly keys: readonly {readonly version: number; readonly secret: string}[]; readonly purpose: string}` (результат `envCrypto` — `KitCryptoEnv['ENCRYPTION_KEYS']` — ему присваивается; `readonly` — чтобы сервис мог передать константу); `KitCipher {encrypt(plaintext: string, opts: {readonly aad: string}): string; decrypt(value: string, opts: {readonly aad: string}): string; needsReencrypt(value: string): boolean}`.
  - `class DecryptError extends Error` — D6; тексты: `format` — «значение шифра в неверном формате», `unknown_version` — «версии ключа значения нет в ENCRYPTION_KEYS», `auth` — «значение шифра не прошло проверку подлинности».
  - `createCipher(options)`: (1) `assertServiceName(options.service, 'createCipher')`; (2) `purpose` по `PURPOSE_PATTERN`, иначе `TypeError('createCipher: purpose «…» вне формата ^[a-z][a-z0-9-]{1,31}$')` (purpose — не секрет); (3) `encryptionKeysSchema.safeParse(options.keys)` — неуспех → `TypeError('createCipher: неверные keys: <пути через запятую>')` с путями `keys.<path>` без значений; (4) `Map<number, Buffer>` версия → `hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.alloc(0), \`verdeect-${service}:${purpose}\`, KEY_BYTES)`; текущая — `keys[0]`. Внутренний `parse(value)` → `{version, iv, ct, tag}` или `DecryptError('format')` (D3).
  - `encrypt`: `assertAad` (D5) → `randomBytes(IV_BYTES)` → `createCipheriv` + `setAAD(Buffer.from(aad, 'utf8'))` → `` `v${version}:${iv}:${ct}:${tag}` `` (base64url).
  - `decrypt`: `assertAad` → `parse` → ключ по версии или `'unknown_version'` → `createDecipheriv(…, {authTagLength: TAG_BYTES})`, `setAAD`, `setAuthTag`; исключение `final()` → `DecryptError('auth')` (D4); результат — UTF-8.
  - `needsReencrypt` — D7. `generateSecret(bytes = 32)` — D8, `RangeError('generateSecret: bytes — целое не меньше 32')`.
  - TSDoc на каждом экспорте и поле (ESLint `jsdoc`), в TSDoc `createCipher` — порядок ротации UC-10 шаги 1–5 и `aad = <purpose>:<id записи>`.
  - `src/crypto/index.ts`: шапка + `export { createCipher, DecryptError, generateSecret } from './cipher.js'; export type { DecryptErrorReason, KitCipher, KitCipherOptions } from './cipher.js';`.
  - Логи: нет (чистые функции; ошибки без значений — NFR-4).
  - Готово, когда: `pnpm typecheck`, `pnpm lint` зелёные.

- [x] **Task 5: манифест `./crypto`, ESLint `src/crypto/**`, тест манифеста** — AC-1.1, AC-1.2, NFR-3, D11 (depends on 4)
  - **Skill:** none — манифест и конфиг lint; тест — `nestjs-code test unit package package-manifest (MODIFY)`
  - `package.json` `exports`: `"./crypto": {"types": "./dist/crypto/index.d.ts", "default": "./dist/crypto/index.js"}` между `./config` и `./database`; зависимостей не добавлять (только `node:crypto` и `zod`).
  - `eslint.config.js`: новый блок `files: ['src/crypto/**/*.ts']` по образцу блока `src/config/**`: `restrictedImports` с группой `['@nestjs/*', '../config/index.js', '../observability/*', '../http/*', '../database/*', '../idempotency/*', '../messaging/*', '../redis/*', '../testing/*', '../cli/*', 'shell-quote']` и сообщением «crypto импортирует только node:crypto, config/fragments и internal (ARCHITECTURE.md)» — через `restrictedImports([...])`: функция сама добавляет `COMMON_PATTERNS` и `AJV_PATTERN` (`eslint.config.js:58-66`), отдельно их не повторять.
  - `test/unit/package/package-manifest.spec.ts`: случай списка `exports` → «AC-1.1: exports — ровно ./config, ./crypto, ./database, ./http, ./idempotency, ./messaging, ./observability, ./testing, ./package.json»; заголовок `describe` — «(E1–E7)»; новый случай «AC-1.1: ./crypto — {types, default} на dist/crypto/index.*».
  - Логи: нет.
  - Готово, когда: `pnpm lint`, `pnpm exec vitest run test/unit/package` зелёные.

- [x] **Task 6: unit-тесты AC-7.1–AC-7.4 и эквивалентность B/O** — AC-7.1, AC-7.2, AC-7.3, AC-7.4, UC-10 (depends on 4)
  - **Skill:** nestjs-code test unit crypto cipher (CREATE)
  - Общий помощник `test/unit/crypto/support.ts`: `secret()` — `randomBytes(32).toString('base64url')`; `cipherOf({version, secret}[], {service = 'svc-a', purpose = 'client-secret'})`; `reasonOf(fn)` — `reason` из `DecryptError` или `expect.fail`; `flipByte(value, part)` — меняет один байт декодированной части и кодирует обратно (длина сохраняется).
  - `test/unit/crypto/ac-7-1-encrypt-decrypt.spec.ts` (`describe('UC-10: шифрование …')`):
    - «AC-7.1: encrypt → decrypt возвращает исходный текст» (ASCII, кириллица, эмодзи, пустая строка — D3);
    - «AC-7.1: значение — v<N>: и три части base64url» (`/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]*:[A-Za-z0-9_-]{22}$/`, версия — `keys[0]`, напр. `v7`);
    - «AC-7.1: два шифрования одного текста различаются (IV)»;
    - «AC-7.1: значение не содержит открытого текста» (перенос O «закрытой части в открытом виде»).
  - `test/unit/crypto/ac-7-2-decrypt-errors.spec.ts`:
    - «AC-7.2: подмена значения между записями (другой aad) → 'auth'» (перенос B «чужой AAD»: `client-secret:cli_1` → `client-secret:cli_2`);
    - «AC-7.2: изменённый байт ct, iv или tag → 'auth'» (`it.each` по трём частям, `flipByte`);
    - «AC-7.2: неизвестная версия → 'unknown_version'» (перенос B; тот же секрет под другой версией — тоже `'unknown_version'`, перенос O);
    - «AC-7.2: неверный формат → 'format'» (`it.each`: `'garbage'`, 3 части, 5 частей, `'1:…'` без `v`, `'v0:…'`, `'v01:…'`, символ `+`/`/`/`=` в части, IV 16 байт, тег 12 байт — перенос O OR-102 п. 7, пустой IV);
    - «AC-7.2: в тексте и полях ошибки нет открытого текста, aad, секрета и ключа» — по каждой причине: `message`, `JSON.stringify(error)`, `String(error)` не содержат открытого текста, `aad`, секрета, base64url/hex выведенного ключа (вычислить `hkdfSync` в тесте); `error.cause` — `undefined`;
    - «AC-7.2: пустой aad — TypeError в encrypt и decrypt» (D5).
  - `test/unit/crypto/ac-7-3-key-separation.spec.ts`:
    - «AC-7.3: один секрет, разные purpose — значение одного не расшифровывается другим ('auth')»;
    - «AC-7.3: один секрет и purpose, разные service — не расшифровывается ('auth')»;
    - «AC-7.3: ключ — HKDF-SHA256 от декодированного секрета, info verdeect-<svc>:<purpose>» — значение расшифровывается `createDecipheriv` с ключом `hkdfSync('sha256', Buffer.from(secret,'base64url'), Buffer.alloc(0), 'verdeect-svc-a:client-secret', 32)` (D1);
    - «AC-7.3: значение, зашифрованное ключом из UTF-8 строки того же секрета, не расшифровывается ('auth')» — в тесте ключ `hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), 'verdeect-svc-a:client-secret', 32)`, значение собрано `createCipheriv` в формате `v1:<iv>:<ct>:<tag>` с тем же `aad`; `createCipher(...).decrypt` → `'auth'` (D1; страхует от возврата к способу O);
    - «AC-7.3: service или purpose вне формата — ошибка при создании» (`it.each`: service `'Bad'`, `'a'`, `'1svc'`, 33 символа; purpose `'Purpose'`, `'p'`, `'a_b'`, 33 символа) — `TypeError`;
    - «§3.6: keys вне формата — TypeError с путём, без значений» (пустой массив, секрет 31 байт, повтор версии) — сообщение содержит `keys`, не содержит секретов (D2).
  - `test/unit/crypto/ac-7-3-test-vector.spec.ts` — отдельный файл, потому что подменяет модуль (D13):
    - `vi.mock('node:crypto', async (importOriginal) => ({...original, randomBytes: vi.fn(original.randomBytes)}))`; в тесте `vi.mocked(randomBytes).mockReturnValueOnce(IV)` — только на вызов `encrypt`;
    - фиксированные входы (литералы в тесте): `SECRET = Buffer.from(Array.from({length: 32}, (_, i) => i + 1)).toString('base64url')`, `service: 'svc-a'`, `purpose: 'client-secret'`, версия `1`, `IV = Buffer.from(Array.from({length: 12}, (_, i) => i))`, текст `'verdeect-test-vector'`, `aad: 'client-secret:cli_1'`;
    - ожидаемое значение `EXPECTED = 'v1:…'` вычисляется **один раз** при реализации задачи скриптом вне пакета: `node --input-type=module -e` с `hkdfSync('sha256', Buffer.from(SECRET, 'base64url'), Buffer.alloc(0), 'verdeect-svc-a:client-secret', 32)` + `createCipheriv('aes-256-gcm', key, IV)`, `setAAD`, `getAuthTag`, части в base64url; результат вставляется в тест литералом с комментарием «вектор посчитан node:crypto напрямую, не кодом пакета» и командой расчёта; тест его не пересчитывает;
    - «AC-7.3: контрольный вектор — фиксированные секрет, service, purpose, IV и текст дают заранее вычисленное значение» (`encrypt` → `toBe(EXPECTED)`);
    - «AC-7.3: контрольный вектор расшифровывается» (`decrypt(EXPECTED)` → текст; без подмены IV).
  - `test/unit/crypto/ac-7-4-rotation.spec.ts`:
    - «AC-7.4: значение версии 1 читается после добавления версии 2 первой» (перенос B «запись старого ключа читается после ротации»);
    - «AC-7.4: needsReencrypt — true для v1 при текущей v2, после перешифровки — false» (decrypt → encrypt новым шифром → `needsReencrypt` `false`, префикс `v2:`);
    - «AC-7.4: после удаления версии 1 из keys перешифрованное значение читается, старое — 'unknown_version'» (UC-10 шаг 5);
    - «§3.6: needsReencrypt вне формата — DecryptError('format')» (D7).
  - Таймеров, сети и пауз нет.
  - Логи: нет.
  - Готово, когда: `pnpm exec vitest run test/unit/crypto` зелёный.

- [x] **Task 7: AC-1.2 — `/crypto` грузится без опциональных peer** — AC-1.2, NFR-3 (depends on 4)
  - **Skill:** nestjs-code test unit crypto ac-1-2-crypto-without-peers (CREATE)
  - `test/unit/crypto/ac-1-2-crypto-without-peers.spec.ts` по образцу `test/unit/http/ac-1-2-http-without-pg.spec.ts` (граф импортов исходников от `src/crypto/index.ts`):
    - «AC-1.2: /crypto не импортирует pg, ioredis, amqplib, amqp-connection-manager, testcontainers, vitest, @nestjs/*» — в `packages` графа только встроенные `node:*` и `zod` (`packages.filter((p) => !p.startsWith('node:') && p !== 'zod')` пуст; `node:os` приходит из `config/fragments.ts`);
    - «AC-1.2: /crypto не загружает config/index, observability, http, database, idempotency, messaging, testing» — `files` графа без этих путей (D11).
  - Логи: нет.
  - Готово, когда: `pnpm exec vitest run test/unit/crypto/ac-1-2-crypto-without-peers.spec.ts` зелёный.

### Фаза 3: CLI `crypto generate-secret`

- [x] **Task 8: `src/cli/commands/crypto.ts` и регистрация в `main.ts`** — §3.6 (CLI), UC-10 шаг 1, AC-7.5, D9 (depends on 4)
  - **Skill:** nestjs-code generic src/cli/commands/crypto.ts (CREATE); nestjs-code generic src/cli/main.ts (MODIFY)
  - Шапка: `// Команда verdeect-kit crypto generate-secret [--bytes N] (prd.md §3.6, UC-10, AC-7.5): секрет base64url для ENCRYPTION_KEYS. Образец — commands/rabbitmq.ts. Без pg, ioredis, amqplib: только crypto динамическим import().`
  - `export interface CryptoCommandContext {readonly write: (text: string) => void; readonly env: Readonly<Record<string, string | undefined>>}` + `defaultContext`; `export async function cryptoCommand(args, context = defaultContext): Promise<number>`.
  - Разбор: `parseArgs({strict: true, allowPositionals: true, options: {bytes: {type: 'string'}}})`; подкоманда — только `generate-secret`, иначе `USAGE`; лишние позиционные аргументы после `generate-secret` — `USAGE`; `--bytes` по умолчанию 32, `^\d+$` и ≥ 32, иначе `USAGE` с текстом «--bytes — целое не меньше 32»; ошибка `parseArgs` — `USAGE`.
  - Успех: `const { generateSecret } = await import('../../crypto/index.js')` → `context.write(\`${JSON.stringify({ secret })}\n\`)`, выход 0.
  - Логгер — как `createLogger` в `rabbitmq.ts` (`LOG_LEVEL`, `REPLICA_ID` из `envBase`, `entry: 'cli'`, stderr); `debug` «crypto generate-secret: N байт» — без секрета. Ошибка — stderr `{level: 'error', code, message}`, stdout `{"error": {code, message}}`, выход 1 (как `rabbitmq.ts`).
  - `src/cli/main.ts`: `crypto: async () => (await import('./commands/crypto.js')).cryptoCommand` в `COMMANDS`; обновить шапку (список команд).
  - Логи: `debug` — команда и число байт; `error` — `USAGE`/`INVALID_ENVIRONMENT` с кодом, без значений.
  - Готово, когда: `pnpm build` и `node dist/cli/main.js crypto generate-secret` печатает `{"secret":"…"}`.

- [x] **Task 9: AC-7.5 — `ENCRYPTION_KEYS`, `generateSecret` и CLI** — AC-7.5, UC-10 А3, §3.1 `envCrypto` (depends on 3, 8)
  - **Skill:** nestjs-code test unit crypto ac-7-5-secrets (CREATE); nestjs-code test unit cli ac-7-5-crypto-command (CREATE)
  - `test/unit/crypto/ac-7-5-secrets.spec.ts` (помощники `errorOf`, `expectKeysOnly` из `test/unit/config/support.ts`; схема `defineEnv({...envCrypto})`):
    - «AC-7.5: секрет < 32 байт → InvalidEnvironmentError с путём ENCRYPTION_KEYS.0.secret, без значения»;
    - «AC-7.5: повтор версии → путь ENCRYPTION_KEYS, без значений»;
    - «AC-7.5: version 0 (и -1, 1.5) → путь ENCRYPTION_KEYS.0.version, без значений» (KT-26 п. 2: version — целое ≥ 1, как `v<N>`; схема `z.number().int().positive()` уже есть с E1 — код не меняется);
    - «AC-7.5: createCipher с version 0 → TypeError с путём keys.0.version, без секрета» (та же схема, D2);
    - «AC-7.5: секрет в base64 с '+', '/' или '=' → путь ENCRYPTION_KEYS.0.secret» (`it.each` по трём символам; строки 32+ байт);
    - «AC-7.5: секрет из generateSecret() принимается envCrypto и createCipher» (разбор → `createCipher({service, keys: env.ENCRYPTION_KEYS, purpose})` → roundtrip);
    - «§3.6: generateSecret(48) — 48 байт base64url без '='; generateSecret(31), (0) и (32.5) — RangeError» (D8).
    - Существующий `test/unit/config/env-crypto.spec.ts` (E1) остаётся без изменений.
  - `test/unit/cli/ac-7-5-crypto-command.spec.ts` по образцу `test/unit/cli/ac-5-10-rabbitmq-command.spec.ts` (обработчик в процессе, `vi.spyOn(process.stderr, 'write')`, `LOG_LEVEL: 'silent'`):
    - «AC-7.5: crypto generate-secret — stdout одна строка JSON {secret}, значение secret принимается ENCRYPTION_KEYS, выход 0» (ровно одна строка, `JSON.parse`, ключи объекта — только `secret`, без `=`; разбор `parseEnv(defineEnv({...envCrypto}), {ENCRYPTION_KEYS: JSON.stringify([{version: 1, secret}])})`);
    - «AC-7.5: --bytes 16 → USAGE, выход 1»;
    - «AC-7.5: --bytes 64 — секрет 64 байта»;
    - «UC-10: два вызова — разные секреты»;
    - `it.each` «UC-10: %s → USAGE, выход 1»: без подкоманды, `generate`, `generate-secret 64` (лишний позиционный аргумент), `--bytes 0`, `--bytes abc`, неизвестная опция `--out x`;
    - «AC-7.5: при LOG_LEVEL=debug stdout — только одна строка JSON, debug-лог «crypto generate-secret: 32 байт» — в stderr, секрета в stderr нет» (KT-26 п. 12: перехват `process.stderr.write` — в нём есть debug-строка; `output` контекста — ровно одна строка `{"secret"}`, без строк лога).
  - Логи: нет.
  - Готово, когда: `pnpm test` зелёный.

### Фаза 4: Архив, потребитель, документация

- [x] **Task 10: AC-1.1, AC-1.2, AC-9.1 — архив и проект-потребитель с `/crypto`** — AC-1.1, AC-1.2, AC-9.1 (depends on 5, 8)
  - **Skill:** nestjs-code test package ac-1-1-package (MODIFY); none — `.mjs`/`.ts` проекта-потребителя (правка по образцу существующих)
  - `test/package/ac-1-1-package.spec.ts`: в «AC-1.1: состав архива» — `package/dist/crypto/index.js`, `package/dist/cli/commands/crypto.js`; в «AC-1.1: dist рабочих подпутей не импортирует testing и shell-quote» — `'crypto'` в списке каталогов; новый «AC-1.2: dist/crypto загружает только node:*, zod и свои файлы (без pg, @nestjs/*, dist/config/index.js, dist/testing)» — `importGraph(dist/crypto/index.js)`.
  - `test/consumer/minimal/import-check.mjs`: `crypto:${await probe('@verdeect/kit/crypto', 'createCipher')}` после `config`; ожидаемые строки в `test/package/ac-9-1-consumer.spec.ts` (оба случая AC-1.1) — с `crypto:ok`.
  - `test/consumer/no-testcontainers/peer-check.mjs`: `'crypto'` в список подпутей, которые импортируются; в `ac-9-1-consumer.spec.ts` случай AC-1.2 — `expect(...).toContain('crypto:ok')` и `/crypto` в названии.
  - `test/consumer/minimal/types-check.ts`: `import { createCipher, DecryptError, generateSecret, type DecryptErrorReason, type KitCipher } from '@verdeect/kit/crypto'`; `const cipher: KitCipher = createCipher({service: 'consumer', keys: [{version: 1, secret: generateSecret()}], purpose: 'client-secret'})`; `// @ts-expect-error aad обязателен (§3.6)` на `cipher.encrypt('x')`; `DecryptError` — проверка `reason` типа `DecryptErrorReason`.
  - `test/package/ac-9-1-consumer.spec.ts`, новый случай «AC-9.1: verdeect-kit crypto generate-secret из архива — секрет принимается createCipher потребителя»: `runInConsumer(dir(minimal), 'pnpm', ['exec', 'verdeect-kit', 'crypto', 'generate-secret'])` → JSON `secret` → `node --input-type=module -e` в каталоге потребителя: `createCipher` из `@verdeect/kit/crypto` + roundtrip, вывод `ok`.
  - Логи: нет.
  - Готово, когда: `pnpm pack:check` зелёный.

- [x] **Task 11: README, CHANGELOG `[Unreleased]`, тест AC-9.3** — AC-9.3, UC-10, «Library Package Scope» (7) (depends on 4, 8)
  - **Skill:** none — Markdown; тест — `nestjs-code test package ac-9-3-docs (MODIFY)`
  - `README.md`:
    - «Подпути»: `/crypto` — `готов, в [Unreleased]`;
    - новый раздел `## Шифр` (после «Сообщения»): `createCipher({service, keys: env.ENCRYPTION_KEYS, purpose})`, формат `v<N>:<iv>:<ct>:<tag>`, `aad = <purpose>:<id записи>` (обязателен), `DecryptError` и причины, HKDF `info = verdeect-<svc>:<purpose>`, старые форматы не читаются (сервисы — §10: значения создаются заново), пример кода;
    - «Развёртывание», строка смены ключа шифра (без «(с E7)»): 1) `verdeect-kit crypto generate-secret` — единственный рекомендуемый способ получить секрет; 2) новая версия **первой** в `ENCRYPTION_KEYS`, старая остаётся; 3) перезапуск всех реплик; 4) задача сервиса под `runExclusive` перешифровывает значения с `needsReencrypt(value) === true`; 5) старая версия убирается из `ENCRYPTION_KEYS` после того, как значений под ней не осталось;
    - «API»: `### @verdeect/kit/crypto` — `createCipher`, `KitCipher`, `KitCipherOptions`, `DecryptError`, `DecryptErrorReason`, `generateSecret` (каждое имя в обратных кавычках с кратким контрактом);
    - CLI: `verdeect-kit crypto generate-secret [--bytes 32]` → `{"secret":"…"}`; пример получения секрета — `verdeect-kit crypto generate-secret | jq -r .secret` (§3.6 v1.16) и в «Развёртывании», и в разделе «Шифр»; `--bytes` — целое ≥ 32.
  - `CHANGELOG.md`, `[Unreleased]`: вводная строка — «… `/crypto` и CLI `crypto` (этап E7, PRD v1.16)»; `### Added`: `/crypto: createCipher и типы KitCipher, KitCipherOptions — AES-256-GCM, HKDF-SHA256 (info verdeect-<svc>:<purpose>), значение v<N>:<iv>:<ct>:<tag> base64url, обязательный aad, needsReencrypt`; `/crypto: DecryptError и тип DecryptErrorReason — 'format' | 'unknown_version' | 'auth' без открытого текста и ключей`; `/crypto: generateSecret(bytes = 32) — секрет base64url (не меньше 32 байт)`; `CLI: verdeect-kit crypto generate-secret [--bytes N]`.
  - `AGENTS.md`: строка состояния (сейчас «Состояние после E5 …») → «после E7» с `/crypto` и CLI `crypto`, дальше — только E8; в дереве `src/` — `crypto/` (`cipher.ts`, `index.ts`) и `cli/commands/crypto.ts`, если дерево перечисляет команды; в таблице ключевых файлов — строка `src/crypto/index.ts` | публичная поверхность `@verdeect/kit/crypto`.
  - `test/package/ac-9-3-docs.spec.ts`: `ENTRY_POINTS` + `'src/crypto/index.ts'`; в «AC-9.3: README — правила развёртывания» — фрагменты `'crypto generate-secret'`, `'jq -r .secret'`, `'needsReencrypt'`, `'первой'`.
  - Логи: нет.
  - Готово, когда: `pnpm exec vitest run -c vitest.package.config.ts test/package/ac-9-3-docs.spec.ts` и `pnpm format:check` зелёные.

## Commit Plan
- **Commit 0** (сделан, `8a92b65`): `docs(requirements): r11 — PRD v1.16, уточнения E5 и вопросы планирования E7`
- **Commit 1** (задачи 1–2): `fix(testing): openChannel закрывает соединение при отказе канала; AC-3.9 — второй пробник после ECONNRESET (KT-24)`
- **Commit 2** (задачи 3–7): `feat(crypto): подпуть @verdeect/kit/crypto — createCipher, DecryptError, generateSecret`
- **Commit 3** (задачи 8–9): `feat(cli): verdeect-kit crypto generate-secret`
- **Commit 4** (задачи 10–11): `docs(crypto): архив, проект-потребитель, README и CHANGELOG (E7)`

Каждая фаза заканчивается зелёными `pnpm lint`, `pnpm typecheck`, `pnpm test`; фаза 1 — ещё `pnpm test:timing` (AC-3.9) и `pnpm test:integration` (AC-5.13 без регрессии); фаза 4 — `pnpm pack:check`. Перед слиянием: `make test-full`.

## Traceability

| UC/AC | Задачи | Тест-файл / название |
|---|---|---|
| AC-7.1 | 4, 6 | `test/unit/crypto/ac-7-1-encrypt-decrypt.spec.ts` / «AC-7.1: …» |
| AC-7.2 | 4, 6 | `test/unit/crypto/ac-7-2-decrypt-errors.spec.ts` / «AC-7.2: …» |
| AC-7.3 | 4, 6 | `test/unit/crypto/ac-7-3-key-separation.spec.ts`, `test/unit/crypto/ac-7-3-test-vector.spec.ts` / «AC-7.3: …» (в т. ч. ключ из UTF-8 строки → `'auth'`, контрольный вектор) |
| AC-7.4 | 4, 6 | `test/unit/crypto/ac-7-4-rotation.spec.ts` / «AC-7.4: …» |
| AC-7.5 | 3, 4, 8, 9 | `test/unit/crypto/ac-7-5-secrets.spec.ts`, `test/unit/cli/ac-7-5-crypto-command.spec.ts` / «AC-7.5: …»; `test/unit/config/env-crypto.spec.ts` (E1, без изменений) |
| UC-10 | 4, 6, 8, 9, 11 | AC-7.1–AC-7.5; «UC-10: …» в `ac-7-5-crypto-command.spec.ts`; README «Развёртывание» (`ac-9-3-docs.spec.ts`) |
| AC-1.1 (растёт) | 5, 10 | `test/unit/package/package-manifest.spec.ts`, `test/package/ac-1-1-package.spec.ts`, `test/package/ac-9-1-consumer.spec.ts` / «AC-1.1: …» |
| AC-1.2 (растёт) | 5, 7, 10 | `test/unit/crypto/ac-1-2-crypto-without-peers.spec.ts`, `test/package/ac-1-1-package.spec.ts`, `test/consumer/no-testcontainers/peer-check.mjs` / «AC-1.2: …» |
| AC-9.1 (растёт) | 10 | `test/package/ac-9-1-consumer.spec.ts` / «AC-9.1: verdeect-kit crypto generate-secret из архива …», `test/consumer/minimal/types-check.ts` |
| AC-9.3 (растёт) | 11 | `test/package/ac-9-3-docs.spec.ts` |
| AC-9.4 | 4, 5 | `test/package/ac-9-4-lint-rules.spec.ts` (без изменений; `src/crypto/**` под правилом) |
| AC-5.13 (KT-24 п. 1) | 1 | `test/unit/testing/test-events-open-channel.spec.ts` / «AC-5.13: …» |
| AC-3.9 (KT-24 п. 2) | 2 | `test/timing/http/ac-3-9-shutdown.spec.ts` / «AC-3.9: новый запрос после шага 2 — отказ соединения …» |
