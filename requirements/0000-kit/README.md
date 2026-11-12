# 0000-kit — `@verdeect/kit`

Общий инфраструктурный npm-пакет сервисов Вердикт 2.0: конфигурация, наблюдаемость и запуск, HTTP-каркас, БД с RLS, идемпотентность, outbox/inbox и RabbitMQ, шифр секретов, Redis, тестовый контур. Код переносится из копий в Identity, BFF, Platform, Orchestrator (эталон — `files/inventory.md`).

> Режим: INIT · Ревизия: r17 · 2026-11-12 · PRD v1.22 · Репозиторий: GitHub `smskin/verdeect-kit`, WSL `/home/administrator/projects/verdeect2/verdeect-kit` · Источник: чат «`@verdeect/kit`» проекта Claude «Verdeect v2» (префикс KT)

## Файлы

| Файл | Что внутри |
|---|---|
| `prd.md` | PRD v1.22 — источник истины: P0 и решения G (§0), публичный API по подпутям (§3), UC-1–UC-16 (§4), AC с уровнем теста (§5), модель данных (§6), NFR (§7), процесс (§8), этапы (§9), переходы сервисов (§10), открытые вопросы (§11) |
| `files/inventory.md` | Инвентаризация копий в сервисах: модуль × сервис, столбец «Эталон», тесты эквивалентности, точные версии зависимостей и образов. §4 — расхождения на момент инвентаризации; решения по ним — в `prd.md` (при расхождении действует `prd.md`) |

UI нет, макетов нет. Пакет `@verdeect/events` — отдельный PRD и отдельный репозиторий (`verdeect2/verdeect-events`), не входит сюда.

## Этапы

Номер E6 не используется (бывший этап `@verdeect/events`, вынесен в v1.5). UC пакета сквозные: каждый этап закрывает свою часть сценария; AC — ровно в одном этапе. Сквозные AC-9.1, AC-9.3, AC-9.4 (с E1) и AC-9.5 (с E4) реализуются в первом указанном этапе и перепроверяются в каждом следующем для выпущенных подпутей.

| № | Этап | Содержание | UC (часть) | AC | Режим плана | Зависит от | Выпуск |
|---|---|---|---|---|---|---|---|
| E1 | Каркас и config | репозиторий по образцу `verdeect-platform-client` (package.json с `exports` для `/config` и `/testing` — остальные подпути добавляются в своих этапах, AC-1.1 и AC-1.2 растут вместе с ними; `/testing` только по условию `development`; peer по NFR-3; проверка опциональных peer при импорте), `/config` §3.1, основа `/testing` (`TEST_IMAGES`, `startTestStack` — контейнеры PostgreSQL, mailpit, MinIO; `assertRepoConventions` — все правила; `timingGuard`, `TEST_TIMEOUT_SCALE`, `tcpProxy`), `test/consumer` минимальный, правило lint AC-9.4, `scripts/publish.mjs`, README, CHANGELOG, `docs/releasing.md`. Makefile и CI — не здесь (5.1a) | UC-1, UC-3, UC-14, UC-16 | AC-1.1–AC-1.8, AC-1.10 (часть: `scripts/publish.mjs`; workflow — 5.1a), AC-1.11–AC-1.13, AC-9.1 (минимальный потребитель), AC-9.3, AC-9.4 | ultra | — | — |
| E2 | Наблюдаемость | `/observability` §3.2: логи и редактирование, `sanitizeError`, `initSentry`/`captureThrottled`/`failStartup`, `/ok`, `/health`, `/metrics`, `KitLifecycle`, шаблон алертов | UC-3, UC-4, UC-8, UC-13 | AC-2.1–AC-2.13 | full | E1 | — |
| E3 | HTTP-каркас | `/http` §3.5: `bootstrapService`, `createHttpApp`, фильтр ошибок и словарь кодов, zod pipe, заголовки безопасности, пагинация, `@Api` и CLI `openapi`; `createTestApp`, `expectProblem`, `expectMatchesApi` | UC-1, UC-3, UC-4, UC-8, UC-14 | AC-3.1–AC-3.13 | full | E2 | — |
| E4 | База данных и идемпотентность | `/database` §3.3 и `/idempotency` §3.3а; `startTestStack` — подготовка БД и миграции, `createScratchDatabase`, `countQueries`, `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner`, `workerScope` (`tenant`); CLI `db` | UC-5, UC-7, UC-9, UC-12, UC-14 | AC-4.1–AC-4.18; AC-9.5 (очистка идемпотентности) | ultra | E3 | — |
| E5 | Сообщения | `/messaging` §3.4: outbox из кода, relay, подписчик, inbox, retry/DLQ, очередь реплики, `defineEvent`; `startTestStack` с RabbitMQ и `definitions.json`, vhost на воркер, `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`; CLI `rabbitmq definitions` | UC-5, UC-6, UC-8, UC-12, UC-14 | AC-5.1–AC-5.20; AC-9.5 (relay, подписчик, очистка) | ultra | E4 | — |
| E7 | Шифр секретов | `/crypto` §3.6: `createCipher`, версии ключей, AAD, CLI `crypto generate-secret` | UC-10 | AC-7.1–AC-7.5 | full | E2 | — |
| E8 | Redis | `/redis` §3.7: клиент, префикс `<svc>:`, лимитер fail-open; `startTestStack` с Redis и ACL, префикс воркера `<svc>:w<N>:`; CLI `redis acl` | UC-11, UC-12 | AC-8.1–AC-8.6; AC-9.5 (лимитер) | full | E3 | `1.0.0-rc.1` вручную, `npm trust` |

