<!-- aif:plan-mode:ultra -->
# Ultra-план реализации: E1 Каркас и config (`@verdeect/kit` 1.0.0)

Mode: ultra
Branch: feature/e1-scaffold-config
Created: 2026-11-09

## Original Request
Реализуй этап roadmap «E1 Каркас и config» по пакету требований requirements/0000-kit/ (ревизия r1, PRD v1.6).

Скоуп этапа: AC-1.1–AC-1.8, AC-1.10 (часть: scripts/publish.mjs — тег = version и версии нет в npm, с unit-тестом; workflow GitHub Actions — не здесь), AC-1.11–AC-1.13; сквозные AC-9.1 (минимальный проект-потребитель test/consumer: ставит упакованный архив, импортирует /config и /testing, разбирает окружение defineEnv, поднимает startTestStack({postgres: true}), проходит assertRepoConventions на фикстуре), AC-9.3 (README — API /config и /testing, правила развёртывания, реестр префиксов id, таблица совместимости; CHANGELOG по Keep a Changelog с разделом [1.0.0]), AC-9.4 (правило lint no-console и no-restricted-syntax, тест конфига на фикстуре нарушения); P0, G1, G3, G13, G14; NFR-1, NFR-3, NFR-4, NFR-6 (docs/releasing.md: чек-лист, ручной 1.0.0, npm trust, запрет публикации токенами), NFR-8, NFR-9; prd.md §3.1 целиком; §3.8 — строки с этапом E1 (TEST_IMAGES; startTestStack — только контейнеры postgres, mailpit, minio, адреса через provide, без подготовки БД и миграций; assertRepoConventions — все правила из §3.8 и AC-1.8; tcpProxy, timingGuard, TEST_TIMEOUT_SCALE). Каркас пакета — по образцу /home/administrator/projects/verdeect2/verdeect-platform-client: package.json (exports только для ./config и ./testing — у testing только {types, development}, без default; остальные подпути добавляются в своих этапах вместе с проверками AC-1.1 и AC-1.2; engines node ≥ 22.12; packageManager pnpm; peer и optional peer — ровно по NFR-3; version 1.0.0), tsconfig, tsconfig.build.json, eslint, prettier, vitest-конфиги уровней U, I (Testcontainers в globalSetup, раз на прогон) и T. Перенос кода — по requirements/0000-kit/files/inventory.md (столбец «Эталон»): config — env.schema B/O (путь ключа через точку) и помощники; testing — O test/support (images, tcp-proxy, timing-guard, timeout-scale, global-setup), правила assertRepoConventions — по P ac-6-1-production-compose.spec и O test/support/compose-env.spec, сравнение тегов образов — по BFF image-tags.spec.ts; тесты эталонов переносятся вместе с кодом и обобщаются. Репозитории сервисов — только чтение: ничего не менять, ветку не переключать, git — только log/show/diff. Makefile, CI и Docker в этап НЕ входят: Makefile и CI генерируют /aif-build-automation и /aif-ci после этапа, Docker библиотеке не нужен; тесты запускаются скриптами pnpm. Публикацию 1.0.0 делает мейнтейнер вручную после 5.1a. Остальное из пакета — другие этапы. Источник истины — requirements/0000-kit/prd.md; приоритет при конфликте: prd.md > files/inventory.md > ROADMAP/DESCRIPTION; если код сервиса расходится с prd.md — берётся prd.md (P0: без режимов совместимости и псевдонимов). Покрой все требования скоупа; ссылайся на их ID в задачах и в названиях тестов. Открытые вопросы [OPEN] не додумывай — спроси меня. Фазы должны оставлять проект в рабочем состоянии: тесты зелёные после каждой фазы.

## Settings
- Testing: yes (обязательно по правилу проекта «Mandatory Test Phases»)
- Logging: minimal. Пакет в E1 не пишет логов. Единственные строки в stderr — `timingGuard` (его назначение) и отказ старта `startTestStack`. `console.*` в `src/**` запрещён (NFR-8).
- Docs: no — только предупреждение `WARN [docs]`. README, CHANGELOG и `docs/releasing.md` всё равно пишутся: их требуют AC-9.3 и NFR-6 (фаза 6).

