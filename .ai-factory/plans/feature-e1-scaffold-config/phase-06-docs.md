# Фаза 6: README, CHANGELOG, выпуск, проверка документов

Plan: [index.md](index.md)
Tasks: 33–36
Depends on: Phases 2–5

## Цель

- README содержит API `/config` и `/testing`, правила развёртывания, реестр префиксов id и таблицу совместимости (AC-9.3).
- CHANGELOG ведётся по Keep a Changelog, с разделом `[1.0.0]` (AC-9.3).
- `docs/releasing.md` описывает чек-лист выпуска, ручной `1.0.0`, `npm trust` и запрет публикации токенами (NFR-6).
- Проверку документов выполняет тест уровня R.
- Контекст ИИ (`AGENTS.md`, `DESCRIPTION.md`, `ARCHITECTURE.md`) соответствует коду E1 и PRD v1.7.

Политика документации плана — `Docs: no` (только предупреждение). Документы этой фазы обязательны не по ней, а по AC-9.3 и NFR-6.

## Свидетельства из кода

| Путь | Что берём |
|---|---|
| `verdeect-platform-client/README.md` | порядок разделов (Совместимость, Установка, …, API, Документация, Выпуск, Разработка, Лицензия); формат таблицы совместимости |
| `verdeect-platform-client/CHANGELOG.md` | шапка: Keep a Changelog `https://keepachangelog.com/ru/1.1.0/`, SemVer, «У мажорной версии есть раздел «Как обновиться»» |
| `verdeect-platform-client/docs/releasing.md` | разделы: «Выпуск по шагам», «Что проверяет publish до публикации», «Ошибки выпуска», «Semver и контракт», «Авторизация в npm: Trusted Publishing» (разовая настройка GitHub, первый выпуск вручную, переход на OIDC), «Где смотреть логи публикации» |
| `verdeect-platform-client/test/package/docs.spec.ts` | `section(text, title)`, `withoutCode`, `exportedNames` (только `export { … }` / `export type { … }`), проверка ссылок, regex релизов `/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm` |
| `verdeect-orchestrator/apps/orchestrator/src/**` | префиксы `newId`: `lse` (insert-lease.action.ts:25), `jup` (put-journal.use-case.ts:45), `chm` и `chr` (channel.service.ts:261, 269), `trn` и `msg` (insert-turn.action.ts:31–32); `evt` — id события outbox (prd.md §3.4) |

## Task 33: README.md

**Skill:** none — документация (markdown)

### Шаги
Заменить заглушку из задачи 29. Разделы `##` по порядку:
1. `# @verdeect/kit` — один абзац: назначение и ссылка на `requirements/0000-kit/prd.md`.
2. `## Совместимость`:
   ```
   | `@verdeect/kit` | `@verdeect/events` | `@verdeect/auth` | `@verdeect/platform-client` |
   | --------------- | ------------------ | ---------------- | --------------------------- |
   | `1.0.x`         | —                  | `^1.0.1`         | `1.1.x`                     |
   ```
   Под таблицей: `@verdeect/events` выходит после `@verdeect/kit 1.4.0` (§3.9). Поддерживается только последний мажор (NFR-5).
3. `## Установка`:
   - `pnpm add @verdeect/kit@1.0.0` — точная версия;
   - список обязательных peer по NFR-3 (v1.7, с `@nestjs/config`);
   - таблица «подпуть → опциональные peer»: `/testing` — `testcontainers`, `vitest`; остальные подпути — «в своих этапах».
4. `## Подпути` — таблица:
   - `/config` и `/testing` — «1.0.0»;
   - `/observability` — E2 → 1.1.0, `/http` — E3 → 1.2.0, `/database` и `/idempotency` — E4 → 1.3.0, `/messaging` — E5 → 1.4.0, `/crypto` — E7 → 1.5.0, `/redis` — E8 → 1.6.0. Все — «ещё не выпущен».
5. `## Конфигурация окружения` — пример `defineEnv({...envBase, ...envDatabase, ...envServiceUrls(['identity']), СВОЙ_КЛЮЧ})`, `parseEnv`, `KitConfigModule.forRoot({schema})` + `ConfigService`. Таблица ключей пакета с умолчаниями из §3.1 v1.7. Правила:
   - путь ключа в ошибке — через точку;
   - значений в ошибке нет;
   - переименование ключей — без псевдонимов (C0);
   - `KitConfigModule` (через `@nestjs/config`) дописывает в `process.env` умолчания разобранных ключей. В тестах с несколькими контекстами окружение сохраняется и восстанавливается целиком.
