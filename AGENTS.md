# AGENTS.md

> Карта репозитория для ИИ-агентов и новых разработчиков. Обновляйте её при заметных изменениях структуры. Раздел «Документация» ведёт `/aif-docs`.

## Обзор проекта

`@verdeect/kit` — общий инфраструктурный npm-пакет NestJS-сервисов Вердикта 2.0. Подпути: `/config`, `/observability`, `/http`, `/database`, `/idempotency`, `/messaging`, `/crypto`, `/redis` и `/testing` (только с условием `development`), плюс CLI `verdeect-kit`. Пакет — библиотека: своего HTTP-сервера, БД, Docker и GlitchTip у него нет. Подробности — `.ai-factory/DESCRIPTION.md`.

## Технологический стек

- **Язык:** TypeScript (ESM-only, Node ≥ 22.12; тесты — Node 22 и 24)
- **Обязательные peer-зависимости:** NestJS 12, Fastify 5, Drizzle 0.45.4, zod 4, `nestjs-pino`, `pino`, `@prometheus-io/client`, `@sentry/nestjs`, `@verdeect/auth`
- **Опциональные peer-зависимости:** `pg`, `ioredis`, `amqplib` + `amqp-connection-manager`, `testcontainers`, `vitest`
- **Тесты:** Vitest. Уровни: U (unit), I (integration на Testcontainers), T (timing), C (проект-потребитель на архиве), R (проверки репозитория и архива)
- **Пакетный менеджер:** pnpm
- **CI и выпуск:** GitHub Actions; публикация — npm Trusted Publishing по тегу `v<semver>`
- **БД, брокер, Redis:** своих нет. Тесты поднимают их через Testcontainers (`TEST_IMAGES`)

## Структура проекта

Состояние: выпущены `1.0.0-rc.1` и `1.0.0-rc.2` — все подпути `/config`, `/observability`, `/http`, `/database`, `/idempotency`, `/messaging`, `/crypto`, `/redis`, `/testing` и CLI `verdeect-kit openapi`, `db`, `rabbitmq`, `crypto`, `redis`; готовится `1.0.0-rc.3` — права публикации RabbitMQ по префиксам (`docs/releasing.md`).