## Roadmap Linkage
Milestone: "E1 Каркас и config"
Rationale: план реализует ровно скоуп вехи E1 из `.ai-factory/ROADMAP.md` и `requirements/0000-kit/README.md`.

## Requirements Reconciliation
Authority:
1. `requirements/0000-kit/prd.md` **v1.7** (ревизия r2, коммит `4de7f14` в этой ветке);
2. `requirements/0000-kit/files/inventory.md`;
3. `.ai-factory/ROADMAP.md`, `.ai-factory/DESCRIPTION.md`, `.ai-factory/ARCHITECTURE.md`.

**Ребейз на r3 (KT-04, PRD v1.8), до коммита этапа:** выпусков по этапам нет — `version` = `1.0.0-rc.1` (номер следующего выпуска, до тега не публикуется), CHANGELOG — `[Unreleased]` вместо `[1.0.0]`; `scripts/publish.mjs` — `-rc.<N>` → `--tag next`, без суффикса → `--tag latest`, другой суффикс — отказ (AC-1.10 v1.8); `docs/releasing.md` и README — `1.0.0-rc.1` после E8, `1.0.0` после Identity. Упоминания `1.0.0` как версии E1 ниже (заголовок, Commit Plan, DoD) заменены этим решением.

**Ребейз на r4 (KT-05, PRD v1.9), до коммита этапа:** одноразовое задание — `command:` (своя или из базового `compose.yml`) без команды запуска приложения; к нему не применяются `stop-grace-period` и `instrument-import`, применяются `test-images`, `replica-id`, `env-keys` (§3.8, AC-1.8). Предел алиасов YAML — конечный, 1000.

**Ребейз на r5 и r6 (KT-07, KT-08; PRD v1.10, v1.11), до коммита этапа:** форма команды запуска собирается по правилам Docker и Compose (слитый сервис, `!reset`/`!override`, ENTRYPOINT + CMD, `FROM <стадия>`); новое правило `command-unrecognized` работает «на запрет»: у приложения обязателен распознанный запуск, неизвестная форма — нарушение (§3.8, AC-1.8). Разбор вынесен в `src/testing/launch-command.ts`.

Код сервисов, расходящийся с PRD, уступает PRD (P0). Исходный запрос ссылался на r1 / v1.6. Ответы на вопросы планирования закреплены в r2 / v1.7 по сообщению чата kit KT-03, и план построен по v1.7.

Milestone scope (только эти ID):
- критерии: AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.7, AC-1.8, AC-1.10 (часть: `scripts/publish.mjs`), AC-1.11, AC-1.12, AC-1.13, AC-9.1 (минимальный потребитель), AC-9.3, AC-9.4;
- решения и NFR: P0, G1, G3, G13, G14, NFR-1, NFR-3, NFR-4, NFR-6, NFR-8, NFR-9;
- API: §3.1 целиком, строки §3.8 с этапом E1;
- UC (часть E1): UC-1, UC-3, UC-14, UC-16.

Вне скоупа:
- AC-1.10 (workflow) — 5.1a;
- AC-1.9 — удалён;
- AC-2.x–AC-8.x, AC-9.5 — следующие этапы;
- Makefile, CI, Docker.

