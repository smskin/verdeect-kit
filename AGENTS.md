# AGENTS.md

> Карта репозитория для ИИ-агентов и новых разработчиков. Обновляйте её при заметных изменениях структуры. Раздел «Документация» ведёт `/aif-docs`.

## Обзор проекта

`@verdeect/kit` — общий инфраструктурный npm-пакет NestJS-сервисов Вердикта 2.0. Подпути: `/config`, `/observability`, `/http`, `/database`, `/idempotency`, `/messaging`, `/crypto`, `/redis` и `/testing` (только с условием `development`), плюс CLI `verdeect-kit`. Пакет — библиотека: своего HTTP-сервера, БД, Docker и GlitchTip у него нет. Подробности — `.ai-factory/DESCRIPTION.md`.

## Технологический стек

- **Язык:** TypeScript (ESM-only, Node ≥ 22.12; тесты — Node 22 и 24)
- **Обязательные peer-зависимости:** NestJS 12, Fastify 5, Drizzle 0.45.4, zod 4, `nestjs-pino`, `pino`, `prom-client`, `@sentry/nestjs`, `@verdeect/auth`
- **Опциональные peer-зависимости:** `pg`, `ioredis`, `amqplib` + `amqp-connection-manager`, `testcontainers`, `vitest`
- **Тесты:** Vitest. Уровни: U (unit), I (integration на Testcontainers), T (timing), C (проект-потребитель на архиве), R (проверки репозитория и архива)
- **Пакетный менеджер:** pnpm
- **CI и выпуск:** GitHub Actions; публикация — npm Trusted Publishing по тегу `v<semver>`
- **БД, брокер, Redis:** своих нет. Тесты поднимают их через Testcontainers (`TEST_IMAGES`)

## Структура проекта

Состояние после E1 (в `[Unreleased]`; выпуск — `1.0.0-rc.1` после E8): подпути `/config` и `/testing`. Следующие подпути появляются по этапам E2–E8 (`requirements/0000-kit/README.md`).

```
verdeect-kit/
├── src/
│   ├── internal/                 # без точки входа: peer.ts (loadPeer, AC-1.2), service-name.ts
│   ├── config/                   # ./config — §3.1: fragments, helpers, define-env, parse-env, cli-schemas, kit-config.module
│   └── testing/                  # ./testing (только development) — §3.8 E1: images, start-test-stack, repo-files,
│                                 #   repo-conventions, tcp-proxy, timing-guard, timeout-scale
├── test/
│   ├── unit/<подпуть>/           # U: без сети и Docker (+ *.test-d.ts)
│   ├── integration/<подпуть>/    # I: Testcontainers, global-setup.ts
│   ├── timing/<подпуть>/         # T: timingGuard, global-setup.ts
│   ├── package/                  # R и C: архив, потребители, publish.mjs, lint AC-9.4, документы
│   ├── consumer/                 # шаблоны проектов-потребителей: minimal, no-testcontainers
│   ├── fixtures/                 # repo-conventions/valid (AC-1.8), lint (AC-9.4) — тестовые данные
│   └── support/                  # общие помощники уровня I
├── scripts/publish.mjs           # публикация из CI: тег = version, версии нет в npm (AC-1.10)
├── docs/                         # releasing.md, testing.md
├── requirements/0000-kit/        # prd.md (v1.8 — источник истины), README.md (этапы), files/inventory.md (эталоны)
├── .ai-factory/                  # контекст AI Factory (DESCRIPTION, ARCHITECTURE, rules, skill-context, plans)
├── package.json, pnpm-workspace.yaml, tsconfig.json, tsconfig.build.json, eslint.config.js, .prettierrc.json
├── vitest.config.ts, vitest.integration.config.ts, vitest.timing.config.ts, vitest.package.config.ts
└── README.md, CHANGELOG.md
```

Позже (prd.md §8): `src/<подпуть>/` следующих этапов, `src/cli/` (поле `bin` — с первой CLI-командой в E3), `alerts/verdeect-kit.rules.yml` (E2), Makefile и `.github/workflows/ci.yml` (после E1).

## Команды

| Команда | Что |
|---|---|
| `pnpm install` | зависимости (`--frozen-lockfile` в проверках) |
| `pnpm lint` | ESLint: стиль, TSDoc, границы подпутей, AC-9.4 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | U (+ тесты типов) |
| `pnpm test:integration` | I — нужен Docker |
| `pnpm test:timing` | T — только на тихой машине |
| `pnpm pack:check` | сборка + R и C (Docker, сеть до реестра npm) |

## Ключевые точки входа

| Файл | Назначение |
|---|---|
| `src/config/index.ts` | публичная поверхность `@verdeect/kit/config` |
| `src/testing/index.ts` | публичная поверхность `@verdeect/kit/testing` |
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