Выпусков по этапам нет: E1–E8 копятся в `[Unreleased]`, проверка каждого этапа — проект-потребитель на упакованном архиве. После E8 — `1.0.0-rc.1`; на `rc` переходят готовые сервисы (`prd.md` §10); `1.0.0` — после перехода Identity (G14).

## Готовность (Definition of Ready, r1)

| # | Пункт | Статус | Комментарий |
|---|---|---|---|
| R1 | Описание | ✅ | §1 цели, §2 не-цели |
| R2 | Use cases | ✅ | UC-1–UC-16 в полной форме (UC-15 перенесён в PRD events) |
| R3 | Критерии приёмки | ✅ | у каждого AC — UC или NFR и уровень теста |
| R4 | Макеты | — | UI нет |
| R5 | Роли | ✅ | библиотека: акторы в UC (разработчик сервиса, сервис, мейнтейнер, CI) |
| R6 | Данные | ✅ | §6 (outbox, inbox, идемпотентность, роли БД) |
| R7 | Контракт | ✅ | §3 — экспорты, CLI, коды ошибок |
| R8 | Открытые вопросы | ✅ | §11 п. 1–3 не влияют на реализацию (решаются замером или соседним чатом после E5) |
| R9 | Изменение | — | новый пакет; переходы сервисов — §10, в их чатах |
| R10 | Данные e2e | — | UI нет |
| R11 | Этапы | ✅ | таблица выше; AC — ровно в одном этапе |
| R12 | Визуальная проверка | — | UI нет |

Желательные: NFR-7 (скорость) — ориентир, не критерий; выкатка — не применимо (библиотека).

## История ревизий