| Решение / комбинация | Источник | Проверка |
|---|---|---|
| `@nestjs/config` — обязательный peer `^12.0.0`, dev 12.0.1; `KitConfigModule` — обёртка над `ConfigModule` | prd v1.7 §3.1, NFR-3 | задача 6 (`NFR-3: обязательные peer`), задача 12 (AC-1.7) |
| Умолчания `NODE_ENV = production`, `LOG_LEVEL = info` (fatal…silent), `METRICS_PORT = 9100` | prd v1.7 §3.1, AC-1.5 | задача 10 (`AC-1.5: умолчания`) |
| Путь ключа ошибки — полный, через точку; без пути — `(root)`; значений нет | prd §3.1, AC-1.3; эталон B (у O — первый сегмент, inventory §4 п. 10 — решено PRD) | задача 10 (`AC-1.3`) |
| `RABBITMQ_RETRY_SECONDS` по умолчанию 30 (у O — 5) | prd §3.1 (GAP-5) | задача 10 |
| `ENCRYPTION_KEYS` — JSON `[{version, secret}]`, base64url без `=`, ≥ 32 байт; форматы B/I/O не читаются | prd §3.1, §3.6, N9, CE-2 | задача 10 (`env-crypto.spec.ts`) |
| Сообщения ошибок — по-русски | NFR-9 | задачи 10, 25, 30 |
| Peer — диапазон `^<мажор>.<минор>.0` проверенной версии; `drizzle-orm ^0.45.4` (NFR-1 называет 0.45.4) | NFR-3 «от проверенной минорной», NFR-1 | задача 6 |
| `dependencies` — только `semver` 7.8.6 и `yaml` 2.9.1 (разбор YAML и версий — внутренние детали) | NFR-3 | задача 6 |
| `exports` E1 — только `./config`, `./testing` (`{types, development}` без `default`), `./package.json`; без `bin` | G1, NFR-4, §3.8 «Этап», skill-context «Library Package Scope» (6) | задачи 6, 29, 30 |
| Опциональный peer — только через `loadPeer` (top-level await), текст AC-1.2 | AC-1.2, NFR-3 | задачи 5 (U), 30 (C) |
| `startTestStack` в E1 — только `postgres`/`mailpit`/`minio`, без `prepareDatabase`, миграций, `rabbitmq`, `redis`, `workerScope` (поля отсутствуют в типе) | §3.8 «Этап», AC-1.12, AC-1.13 | задачи 19, 20 |
| «Приложение» — сервис compose с ключом `envBase` в `environment:` или `env_file:`; «команда запуска приложения» — `node` с файлом входа ровно `main.js`/`main.ts`; подделки `*.main.ts` и инфраструктура не проверяются | prd v1.7 §3.8, AC-1.8 | задача 25 |
| Старые ключи — явный список (IDENTITY_PORT, BFF_PORT → PORT; DATABASE_MIGRATION_URL → DATABASE_MIGRATOR_URL; SESSION_ENC_KEYS, SIGNING_KEY_ENCRYPTION_KEYS, CLIENT_SECRET_KEY, IDENTITY_SECRETS → ENCRYPTION_KEYS); расширение — мажор | prd v1.7 §3.8, G14 | задача 25 |
| `REPLICA_ID` запрещён во всех сервисах compose (не только в приложениях) | prd §3.8 («REPLICA_ID не задан в compose») | задача 25 |
| `stop_grace_period`: значение того же файла, иначе базового `compose.yml`, иначе 10 с Docker; `SHUTDOWN_TIMEOUT_MS`: литерал, `${X:-N}`, иначе 10000 | prd §3.8, UC-8 (решение плана в рамках правила) | задача 25 |
| Образы CI — текст `.gitlab-ci.yml` и `.github/workflows/*`; тег учитывается, только если содержит точку или букву (`postgres:5432` — не образ) | prd §3.8; эталон BFF `image-tags.spec.ts` | задача 25 |
| Правил `--import`, `REPLICA_ID`, `stop_grace_period` в эталонах нет — они новые по PRD. Текущие O/P/I их нарушат: это выравнивание §10, не дефект пакета | prd §3.8, §10; разведка эталонов | — |
| `[ASSUMPTION]` §3.8 `workerScope` (формат `tenant`) и §6 (состав колонок) — этапы E4/E5, на E1 не влияют | prd §3.8, §6 | — |
| `[OPEN]` §11 п. 1–3 — после E5 или по замеру; на E1 не влияют | prd §11 | — |

Опорный реальный артефакт:
- фикстура `test/fixtures/repo-conventions/valid/` повторяет реальные формы O: `compose.production.yml` (`stop_grace_period`, `REPLICA_ID`), `Dockerfile` (exec- и `sh -c`-формы `CMD`), `compose.e2e.yml` (подделка `fake-services.main.ts`), `.gitlab-ci.yml` (переменные образов);
- проект-потребитель проверяет пакет на упакованном архиве, а не на исходниках.

