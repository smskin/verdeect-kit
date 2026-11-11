# План реализации: E8 Redis (`@verdeect/kit/redis`)

Mode: full
Branch: feature/e8-redis
Created: 2026-11-11

## Original Request
Реализуй этап roadmap «E8 Redis» по пакету требований requirements/0000-kit/ (ревизия r11, PRD v1.16).

Скоуп этапа: AC-8.1–AC-8.6; сквозной AC-9.5 для лимитера; prd.md §3.7 целиком (KitRedisModule с keyPrefix <svc>: и подписочным соединением по subscriber: true, RateLimiter hit/peek fail-open с метрикой verdeect_rate_limit_unavailable_total и правилом алерта, throwRateLimited через DomainError и словарь /http, CLI redis acl); §3.8 — строки и поля с этапом E8 (startTestStack с redis и ACL, workerScope.redisPrefix <svc>:w<N>:); подпуть ./redis в exports и в проверках AC-1.1, AC-1.2; проект-потребитель (AC-9.1) с Redis; README и CHANGELOG [Unreleased]. Перенос кода — по requirements/0000-kit/files/inventory.md: redis.provider — O, rate-limiter — I; тесты эквивалентности — I/B rate-limiter, B redis-acl.http-spec. Репозитории сервисов — только чтение. AC уровня T — в test/timing. После слияния — ручной выпуск 1.0.0-rc.1 (не в этом плане). Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION. Решения прошлых этапов, которые касаются E8: модуль закрывается хуком Nest — соединения Redis в onApplicationShutdown (шаг 4), отдельных участников KitLifecycle не регистрировать; проверка опционального peer ioredis — синхронная при загрузке подпути, сам peer — динамическим import() (П15, без top-level await); импорты src/redis/** — правило ESLint по образцу /crypto, проверка графа импортов — общим помощником test/support/import-graph.ts; throwRateLimited бросает DomainError с кодом RATE_LIMITED из kitErrors (§3.5), Retry-After — в секундах вверх; workerScope() синхронная (как rabbitmq в E5): префикс <svc>:w<N>: по VITEST_POOL_ID; ACL — aclfile из CLI redis acl, который startTestStack грузит в globalSetup (пользователь сервиса, префикс воркера лежит внутри <svc>:*, отдельных пользователей на воркер нет — AC-8.5); адреса — provide; ошибки ioredis в логах — без аргументов команд (sanitizeError, E2); тесты без реальных пауз (правило Test Speed Regressions) — подменённые часы, сигналы, ожидание со сроком × TEST_TIMEOUT_SCALE. Уже реализованные этапы E1–E5, E7 — существующий код, не переделывай его без требования. Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня. Фазы должны оставлять проект в рабочем состоянии: тесты зелёные после каждой фазы.

## Settings
- Testing: yes — по уровням AC (`prd.md` §5):
  - U — `test/unit/redis`, `test/unit/http`, `test/unit/cli`, `test/unit/testing`, `test/unit/package`;
  - I — `test/integration/redis` (AC-8.1, AC-8.3, AC-8.5, AC-8.6) на `startTestStack({redis: true})`;
  - T — `test/timing/redis` (AC-8.2);
  - C — `test/consumer/minimal`, `test/consumer/no-testcontainers` (AC-9.1, AC-9.5, AC-1.2);
  - R — `test/package` (AC-1.1, AC-1.2, AC-9.3).
  - Реальных пауз нет: часы лимитера — `vi.useFakeTimers()`/`vi.setSystemTime`, недоступность Redis — `tcpProxy.break()`/`blackhole()` (поведение реального драйвера, срок ответа — сам предмет AC-8.2), ожидание сообщений — сигналом (промис обработчика) со сроком `× TEST_TIMEOUT_SCALE`.
- Logging: verbose.
  - `KitRedisModule`: `debug` — подключение и закрытие соединений (`connection: 'main' | 'subscriber'`); первая ошибка соединения после `ready` — `warn` `{connection, err: sanitizeError(e)}`, повторы до следующего `ready` — `debug` (переподключения не заливают лог); URL, пароль, ключи и аргументы команд в лог не попадают (NFR-4).
  - `RateLimiter`: отказ по лимиту — `debug` `{scope}` (`scope` — часть ключа до первого `:`, сам ключ не пишется); Redis недоступен — метрика +1 на каждую проверку, `warn` «лимитер: Redis недоступен, запрос пропущен» `{err: sanitizeError(e)}` не чаще раза в 60 с на процесс; поля `service`, `replica` — из базы логгера пакета (NFR-8, AC-9.5).
  - `KitRedisChannels`: ошибка обработчика сообщения — `error` + `captureError` (точка входа, «Error Tracking»); неудачный `publish` — исключение вызывающему (ожидаемое решение — его).
  - CLI `redis acl`: `info` «redis acl: собрано» `{services, out}`; ошибка — JSON `{level: 'error', code, message, keys?}` в stderr, как у `rabbitmq`. Хеши паролей в лог не пишутся.
  - Только `pino`, без `console.*` (NFR-8, AC-9.4).
- Docs: no — `WARN [docs]` без обязательного чекпоинта `/aif-docs`. README, CHANGELOG и `AGENTS.md` всё равно обновляет задача 18 (AC-9.3, «Library Package Scope» (7)).

## Roadmap Linkage
Milestone: "E8 Redis"
Rationale: план реализует ровно скоуп вехи E8 из `.ai-factory/ROADMAP.md` (`/redis` §3.7, строки E8 §3.8, UC-11, UC-12, UC-14 (часть), AC-8.1–AC-8.6, AC-9.5 для лимитера). Выпуск `1.0.0-rc.1` и `npm trust` — вручную после слияния, вне плана.

## Requirements Reconciliation

Иерархия источников (запрос пользователя, skill-context «Requirements Package Authority»): `requirements/0000-kit/prd.md` **v1.17 (ревизия r12, коммит `0af1d16` — первый в ветке, KT-28)** > `requirements/0000-kit/files/inventory.md` > `.ai-factory/ROADMAP.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`, `rules/base.md`. Запрос ссылается на r11/v1.16; r12 меняет только `/crypto` (§3.1 `envCrypto`, §3.6, AC-7.2, AC-7.5) — §3.7, §3.8 и AC-8.x не изменились. Код сервиса, расходящийся с PRD, не переносится как есть (P0).

**Milestone scope:** AC-8.1, AC-8.2, AC-8.3, AC-8.4, AC-8.5, AC-8.6; AC-9.5 (лимитер); §3.7 целиком; §3.8 — `startTestStack({redis})` + ACL, `workerScope().redisPrefix`; UC-11; UC-12 (Redis: префикс и ACL); UC-14 (префикс Redis воркера); растущие AC-1.1, AC-1.2 (подпуть `./redis`); сквозные AC-9.1 (потребитель с Redis), AC-9.3 (README, CHANGELOG), AC-9.4 (правило lint на `src/redis/**` без изменения правила).

Вне скоупа: выпуск `1.0.0-rc.1` (вручную после слияния), переходы сервисов (§10), `RedisBus` O и `job-lock` (N7). `[OPEN]` §11 п. 1–3 к E8 не относятся. `[ASSUMPTION]` §11 п. 4 и §6 к E8 не относятся.

До плана в ветке (KT-28): `0af1d16` `docs(requirements): r12 — PRD v1.17, уточнения /crypto`; `8754329` `test(crypto): AC-7.2, AC-7.5 по PRD v1.17 …` (сверка /crypto: код совпадает с v1.17, дописаны три теста).

**Эталоны (inventory §1):**
- `redis.provider` — **O** `verdeect-orchestrator/apps/orchestrator/src/shared/redis/redis.provider.ts` (112) + `redis.module.ts` (26): `lazyConnect`, `maxRetriesPerRequest: 1`, `commandTimeout` 500 / 5000 для подписки, два токена, закрытие `quit()` → при ошибке `disconnect()` в `onApplicationShutdown`, проба `redis` некритичная (`PING` = `PONG`), ошибки соединения — `warn` с `code`, URL не логируется. Из O не берётся: `RedisBus`, `channels.ts`, `JobLock` (N7, доменное), ручные префиксы (заменены `keyPrefix` и обёрткой каналов).
- `rate-limiter` — **I** `verdeect-identity/apps/identity/src/shared/security/rate-limiter.ts` (92): `consume` → `hit`, `peek`, fail-open, логи по `scope`. Из B (`verdeect-bff/apps/bff/src/shared/security/rate-limiter.ts`, 62): `PTTL` вместо `TTL`, fail-open без GlitchTip. Изменено по PRD: окно в мс, `PEXPIRE … NX` в том же `MULTI` (у I и B — отдельный `EXPIRE` после `MULTI`), результат `{allowed, remaining, retryAfterMs}`, метрика `verdeect_rate_limit_unavailable_total`.
- 429: I `RateLimitedError`, B `BffError.rateLimited` → `throwRateLimited` (`DomainError` + фильтр, D6).
- Тесты эквивалентности: I `test/integration/security/rate-limiter.int-spec.ts`, B `test/integration/shared/rate-limiter.int-spec.ts` → задача 14 (`ac-8-3-rate-limiter.spec.ts`); B `test/http/shared/redis-acl.http-spec.ts` (NOPERM, `ACL LOG` пуст, команды модуля под ACL проходят) → задача 14 (`ac-8-1-prefix-acl.spec.ts`). Не переносится: пользователь ACL через `ACL SETUSER` в тесте и номер БД на воркер у B (заменены aclfile из CLI и префиксом воркера, AC-8.5).

Решения (источник → задача):

| # | Решение | Источник | Задача |
|---|---|---|---|
| D1 | Публичный экспорт `/redis`: `KitRedisModule`, токен `KIT_REDIS` (ioredis основного соединения с `keyPrefix`), класс `KitRedisChannels` (`publish(channel, message)`, `subscribe(channel, handler)` → функция отписки), `RateLimiter`, `throwRateLimited`; типы `KitRedisModuleOptions`, `RateLimitOptions`, `RateLimitResult`. Сырого подписочного соединения наружу нет (внутренний токен). В PRD их внесёт следующая ревизия | ответ пользователя 11.11 (вопрос «Клиент/каналы»), §3.7 «префикс к каналам ставит обёртка» | 3, 4, 5, 6 |
| D2 | Префикс — внутренний токен `KIT_REDIS_PREFIX` (`src/internal/tokens.ts`), умолчание `<svc>:`; его читают и `keyPrefix` основного соединения, и `KitRedisChannels`. `/testing` экспортирует `redisWorkerOverride()` → `{provide: KIT_REDIS_PREFIX, useValue: workerScope().redisPrefix}` для `createTestApp({overrides})`; из `/redis` токен не экспортируется. Опции `keyPrefix` у `forRoot` нет (P0) | ответ пользователя 11.11 («Префикс воркера», вариант 3) | 2, 3, 11 |
| D3 | CLI `verdeect-kit redis acl --services <svc,…> --out <файл>`: хеш пароля — ключ `REDIS_PASSWORD_HASH_<SVC>` (заглавные, `-` → `_`), значение — sha256 пароля, 64 hex в нижнем регистре; нет ключа или неверный формат — `INVALID_ENVIRONMENT` с `keys` без значений, выход 1. aclfile: первая строка `user default off`, далее по сервису `user <svc> on #<hash> ~<svc>:* &<svc>:* +@all -@dangerous` (отступление от буквы §3.7 `><пароль>`: в файле нет открытого пароля). `--out` пишет aclfile, stdout — JSON `{out, services}`. Без `--out` — `USAGE` (aclfile — не JSON, а stdout CLI — только JSON) | ответ пользователя 11.11 («redis acl», вариант 3); ARCHITECTURE «CLI» | 9, 10 |
| D4 | `startTestStack({redis: true})`: пароль сервиса — случайный, хеш — тем же `buildRedisAclFile`, что CLI; к aclfile добавляется администратор теста `user kit-test-admin on #<hash> ~* &* +@all`; контейнер `TEST_IMAGES.redis` с `--aclfile`, без сохранения на диск. `provide`: `kitRedisUrl` (пользователь сервиса — `REDIS_URL` тестов), `kitRedisAdminUrl` (администратор теста: `CLIENT LIST`, `ACL LOG`, очистка), `kitRedisService` (имя сервиса для `redisPrefix`). Пользователей на воркер нет (AC-8.5) | §3.8; ответ пользователя 11.11; запрос «отдельных пользователей на воркер нет» | 11 |
| D5 | `workerScope().redisPrefix` = `<svc>:w<VITEST_POOL_ID>:` — синхронный ленивый геттер (как `rabbitmq`); стек без `redis: true` — `TypeError` при обращении. Префикс лежит внутри `~<svc>:*` и `&<svc>:*` ACL сервиса | §3.8, AC-8.5 | 11 |
| D6 | `throwRateLimited(result)` бросает `DomainError('RATE_LIMITED', {retryAfterSec})`, `retryAfterSec = max(1, ceil(retryAfterMs / 1000))`; `KitExceptionFilter` для `code === 'RATE_LIMITED'` с целым `details.retryAfterSec ≥ 1` ставит `Retry-After: <retryAfterSec>`. Сигнатура `DomainError` (E3) не меняется. `result.allowed === true` — `TypeError` (ошибка разработчика) | ответ пользователя 11.11 («Retry-After»); §3.5, §3.7, AC-8.4 | 1, 5 |
| D7 | Ключ лимитера — `rl:<key>` под `keyPrefix` → в Redis `<svc>:rl:<key>`. `hit`: `MULTI` `INCR k`, `PEXPIRE k windowMs NX`, `PTTL k` `EXEC` — один обход, окно фиксировано первым попаданием (`NX` — Redis ≥ 7.0; `TEST_IMAGES.redis` 7.4); `allowed = count ≤ limit`, `remaining = max(0, limit − count)`, `retryAfterMs = allowed ? 0 : max(0, pttl)`. Минимум Redis 7.0 — в README (таблица совместимости и «Развёртывание», KT-29). `peek`: `MULTI` `GET k`, `PTTL k`; `count = Number(get ?? 0)`, `allowed = count < limit`, `remaining = max(0, limit − count)`, `retryAfterMs = allowed ? 0 : max(0, pttl)`; счётчик не меняется. `key` — непустая строка, `limit`, `windowMs` — целые ≥ 1, иначе `TypeError` | §3.7, AC-8.3; I (`peek`), B (`PTTL`) | 5 |
| D8 | Fail-open: любая ошибка `exec` (в т. ч. ошибка команды внутри результата `MULTI`) → `{allowed: true, remaining: limit, retryAfterMs: 0}`, `metrics.rateLimitUnavailable.inc()` (метка `service` — из `setDefaultLabels`) на каждую проверку, `warn` не чаще раза в 60 с; без GlitchTip — ожидаемая ошибка недоступной зависимости (skill-context «Expected Errors Are Not Reported»; B — без GlitchTip, I — с ним: берётся B). Правило алерта `VerdeectRateLimitUnavailable` уже есть с E2 (`alerts/verdeect-kit.rules.yml`) — не меняется | §3.7, AC-8.3, AC-9.5, NFR-8 | 5 |
| D9 | Основное соединение: `lazyConnect: true`, `maxRetriesPerRequest: 1`, `commandTimeout: 500`, `keyPrefix` из D2, `enableReadyCheck: false` (проверка готовности шлёт `INFO`, а `INFO` входит в `@dangerous` и запрещён ACL §3.7; ioredis 6.0.0 при отказе `INFO` не падает, а пишет `console.warn` «Skipping the ready check…» — `built/Redis.js:791`, мимо pino, NFR-8). При подключении ioredis шлёт `CLIENT SETNAME` (`connectionName`) и `CLIENT SETINFO LIB-VER/LIB-NAME` с `errorHandler: noop` (`built/redis/event_handler.js:45-70`) — отказ ACL был бы немым, поэтому тест AC-8.1 проверяет пустой `ACL LOG` с момента до подключения; если `SETINFO` запрещён `-@dangerous`, ставится `disableClientInfo: true`, ACL не расширяется, `connectionName: <svc>`. Подписочное (только `subscriber: true`): то же без `keyPrefix`, `commandTimeout: 5000`, `connectionName: <svc>-subscriber`. URL — `REDIS_URL` из `ConfigService` (`envRedis`); нет `ConfigService` — `Error` как у `KitMessagingModule` | §3.7, AC-8.2, AC-8.6; O; ioredis 6.0.0 (Context7: `enableReadyCheck` шлёт `INFO`, `keyPrefix` не ставится каналам и шаблонам `KEYS`/`SCAN`) | 3 |
| D10 | `KitRedisChannels`: `publish(channel, message: string): Promise<number>` → `PUBLISH <prefix><channel>` через основное соединение; `subscribe(channel, handler: (message: string) => void \| Promise<void>): Promise<() => Promise<void>>` → `SUBSCRIBE <prefix><channel>` через подписочное, одна подписка Redis на канал, обработчики — `Set`, `UNSUBSCRIBE` при уходе последнего; в событии `message` префикс снимается. `subscribe` без `subscriber: true` — `Error` разработчика. Сообщение — строка (JSON — забота сервиса). Повторная подписка после переподключения — `autoResubscribe` ioredis (умолчание). Подписочное соединение ленивое (`lazyConnect`, `built/Redis.js:89`): открывается при первом `subscribe` | D1; §3.7; AC-8.6; O `RedisBus` (только механика `Set` обработчиков) | 4 |
| D11 | Проба `/health` `redis` — `PING` основного соединения, `{critical: false}` (недоступен → `degraded`, 200). Закрытие — `onApplicationShutdown` (шаг 4): `status` `wait`/`end` → `disconnect()`, иначе `quit()`, ошибка `quit` → `debug` и `disconnect()`. Участников `KitLifecycle` нет | §3.7, AC-8.2, UC-11; ARCHITECTURE «Жизненный цикл»; запрос | 3 |
| D12 | `ioredis` — опциональный peer (`^6.0.0`, уже в `peerDependencies`); `devDependencies` — точная `6.0.0`. `src/redis/peer.ts` — `requirePeer('ioredis', 'redis')`, первая строка импорта `index.ts`; сам пакет — мемоизированный `loadIoredis()` (`import('ioredis')`) в фабрике провайдера, без top-level await (П15). Типы ioredis в публичном `.d.ts` `/redis` допустимы (подпуть требует ioredis) | NFR-3, AC-1.2; ARCHITECTURE «Правила зависимостей» | 2, 7 |
| D13 | `src/redis/**` импортирует значения только из `../http/index.js` (`DomainError`), `../observability/index.js`, `../config/index.js`, `../internal/*`; правило ESLint по образцу блока `/crypto`. Граф импортов — `test/support/import-graph.ts` | ARCHITECTURE таблица (`redis`); запрос | 7, 8 |
| D14 | Решения D1–D13 приняты чатом kit (KT-29, 11.11.2026); D1–D4, D6–D9 войдут в PRD r13 после E8 — код не блокируется. Уточнения: D7 — минимум Redis 7.0 в README (таблица совместимости, «Развёртывание»); D9 — тест AC-8.1: под пользователем из aclfile CLI (`user default off`) оба соединения подключаются (`CLIENT SETNAME`), проба `redis` — `up`, `INFO` → `NOPERM` | KT-29 | 14, 18 |

Варианты лимитера (AC-8.3, AC-8.4, AC-9.5):

| Вызов | Состояние Redis | Итог | Метрика / лог | Проверка |
|---|---|---|---|---|
| `hit` № 1…`limit` в окне | доступен | `allowed: true`, `remaining = limit − n`, `retryAfterMs: 0`; TTL ключа ≤ `windowMs` | — | AC-8.3 (I) |
| `hit` № `limit + 1` | доступен | `allowed: false`, `remaining: 0`, `retryAfterMs = PTTL` (0 < … ≤ `windowMs`) | `debug` `{scope}` | AC-8.3 (I) |
| `hit` после окна | доступен | `allowed: true` снова (ключ истёк) | — | AC-8.3 (I, `PEXPIRE` малым окном и опрос `PTTL` = −2 — без паузы на окно) |
| `peek` после `limit` попаданий | доступен | `allowed: false`, счётчик не изменился (`GET` до и после) | — | AC-8.3 (I) |
| `peek` без попаданий | доступен | `allowed: true`, `remaining = limit` | — | AC-8.3 (I) |
| `hit`/`peek` | недоступен | `allowed: true`, `remaining = limit`, `retryAfterMs: 0` | метрика +1 на вызов; `warn` раз в 60 с | AC-8.3 (I), U (часы), AC-9.5 (C) |
| `throwRateLimited({allowed: false, retryAfterMs: 1500})` | — | 429 `RATE_LIMITED`, `Retry-After: 2`, `details.retryAfterSec: 2` | `warn` фильтра, без GlitchTip | AC-8.4 (U), C |
| `throwRateLimited` с `retryAfterMs: 0` / `1` | — | `Retry-After: 1` | — | AC-8.4 (U) |

Представительный реальный артефакт: aclfile, собранный той же функцией, что CLI, грузится настоящим `redis:7.4.11-alpine` в `globalSetup` (задача 11), и все I-тесты Redis идут под пользователем сервиса этого файла (AC-8.1, AC-8.5); проект-потребитель (C) запускает собранный сервис на этом же стеке.

## Architecture and Decisions
- Файлы `src/redis/`: `peer.ts`, `client.ts` (загрузка ioredis, создание и закрытие соединения), `kit-redis.module.ts`, `channels.ts`, `rate-limiter.ts`, `index.ts`. ARCHITECTURE.md называет `kit-redis.module.ts · rate-limiter.ts`; `channels.ts` и `client.ts` — по D1, D9 (по одному классу/функции на файл, как в `/messaging`).
- Внутренние токены — `src/internal/tokens.ts`: `KIT_REDIS_PREFIX`, `KIT_REDIS_SUBSCRIBER` (рядом с `KIT_METRICS`, `KIT_LOGGER`); `/testing` импортирует `KIT_REDIS_PREFIX` оттуда (D2).
- Генератор aclfile — `src/internal/redis-acl.ts` (общий для CLI и `startTestStack`, как `internal/rabbitmq-definitions.ts`).
- Модуль `global: true`, как `KitMessagingModule`/`KitDatabaseModule`; `forRoot` синхронный (асинхронна только фабрика провайдера соединения).
- Версия пакета не меняется (G14: E1–E8 в `[Unreleased]`; `1.0.0-rc.1` — вручную после слияния).

## Tasks

### Фаза 1: Подпуть `/redis`

- [x] **Task 1: `Retry-After` для `RATE_LIMITED` в `KitExceptionFilter`** — AC-8.4, §3.5, §3.7, D6
  - **Skill:** nestjs-code generic src/http/kit-exception.filter.ts (MODIFY); nestjs-code generic src/http/errors.ts (MODIFY — только шапка)
  - `src/http/kit-exception.filter.ts`, ветка `DomainError`: если `error.code === 'RATE_LIMITED'` и `details?.retryAfterSec` — целое ≥ 1 (`Number.isInteger`), то `void reply.header('Retry-After', String(details.retryAfterSec))` перед `send`. Иначе заголовка нет (тело и статус — как сейчас). Остальные ветки не трогать.
  - `src/http/errors.ts`, шапка: «заголовков в DomainError нет (Retry-After 429 — E8)» → «заголовков в DomainError нет; Retry-After для RATE_LIMITED ставит KitExceptionFilter по details.retryAfterSec (E8, §3.7)». TSDoc `DomainError` — то же одной строкой.
  - Логи: без изменений (`warn` фильтра для `DomainError`, без GlitchTip).
  - Готово, когда: `test/unit/http/ac-3-3-exception-filter.spec.ts` зелёный без правок.

- [x] **Task 2: peer ioredis, загрузчик и внутренние токены** — NFR-3, AC-1.2, D2, D9, D12 (depends on —)
  - **Skill:** nestjs-code generic src/redis/peer.ts (CREATE); nestjs-code generic src/redis/client.ts (CREATE); nestjs-code generic src/internal/tokens.ts (MODIFY)
  - `src/redis/peer.ts`: шапка + `import { requirePeer } from '../internal/peer.js'; requirePeer('ioredis', 'redis');` (образец `src/messaging/peer.ts`).
  - `src/internal/tokens.ts`: `KIT_REDIS_PREFIX = Symbol('KIT_REDIS_PREFIX')`, `KIT_REDIS_SUBSCRIBER = Symbol('KIT_REDIS_SUBSCRIBER')`, `KIT_REDIS_LOG = Symbol('KIT_REDIS_LOG')` с TSDoc `@internal` (D2: не реэкспортируются из `/redis`).
  - `src/redis/client.ts` (шапка: эталон O `redis.provider.ts` — опции, `close`; ошибки соединения без URL):
    - `export const KIT_REDIS = Symbol('KIT_REDIS')` с TSDoc (значение — `Redis` ioredis основного соединения с `keyPrefix`) — здесь, а не в `kit-redis.module.ts`: его внедряют `RateLimiter` и `KitRedisChannels`, которые импортирует модуль; объявление в модуле дало бы цикл ESM и `@Inject(undefined)`;
    - `loadIoredis()` — мемоизированный `import('ioredis').then((module) => module.Redis)` — именованный `Redis` (класс клиента), **не** `.default`: ioredis 6.0.0 — CommonJS (`built/index.js:4` `exports = module.exports = require("./Redis").default`), при `module: NodeNext` ESM-`default` типизируется как весь `module.exports`, а `Redis` объявлен `Object.defineProperty(exports, "Redis", …)` (`built/index.js:8`) и виден лексеру CJS Node; поэтому образец `loadPg` (`module.default`, `src/database/pg.ts`) не копируется как есть; типы — `import type { Redis, RedisOptions } from 'ioredis'`;
    - `export interface RedisLog {debug, info, warn, error: (fields: object, message: string) => void}` и `redisNestLog(context): RedisLog` — адаптер логгера Nest той же формы, что `nestLog` в `src/messaging/rabbit-connection.ts:43-65` (импорт из `/messaging` запрещён правилом ESLint задачи 7, поэтому своя копия); pino приложения (`KIT_LOGGER`) уже реализует `RedisLog` и несёт `service`, `replica` в `base` (AC-9.5);
    - `createRedisConnection({url, connection: 'main' | 'subscriber', service, keyPrefix?, log: RedisLog}): Promise<Redis>` — опции D9 (`commandTimeout` 500 / 5000, `keyPrefix` только у `main`, `connectionName` `<svc>` / `<svc>-subscriber`, `enableReadyCheck: false`, `lazyConnect: true`, `maxRetriesPerRequest: 1`); обработчик `error`: первая ошибка после `ready` — `warn` `{connection, err: sanitizeError(e)}` «redis: ошибка соединения», дальше до следующего `ready` — `debug`; `ready` — `debug` «redis: соединение готово»;
    - `closeRedisConnection(redis, log: RedisLog)` — D11 (`wait`/`end` → `disconnect()`, иначе `quit()`, ошибка → `debug {err: error.name}` и `disconnect()`).
  - Логи: как в Settings (`debug`/`warn`, без URL и аргументов).
  - Готово, когда: `pnpm typecheck` зелёный.

- [x] **Task 3: `KitRedisModule.forRoot({service, subscriber?: true})`** — §3.7, AC-8.1, AC-8.2, AC-8.6, UC-11, D1, D2, D9, D11 (depends on 2)
  - **Skill:** nestjs-code generic src/redis/kit-redis.module.ts (CREATE)
  - Шапка: `// KitRedisModule (prd.md §3.7, UC-11, AC-8.1, AC-8.2, AC-8.6). Эталон — O shared/redis/redis.provider.ts + redis.module.ts (опции, проба, закрытие); префикс — keyPrefix и KitRedisChannels вместо ручных префиксов O. Закрытие — onApplicationShutdown (шаг 4), KitLifecycle не нужен.`
  - `KitRedisModuleOptions {readonly service: string; readonly subscriber?: true}`; `forRoot(options): DynamicModule` — `assertServiceName(service, 'KitRedisModule')`, `global: true`.
  - Провайдеры: `{provide: KIT_REDIS_LOG, useFactory: (logger?: PinoLogger): RedisLog => logger ?? redisNestLog('KitRedis'), inject: [{token: KIT_LOGGER, optional: true}]}` (образец `KIT_MESSAGING_LOG`, `src/messaging/kit-messaging.module.ts:353-358`); `{provide: KIT_REDIS_PREFIX, useValue: \`${service}:\`}`; `KIT_REDIS` — `useFactory: (config, prefix, log) => createRedisConnection({connection: 'main', keyPrefix: prefix, …})`, `inject: [{token: ConfigService, optional: true}, KIT_REDIS_PREFIX, KIT_REDIS_LOG]`; без `ConfigService` — `Error('KitRedisModule: модуль сервиса не импортирует KitConfigModule.forRoot({schema}) с envRedis')` (образец `messagingEnv`); `KIT_REDIS_SUBSCRIBER` — только при `subscriber: true` (D9), иначе провайдера нет; `KitRedisChannels`, `RateLimiter`; внутренний `RedisLifecycle implements OnModuleInit, OnApplicationShutdown` (`@Optional() health?: HealthRegistry`): `onModuleInit` → `health?.register('redis', async () => (await redis.ping()) === 'PONG', {critical: false})`; `onApplicationShutdown` → `closeRedisConnection` для основного и (если есть) подписочного, `Promise.all`.
  - Экспорт модуля: `KIT_REDIS`, `KitRedisChannels`, `RateLimiter`.
  - TSDoc: опции, `keyPrefix <svc>:`, без `subscriber` второго соединения нет, `KEYS`/`SCAN` префикс не получают (сервис ставит его в шаблон сам).
  - Логи: `debug` «KitRedisModule: закрытие соединений» в `onApplicationShutdown`.
  - Готово, когда: `pnpm typecheck` зелёный.

- [x] **Task 4: `KitRedisChannels` — каналы с префиксом** — §3.7, AC-8.1, AC-8.6, D10 (depends on 2; модуль задачи 3 регистрирует класс)
  - **Skill:** nestjs-code generic src/redis/channels.ts (CREATE)
  - Шапка: `// KitRedisChannels (prd.md §3.7 «префикс к каналам ставит обёртка», AC-8.1, AC-8.6): keyPrefix ioredis не действует на каналы. Механика Set обработчиков — O RedisBus, без JSON и повторов SUBSCRIBE.`
  - `@Injectable()`; конструктор: `KIT_REDIS`, `KIT_REDIS_PREFIX`, `@Optional() @Inject(KIT_REDIS_SUBSCRIBER) subscriber?`, `@Inject(KIT_REDIS_LOG) log: RedisLog`.
  - `publish` / `subscribe` — D10. Обработчик `message` подписочного соединения вешается один раз в конструкторе; канал без префикса (чужой) игнорируется. Ошибка/отклонённый промис обработчика — `error` `{channel, err: sanitizeError(e)}` (канал без префикса — имя задаёт сервис, не данные) + `captureError(e)` из `../observability/index.js`; остальные обработчики получают сообщение.
  - Логи: `debug` подписка/отписка `{channel}`; `error` — ошибка обработчика.
  - Готово, когда: `pnpm typecheck` зелёный.

- [x] **Task 5: `RateLimiter.hit/peek` и `throwRateLimited`** — §3.7, AC-8.3, AC-8.4, AC-9.5, UC-11, D6, D7, D8 (depends on 2; модуль задачи 3 регистрирует класс)
  - **Skill:** nestjs-code generic src/redis/rate-limiter.ts (CREATE)
  - Шапка: `// RateLimiter, throwRateLimited (prd.md §3.7, UC-11, AC-8.3, AC-8.4, AC-9.5). Эталон — I shared/security/rate-limiter.ts (consume → hit, peek, scope); из B — PTTL и fail-open без GlitchTip. Окно в мс, PEXPIRE NX в одном MULTI.`
  - Типы: `RateLimitOptions {readonly limit: number; readonly windowMs: number}`; `RateLimitResult {readonly allowed: boolean; readonly remaining: number; readonly retryAfterMs: number}`.
  - `@Injectable() class RateLimiter`: конструктор `KIT_REDIS`, `@Optional() @Inject(KIT_METRICS) metrics?`, `@Inject(KIT_REDIS_LOG) log: RedisLog`; `hit(key, opts)`, `peek(key, opts)` — D7; fail-open — D8 (`#lastUnavailableWarnAt`, `Date.now()`; `// ponytail: один таймер warn на процесс, по ключам — если понадобится разбор по scope`).
  - `throwRateLimited(result: RateLimitResult): never` — D6.
  - TSDoc: семантика окна (фиксированное от первого попадания), fail-open и метрика, ключ `<svc>:rl:<key>`, пример с `throwRateLimited`.
  - Логи: Settings → `RateLimiter`.
  - Готово, когда: `pnpm typecheck` зелёный.

- [x] **Task 6: точка входа `src/redis/index.ts`** — §3.7, D1 (depends on 3, 4, 5)
  - **Skill:** nestjs-code generic src/redis/index.ts (CREATE)
  - Шапка + `import './peer.js';` первой строкой; `export { KitRedisModule } from './kit-redis.module.js'; export { KIT_REDIS } from './client.js'; export { KitRedisChannels } from './channels.js'; export { RateLimiter, throwRateLimited } from './rate-limiter.js'; export type { KitRedisModuleOptions } from './kit-redis.module.js'; export type { RateLimitOptions, RateLimitResult } from './rate-limiter.js';`.
  - Логи: нет.
  - Готово, когда: `pnpm typecheck`, `pnpm lint` зелёные.

- [x] **Task 7: манифест `./redis`, devDependency ioredis, ESLint `src/redis/**`** — AC-1.1, AC-1.2, NFR-3, D12, D13 (depends on 6)
  - **Skill:** none — манифест и конфиг lint; тест — `nestjs-code test unit package package-manifest (MODIFY)`
  - `package.json`: `exports["./redis"] = {"types": "./dist/redis/index.d.ts", "default": "./dist/redis/index.js"}` после `./observability` (алфавитный порядок существующих ключей); `devDependencies.ioredis = "6.0.0"`; `pnpm install` (lockfile).
  - `eslint.config.js`: блок `files: ['src/redis/**/*.ts']` по образцу блока `src/crypto/**` — `restrictedImports([{group: ['../database/*', '../idempotency/*', '../messaging/*', '../crypto/*', '../testing/*', '../cli/*', 'shell-quote'], message: 'redis импортирует только http, observability, config и internal (ARCHITECTURE.md)'}])`; `ioredis` уже в `COMMON_PATTERNS` (только `import type`).
  - `test/unit/package/package-manifest.spec.ts`: список `exports` с `./redis`, `describe` — «(E1–E8)»; случай «AC-1.1: ./redis — {types, default} на dist/redis/index.*»; проверка devDependencies AMQP-драйверов дополняется `ioredis: '6.0.0'`.
  - Логи: нет.
  - Готово, когда: `pnpm lint`, `pnpm exec vitest run test/unit/package` зелёные.

- [x] **Task 8: unit-тесты `/redis`** — AC-8.4, AC-8.3 (fail-open, часы), AC-1.2, D6, D7, D8, D12 (depends on 1, 6)
  - **Skill:** nestjs-code test unit redis ac-8-4-throw-rate-limited (CREATE); nestjs-code test unit redis rate-limiter (CREATE); nestjs-code test unit redis ac-1-2-redis-peer (CREATE)
  - `test/unit/redis/ac-8-4-throw-rate-limited.spec.ts` (`describe('UC-11: 429 RATE_LIMITED')`):
    - «AC-8.4: throwRateLimited → DomainError RATE_LIMITED, статус 429, details.retryAfterSec — секунды вверх» (`it.each`: 1500 → 2, 1000 → 1, 1 → 1, 0 → 1, 59001 → 60);
    - «AC-8.4: через KitExceptionFilter — 429, Retry-After в секундах, тело {error: {code: 'RATE_LIMITED'}}» — приложение `createTestApp` с маршрутом, который вызывает `throwRateLimited({allowed: false, remaining: 0, retryAfterMs: 1500})`, `inject` → `Retry-After: '2'`, `expectProblem(res, {status: 429, code: 'RATE_LIMITED'})`;
    - «AC-8.4: DomainError RATE_LIMITED без retryAfterSec — 429 без Retry-After»;
    - «§3.7: throwRateLimited с allowed: true — TypeError» (D6).
  - `test/unit/redis/rate-limiter.spec.ts` (подделка `KIT_REDIS`: `multi()` → `{incr, pexpire, pttl, get, exec}` с записью вызовов; `kitMetrics({service: 'kit'})`; логгер-шпион):
    - «AC-8.3: hit шлёт MULTI INCR rl:<key>, PEXPIRE rl:<key> windowMs NX, PTTL одним exec» (D7);
    - «AC-8.3: peek шлёт GET и PTTL, без INCR»;
    - «AC-8.3: exec отклонён — allowed: true, remaining = limit, retryAfterMs 0, метрика +1 на каждый вызов» (`register.getSingleMetricAsString` или `.get()` счётчика);
    - «AC-8.3: ошибка команды внутри результата exec — fail-open» (`[[err, null], …]`);
    - «AC-9.5: warn fail-open не чаще раза в 60 с, метрика — на каждый вызов» — `vi.useFakeTimers()`, три вызова → один `warn`; `vi.advanceTimersByTime(60_000)` → второй `warn`; в полях `warn` нет ключа (`rl:`, исходный ключ);
    - «§3.7: key пустой, limit или windowMs не целое ≥ 1 — TypeError» (`it.each`).
  - `test/unit/redis/ac-1-2-redis-peer.spec.ts` по образцу `test/unit/messaging/ac-1-2-messaging-peer.spec.ts`: первая строка импорта `index.ts` — `./peer.js`; `peer.ts` вызывает `requirePeer('ioredis', 'redis')`; `it.each` по файлам `src/redis/*.ts` — нет статического импорта значения `ioredis` и top-level await; граф `importGraph('src/redis/index.ts')` — нет `pg`, `amqplib`, `amqp-connection-manager`, `testcontainers`, `vitest`, файлов `src/database`, `src/messaging`, `src/testing` (D13).
  - Логи: нет.
  - Готово, когда: `pnpm test` зелёный.

### Фаза 2: CLI `redis acl` и `/testing`

- [x] **Task 9: генератор aclfile `src/internal/redis-acl.ts`** — §3.7 (CLI), UC-12, D3 (depends on —)
  - **Skill:** nestjs-code generic src/internal/redis-acl.ts (CREATE)
  - Шапка: `// aclfile Redis (prd.md §3.7, UC-12): общий для CLI redis acl и startTestStack (как internal/rabbitmq-definitions). Пароли — sha256 hex (#<hash>), default off.`
  - `redisPasswordHashKey(service)` → `REDIS_PASSWORD_HASH_${service.toUpperCase().replaceAll('-', '_')}`; `REDIS_PASSWORD_HASH = /^[0-9a-f]{64}$/`; `redisPasswordHash(password)` → `createHash('sha256').update(password, 'utf8').digest('hex')`; `buildRedisAclFile({users: readonly {service, passwordHash}[], extra?: readonly string[]})` → строки D3 + `extra` (администратор теста), `\n` в конце. Имена — `assertServiceName`.
  - Логи: нет.
  - Готово, когда: `pnpm typecheck` зелёный.

- [x] **Task 10: CLI `verdeect-kit redis acl`** — §3.7, UC-12, D3 (depends on 9)
  - **Skill:** nestjs-code generic src/cli/commands/redis.ts (CREATE); nestjs-code generic src/cli/main.ts (MODIFY)
  - По образцу `src/cli/commands/rabbitmq.ts`: контекст `{write, env, cwd}`, свой `CommandError`, `parseArgs({strict: true, allowPositionals: true, options: {services: {type: 'string'}, out: {type: 'string'}}})`; подкоманда только `acl`; `--services` — локальная копия `servicesOf` (непустой список, `SERVICE_NAME_PATTERN`, без повторов), бросающая `CommandError` этой команды: функция в `rabbitmq.ts:72` не экспортирована и бросает свой `CommandError`, а `failureOf` проверяет `instanceof` — импорт дал бы `REDIS_COMMAND_FAILED` вместо `USAGE`, `--out` обязателен, иначе `USAGE`; ключи D3 → `INVALID_ENVIRONMENT {keys}`; `mkdir` + `writeFile(out, aclfile)`; stdout `{"out": "<абсолютный путь>", "services": [...]}`; `failureOf` с запасным `REDIS_COMMAND_FAILED`. Генератор — динамический `import('../../internal/redis-acl.js')`; ioredis не нужен.
  - `src/cli/main.ts`: `redis: async () => (await import('./commands/redis.js')).redisCommand` в `COMMANDS`, шапка — список команд.
  - Логи: Settings → CLI.
  - Готово, когда: `pnpm build`, `REDIS_PASSWORD_HASH_SVC_A=$(printf x | sha256sum | cut -d' ' -f1) node dist/cli/main.js redis acl --services svc-a --out /tmp/…/users.acl` печатает JSON и пишет файл.

- [x] **Task 11: `startTestStack({redis})`, `workerScope().redisPrefix`, `redisWorkerOverride()`** — §3.8 (E8), AC-8.5, UC-14, D2, D4, D5 (depends on 3, 9)
  - **Skill:** nestjs-code generic src/testing/start-test-stack.ts (MODIFY); nestjs-code generic src/testing/worker-scope.ts (MODIFY); nestjs-code generic src/testing/redis-worker.ts (CREATE); nestjs-code generic src/testing/index.ts (MODIFY)
  - `start-test-stack.ts`: шапка — «redis (E8) — позже» → «E8: redis — aclfile из internal/redis-acl (как CLI redis acl) + администратор теста». `TestStackOptions.redis?: boolean` с TSDoc; `ProvidedContext`: `kitRedisUrl`, `kitRedisAdminUrl`, `kitRedisService` (readonly, optional). `redisPart(labels, service)`: пароли `randomBytes(16).toString('hex')` для сервиса и администратора; `buildRedisAclFile({users: [{service, passwordHash}], extra: ['user kit-test-admin on #<hash> ~* &* +@all']})`; `new GenericContainer(TEST_IMAGES.redis).withLabels(labels).withCopyContentToContainer([{content: aclfile, target: '/usr/local/etc/redis/users.acl', mode: 0o644}]).withCommand(['redis-server', '--aclfile', '/usr/local/etc/redis/users.acl', '--save', '', '--appendonly', 'no']).withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage('Ready to accept connections')).withStartupTimeout(120_000)`; `provide` D4 (`redis://<service>:<пароль>@host:port`, `redis://kit-test-admin:<пароль>@host:port`). Флаг — в сборке `parts` рядом с `rabbitmq`.
  - `worker-scope.ts`: шапка — «redisPrefix (E8) — позже» убрать; `KitWorkerScope.redisPrefix: string` с TSDoc (D5); ленивый геттер через `Object.defineProperty`, как `rabbitmq`; источник — `inject('kitRedisService')`: `workerScopeWith(readWorkers, readRedisService: () => string | undefined = readProvidedRedisService)` — второй параметр необязательный (умолчание — `vitest.inject('kitRedisService')`), три существующих вызова в `test/unit/testing/worker-scope.spec.ts` с одним аргументом не меняются; значение — `` `${service}:w${process.env.VITEST_POOL_ID ?? '1'}:` `` (умолчание `'1'`, как `rabbitmqOf`). `undefined` → `TypeError('workerScope().redisPrefix: startTestStack запущен без redis: true')`.
  - `redis-worker.ts`: `redisWorkerOverride(): KitTestOverride` → `{provide: KIT_REDIS_PREFIX, useValue: workerScope().redisPrefix}` (импорт токена из `../internal/tokens.js`), TSDoc с примером `createTestApp({module, service, overrides: [redisWorkerOverride()]})` и `REDIS_URL = inject('kitRedisUrl')`.
  - `testing/index.ts`: `export { redisWorkerOverride } from './redis-worker.js'`.
  - Логи: ошибки запуска/подготовки — общие сообщения `startTestStack` в stderr (как сейчас); пароли не выводятся.
  - Готово, когда: `pnpm typecheck` зелёный; `test/unit/testing/worker-scope.test-d.ts` дополнен (задача 12).

- [x] **Task 12: unit-тесты CLI и `/testing`** — §3.7 (CLI), AC-8.5, D3, D5 (depends on 10, 11)
  - **Skill:** nestjs-code test unit cli redis-acl-command (CREATE); nestjs-code test unit testing worker-scope (MODIFY); nestjs-code test unit testing worker-scope.test-d (MODIFY)
  - `test/unit/cli/redis-acl-command.spec.ts` по образцу `ac-5-10-rabbitmq-command.spec.ts` (каталог — временный в scratch `mkdtemp`):
    - «UC-12: redis acl --services svc-a,bff-app --out f — aclfile: user default off первой строкой, по строке на сервис `user <svc> on #<hash> ~<svc>:* &<svc>:* +@all -@dangerous`, stdout {out, services}, выход 0»;
    - «UC-12: нет REDIS_PASSWORD_HASH_BFF_APP или хеш не 64 hex — INVALID_ENVIRONMENT, keys без значений, выход 1, файла нет»;
    - `it.each` «UC-12: %s → USAGE, выход 1»: без подкоманды, `users`, без `--services`, без `--out`, неизвестная опция, неверное имя сервиса `Bad_Svc`, имя указано дважды `svc-a,svc-a`;
    - «UC-12: хеши не попадают в stderr-лог».
  - `test/unit/testing/worker-scope.spec.ts`: «AC-8.5: redisPrefix — <svc>:w<VITEST_POOL_ID>:», «AC-8.5: стек без redis — TypeError при обращении к redisPrefix, tenant доступен» (через `workerScopeWith` с подменёнными читателями); `worker-scope.test-d.ts` — `redisPrefix: string`.
  - Логи: нет.
  - Готово, когда: `pnpm test` зелёный.

### Фаза 3: Integration и timing

- [x] **Task 13: стенд Redis для I и T** — §3.8, D4 (depends on 11)
  - **Skill:** nestjs-code test integration redis support (CREATE); none — правка `global-setup.ts`
  - `test/integration/global-setup.ts`, `test/timing/global-setup.ts`: `redis: true` в `startTestStack`.
  - `test/support/redis.ts` (образец `test/support/messaging.ts`): `redisEnvSchema = defineEnv({...envBase, ...envRedis})`; `redisEnv(overrides)` — `LOG_LEVEL: 'silent'`, `REDIS_URL: inject('kitRedisUrl')`, `REPLICA_ID: 'kit-1'`; `createRedisApp({options?: {subscriber?: true}, env?, providers?, controllers?, overrides?})` — модуль `KitConfigModule.forRoot({schema: redisEnvSchema})` + `KitRedisModule.forRoot({service: 'kit', ...})` собирается в `@Module` и возвращается `createDbApp({module, schema: redisEnvSchema, env: redisEnv(env), overrides})` из `test/support/database.ts:82` (БД ему не нужна — так же его вызывает `createMessagingApp` без `KitDatabaseModule`); нового помощника не писать; `adminRedis()` — ioredis на `kitRedisAdminUrl` (для `CLIENT LIST`, `ACL LOG`, `PTTL`, очистки); `deleteByPrefix(prefix)` — `SCAN MATCH <prefix>*` + `DEL` администратором (файлы чистят свои ключи, контейнер не перезапускается).
  - Логи: нет.
  - Готово, когда: `pnpm test:integration` зелёный (существующие тесты не задеты).

- [x] **Task 14: integration-тесты AC-8.1, AC-8.3, AC-8.5, AC-8.6** — AC-8.1, AC-8.3, AC-8.5, AC-8.6, UC-11, UC-12, UC-14 (depends on 13, 6)
  - **Skill:** nestjs-code test integration redis ac-8-1-prefix-acl (CREATE); nestjs-code test integration redis ac-8-3-rate-limiter (CREATE); nestjs-code test integration redis ac-8-5-worker-isolation (CREATE); nestjs-code test integration redis ac-8-6-subscriber (CREATE); nestjs-code test integration testing ac-8-5-redis-stack (CREATE)
  - Все приложения — под пользователем сервиса `kit` из aclfile стека (`kitRedisUrl`). `afterEach` — `deleteByPrefix('kit:')`; `afterAll` — `app.close()`, `admin.quit()`.
  - `test/integration/redis/ac-8-1-prefix-acl.spec.ts` (обобщение B `redis-acl.http-spec`):
    - «AC-8.1: SET через KIT_REDIS — в Redis ключ kit:<key>» (администратор `GET kit:k`);
    - «AC-8.1: publish в канал x — сообщение в канале kit:x» (администратор `SUBSCRIBE kit:x`, ожидание сигналом со сроком `1000 × TEST_TIMEOUT_SCALE`);
    - «AC-8.1: под ACL из CLI чужой ключ и канал → NOPERM» — отдельное ioredis на `kitRedisUrl` без `keyPrefix`: `GET other:x`, `SET other:x 1`, `PUBLISH other:x m` → `/NOPERM/`; `SET kit:probe 1` → `OK`;
    - «AC-8.1: под пользователем сервиса из aclfile CLI (user default off) основное и подписочное соединения подключаются» (D9, KT-29) — приложение с `subscriber: true`, одна команда основного соединения и `await channels.subscribe('x', handler)` (оба соединения ленивые, D9/D10), затем `CLIENT LIST` администратора содержит `name=kit` и `name=kit-subscriber` (`connectionName` → `CLIENT SETNAME` прошёл), `HealthRegistry.evaluate()` → `checks.redis === 'up'`, `status: 'ok'`; отдельное ioredis на `kitRedisUrl`: `INFO` → `/NOPERM/` (поэтому `enableReadyCheck: false`); ioredis без пользователя (`default`) — отказ аутентификации;
    - «AC-8.1: команды модуля под ACL проходят — ACL LOG пуст» — **первым в файле, отдельный `describe` со своим `beforeAll`** (`ACL LOG` общий для сервера, а случаи NOPERM и отказа аутентификации этого файла пишут в него записи; общий `beforeAll` файла сбросил бы журнал до них) (`ACL LOG RESET` в `beforeAll` **до** создания и `init()` своего приложения — так `ACL LOG` покрывает и `CLIENT SETNAME`/`CLIENT SETINFO` при подключении (D9); после `hit`, `peek`, `publish`, `PING` пробы — `ACL LOG` = `[]`; комментарий B: fail-open скрыл бы отказ ACL, поэтому лимитер проверяется `allowed: false` на `limit + 1`).
  - `test/integration/redis/ac-8-3-rate-limiter.spec.ts` (перенос I `rate-limiter.int-spec` + B `rate-limiter.int-spec`):
    - «AC-8.3: limit попыток в окне — allowed, следующая — allowed: false, retryAfterMs = PTTL» (`limit: 30`, `windowMs: 60_000`; `retryAfterMs` в (0, 60000], равен `PTTL kit:rl:<key>` администратора ± 50 мс; `remaining` убывает до 0);
    - «AC-8.3: ключ в Redis — kit:rl:<key>, TTL ≤ windowMs; окно не продлевается попаданиями (PEXPIRE NX)» (PTTL после 2-го попадания ≤ PTTL после 1-го);
    - «AC-8.3: разные ключи независимы» (I, `limit: 1`);
    - «AC-8.3: peek не увеличивает счётчик» (`GET` до/после), «AC-8.3: peek после limit — allowed: false, retryAfterMs > 0»;
    - «AC-8.3: после окна — снова allowed» (без паузы на окно: администратор `PEXPIRE kit:rl:<key> 1`, затем опрос `PTTL` до −2 со сроком `1000 × TEST_TIMEOUT_SCALE` мс);
    - «AC-8.3: Redis недоступен — allowed: true, remaining = limit и verdeect_rate_limit_unavailable_total +1» — приложение с `REDIS_URL = tcpProxy(kitRedisUrl).url`, `proxy.break()`; значение счётчика из `app.get(KIT_METRICS)` до/после, метка `service="kit"` в выводе реестра; вызов завершается за `1000 × TEST_TIMEOUT_SCALE` мс.
  - `test/integration/redis/ac-8-5-worker-isolation.spec.ts`:
    - «AC-8.5: префикс воркера — <svc>:w<N>: из workerScope()» (`workerScope().redisPrefix === \`kit:w${VITEST_POOL_ID ?? 1}:\``);
    - «AC-8.5: два воркера не видят ключей друг друга» — два приложения с `overrides: [{provide: KIT_REDIS_PREFIX, useValue: 'kit:w1:'}]` и `'kit:w2:'` (так `redisWorkerOverride` работает в двух воркерах; в одном процессе — явные значения), `SET k` в обоих, `GET k` — у каждого своё, администратор видит `kit:w1:k` и `kit:w2:k`; лимитер — счётчики независимы;
    - «AC-8.5: каналы воркеров изолированы» — `subscribe('x')` у w2 не получает `publish('x')` от w1, у w1 — получает (ожидание сигналом w1, затем проверка, что у w2 обработчик не вызывался);
    - «AC-8.5: под ACL сервиса из CLI команды воркера проходят» — `ACL LOG` пуст после сценариев (свой `ACL LOG RESET` в `beforeAll` файла до создания приложений воркеров: журнал общий для сервера и хранит записи NOPERM из `ac-8-1`);
    - «AC-8.5: redisWorkerOverride() — запись {provide: KIT_REDIS_PREFIX, useValue: workerScope().redisPrefix}» (приложение с ней пишет ключ `kit:w<N>:k`).
  - `test/integration/redis/ac-8-6-subscriber.spec.ts`:
    - «AC-8.6: subscriber: true — publish в канал x приходит подписчику канала kit:x»: подписчик модуля `subscribe('x')` получает `publish('x')` модуля и сообщение администратора `PUBLISH kit:x m`; обработчик получает строку без префикса канала;
    - «AC-8.6: срок команд подписочного соединения 5 с, основного — 500 мс» — `app.get(KIT_REDIS_SUBSCRIBER).options.commandTimeout === 5000`, `app.get(KIT_REDIS).options.commandTimeout === 500` (реальное ожидание 5 с — не в I; срок основного проверяет T AC-8.2);
    - «AC-8.6: без subscriber второго соединения нет» — приложение без `subscriber`: после `app.init()` и одной команды `CLIENT LIST` администратора содержит `name=kit` и не содержит `name=kit-subscriber`, а `app.get(KIT_REDIS_SUBSCRIBER, {strict: false})` бросает (провайдера нет — доказано DI, а не ленивостью); с `subscriber: true` — сначала `await channels.subscribe('x', handler)` (соединение ленивое, D10), затем `CLIENT LIST` — оба имени; `subscribe` без `subscriber` — `Error`;
    - «AC-8.6: отписка последнего обработчика — UNSUBSCRIBE; ошибка обработчика не мешает другим» (второй обработчик получает сообщение, `PUBSUB NUMSUB kit:x` после отписки — 0).
  - `test/integration/testing/ac-8-5-redis-stack.spec.ts` (образец `test/integration/testing/ac-1-12-mailpit-minio.spec.ts`: `fakeProject()`, `runningImages(SERVICE)`, `provided(key)`; свой `service`, например `kit-redis-stack`, — не пересекается со стеком `globalSetup`):
    - «AC-8.5: startTestStack({redis: true}) поднимает TEST_IMAGES.redis» (`runningImages` = `[TEST_IMAGES.redis]`);
    - «AC-8.5: адреса переданы через provide» — `kitRedisUrl`, `kitRedisAdminUrl`, `kitRedisService` заданы; `PING` по `kitRedisAdminUrl` и по `kitRedisUrl` → `PONG`;
    - «AC-8.5: без redis: true контейнер Redis не стартует, kitRedisUrl не передан»;
    - «AC-8.5: после teardown контейнеров нет».
    - Отказ анонимного `default` — уже в случае AC-8.1 выше, здесь не повторяется.
  - Если тест подменяет процесс-глобальное (`vi.stubEnv`, Sentry) — в `ISOLATED` `vitest.integration.config.ts` с причиной; по плану — не нужно.
  - Логи: нет.
  - Готово, когда: `pnpm test:integration test/integration/redis` зелёный 3 прогона подряд.

- [x] **Task 15: timing AC-8.2 — недоступный Redis** — AC-8.2, UC-11 шаги 1, 3 (depends on 13, 6)
  - **Skill:** nestjs-code test timing redis ac-8-2-unavailable (CREATE)
  - `test/timing/redis/ac-8-2-unavailable.spec.ts` (`timingGuard` — в `globalSetup`): приложение `createRedisApp` с `REDIS_URL = proxy.url` (`tcpProxy(inject('kitRedisUrl'))`).
    - «AC-8.2: Redis не отвечает (blackhole) — команда завершается ошибкой не позже ~0,5 с» — `proxy.blackhole()` после первого `PING`; `GET k` отклоняется; длительность ≥ 450 мс и ≤ `800 × TEST_TIMEOUT_SCALE` мс (`commandTimeout`);
    - «AC-8.2: проба /health — degraded (200), redis: down» — `HealthRegistry.evaluate()` из `app.get(HealthRegistry)` при `blackhole` → `{status: 'degraded', checks: {redis: 'down'}}` за срок пробы; после `proxy.restore()` — `ok` (опрос со сроком);
    - «UC-11: лимитер при blackhole — allowed: true не позже ~0,5 с».
  - Логи: нет.
  - Готово, когда: `pnpm test:timing test/timing/redis` зелёный 3 прогона подряд.

### Фаза 4: Архив, потребитель, документация

- [x] **Task 16: AC-1.1, AC-1.2 — архив и проверки peer с `/redis`** — AC-1.1, AC-1.2 (depends on 7, 10)
  - **Skill:** nestjs-code test package ac-1-1-package (MODIFY); nestjs-code test package ac-9-1-consumer (MODIFY); nestjs-code generic test/consumer/minimal/types-check.ts (MODIFY); none — `package.json` и `.mjs` проекта-потребителя
  - `test/package/ac-1-1-package.spec.ts`: в «состав архива» — `package/dist/redis/index.js`, `package/dist/cli/commands/redis.js`, `package/dist/internal/redis-acl.js`; `'redis'` в список каталогов dist без импорта `testing`/`shell-quote`; по образцу `MESSAGING_ENTRIES`: «AC-1.2: dist/redis — первая строка import ./peer.js, нет статического ioredis, нет top-level await».
  - `test/consumer/minimal/package.json`: `ioredis: 6.0.0` (здесь, а не в задаче 17: без него импорт `/redis` в `import-check.mjs` и типы в `types-check.ts` падают ошибкой AC-1.2, и `pnpm pack:check` задачи 16 красный).
  - `test/consumer/minimal/import-check.mjs`: `redis:${await probe('@verdeect/kit/redis', 'KitRedisModule')}`; ожидаемые строки в `test/package/ac-9-1-consumer.spec.ts` — с `redis:ok`.
  - `test/consumer/no-testcontainers/peer-check.mjs`: `'redis'` во второй цикл (ошибка AC-1.2); в `ac-9-1-consumer.spec.ts` случай AC-1.2 — ожидается «`@verdeect/kit/redis` требует ioredis — добавьте в зависимости сервиса».
  - `test/consumer/minimal/types-check.ts`: `import { KIT_REDIS, KitRedisChannels, KitRedisModule, RateLimiter, throwRateLimited, type RateLimitResult } from '@verdeect/kit/redis'`; `// @ts-expect-error` на `KitRedisModule.forRoot({service: 'consumer', subscriber: false})` (только `true`); `import { redisWorkerOverride } from '@verdeect/kit/testing'`.
  - Логи: нет.
  - Готово, когда: `pnpm build && pnpm exec vitest run -c vitest.package.config.ts test/package/ac-1-1-package.spec.ts test/package/ac-9-1-consumer.spec.ts` зелёный (полный `pnpm pack:check` до задачи 18 красный: `ac-9-3-docs.spec.ts` требует `redisWorkerOverride` из задачи 11 в README API и CHANGELOG).

- [x] **Task 17: AC-9.1, AC-9.5 — проект-потребитель с Redis** — AC-9.1, AC-9.5, AC-8.4 (C), UC-11 (depends on 11, 16)
  - **Skill:** nestjs-code generic test/consumer/minimal/src/service/app.module.ts (MODIFY); nestjs-code http-controller consumer limited (CREATE); nestjs-code test integration consumer observability (MODIFY); nestjs-code test integration consumer messaging (MODIFY); nestjs-code generic test/consumer/minimal/src/service/env.ts (MODIFY); none — правка `test/consumer/minimal/global-setup.ts`
  - `ioredis` в `package.json` потребителя уже добавлен задачей 16. `global-setup.ts`: `redis: true`. `src/service/env.ts`: `...envRedis`. `app.module.ts`: `KitRedisModule.forRoot({service: 'consumer'})`. Новый `src/service/limited.controller.ts`: `GET /limited` → `limiter.hit('limited:all', {limit: 2, windowMs: 60_000})`, при `!allowed` — `throwRateLimited(result)`, иначе `{remaining}`. Маршрут — **без `@Api`** (тестовый маршрут лимитера, не контракт сервиса): построитель `src/http/api/openapi-document.ts` берёт только маршруты с `@Api`, поэтому `contracts/openapi.json` не меняется и `openapi.spec.ts` (AC-3.8) зелёный без правок.
  - С `envRedis` в `serviceEnvSchema` ключ `REDIS_URL` обязателен для всех запусков сервиса потребителя: `startService` в `test/consumer/minimal/src/observability.spec.ts` — `REDIS_URL: inject('kitRedisUrl') ?? ''` в базовом `env`; `test/consumer/minimal/src/messaging.spec.ts` — `vi.stubEnv('REDIS_URL', inject('kitRedisUrl') ?? '')` рядом с `RABBITMQ_URL` (иначе контекст падает `InvalidEnvironmentError`). `openapi.spec.ts` (сборка по метаданным) и `testing-peer.spec.ts` (отказ до окружения) не меняются.
  - `app.module.ts`: `LimitedController` — в `controllers` (`[ItemsController, CompaniesController, LimitedController]`), иначе `GET /limited` — 404; шапки `app.module.ts` и `src/service/env.ts` — упоминание `KitRedisModule` / `envRedis` (E8).
  - Существующий тест «AC-9.1: /health — database, database-read и rabbitmq up» (`observability.spec.ts`) сравнивает `checks` через `toEqual` и с пробой `redis` станет красным: переименовать в «AC-9.1: /health — database, database-read, rabbitmq и redis up», в `toEqual` добавить `redis: 'up'`; помощник `healthWithRabbit` → `healthUp`, ждёт `rabbitmq === 'up' && redis === 'up'`.
  - Тесты Redis — новый `describe('UC-11: Redis потребителя')` в `test/consumer/minimal/src/observability.spec.ts` (переиспользует `startService`, `Service.line`, разбор `/metrics`; копии помощника нет); ключи `consumer:rl:*` чистит администратор `kitRedisAdminUrl` в `beforeEach`:
    - «AC-9.1: GET /limited — два 200, третий 429 RATE_LIMITED, Retry-After ≥ 1» (AC-8.4 на собранном архиве);
    - «AC-9.5: лимитер без Redis — 200 (fail-open), лог «лимитер: Redis недоступен, запрос пропущен» с service=consumer и replica=consumer-1, /metrics — verdeect_rate_limit_unavailable_total{service="consumer"} ≥ 1, /health — degraded» — второй процесс с `REDIS_URL=redis://127.0.0.1:1` (порт без слушателя);
    - остановка по `SIGTERM` с выходом 0 — уже проверяется в `observability.spec.ts`; с Redis в модуле тест остаётся зелёным (шаг 4).
  - Логи: нет (логи — пакета).
  - Готово, когда: `pnpm build && pnpm exec vitest run -c vitest.package.config.ts test/package/ac-9-1-consumer.spec.ts` зелёный (полный `pnpm pack:check` до задачи 18 красный: `ac-9-3-docs.spec.ts` требует `redisWorkerOverride` из задачи 11 в README API и CHANGELOG).

- [x] **Task 18: README, CHANGELOG `[Unreleased]`, AGENTS.md, тест AC-9.3** — AC-9.3, UC-11, UC-12, «Library Package Scope» (7) (depends on 6, 10, 11)
  - **Skill:** none — Markdown; тест — `nestjs-code test package ac-9-3-docs (MODIFY)`
  - `README.md`:
    - первая строка README: «…, а в следующих этапах — БД с RLS, идемпотентность, сообщения, шифр и Redis» → перечень без «в следующих этапах» (все подпути готовы);
    - «Подпути»: `/redis` — `готов, в [Unreleased]`;
    - раздел `## Redis` (после «Шифр»): `KitRedisModule.forRoot({service, subscriber?: true})`, `keyPrefix <svc>:` (не действует на шаблоны `KEYS`/`SCAN` и ответы), `KIT_REDIS`, `KitRedisChannels` (каналы `<svc>:<канал>`), `RateLimiter.hit/peek` (окно от первого попадания, `{allowed, remaining, retryAfterMs}`, ключ `<svc>:rl:<key>`), fail-open + метрика + алерт `VerdeectRateLimitUnavailable`, `throwRateLimited` → 429 + `Retry-After` (секунды вверх), проба `redis` некритичная, пример кода;
    - таблица совместимости: строка Redis — `≥ 7.0` (`PEXPIRE … NX` лимитера, D7, KT-29); тесты — `TEST_IMAGES.redis` 7.4.11;
    - «Развёртывание»: Redis ≥ 7.0 (KT-29); ACL — `verdeect-kit redis acl --services <svc,…> --out users.acl` с `REDIS_PASSWORD_HASH_<SVC>` (sha256 hex: `printf %s "$PASS" | sha256sum`), `user default off` первой строкой, Redis с `--aclfile`; проверка здоровья Redis в compose — с пользователем и паролем (`redis-cli --user <svc> --pass … ping`); `REDIS_URL` сервиса — `redis://<svc>:<пароль>@…`;
    - «Тесты сервиса»: фраза «Redis появится в E8.» заменяется описанием `redis: true` (aclfile пользователя сервиса тем же генератором, что CLI, + администратор теста; ключи `kitRedisUrl`, `kitRedisAdminUrl`, `kitRedisService`); `startTestStack({redis: true})`, `inject('kitRedisUrl')`, `workerScope().redisPrefix`, `createTestApp({…, overrides: [redisWorkerOverride()]})`;
    - «API»: `### @verdeect/kit/redis` — `KitRedisModule`, `KitRedisModuleOptions`, `KIT_REDIS`, `KitRedisChannels`, `RateLimiter`, `RateLimitOptions`, `RateLimitResult`, `throwRateLimited` (каждое в обратных кавычках с контрактом); в `/testing` — `redis?`, `redisPrefix`, `redisWorkerOverride`, ключи `kitRedisUrl`, `kitRedisAdminUrl`, `kitRedisService`; CLI — `verdeect-kit redis acl`.
  - `CHANGELOG.md`, `[Unreleased]`: вводная — «… `/redis` и CLI `redis` (этап E8, PRD v1.17)»; `### Added`: `/redis: KitRedisModule.forRoot({service, subscriber?: true}) и KitRedisModuleOptions — keyPrefix <svc>:, подписочное соединение по subscriber, проба redis, закрытие на шаге 4`; `/redis: KIT_REDIS, KitRedisChannels — каналы с префиксом <svc>:`; `/redis: RateLimiter.hit/peek, RateLimitOptions, RateLimitResult — fail-open и verdeect_rate_limit_unavailable_total`; `/redis: throwRateLimited — 429 RATE_LIMITED + Retry-After`; `/testing: startTestStack({redis}) с ACL, workerScope().redisPrefix, redisWorkerOverride, ключи provide kitRedisUrl, kitRedisAdminUrl, kitRedisService`; `CLI: verdeect-kit redis acl --services … --out …`; `### Changed`: `/http: KitExceptionFilter ставит Retry-After для RATE_LIMITED по details.retryAfterSec`.
  - `docs/testing.md`: абзац `/redis` по образцу абзацев подпутей — U `test/unit/redis` (подделка ioredis, часы лимитера), I `test/integration/redis` (под пользователем сервиса `kit` из aclfile того же `buildRedisAclFile`, что CLI; администратор теста — `kitRedisAdminUrl`; файлы чистят свои ключи `kit:*`), T `test/timing/redis` (`tcpProxy.blackhole()`, срок `commandTimeout`), C — Redis потребителя в `observability.spec.ts`; в описании `globalSetup` уровней I и T — `redis: true`.
  - `AGENTS.md`: строка состояния → «после E8» (все подпути, CLI `redis`; следующий шаг — выпуск `1.0.0-rc.1` вручную); дерево `src/` — `redis/`, `cli/commands/redis.ts`, `internal/redis-acl.ts`; таблица ключевых файлов — `src/redis/index.ts`.
  - `test/package/ac-9-3-docs.spec.ts`: `ENTRY_POINTS` + `'src/redis/index.ts'`; в «README — правила развёртывания» — фрагменты `'redis acl'`, `'REDIS_PASSWORD_HASH_'`, `'user default off'`, `'Redis ≥ 7.0'`.
  - Логи: нет.
  - Готово, когда: `pnpm pack:check` (весь `test/package`, в т. ч. `ac-9-3-docs.spec.ts`) и `pnpm format:check` зелёные.

## Commit Plan
- **Commit 0** (сделаны, KT-28): `0af1d16` `docs(requirements): r12 — PRD v1.17, уточнения /crypto`; `8754329` `test(crypto): AC-7.2, AC-7.5 по PRD v1.17 — …`
- **Commit 1** (задачи 1–8): `feat(redis): подпуть @verdeect/kit/redis — KitRedisModule, KitRedisChannels, RateLimiter, throwRateLimited`
- **Commit 2** (задачи 9–12): `feat(cli,testing): verdeect-kit redis acl; startTestStack с Redis и ACL, workerScope().redisPrefix`
- **Commit 3** (задачи 13–15): `test(redis): integration AC-8.1, AC-8.3, AC-8.5, AC-8.6 и timing AC-8.2`
- **Commit 4** (задачи 16–18): `docs(redis): архив, проект-потребитель, README и CHANGELOG (E8)`

Каждая фаза заканчивается зелёными `pnpm lint`, `pnpm typecheck`, `pnpm test`; фазы 2–3 — ещё `pnpm test:integration`; фаза 3 — `pnpm test:timing`; фаза 4 — `pnpm pack:check`. Перед слиянием: `make test-full`.

## Traceability

| UC/AC | Задачи | Тест-файл / название |
|---|---|---|
| AC-8.1 | 3, 4, 9, 11, 14 | `test/integration/redis/ac-8-1-prefix-acl.spec.ts` / «AC-8.1: …» (префикс ключей и каналов, NOPERM под ACL из CLI, `ACL LOG` пуст) |
| AC-8.2 | 2, 3, 15 | `test/timing/redis/ac-8-2-unavailable.spec.ts` / «AC-8.2: …» |
| AC-8.3 | 5, 8, 14 | `test/integration/redis/ac-8-3-rate-limiter.spec.ts` / «AC-8.3: …»; `test/unit/redis/rate-limiter.spec.ts` / «AC-8.3: …» |
| AC-8.4 | 1, 5, 8, 17 | `test/unit/redis/ac-8-4-throw-rate-limited.spec.ts` / «AC-8.4: …»; `test/consumer/minimal/src/observability.spec.ts` / «AC-9.1: GET /limited …» |
| AC-8.5 | 11, 12, 14 | `test/integration/redis/ac-8-5-worker-isolation.spec.ts`, `test/integration/testing/ac-8-5-redis-stack.spec.ts` / «AC-8.5: …»; `test/unit/testing/worker-scope.spec.ts` / «AC-8.5: …» |
| AC-8.6 | 3, 4, 14 | `test/integration/redis/ac-8-6-subscriber.spec.ts` / «AC-8.6: …» |
| AC-9.5 (лимитер) | 5, 8, 17 | `test/unit/redis/rate-limiter.spec.ts` / «AC-9.5: warn fail-open …»; `test/consumer/minimal/src/observability.spec.ts` / «AC-9.5: лимитер без Redis …» |
| UC-11 | 3, 5, 15, 17 | AC-8.2, AC-8.3, AC-8.4; «UC-11: лимитер при blackhole …» |
| UC-12 (Redis) | 9, 10, 12, 18 | `test/unit/cli/redis-acl-command.spec.ts` / «UC-12: …»; AC-8.1; README (`ac-9-3-docs.spec.ts`) |
| UC-14 (Redis) | 11, 12, 14 | AC-8.5 |
| AC-1.1 (растёт) | 7, 16 | `test/unit/package/package-manifest.spec.ts`, `test/package/ac-1-1-package.spec.ts`, `test/package/ac-9-1-consumer.spec.ts` / «AC-1.1: …» |
| AC-1.2 (растёт) | 2, 7, 8, 16 | `test/unit/redis/ac-1-2-redis-peer.spec.ts`, `test/package/ac-1-1-package.spec.ts`, `test/consumer/no-testcontainers/peer-check.mjs` / «AC-1.2: …» |
| AC-9.1 (растёт) | 16, 17 | `test/consumer/minimal/src/observability.spec.ts` / «AC-9.1: …» (в т. ч. «/health — … rabbitmq и redis up»), `test/consumer/minimal/types-check.ts` |
| AC-9.3 (растёт) | 18 | `test/package/ac-9-3-docs.spec.ts` |
| AC-9.4 | 2–6, 7 | `test/package/ac-9-4-lint-rules.spec.ts` (без изменений; `src/redis/**` под правилом) |