6. `## Тесты сервиса`:
   - условие `development`;
   - пример `globalSetup` — `export default startTestStack({ service: 'files', postgres: true, mailpit: true })`;
   - ключи `inject`: `kitPostgresUrl`, `kitSmtpUrl`, `kitMailpitUrl`, `kitS3Endpoint`, `kitS3AccessKey`, `kitS3SecretKey`;
   - `TEST_IMAGES`;
   - `assertRepoConventions` — таблица правил фазы 4 с ID, определением «приложения» и «команды запуска приложения», списком старых ключей;
   - `tcpProxy`, `timingGuard`, `TEST_TIMEOUT_SCALE`.
7. `## Развёртывание` — правила (AC-9.3):
   - порт метрик (`METRICS_PORT`) не публикуется наружу;
   - `REPLICA_ID` не задавать — умолчание `hostname()`;
   - `stop_grace_period: 15s` при `SHUTDOWN_TIMEOUT_MS` 10000;
   - пул соединений PostgreSQL — формула `2 × DB_POOL_MAX × реплики`;
   - DLQ — разбор в 7 дней;
   - порядок смены ключа шифра: новый секрет `verdeect-kit crypto generate-secret` (с E7) → новая версия первой в `ENCRYPTION_KEYS` → перезапуск → перешифровка → удаление старой версии (UC-10);
   - смена TTL `.retry` (`RABBITMQ_RETRY_SECONDS`): очередь `<svc>.retry` удалить и пересоздать, иначе отказ запуска (§3.4).
8. `## Реестр префиксов id` — таблица `Префикс | Сущность | Сервис`. Формат `^[a-z]{2,5}$`, id — `<prefix>_<ulid>`:
   - `evt` | событие outbox | все (kit, §3.4);
   - `trn` | ход (turn) | orchestrator;
   - `msg` | сообщение хода | orchestrator;
   - `lse` | аренда (lease) рантайма | orchestrator;
   - `jup` | загрузка журнала | orchestrator;
   - `chm` | сообщение канала | orchestrator;
   - `chr` | запрос канала | orchestrator.

   Новый префикс добавляется строкой в этот реестр в плане сервиса.
9. `## API` — подразделы `### @verdeect/kit/config`, `### @verdeect/kit/testing`. Каждое экспортированное имя из `src/config/index.ts` и `src/testing/index.ts` — в обратных кавычках с одной строкой описания.
10. `## Документация` — ссылки на `docs/releasing.md`, `docs/testing.md`, `CHANGELOG.md`.
11. `## Выпуск` — коротко + ссылка на `docs/releasing.md`.
12. `## Разработка` — скрипты pnpm: `install`, `lint`, `typecheck`, `test`, `test:integration`, `test:timing`, `pack:check`. Для I, T, C нужен Docker. Makefile появится после E1 (`/aif-build-automation`).
13. `## Лицензия` — UNLICENSED.

### Критерии приёмки и проверка
- Задача 35.

## Task 34: CHANGELOG.md, docs/releasing.md, docs/testing.md

**Skill:** none — документация (markdown)

### Шаги
1. `CHANGELOG.md` (заменить заглушку):
   - шапка по образцу PC, с «Как перейти» для мажоров (NFR-5);
   - `## [Unreleased]` — пустой;
   - `## [1.0.0] - <дата реализации YYYY-MM-DD>` — абзац «Первый выпуск: подпути `/config` и `/testing` (этап E1, PRD v1.7)»;
   - `### Added` — по пункту на каждый экспорт `/config` и `/testing` и на правила `assertRepoConventions` (ID правил).