## Architecture and Decisions
- Паттерн — `.ai-factory/ARCHITECTURE.md` (подпути по слоям). В E1 есть только `src/internal` (без точки входа), `src/config`, `src/testing`.
- `src/internal/peer.ts` (`loadPeer`) и `src/internal/service-name.ts` создаются в E1 и переиспользуются следующими этапами. Повторно их не создавать (skill-context «Check Shared Infrastructure»).
- Тесты: U — `test/unit/<подпуть>`, I — `test/integration/<подпуть>` (globalSetup пакета на собственном `startTestStack`), T — `test/timing/<подпуть>`, R и C — `test/package` (запуск из `pnpm pack:check` после `pnpm build`).
- Makefile, CI и Docker в этап не входят. Все команды — скрипты pnpm.
- Внешние API (`@nestjs/config` 12, zod 4, Vitest 5 `provide`/`typecheck`/`projects`, testcontainers 12, `yaml` 2.9, typescript-eslint `no-restricted-imports`, ESLint `lintText`) сверяются через Context7 перед кодом (skill-context `/aif-implement`).
- Слоёв сервиса из `nestjs-specialist` нет. Компоненты — `nestjs-code generic <path>`, тесты — `nestjs-code test <unit|integration> <target>`. Обоснование: «компонент библиотеки, не сервиса». CLAUDE.md модулей (`nestjs-generate-documentation`) не генерируются: у библиотеки нет `src/modules/`.

## Phase Index
1. [Фаза 1: Каркас пакета](phase-01-scaffold.md) — Tasks 1–6
2. [Фаза 2: Подпуть `/config`](phase-02-config.md) — Tasks 7–12
3. [Фаза 3: Основа `/testing`](phase-03-testing-base.md) — Tasks 13–21
4. [Фаза 4: `assertRepoConventions`](phase-04-repo-conventions.md) — Tasks 22–25
5. [Фаза 5: Архив, потребитель, публикация, lint](phase-05-package-release.md) — Tasks 26–32
6. [Фаза 6: Документы](phase-06-docs.md) — Tasks 33–36

## Cross-Phase Dependencies
- Задачи 7–12 зависят от 1–5: манифест, конфиги, lint, `vitest.config.ts`.
- Задача 16 зависит от задачи 5 (`loadPeer`, `assertServiceName`) и задачи 13.
- Задача 23 зависит от задачи 7 (`envBase` — признак приложения), задач 13 и 17.
- Задача 28 копирует фикстуру задачи 24 в потребителя. Задачи 29–32 требуют `pnpm build`: `src/config` и `src/testing` полностью готовы после фаз 2–4.
- Задача 29 зависит от задач 9 и 23: `pnpm build` в `pack:check` собирает готовые `src/config` и `src/testing`.
- Задача 29 создаёт временные `README.md`/`CHANGELOG.md`. Задачи 33–34 заменяют их, задача 35 проверяет.
- Задача 36 — финальная проверка всего этапа.

## Tasks

