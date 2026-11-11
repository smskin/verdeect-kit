# Дорожная карта проекта

> `@verdeect/kit` — общий инфраструктурный npm-пакет сервисов Вердикта 2.0: один проверенный экземпляр кода конфигурации, наблюдаемости и запуска, HTTP-каркаса, БД с RLS, идемпотентности, outbox/inbox и RabbitMQ, шифра секретов, Redis и тестового контура вместо четырёх копий в сервисах.

## Вехи

Источник — `requirements/0000-kit/README.md`, раздел «Этапы». Номер E6 не используется: бывший этап `@verdeect/events` вынесен в отдельный PRD и репозиторий. Сквозные AC-9.1, AC-9.3, AC-9.4 (с E1) и AC-9.5 (с E4) реализуются в первом указанном этапе и перепроверяются в каждом следующем для выпущенных подпутей.

- [x] **E1 Каркас и config** — репозиторий по образцу `verdeect-platform-client`: `package.json` с `exports` для `/config` и `/testing` (остальные подпути добавляются в своих этапах), `/testing` только по условию `development`, peer по NFR-3, проверка опциональных peer при импорте. Подпуть `/config` §3.1. Основа `/testing`: `TEST_IMAGES`, `startTestStack` (контейнеры PostgreSQL, mailpit, MinIO), `assertRepoConventions` со всеми правилами, `timingGuard`, `TEST_TIMEOUT_SCALE`, `tcpProxy`. Минимальный `test/consumer`, правило lint AC-9.4, `scripts/publish.mjs`, README, CHANGELOG, `docs/releasing.md`. Makefile и CI — не здесь (5.1a). Выпуска нет — `[Unreleased]` (G14) · requirements/0000-kit · UC-1, UC-3, UC-14, UC-16, AC-1.1–AC-1.8, AC-1.10 (часть: `scripts/publish.mjs`; workflow — 5.1a), AC-1.11–AC-1.13, AC-9.1 (минимальный потребитель), AC-9.3, AC-9.4
- [x] **E2 Наблюдаемость** — `/observability` §3.2: логи и редактирование, `sanitizeError`, `initSentry`/`captureThrottled`/`failStartup`, `/health`, `/metrics`, `KitLifecycle`, шаблон алертов. Выпуска нет — `[Unreleased]` · requirements/0000-kit · UC-3, UC-4, UC-8, UC-13, AC-2.1–AC-2.13
- [x] **E3 HTTP-каркас** — `/http` §3.5: `bootstrapService`, `createHttpApp` (с `/ok`), фильтр ошибок и словарь кодов, zod pipe, заголовки безопасности, пагинация, `@Api` и CLI `openapi`; `createTestApp`, `expectProblem`, `expectMatchesApi`. Выпуска нет — `[Unreleased]` · requirements/0000-kit · UC-1, UC-3, UC-4, UC-8, UC-14, AC-3.1–AC-3.13
- [x] **E4 База данных и идемпотентность** — `/database` §3.3 и `/idempotency` §3.3а. В `startTestStack` — подготовка БД и миграции; `createScratchDatabase`, `countQueries`, `assertStrictTenantIsolation`, `assertAppRoleIsNotOwner`, `workerScope` (`tenant`); CLI `db`. Выпуска нет — `[Unreleased]` · requirements/0000-kit · UC-5, UC-7, UC-9, UC-12, UC-14, AC-4.1–AC-4.18, AC-9.5 (очистка идемпотентности)
- [x] **E5 Сообщения** — `/messaging` §3.4: outbox из кода, relay, подписчик, inbox, retry/DLQ, очередь реплики, `defineEvent`. В `startTestStack` — RabbitMQ и `definitions.json`, vhost на воркер; `expectOutbox`, `assertOutboxCoverage`, `publishTestEvent`, `waitForInbox`; CLI `rabbitmq definitions`. Выпуска нет — `[Unreleased]` · requirements/0000-kit · UC-5, UC-6, UC-8, UC-12, UC-14, AC-5.1–AC-5.20, AC-9.5 (relay, подписчик, очистка)
- [ ] **E7 Шифр секретов** — `/crypto` §3.6: `createCipher`, версии ключей, AAD, CLI `crypto generate-secret`. Выпуска нет — `[Unreleased]` · requirements/0000-kit · UC-10, AC-7.1–AC-7.5
- [ ] **E8 Redis** — `/redis` §3.7: клиент, префикс `<svc>:`, лимитер fail-open. В `startTestStack` — Redis и ACL, префикс воркера `<svc>:w<N>:`; CLI `redis acl`. После E8 — `1.0.0-rc.1` вручную (метка `next`), `npm trust` · requirements/0000-kit · UC-11, UC-12, AC-8.1–AC-8.6, AC-9.5 (лимитер)

Выпусков по этапам нет (G14, PRD v1.8): E1–E8 копятся в `[Unreleased]`, после E8 — `1.0.0-rc.1`, дальше `1.0.0-rc.N` (метка `next`); `1.0.0` — после перехода Identity. E7 и E8 можно планировать параллельно с E4–E5.

## Выполнено

| Веха | Дата |
|------|------|
| E1 Каркас и config | 2026-11-09 |
| E2 Наблюдаемость | 2026-11-10 |
| E3 HTTP-каркас | 2026-11-10 |
| E4 База данных и идемпотентность | 2026-11-11 |
| E5 Сообщения | 2026-11-11 |

## Requirements Map

| Веха | Пакет | UC | AC | Зависит от |
|---|---|---|---|---|
| E1 Каркас и config | requirements/0000-kit | UC-1, UC-3, UC-14, UC-16 | AC-1.1–AC-1.8, AC-1.10 (часть), AC-1.11–AC-1.13, AC-9.1 (минимальный потребитель), AC-9.3, AC-9.4 | — |
| E2 Наблюдаемость | requirements/0000-kit | UC-3, UC-4, UC-8, UC-13 | AC-2.1–AC-2.13 | E1 |
| E3 HTTP-каркас | requirements/0000-kit | UC-1, UC-3, UC-4, UC-8, UC-14 | AC-3.1–AC-3.13 | E2 |
| E4 База данных и идемпотентность | requirements/0000-kit | UC-5, UC-7, UC-9, UC-12, UC-14 | AC-4.1–AC-4.18, AC-9.5 (очистка идемпотентности) | E3 |
| E5 Сообщения | requirements/0000-kit | UC-5, UC-6, UC-8, UC-12, UC-14 | AC-5.1–AC-5.20, AC-9.5 (relay, подписчик, очистка) | E4 |
| E7 Шифр секретов | requirements/0000-kit | UC-10 | AC-7.1–AC-7.5 | E2 |
| E8 Redis | requirements/0000-kit | UC-11, UC-12 | AC-8.1–AC-8.6, AC-9.5 (лимитер) | E3 |