2. `docs/releasing.md` — разделы по образцу PC:
   - «Выпуск по шагам»: проверки локально (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:timing` на тихой машине, `pnpm pack:check`), обновление CHANGELOG и версии по G14, `git tag vX.Y.Z`, `git push origin vX.Y.Z`. После 5.1a — `make test-full` и CI;
   - «Что проверяет publish до публикации»: тег = `version`, версии нет в npm (AC-1.10);
   - «Semver»: правила G14 — мажор, минор, патч дословно из PRD §0; «Как перейти» на мажор; только последний мажор (NFR-5);
   - «Авторизация в npm: Trusted Publishing»:
     - разовая настройка GitHub: environment `npm`, ruleset на теги `v*`;
     - первый выпуск `1.0.0` вручную мейнтейнером после 5.1a: `npm login`, `pnpm pack:check`, `npm publish --access public`;
     - затем `npm trust github …` и запрет публикации токенами (`disallow tokens`);
     - `NPM_TOKEN` не используется нигде;
   - «Где смотреть логи публикации» — Actions → job `publish` (после 5.1a).
3. `docs/testing.md`:
   - уровни U, I, T, C, R и их файлы;
   - скрипты pnpm;
   - Docker для I, T, C;
   - `TEST_TIMEOUT_SCALE=2..3` только локально;
   - проекты `shared`/`isolated` integration-конфига и правило добавления в `isolated` (с причиной).

### Критерии приёмки и проверка
- Задача 35.

## Task 35: Тест документов — AC-9.3, NFR-6

**Skill:** nestjs-code test unit package/ac-9-3-docs (CREATE)

### Шаги
`test/package/ac-9-3-docs.spec.ts`. Помощники `section`, `withoutCode`, `exportedNames` — из PC `docs.spec.ts`.
- `AC-9.3: README — API каждого выпущенного подпути` — каждое имя из `exportedNames('src/config/index.ts')` и `exportedNames('src/testing/index.ts')` встречается в разделе `## API` как `` `имя` ``;
- `AC-9.3: README — правила развёртывания` — раздел `## Развёртывание` содержит `METRICS_PORT`, `наружу`, `REPLICA_ID`, `stop_grace_period: 15s`, `2 × DB_POOL_MAX × реплики`, `DLQ`, `7 дней`, `ENCRYPTION_KEYS`, `RABBITMQ_RETRY_SECONDS`, `.retry`;
- `AC-9.3: README — реестр префиксов id` — раздел `## Реестр префиксов id`: строки таблицы, начинающиеся с `` | `evt` ``, `` | `trn` ``, `` | `msg` ``, `` | `lse` ``, `` | `jup` ``, `` | `chm` ``, `` | `chr` ``; все префиксы соответствуют `^[a-z]{2,5}$`;
- `AC-9.3: README — таблица совместимости` — раздел `## Совместимость`: заголовок с `@verdeect/kit`, `@verdeect/events`, `@verdeect/auth`, `@verdeect/platform-client`; строка `` | `1.0.x` ``;
- `AC-9.3: CHANGELOG — Keep a Changelog, [Unreleased], раздел версии = package.json` — `keepachangelog.com`, `## [Unreleased]`, релизы по regex, первый — `1.0.0` = `version`;
- `NFR-6: docs/releasing.md — чек-лист, ручной 1.0.0, npm trust, запрет токенов` — содержит `pnpm pack:check`, `git tag v`, `npm login`, `npm publish --access public`, `npm trust`, `disallow tokens`, `Trusted Publishing`; не содержит `NPM_TOKEN`;
- `AC-9.3: относительные ссылки README, CHANGELOG, AGENTS.md и docs/*.md ведут на существующие файлы`.

### Критерии приёмки и проверка
- `pnpm pack:check` — зелёный.

## Task 36: Синхронизация контекста ИИ и финальная проверка этапа

**Skill:** none — документация (markdown) и команды

### Шаги
1. `AGENTS.md`:
   - раздел «Структура проекта» — фактическое дерево после E1 (`src/config`, `src/internal`, `src/testing`, `test/{unit,integration,timing,package,consumer,fixtures,support}`, `scripts/publish.mjs`, `docs/`);
   - добавить раздел «Команды»: скрипты pnpm из задачи 33 п. 12;
   - «Ключевые точки входа»: `src/config/index.ts`, `src/testing/index.ts`, `package.json`, `scripts/publish.mjs`;
   - «Документация»: README, CHANGELOG, `docs/releasing.md`, `docs/testing.md`.
2. `.ai-factory/DESCRIPTION.md`, раздел «Технологический стек»: добавить `@nestjs/config` 12.0.1 в обязательные peer (PRD v1.7); `prom-client` — 15.1.3. `dependencies`: `semver` 7.8.6, `yaml` 2.9.1.
3. `.ai-factory/ARCHITECTURE.md`:
   - в таблице «Правила зависимостей» у `config` — `@nestjs/common`, `@nestjs/config`;
   - в дереве: `src/testing/repo-files.ts`, `src/testing/tcp-proxy.ts`, `src/testing/timing-guard.ts`, `src/testing/start-test-stack.ts` и `vitest.timing.config.ts`. В E1 нет `bin` — поле появится с первой CLI-командой (E3).
4. Финальная проверка, каждая команда — отдельный вызов:
   - `pnpm install --frozen-lockfile`
   - `pnpm format:check`
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm test:integration`
   - `pnpm test:timing` (на тихой машине; при нагрузке — отложить с замером, не FAIL)
   - `pnpm pack:check`
5. `grep -rn "console\." src` — пусто. `grep -rnE "pgSchema\('" src` — пусто.

### Критерии приёмки и проверка
- Все команды п. 4 — код 0. Трассировка в `index.md` совпадает с файлами тестов.

## Риски фазы
- Риск: регулярное выражение тестов на разделы README хрупкое к форматированию.
  Что делать: заголовки разделов фиксируются этим планом. Тест ищет фрагменты, а не точный текст.

## Чек-лист завершения фазы
- Все проверки задачи 36 зелёные.
- Галочки задач 33–36 в `index.md` обновлены.