```
verdeect-kit/
├── src/
│   ├── internal/                 # без точки входа: peer.ts (loadPeer, requirePeer, AC-1.2), service-name.ts, pg-errors.ts,
│                                 #   preparsed-env.ts, tokens.ts, ids.ts, metadata.ts, sql-identifier.ts, tx-context.ts, outbox-policy.ts,
│                                 #   rabbitmq-definitions.ts, redis-acl.ts, cleanup-result.ts
│   ├── config/                   # ./config — §3.1: fragments, helpers, define-env, parse-env, cli-schemas, kit-config.module
│   ├── observability/            # ./observability — §3.2: redaction, sanitize-error, logger-options, sentry, fail-startup,
│                                 #   health-registry, metrics, metrics-server, lifecycle
│   ├── http/                     # ./http — §3.5: bootstrap-service, create-http-app, kit-http-core.module, errors,
│                                 #   zod-validation.pipe, kit-exception.filter, pagination, api/ (@Api, OpenAPI)
│   ├── database/                 # ./database — §3.3: pg (requirePeer, ленивый драйвер), tenant, prepare-database,
│                                 #   migrations, db, kit-database.module, pools (buildPools, без @nestjs/*),
│                                 #   timeouts (CONNECTION_TIMEOUT_MS без peer), batches, run-exclusive, if-newer
│   ├── idempotency/              # ./idempotency — §3.3а: peer, table, idempotent.decorator, idempotency.interceptor,
│                                 #   kit-idempotency.module
│   ├── messaging/                # ./messaging — §3.4: peer, errors, define-event, envelope, tables, topology, redelivery,
│                                 #   rabbit-connection, outbox-store, outbox-relay, inbox, subscriber, cleanup, config,
│                                 #   kit-messaging.module
│   ├── crypto/                   # ./crypto — §3.6: cipher (createCipher, DecryptError, generateSecret), index
│   ├── redis/                    # ./redis — §3.7: peer, client (KIT_REDIS, соединения), kit-redis.module, channels,
│                                 #   rate-limiter (RateLimiter, throwRateLimited), index
│   ├── testing/                  # ./testing (только development) — §3.8 E1, E3, E4: images, start-test-stack, repo-files,
│                                 #   repo-conventions, tcp-proxy, timing-guard, timeout-scale (ещё подпуть ./testing/timeout-scale
│                                 #   без development, только node:*), create-test-app, create-test-db,
│                                 #   expect-problem, expect-matches-api, scratch-database, worker-scope,
│                                 #   tenant-isolation, count-queries, rabbitmq-admin, outbox-coverage, test-events, redis-worker
│   └── cli/                      # bin verdeect-kit: main.ts (только runCli), run.ts (runCli: таблица команд, справка --help),
│                                 #   commands/openapi.ts, commands/db.ts, commands/rabbitmq.ts,
│                                 #   commands/crypto.ts, commands/redis.ts
├── alerts/verdeect-kit.rules.yml # шаблон правил vmalert (alertRulesTemplate, §3.2), входит в архив
├── test/
│   ├── unit/<подпуть>/           # U: без сети и Docker (+ *.test-d.ts)
│   ├── integration/<подпуть>/    # I: Testcontainers, global-setup.ts
│   ├── timing/<подпуть>/         # T: timingGuard, global-setup.ts
│   ├── package/                  # R и C: архив, потребители, publish.mjs, lint AC-9.4, документы
│   ├── consumer/                 # шаблоны проектов-потребителей: minimal, no-testcontainers
│   ├── fixtures/                 # repo-conventions/valid (AC-1.8), lint (AC-9.4), alerts (AC-2.11), observability/shutdown-child.mjs (AC-2.10),
│                                 #   http/api-app.module.ts (AC-3.7), http/shutdown-app.mjs (AC-3.9),
│                                 #   database/ (схема kit и миграции drizzle-kit, pnpm db:fixtures — E4)
│   └── support/                  # общие помощники: docker.ts, fake-sentry.ts (поддельный транспорт GlitchTip),
│                                 #   postgres.ts, database.ts (Db и приложение уровня I), broker.ts (RabbitMQ vhost воркера),
│                                 #   messaging.ts (стенды /messaging, TestConsumer), redis.ts (стенд /redis, администратор)
├── .github/workflows/ci.yml      # CI: lint, test (Node 22, 24: U + I), timing, package, publish по тегу v*
├── Makefile                      # единая точка входа: make help
├── scripts/publish.mjs           # публикация из CI: тег = version, версии нет в npm (AC-1.10)
├── docs/                         # releasing.md, testing.md
├── requirements/0000-kit/        # prd.md (v1.11 — источник истины), README.md (этапы), files/inventory.md (эталоны)
├── .ai-factory/                  # контекст AI Factory (DESCRIPTION, ARCHITECTURE, rules, skill-context, plans)
├── package.json, pnpm-workspace.yaml, tsconfig.json, tsconfig.build.json, eslint.config.js, .prettierrc.json
├── vitest.config.ts, vitest.integration.config.ts, vitest.timing.config.ts, vitest.package.config.ts
└── README.md, CHANGELOG.md
```

Позже (prd.md §8): `src/<подпуть>/` следующих этапов и их CLI-команды.

## Команды

| Команда | Что |
|---|---|
| `make install` | зависимости по `pnpm-lock.yaml` |
| `make lint` | ESLint (стиль, TSDoc, границы подпутей), Prettier, правила lint AC-9.4 |
| `make analyse` | `tsc --noEmit`, политика зависимостей манифеста |
| `make test` | U (+ тесты типов); `FILTER='AC-1.8'` |
| `make test-module M='…'` | U + I подпутей |
| `make test-integration` | I — нужен Docker |
| `make test-timing` | T — только на тихой машине |
| `make pack-check` | сборка + R и C (Docker, сеть до реестра npm) |
| `make ci` | конвейер CI |
| `make test-full` | перед слиянием и выпуском |

Во время работы — `make test` и `make test-module` для затронутых подпутей; перед `/aif-commit` и слиянием — `make test-full`.

## Ключевые точки входа

| Файл | Назначение |
|---|---|
| `src/config/index.ts` | публичная поверхность `@verdeect/kit/config` |
| `src/observability/index.ts` | публичная поверхность `@verdeect/kit/observability` |
| `src/http/index.ts` | публичная поверхность `@verdeect/kit/http` |
| `src/messaging/index.ts` | публичная поверхность `@verdeect/kit/messaging` |
| `src/crypto/index.ts` | публичная поверхность `@verdeect/kit/crypto` |
| `src/redis/index.ts` | публичная поверхность `@verdeect/kit/redis` |
| `src/cli/main.ts` | CLI `verdeect-kit` (поле `bin`): только вызов `runCli` |
| `src/cli/run.ts` | `runCli`: разбор команды, справка `--help`, загрузка обработчика |
| `src/testing/index.ts` | публичная поверхность `@verdeect/kit/testing` |
| `src/testing/timeout-scale.ts` | подпуть `@verdeect/kit/testing/timeout-scale` (`TEST_TIMEOUT_SCALE`, `readTimeoutScale`) |
| `package.json` | `exports`, peer-зависимости (NFR-3), скрипты |
| `scripts/publish.mjs` | публикация по тегу (AC-1.10) |
| `requirements/0000-kit/prd.md` | требования: P0 и G (§0), API по подпутям (§3), UC-1–UC-16, AC (§5), модель данных (§6), NFR (§7), этапы (§9) |
| `requirements/0000-kit/README.md` | таблица этапов E1–E8, режим плана, зависимости, выпуск |
| `requirements/0000-kit/files/inventory.md` | эталон переноса каждого модуля и тесты эквивалентности |