### Фаза 1: Каркас пакета
- [x] Task 1: Манифест пакета и установка зависимостей ([details](phase-01-scaffold.md#task-1-манифест-пакета-и-установка-зависимостей))
- [x] Task 2: TypeScript, Prettier и игнор-файлы ([details](phase-01-scaffold.md#task-2-typescript-prettier-и-игнор-файлы)) (depends on 1)
- [x] Task 3: ESLint — стиль, границы подпутей и правила AC-9.4 ([details](phase-01-scaffold.md#task-3-eslint--стиль-границы-подпутей-и-правила-ac-94)) (depends on 1, 2)
- [x] Task 4: Конфиг Vitest уровня U и `TEST_TIMEOUT_SCALE` ([details](phase-01-scaffold.md#task-4-конфиг-vitest-уровня-u-и-test_timeout_scale)) (depends on 2)
- [x] Task 5: Внутренние функции `loadPeer` и формат имени сервиса ([details](phase-01-scaffold.md#task-5-внутренние-функции-loadpeer-и-формат-имени-сервиса)) (depends on 4)
- [x] Task 6: Тест манифеста (NFR-1, NFR-3, форма `exports` AC-1.1) ([details](phase-01-scaffold.md#task-6-тест-манифеста-nfr-1-nfr-3-форма-exports-ac-11)) (depends on 1, 4)

### Фаза 2: Подпуть `/config`
- [x] Task 7: Помощники и фрагменты окружения ([details](phase-02-config.md#task-7-помощники-и-фрагменты-окружения)) (depends on 3, 4)
- [x] Task 8: `parseEnv`, `InvalidEnvironmentError`, `withBaseChecks`, `defineEnv`, схемы CLI ([details](phase-02-config.md#task-8-parseenv-invalidenvironmenterror-withbasechecks-defineenv-схемы-cli)) (depends on 7)
- [x] Task 9: `KitConfigModule` и публичный `index.ts` ([details](phase-02-config.md#task-9-kitconfigmodule-и-публичный-indexts)) (depends on 8)
- [x] Task 10: Тесты разбора окружения — AC-1.3, AC-1.4, AC-1.5, AC-1.11 и помощники ([details](phase-02-config.md#task-10-тесты-разбора-окружения--ac-13-ac-14-ac-15-ac-111-и-помощники)) (depends on 9)
- [x] Task 11: Тест типов AC-1.6 ([details](phase-02-config.md#task-11-тест-типов-ac-16)) (depends on 9)
- [x] Task 12: Тест `KitConfigModule` — AC-1.7 ([details](phase-02-config.md#task-12-тест-kitconfigmodule--ac-17)) (depends on 9)

### Фаза 3: Основа `/testing`
- [x] Task 13: `TEST_IMAGES` ([details](phase-03-testing-base.md#task-13-test_images)) (depends on 4)
- [x] Task 14: `tcpProxy` ([details](phase-03-testing-base.md#task-14-tcpproxy)) (depends on 4)
- [x] Task 15: `timingGuard` ([details](phase-03-testing-base.md#task-15-timingguard)) (depends on 4)
- [x] Task 16: `startTestStack` ([details](phase-03-testing-base.md#task-16-startteststack)) (depends on 5, 13)
- [x] Task 17: `src/testing/index.ts` (экспорты E1, часть 1) ([details](phase-03-testing-base.md#task-17-srctestingindexts-экспорты-e1-часть-1)) (depends on 13, 14, 15, 16)
- [x] Task 18: Конфиги Vitest уровней I и T, globalSetup пакета ([details](phase-03-testing-base.md#task-18-конфиги-vitest-уровней-i-и-t-globalsetup-пакета)) (depends on 15, 16)
- [x] Task 19: Unit-тесты `startTestStack` ([details](phase-03-testing-base.md#task-19-unit-тесты-startteststack)) (depends on 16)
- [x] Task 20: Integration-тесты AC-1.12 и AC-1.13 ([details](phase-03-testing-base.md#task-20-integration-тесты-ac-112-и-ac-113)) (depends on 18)
- [x] Task 21: Timing-тест `tcpProxy` ([details](phase-03-testing-base.md#task-21-timing-тест-tcpproxy)) (depends on 14, 18)

### Фаза 4: `assertRepoConventions`
- [x] Task 22: Чтение файлов репозитория сервиса ([details](phase-04-repo-conventions.md#task-22-чтение-файлов-репозитория-сервиса)) (depends on 13)
- [x] Task 23: Правила и `assertRepoConventions` ([details](phase-04-repo-conventions.md#task-23-правила-и-assertrepoconventions)) (depends on 7, 17, 22)
- [x] Task 24: Фикстура эталонного репозитория сервиса ([details](phase-04-repo-conventions.md#task-24-фикстура-эталонного-репозитория-сервиса)) (depends on 2, 3)
- [x] Task 25: Тесты AC-1.8 ([details](phase-04-repo-conventions.md#task-25-тесты-ac-18)) (depends on 23, 24)

### Фаза 5: Архив, потребитель, публикация, lint
- [x] Task 26: `scripts/publish.mjs` ([details](phase-05-package-release.md#task-26-scriptspublishmjs)) (depends on 1)
- [x] Task 27: Конфиг уровня R/C и помощники упаковки ([details](phase-05-package-release.md#task-27-конфиг-уровня-rc-и-помощники-упаковки)) (depends on 4, 24)
- [x] Task 28: Шаблоны проектов-потребителей ([details](phase-05-package-release.md#task-28-шаблоны-проектов-потребителей)) (depends on 9, 17, 23, 27)
- [x] Task 29: Тест архива — AC-1.1 ([details](phase-05-package-release.md#task-29-тест-архива--ac-11)) (depends on 9, 23, 27)
- [x] Task 30: Тест проектов-потребителей — AC-9.1, AC-1.1 (условие), AC-1.2 (C) ([details](phase-05-package-release.md#task-30-тест-проектов-потребителей--ac-91-ac-11-условие-ac-12-c)) (depends on 28, 29)
- [x] Task 31: Тест `publish.mjs` — AC-1.10 (часть) ([details](phase-05-package-release.md#task-31-тест-publishmjs--ac-110-часть)) (depends on 26, 27)
- [x] Task 32: Правила lint AC-9.4 на фикстуре ([details](phase-05-package-release.md#task-32-правила-lint-ac-94-на-фикстуре)) (depends on 3, 27)

### Фаза 6: Документы
- [x] Task 33: README.md ([details](phase-06-docs.md#task-33-readmemd)) (depends on 29)
- [x] Task 34: CHANGELOG.md, docs/releasing.md, docs/testing.md ([details](phase-06-docs.md#task-34-changelogmd-docsreleasingmd-docstestingmd)) (depends on 29)
- [x] Task 35: Тест документов — AC-9.3, NFR-6 ([details](phase-06-docs.md#task-35-тест-документов--ac-93-nfr-6)) (depends on 33, 34)
- [x] Task 36: Синхронизация контекста ИИ и финальная проверка этапа ([details](phase-06-docs.md#task-36-синхронизация-контекста-ии-и-финальная-проверка-этапа)) (depends on 35)

## Traceability

| Требование | Задачи | Тест (файл / название) |
|---|---|---|
| AC-1.1 | 1, 6, 29, 30 | `test/unit/package/package-manifest.spec.ts` «AC-1.1: exports …»; `test/package/ac-1-1-package.spec.ts` «AC-1.1: publint / attw / состав архива / dist не импортирует testing»; `test/package/ac-9-1-consumer.spec.ts` «AC-1.1: /testing без условия development …», «AC-1.1: с условием development …», «AC-1.1: типы пакета …» |
| AC-1.2 | 5, 16, 30 | `test/unit/internal/ac-1-2-load-peer.spec.ts` «AC-1.2: …» (4 случая); `test/package/ac-9-1-consumer.spec.ts` «AC-1.2: без pg и testcontainers …» |
| AC-1.3 | 8, 10 | `test/unit/config/ac-1-3-parse-env.spec.ts` «AC-1.3: …» |
| AC-1.4 | 8, 10 | `test/unit/config/ac-1-4-base-checks.spec.ts` «AC-1.4: …» |
| AC-1.5 | 7, 10 | `test/unit/config/ac-1-5-defaults.spec.ts` «AC-1.5: умолчания», «AC-1.5: DB_POOL_ACQUIRE_TIMEOUT_MS = 0 …» |
| AC-1.6 | 8, 11 | `test/unit/config/ac-1-6-define-env.test-d.ts` «AC-1.6: …» |
| AC-1.7 | 9, 12 | `test/unit/config/ac-1-7-kit-config-module.spec.ts` «AC-1.7: …» |
| AC-1.8 | 22–25 | `test/unit/testing/ac-1-8-repo-conventions.spec.ts` «AC-1.8: …» (27 случаев + монорепозиторий) |
| AC-1.10 (часть) | 26, 31 | `test/package/ac-1-10-publish.spec.ts` «AC-1.10: …» (4 случая) |
| AC-1.11 | 7, 10 | `test/unit/config/ac-1-11-service-urls.spec.ts` «AC-1.11: …» |
| AC-1.12 | 16, 19, 20 | `test/unit/testing/start-test-stack.spec.ts` «AC-1.12: без флагов …»; `test/integration/testing/ac-1-12-mailpit-minio.spec.ts` «AC-1.12: …» |
| AC-1.13 | 16, 18, 20 | `test/integration/testing/ac-1-13-postgres.spec.ts` «AC-1.13: …» |
| AC-9.1 | 27, 28, 30 | `test/package/ac-9-1-consumer.spec.ts` «AC-9.1: проект-потребитель проходит свои тесты …»; `test/consumer/minimal/src/consumer.spec.ts` «AC-9.1: …» |
| AC-9.3 | 33, 34, 35 | `test/package/ac-9-3-docs.spec.ts` «AC-9.3: …» |
| AC-9.4 | 3, 32 | `test/package/ac-9-4-lint-rules.spec.ts` «AC-9.4: …» |
| §3.1 (помощники, envCrypto, envSentry, CLI-схемы) | 7, 8, 10 | `test/unit/config/helpers.spec.ts`, `env-crypto.spec.ts`, `cli-schemas.spec.ts`, `ac-1-5-defaults.spec.ts` «§3.1: …» |
| §3.8 E1 (`TEST_IMAGES`, `tcpProxy`, `timingGuard`, `TEST_TIMEOUT_SCALE`) | 4, 13, 14, 15, 21 | `test/unit/testing/test-images.spec.ts`, `tcp-proxy.spec.ts`, `timing-guard.spec.ts`, `timeout-scale.spec.ts`, `test/timing/testing/tcp-proxy-delay.spec.ts` «§3.8: …» |
| NFR-1, NFR-3 | 1, 6 | `test/unit/package/package-manifest.spec.ts` «NFR-1: …», «NFR-3: …» |
| NFR-4 | 8, 10, 25, 30 | значения не в тексте ошибок (AC-1.3, AC-1.11, env-crypto, AC-1.8 «значения окружения не в тексте»); `/testing` без `development` не разрешается (AC-1.1) |
| NFR-6 | 26, 34, 35 | `test/package/ac-9-3-docs.spec.ts` «NFR-6: docs/releasing.md …» |
| NFR-8 | 3, 32, 36 | `test/package/ac-9-4-lint-rules.spec.ts` (no-console); задача 36 `grep console.` |
| NFR-9 | 5, 8, 23 | тексты ошибок по-русски в AC-1.2, AC-1.3, AC-1.8 |
| P0, G1, G3, G13, G14 | 1, 6, 23, 26, 34 | манифест (один пакет с подпутями, peer); `RENAMED_ENV_KEYS` без псевдонимов; publish только по тегу; правила G14 в `docs/releasing.md` |
| UC-1 (часть E1) | 7–12, 23, 28 | AC-1.1, 1.2, 1.5, 1.6, 1.8, 1.11, 9.1 |
| UC-3 (часть E1) | 8, 10, 12 | AC-1.3, 1.4, 1.7 |
| UC-14 (часть E1) | 16, 20 | AC-1.12, 1.13 |
| UC-16 (часть E1) | 26, 29, 31, 34 | AC-1.1, 1.10 (часть), 9.3 |

## Commit Plan
- **Commit 1** (после задач 1–6): `chore: каркас пакета @verdeect/kit — манифест, tsconfig, eslint, vitest, loadPeer`
- **Commit 2** (после задач 7–12): `feat(config): подпуть /config — фрагменты окружения, defineEnv, parseEnv, KitConfigModule`
- **Commit 3** (после задач 13–21): `feat(testing): TEST_IMAGES, startTestStack, tcpProxy, timingGuard, конфиги I и T`
- **Commit 4** (после задач 22–25): `feat(testing): assertRepoConventions — правила §3.8 и фикстуры AC-1.8`
- **Commit 5** (после задач 26–32): `test(package): архив, проекты-потребители, publish.mjs, правила lint AC-9.4`
- **Commit 6** (после задач 33–36): `docs: README, CHANGELOG 1.0.0, releasing, testing; синхронизация AGENTS и контекста ИИ`

## Definition of Done
- Все AC скоупа имеют зелёный тест из таблицы Traceability.
- Зелёные: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:timing` (на тихой машине), `pnpm pack:check`.
- `package.json`: `version 1.0.0`; `exports` — только `./config`, `./testing`, `./package.json`; peer — ровно NFR-3 v1.7.
- В `src/**` нет `console.*`, имён схем и таблиц сервисов, статических импортов опциональных peer.
- Публикации нет: `1.0.0` выпускает мейнтейнер вручную после 5.1a.
- Репозитории сервисов не изменены.