- r1 — 2026-11-09: первая выдача. PRD v1.6 (v1.1–v1.4 — четыре `/prd-review`; v1.5 — `@verdeect/events` вынесен в отдельный PRD; v1.6 — список мажорных изменений в G14, инвентаризация файлом пакета).
- r2 — 2026-11-09: вопросы планирования E1 — `@nestjs/config` обязательный peer, умолчания `NODE_ENV`/`LOG_LEVEL`/`METRICS_PORT`, признаки приложения и список старых ключей для `assertRepoConventions` (§3.1, §3.8, NFR-3, AC-1.5, AC-1.8); PRD v1.7.
- r3 — 2026-11-09: выпуски — без промежуточных версий, после E8 `1.0.0-rc.N` (метка `next`), `1.0.0` после перехода Identity (G14, G15, §3.9, UC-2, UC-16, AC-1.10, NFR-5, NFR-6, §9, §10); PRD v1.8.
- r4 — 2026-11-10: одноразовые задания — `command:` без запуска приложения не проверяется правилами `stop_grace_period` и `--import` (§3.8, AC-1.8).
- r5 — 2026-11-10: формы команды запуска — перечень поддерживаемых форм, остальное — нарушение «команда не распознана»; `--import` через NODE_OPTIONS не принимается (§3.8, AC-1.8).
- r6 — 2026-11-10: правило команды «на запрет» по построению — обязательный распознанный запуск у приложения, main.* у любой команды, нераспознанный -c оболочки и опция обёртки вне списка — «команда не распознана»; длинные опции и -O/+O оболочки; переменные после файла входа не проверяются (§3.8, AC-1.8).
- r7 — 2026-11-10: обязательный peer prom-client (deprecated) → @prometheus-io/client (NFR-3, §3.2, §10).
- r8 — 2026-11-10: вопросы планирования E3 — опциональный peer @nestjs/testing (createTestApp с overrides), CLI openapi --module, defineErrors регистрирует словарь на процесс, KitConfigModule разбирает окружение при сборке контекста; PRD v1.13.
- r9 — 2026-11-10: вопросы планирования E4 — функция очистки идемпотентности idempotency_purge (SECURITY DEFINER) и помощник idempotencyPurgeSql, проверка функции в assertStrictTenantIsolation, workerScope().tenant — слаг компании, db prepare --service, @Idempotent без принципала — 500; PRD v1.14.
- r10 — 2026-11-11: вопросы планирования E5 — KitMessagingModule.forRoot({service, outbox: {table, events}, subscriber}), vhost на воркер до teardown прогона, хеш пароля RabbitMQ из RABBITMQ_PASSWORD_HASH_<SVC>, обработчик (event, tx), значения x-dlq-reason, отказ запуска при другом TTL .retry, срок остановки обработчиков, onReplica без повтора и DLQ; PRD v1.15.
- r11 — 2026-11-11: уточнения после E5 — типы в экспорте /messaging, AC-5.19 (отказ в onApplicationBootstrap), seq outbox — bigint GENERATED ALWAYS AS IDENTITY; вопросы планирования E7 — IKM HKDF из декодированных байт секрета, CLI crypto generate-secret печатает JSON {"secret"} (--bytes ≥ 32, иначе USAGE), AC-7.3 (ключ из UTF-8 строки не подходит, контрольный вектор), AC-7.5 (secret из JSON CLI, --bytes 16 → USAGE); PRD v1.16.
- r12 — 2026-11-11: уточнения /crypto по итогам E7 — экспорт DecryptError и типов KitCipher, KitCipherOptions, DecryptErrorReason, без Nest-модуля; строгий формат значения (канонический base64url, v<N> N ≥ 1, IV 12, тег 16), порядок проверок decrypt, пустой aad — TypeError, needsReencrypt (§3.6, AC-7.2); version в ENCRYPTION_KEYS — целое ≥ 1, одна схема для envCrypto и createCipher, generateSecret(< 32) — RangeError (§3.1, §3.6, AC-7.5); PRD v1.17.
- r13 — 2026-11-12: решения E8 — экспорт /redis (KitRedisModule, KIT_REDIS, KitRedisChannels, RateLimiter, throwRateLimited и типы), общая подписка KitRedisChannels и поведение при отказе SUBSCRIBE, enableReadyCheck: false, connectionName, Redis ≥ 7.0 (§3.7, AC-8.1, AC-8.6); лимитер — ключ <svc>:rl:<key>, окно от первого попадания (PEXPIRE … NX), fail-open без GlitchTip, Retry-After по details.retryAfterSec (§3.5, §3.7, AC-8.3, AC-8.4); CLI redis acl — REDIS_PASSWORD_HASH_<SVC>, #<хеш>, user default off, --out (§3.7, AC-8.1); Redis в /testing — ключи provide, redisWorkerOverride(), без опции keyPrefix (§3.8, AC-8.5); PRD v1.18.
- r14 — 2026-11-12: ревизия §10 по шагу 0 выпуска rc.1 (assertRepoConventions на HEAD сервисов) — в критерии перехода assertRepoConventions без исключений; всем сервисам — команда запуска с --import ./dist/instrument.js во всех стадиях Dockerfile и command: compose, включая apps/node-agent и копии в compose.e2e.yml; Orchestrator — stop_grace_period: 15s и REPLICA_ID не задаётся; Identity — подстановка DATABASE_MIGRATION_URL и stop_grace_period: 15s; пункт prom-client → @prometheus-io/client убран (сделано во всех сервисах); код пакета не меняется; PRD v1.19.
- r15 — 2026-11-12: по находкам BFF-55 — права публикации RabbitMQ по префиксам: CLI rabbitmq definitions --publishes <svc>=<префикс>[,…], topic_permissions на verdeect.events (write — ^(префиксы), без --publishes — ^$; read — .*), write на verdeect.events только у сервиса с --publishes (§3.4); startTestStack({publishes}) (§3.8); AC-5.10 — ACCESS_REFUSED вне префикса и без --publishes, USAGE для неверного префикса и сервиса вне --services; префикс метрик домена — имя сервиса без экземпляра, экземпляр — меткой service (§3.2); §10 BFF — Redis bff-app:/bff-admin:, topic-read .*; PRD v1.20.
- r16 — 2026-11-12: по находкам BFF-58 — HTTP-опции по роли: createHttpApp и bootstrapService({http}) — securityHeaders: 'api' | {referrerPolicy} | false (AC-3.5), exceptionFilter с делегированием в KitExceptionFilter — ошибки маршрутов, 404 ROUTE_NOT_FOUND и хуков Fastify через фильтр сервиса (AC-3.14), configureFastify до регистрации маршрутов — onRoute, bodyLimit маршрута (AC-3.12) (§3.5); экспорт реестра метрик KIT_METRICS, метрики домена только в нём (§3.2, AC-2.14); drizzle-orm обязателен и сервису без БД (NFR-3); PRD v1.21.
- r17 — 2026-11-12: ответ на вопрос review KT-42 — createTestApp принимает те же опции http, что bootstrapService ({bodyLimit, securityHeaders, exceptionFilter, configureFastify}; сервис передаёт в тест тот же объект, что в main.ts) (§3.8); AC-3.14 — через createTestApp({http: {exceptionFilter}}) фильтр сервиса работает так же, как в приложении из bootstrapService; PRD v1.22.