## Документация

| Документ | Путь | Описание |
|---|---|---|
| README | `README.md` | установка, подпути, окружение, тесты сервиса, развёртывание, реестр префиксов, API |
| CHANGELOG | `CHANGELOG.md` | изменения по версиям (Keep a Changelog) |
| Выпуск | `docs/releasing.md` | чек-лист, ручной `1.0.0-rc.1` после E8 (метка `next`), Trusted Publishing, `1.0.0` после Identity |
| Тесты | `docs/testing.md` | уровни U, I, T, R, C и запуск |
| PRD | `requirements/0000-kit/prd.md` | требования к пакету |
| Этапы | `requirements/0000-kit/README.md` | E1 «Каркас и config» … E8 «Redis» |
| Инвентаризация | `requirements/0000-kit/files/inventory.md` | модули × сервисы, эталоны, версии |
| Индекс требований | `requirements/INDEX.md` | список пакетов требований |

## Файлы контекста ИИ

| Файл | Назначение |
|---|---|
| `AGENTS.md` | эта карта репозитория |
| `.ai-factory/DESCRIPTION.md` | описание проекта, стек, интеграции, нефункциональные требования |
| `.ai-factory/ARCHITECTURE.md` | архитектура, направление зависимостей между подпутями |
| `.ai-factory/rules/base.md` | соглашения кода |
| `.ai-factory/skill-context/` | проектные правила скилов AI Factory (правила библиотеки kit) |
| `.ai-factory/config.yaml` | настройки AI Factory (язык, git) |
| `../CLAUDE.md` | общие правила Вердикта 2.0: чужой репозиторий — только для чтения |

## Внешние образцы и источники

Все пути — в `/home/administrator/projects/verdeect2/`, все репозитории только для чтения:

- `verdeect-platform-client`, `verdeect-auth` — образцы пакета: `package.json` (`exports`, условие `development`), tsconfig, eslint, prettier, Vitest, Makefile, `ci.yml`, `scripts/publish.mjs`, `test/consumer`, `docs/`.
- `verdeect-orchestrator` (O) — эталон большинства модулей.
- `verdeect-identity` (I), `verdeect-bff` (B), `verdeect-platform` (P) — остальные копии `apps/<svc>/src/shared/**` и `test/**`. Какой файл — эталон, указано в `inventory.md` §1.

## Правила для агентов

- Не объединяйте shell-команды через `&&`, `||` или `;`. Каждая команда — отдельный вызов.
  - Неправильно: `git checkout main && git pull`
  - Правильно: сначала `git checkout main`, затем `git pull origin main`
- Репозитории сервисов `verdeect-*`, кроме этого, — только для чтения:
  - читать можно: `git log`, `git show`, `git diff`, `git status`;
  - нельзя: менять ветку, делать `pull`, `fetch`, `stash`, `worktree`, поднимать их контуры.
  - Нужна другая версия — свой клон вне чужой папки.
- P0: опция — только для различия по роли сервиса, названного в PRD. Режим совместимости, псевдоним старого ключа или чтение старого формата — дефект.
- Код переносится из эталона (`inventory.md` §1) вместе с его тестами, а не пишется заново. В шапке файла — эталон.
- Подпуть и его помощники `/testing` появляются в своём этапе. Поле типа из следующего этапа отсутствует, заглушки не делаются.
- В `src/**` запрещены `console.*`, имена схем и таблиц сервисов, статический импорт опционального peer из подпути, который должен грузиться без него.
- Изменение публичной поверхности сопровождается TSDoc, README и записью в `CHANGELOG.md`. Версия меняется по G14.
- Docker-файлов и e2e-контура в репозитории нет (`/aif-dockerize` неприменим). Docker нужен только Testcontainers.
- Для `.ts`-файлов используйте скилы `nestjs-specialist` и `nestjs-code`; для компонентов библиотеки — тип `generic`.
