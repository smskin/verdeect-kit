# Фаза 4: `assertRepoConventions`

Plan: [index.md](index.md)
Tasks: 22–25
Depends on: Phase 2 (Task 7 — `envBase`), Phase 3 (Tasks 13, 17)

## Цель

`assertRepoConventions({root})` проверяет репозиторий сервиса по всем правилам §3.8 PRD v1.7. После `1.0.0` новое правило — мажор (G14, CE-1). Эталонная фикстура проходит. Каждая фикстура с нарушением падает с названием правила (AC-1.8).

## Свидетельства из кода (эталоны, только чтение)

Пути — `/home/administrator/projects/verdeect2/…`.

| Путь | Что берём |
|---|---|
| `verdeect-orchestrator/apps/orchestrator/test/support/compose-env.spec.ts` (47 строк) | разбор compose через `yaml` 2.9.1: `parse(text, { merge: true, customTags: [{ tag: '!reset', resolve: () => null }] })`; `environment` сервиса как карта |
| `verdeect-bff/apps/bff/test/image-tags.spec.ts` (45 строк) | сравнение тегов по тексту regex `(?<![\w/-])(redis\|rabbitmq):(\d+\.\d+\.\d+[\w.-]*)`; сбор `missing`/`mismatches` в один `expect` |
| `verdeect-orchestrator/apps/orchestrator/test/support/images.spec.ts` (44 строки) | образы CI из `.gitlab-ci.yml` по переменным `^\s+<VAR>:\s*(\S+)`; образы compose — `image:` всех `compose*.yml` в корне |
| `verdeect-platform/apps/platform/src/shared/config/ac-6-1-production-compose.spec.ts` (65 строк) | только чтение compose как текста; правил `--import`, `REPLICA_ID`, `stop_grace_period` в эталонах нет: они новые (PRD §3.8) |
| `verdeect-orchestrator/compose.production.yml` | `stop_grace_period: 15s` (стр. 44), `REPLICA_ID: ${REPLICA_ID:-}` (стр. 51) — реальная форма, которая станет нарушением `replica-id` (выравнивание §10) |
| `verdeect-orchestrator/Dockerfile` | prod `CMD ["node", "--enable-source-maps", "dist/main.js"]` (стр. 84); dev — `sh -c "pnpm build && node --watch … dist/main.js"` (стр. 54) |
| `verdeect-orchestrator/compose.e2e.yml` стр. 363–411 | `command: ['node', '--import', './test/p/fakes/register.mjs', 'test/p/fakes/fake-services.main.ts']` — подделка, не проверяется |

## Правила (PRD v1.7 §3.8, AC-1.8)

| ID правила | Что проверяется | Где | Какие сервисы |
|---|---|---|---|
| `test-images` | образ репозитория из `TEST_IMAGES` (postgres, redis, rabbitmq, axllent/mailpit, pgsty/minio) — ровно с тегом `TEST_IMAGES` | `image:` сервисов во всех compose-файлах; текст CI-файлов | все |
| `replica-id` | `REPLICA_ID` не задан | `environment:` и `env_file:` | все |
| `stop-grace-period` | `stop_grace_period` > `SHUTDOWN_TIMEOUT_MS` | compose | приложения |
| `env-keys` | нет старых ключей: `IDENTITY_PORT`, `BFF_PORT` → `PORT`; `DATABASE_MIGRATION_URL` → `DATABASE_MIGRATOR_URL`; `SESSION_ENC_KEYS`, `SIGNING_KEY_ENCRYPTION_KEYS`, `CLIENT_SECRET_KEY`, `IDENTITY_SECRETS` → `ENCRYPTION_KEYS` | `environment:` и `env_file:` | приложения |
| `peer-versions` | у peer пакета в манифесте сервиса — точная версия в peer-диапазоне `@verdeect/kit` | `package.json` с зависимостью `@verdeect/kit` | — |
| `instrument-import` | команда запуска приложения содержит `--import` со значением, где есть `instrument` | `command:` приложений, Dockerfile `CMD`/`ENTRYPOINT`, `scripts.start` | команды запуска приложения |
| `redaction-imports` | `src/redaction.ts` импортирует только типы из `@verdeect/kit/observability` | `src/redaction.ts`, `apps/*/src/redaction.ts` | — |

Определения:
- **Приложение** — сервис compose, у которого в `environment:` или в файлах `env_file:` есть хотя бы один ключ `Object.keys(envBase)`: `NODE_ENV`, `LOG_LEVEL`, `PORT`, `METRICS_PORT`, `REPLICA_ID`, `SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_DRAIN_MS`.
- **Команда запуска приложения** — команда `node`, у которой имя файла входа (basename) ровно `main.js` или `main.ts`.

## Task 22: Чтение файлов репозитория сервиса

**Skill:** nestjs-code generic src/testing/repo-files.ts (CREATE)

### Назначение
Отделяет поиск и разбор файлов (compose, env_file, CI, Dockerfile, package.json, redaction) от правил. Всё синхронно: `readFileSync`/`readdirSync`.

### Шаги
1. Поиск файлов относительно `root`:
   - compose: файлы корня по `/^(docker-)?compose(\.[\w-]+)*\.ya?ml$/`;
   - CI: `.gitlab-ci.yml`, `.github/workflows/*.yml`, `.github/workflows/*.yaml`;
   - Dockerfile: файлы корня и `apps/*/` по `/^Dockerfile(\.[\w-]+)?$/`;
   - манифесты: `package.json` в корне, `apps/*/package.json`, `packages/*/package.json`;
   - redaction: `src/redaction.ts`, `apps/*/src/redaction.ts`.

   Отсутствующий каталог — пустой список.
2. Разбор compose:
   ```ts
   const CUSTOM_TAGS = ['!reset', '!override'].flatMap((tag) => [
       { tag, resolve: (v: unknown) => (tag === '!reset' ? null : v) },
       { tag, collection: 'map' as const, resolve: (v: unknown) => (tag === '!reset' ? null : v) },
       { tag, collection: 'seq' as const, resolve: (v: unknown) => (tag === '!reset' ? null : v) },
   ]);
   parse(text, { merge: true, customTags: CUSTOM_TAGS })
   ```
   Формат `customTags` с `collection` для `yaml` 2.9.1 сверить через Context7. Результат — `ComposeService[]`:
   ```ts
   interface ComposeService {
       readonly file: string;            // путь относительно root
       readonly name: string;
       readonly image: string | null;
       readonly env: ReadonlyMap<string, string | null>;   // environment ∪ env_file; null — ключ без значения
       readonly envSource: ReadonlyMap<string, string>;     // ключ → файл, где он задан (compose или env-файл)
       readonly stopGracePeriod: string | null;
       readonly command: readonly string[] | null;          // токены
   }
   ```
   - `environment` — карта (`KEY: value`) или список (`KEY=value` / `KEY`). Значения — строки; числа привести `String(v)`.
   - `env_file` — строка, массив строк или массив `{path, required?}`. Путь — относительно каталога compose-файла. Несуществующий файл пропускается.
   - Разбор env-файла: строки `KEY=VALUE`; `#`-комментарии и пустые строки пропускаются; префикс `export ` снимается; кавычки `'…'`/`"…"` у значения снимаются.
   - Ключи `environment` перекрывают `env_file`.
3. Токенизация команды `tokenize(command: string | readonly string[]): string[]`:
   - массив берётся как есть;
   - строка делится по пробелам с учётом кавычек `'…'` и `"…"`;
   - конструкция `sh -c "<строка>"` / `bash -c` раскрывается рекурсивно;
   - в shell-строке команды разделяются по `&&`, `||`, `;`. Результат — список команд (`string[][]`).
4. Dockerfile:
   - склеить строки с `\` на конце;
   - найти инструкции `CMD` и `ENTRYPOINT` (без учёта регистра);
   - exec-форма (`[...]`) — `JSON.parse`, shell-форма — строка в `tokenize`.
5. Распознавание запуска:
   ```ts
   /** Входной файл node-команды или null; опции со значением: --import, --require, -r, --loader, --env-file, --conditions, -C. */
   export function nodeEntry(tokens: readonly string[]): { entry: string; imports: string[] } | null
   ```
   - Ищется токен с basename `node`. Дальше — опции, начинающиеся с `-`: форма `--x=v` значение не съедает, перечисленные опции без `=` съедают следующий токен. Первый токен без `-` — файл входа.
   - `imports` — значения `--import`.
   - Команда запуска приложения: `basename(entry)` ∈ {`main.js`, `main.ts`}.
6. CI-образы. Текст CI-файла, regex для каждого репозитория `R` из `TEST_IMAGES`:
   ```
   (?<![\w./@-])${escape(R)}:([A-Za-z0-9][\w.-]*)
   ```
   Учитываются только теги с точкой или буквой. Так `postgres:5432` в адресах не считается образом, а `@postgres:5432` отсекается lookbehind.

   Перед поиском — и в тексте CI, и в значениях `image:` compose — интерполяции `${VAR:-default}` и `${VAR-default}` заменяются на `default`: `text.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}/g, '$1')`. Иначе lookbehind по `-` пропустит `image: ${POSTGRES_IMAGE:-postgres:16.15-alpine3.24}`. Функция `expandDefaults(text)` экспортируется из `repo-files.ts` для правил и тестов.
7. Манифесты: `JSON.parse`; поля `dependencies`, `devDependencies`, `scripts.start`.
8. Пути в сообщениях — относительно `root`, через `/`.

### Ошибки и логи
Ошибка разбора YAML или JSON — исключение с именем файла: `assertRepoConventions: не удалось разобрать <файл>: <сообщение парсера>`. Логов нет.

### Тесты
Через задачу 25. Отдельные unit-тесты разбора:
- `test/unit/testing/repo-files.spec.ts` — `tokenize` (`sh -c` с `&&`, кавычки);
- `nodeEntry`: `--import=x`, `--watch`, `--inspect=0.0.0.0:9229`, `-r x`, `fake-services.main.ts` → не приложение;
- env-файл (кавычки, `export`, комментарии);
- CI regex (`postgres:5432` не образ);
- `expandDefaults`: `${X:-a:b}` → `a:b`, `${X-a}` → `a`, `${X}` без умолчания не меняется.

### Критерии приёмки и проверка
- `pnpm test` — зелёный.

## Task 23: Правила и `assertRepoConventions`

**Skill:** nestjs-code generic src/testing/repo-conventions.ts (CREATE); nestjs-code generic src/testing/index.ts (MODIFY)

### Назначение
Один тест репозитория сервиса: правила `01` §11 исполняются кодом (§1 п. 3, §3.8).

### Шаги
1. Сигнатура:
   ```ts
   /** Параметры assertRepoConventions (§3.8). */
   export interface RepoConventionsOptions { readonly root: string }
   /** Проверяет репозиторий сервиса по правилам §3.8; при нарушениях бросает ошибку со списком. */
   export function assertRepoConventions(options: RepoConventionsOptions): void
   ```
2. Peer-диапазоны пакета: `JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url))))`. Путь верен и из `src/testing/`, и из `dist/testing/`. Берётся `peerDependencies`.
3. Правила вызываются по порядку таблицы. Каждое возвращает `Violation[]` вида `{ rule, file, detail }`:
   - **test-images**:
     - для каждого compose-сервиса с `image`: применить `expandDefaults(image)`, затем найти репозиторий из `TEST_IMAGES` тем же regex, что для CI. Если тег ≠ тегу `TEST_IMAGES` → `detail: сервис <name> — образ <repo>:<tag>, ожидается <TEST_IMAGES[...]>`;
     - для каждого CI-файла — то же по тексту, `detail: образ <repo>:<tag>, ожидается …`.
   - **replica-id**: любой сервис с ключом `REPLICA_ID` → `file` = `envSource.get('REPLICA_ID')`, `detail: сервис <name> задаёт REPLICA_ID — не задавайте, умолчание — hostname()`.
   - **stop-grace-period** (только приложения):
     - срок остановки `shutdownMs`: значение `SHUTDOWN_TIMEOUT_MS` того же сервиса — целое число; или `${NAME:-N}` / `${NAME-N}` → N; иначе 10000 (умолчание `envBase`);
     - `graceMs`: `stop_grace_period` в том же файле. Если его нет — значение одноимённого сервиса в `compose.yml` (база); если и там нет — 10 000 (умолчание Docker, 10 с);
     - разбор длительности Docker: последовательность `(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)`; нераспознанное значение — нарушение `stop_grace_period «…» не распознан`;
     - условие нарушения `graceMs <= shutdownMs` → `detail: сервис <name> — stop_grace_period <graceMs> мс ≤ SHUTDOWN_TIMEOUT_MS <shutdownMs> мс (нужно 15s при 10000)`.
   - **env-keys** (только приложения):
     ```ts
     const RENAMED_ENV_KEYS = {
         IDENTITY_PORT: 'PORT', BFF_PORT: 'PORT', DATABASE_MIGRATION_URL: 'DATABASE_MIGRATOR_URL',
         SESSION_ENC_KEYS: 'ENCRYPTION_KEYS', SIGNING_KEY_ENCRYPTION_KEYS: 'ENCRYPTION_KEYS',
         CLIENT_SECRET_KEY: 'ENCRYPTION_KEYS', IDENTITY_SECRETS: 'ENCRYPTION_KEYS',
     } as const;
     ```
     `detail: сервис <name> — ключ <старый>, используйте <новый>`; `file` — из `envSource`.
   - **peer-versions**: для каждого манифеста, где есть `@verdeect/kit` (в `dependencies` или `devDependencies`), для каждого peer пакета из этих полей:
     - `semver.valid(v) === null` → `<имя> <v> — нужна точная версия`;
     - `!semver.satisfies(v, range)` → `<имя> <v> вне диапазона <range> пакета @verdeect/kit`.
   - **instrument-import**. Источники команд:
     - `command:` приложений;
     - все `CMD`/`ENTRYPOINT` найденных Dockerfile;
     - `scripts.start` каждого манифеста с `@verdeect/kit`.

     Для каждой команды запуска приложения без `--import`, значение которого содержит `instrument`, → `detail: <источник> «<команда через пробел>» — нет --import …instrument`. Источник: `сервис <name>`, `CMD`, `ENTRYPOINT`, `scripts.start`.
   - **redaction-imports**:
     - снять комментарии: `/\/\*[\s\S]*?\*\//g`, затем `/(^|[^:])\/\/.*$/gm`;
     - каждое вхождение `\bimport\b` или `\bexport\b … from` либо `require(` разобрать;
     - разрешено только `import type { … } from '@verdeect/kit/observability'` (одинарные или двойные кавычки);
     - иначе → `detail: импорт <спецификатор или фрагмент> — разрешены только типы из @verdeect/kit/observability`.
4. Если нарушения есть:
   ```ts
   throw new Error(`assertRepoConventions: нарушены правила (${n}):\n` + violations.map((v) => `- [${v.rule}] ${v.file}: ${v.detail}`).join('\n'));
   ```
   Сообщения сортируются по порядку правил, затем по файлу.
5. `src/testing/index.ts`: добавить `export { assertRepoConventions } from './repo-conventions.js'`.

### Контракты
- Набор правил и `RENAMED_ENV_KEYS` после `1.0.0` расширяется только мажором (G14).
- Подделки (`*.main.ts`, кроме ровно `main.ts`) и инфраструктурные сервисы правилами `stop-grace-period`, `env-keys`, `instrument-import` не проверяются (v1.7).

### Ошибки и логи
Одно исключение со всеми нарушениями. Значения переменных окружения в сообщение не попадают, кроме `stop_grace_period` и чисел срока. Логов нет.

### Тесты
Задача 25.

### Критерии приёмки и проверка
- `pnpm typecheck`, `pnpm lint` — код 0.

## Task 24: Фикстура эталонного репозитория сервиса

**Skill:** none — тестовые данные (`test/fixtures/repo-conventions/valid/**`, не компилируются и не линтятся)

### Шаги
Создать `test/fixtures/repo-conventions/valid/`:
1. `compose.yml`:
   - `app`: `build: .`, `environment: {NODE_ENV: production, METRICS_PORT: "9100", SHUTDOWN_TIMEOUT_MS: "10000", DATABASE_URL: "postgres://app:secret@db:5432/app"}`, `stop_grace_period: 15s`, `command: ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]`;
   - `worker`: `build: .`, `env_file: ./app.env`, `stop_grace_period: 15s`, `command: node --import ./dist/instrument.js dist/main.js`;
   - `db`: `image: postgres:17.11-alpine3.24`, `environment: {POSTGRES_PASSWORD: secret}` — инфраструктура;
   - `mail`: `image: axllent/mailpit:v1.31.6`.
2. `app.env`: `# окружение worker` и `LOG_LEVEL=info`, `SHUTDOWN_TIMEOUT_MS=10000`.
3. `compose.e2e.yml`:
   - `fakes`: `build: .`, `environment: {NODE_ENV: test}`, `command: ["node", "--import", "./test/fakes/register.mjs", "test/fakes/fake-services.main.ts"]`;
   - `broker`: `image: rabbitmq:4.3.6-management-alpine`.
4. `.gitlab-ci.yml`: `variables: { POSTGRES_IMAGE: postgres:17.11-alpine3.24, DATABASE_URL: "postgres://u:p@postgres:5432/db" }`, `test: { services: [ { name: "redis:7.4.11-alpine" } ], script: [ "pnpm test" ] }`.
5. `Dockerfile`:
   ```dockerfile
   FROM node:24-alpine AS dev
   CMD ["sh", "-c", "pnpm build && node --watch --import ./dist/instrument.js dist/main.js"]
   FROM node:24-alpine AS prod
   CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]
   ```
6. `package.json`:
   - `name: "svc-fixture"`, `private: true`;
   - `scripts.start: "node --enable-source-maps --import ./dist/instrument.js dist/main.js"`;
   - `dependencies: {"@verdeect/kit": "1.0.0", "@nestjs/common": "12.1.3", "@nestjs/core": "12.1.3", "@nestjs/config": "12.0.1", "zod": "4.6.7"}`;
   - `devDependencies: {"testcontainers": "12.2.1", "vitest": "5.0.4"}`.
7. `src/redaction.ts`:
   ```ts
   // Набор редактирования сервиса (комментарий с import x from './y.js' не проверяется)
   import type { KitRedaction } from '@verdeect/kit/observability';
   export const redaction: KitRedaction = { sensitiveKeys: ['inn'] };
   ```
   Каталог исключён из tsconfig, eslint и prettier (задачи 2–3), поэтому несуществующий подпуть `/observability` компиляции не мешает.

### Критерии приёмки и проверка
- `assertRepoConventions({root: <valid>})` проходит (задача 25).

## Task 25: Тесты AC-1.8

**Skill:** nestjs-code test unit testing/repo-conventions (CREATE)

### Шаги
1. `test/unit/testing/ac-1-8-repo-conventions.spec.ts`. Помощник:
   ```ts
   function withFixture(mutate: (dir: string) => void): string
   ```
   `mkdtempSync(join(tmpdir(), 'kit-repo-'))`, `cpSync(VALID, dir, { recursive: true })`, затем `mutate(dir)`. Каталоги удаляются в `afterEach`.

   `edit(dir, file, from, to)` заменяет ровно одно вхождение. Если вхождения нет — `expect.fail`, чтобы фикстура не дрейфовала молча.
2. `expectViolation(dir, rule, file)`: `expect(() => assertRepoConventions({ root: dir })).toThrow(...)`, сообщение содержит `[${rule}] ${file}`.
3. Случаи (каждый — `it`, название с `AC-1.8:`):

   | Название | Мутация | Ожидание |
   |---|---|---|
   | эталонная фикстура проходит | — | без ошибки |
   | образ не из TEST_IMAGES в compose | `db` → `postgres:16.15-alpine3.24` | `[test-images] compose.yml` |
   | образ не из TEST_IMAGES в CI | `POSTGRES_IMAGE` → `postgres:16.15-alpine3.24` | `[test-images] .gitlab-ci.yml` |
   | адрес postgres:5432 в CI — не образ | — (эталон содержит) | без ошибки |
   | образ через интерполяцию вне TEST_IMAGES | `db.image` → `${POSTGRES_IMAGE:-postgres:16.15-alpine3.24}` | `[test-images] compose.yml` |
   | образ через интерполяцию с верным тегом | `db.image` → `${POSTGRES_IMAGE:-postgres:17.11-alpine3.24}` | без ошибки |
   | REPLICA_ID в compose | `app.environment.REPLICA_ID: ${REPLICA_ID:-}` | `[replica-id] compose.yml` |
   | REPLICA_ID в env_file | `app.env` + `REPLICA_ID=x` | `[replica-id] app.env` |
   | stop_grace_period ≤ SHUTDOWN_TIMEOUT_MS | `app` → `stop_grace_period: 10s` | `[stop-grace-period] compose.yml` |
   | stop_grace_period не задан (10 с по умолчанию) | удалить у `app` | `[stop-grace-period]` |
   | SHUTDOWN_TIMEOUT_MS со значением по умолчанию в интерполяции | `SHUTDOWN_TIMEOUT_MS: "${SHUTDOWN_TIMEOUT_MS:-20000}"` | `[stop-grace-period]` |
   | ключ из env_file делает сервис приложением | у `worker` удалить `stop_grace_period` | `[stop-grace-period] compose.yml` (сервис worker) |
   | ключ IDENTITY_PORT | `app.environment.IDENTITY_PORT: "3000"` | `[env-keys]`, текст `используйте PORT` |
   | ключ BFF_PORT в env_file | `app.env` + `BFF_PORT=3000` | `[env-keys] app.env` |
   | ключ SESSION_ENC_KEYS | в `app` | текст `используйте ENCRYPTION_KEYS` |
   | версия peer вне диапазона | `@nestjs/core` → `11.0.0` | `[peer-versions] package.json` |
   | версия peer не точная | `@nestjs/core` → `^12.1.3` | `[peer-versions]`, текст `нужна точная версия` |
   | команда Dockerfile без --import | prod `CMD` без `--import`, `./dist/instrument.js` | `[instrument-import] Dockerfile` |
   | команда dev-стадии через sh -c без --import | убрать `--import ./dist/instrument.js` из dev | `[instrument-import] Dockerfile` |
   | скрипт start без --import | `scripts.start` без `--import` | `[instrument-import] package.json` |
   | command: compose без --import | `app.command` без `--import` | `[instrument-import] compose.yml` |
   | инфраструктурный сервис без --import — не нарушение | `db` + `command: ["postgres", "-c", "fsync=off"]` | без ошибки |
   | подделка fake-services.main.ts без --import — не нарушение | у `fakes` убрать `--import …` | без ошибки |
   | redaction.ts импортирует модуль приложения | + `import { config } from './config.js';` | `[redaction-imports] src/redaction.ts` |
   | redaction.ts — export … from | + `export { x } from './x.js';` | `[redaction-imports]` |
   | несколько нарушений — одним списком | IDENTITY_PORT + REPLICA_ID | сообщение `нарушены правила (2)` и оба правила |
   | значения окружения не в тексте | `IDENTITY_PORT: "3000-SECRET_MARKER"` | сообщение не содержит `SECRET_MARKER` |

4. Монорепозиторий: `withFixture` переносит `package.json` и `Dockerfile` в `apps/svc/`. `[peer-versions] apps/svc/package.json` при `@nestjs/core 11.0.0`.

### Критерии приёмки и проверка
- `pnpm test -- test/unit/testing/ac-1-8` — зелёный.

## Риски фазы
- Риск: эвристика «приложение» пропускает сервис без ключей `envBase`.
  Что делать: это решение PRD v1.7. Исправление — только через PRD, и после `1.0.0` это мажор.
- Риск: снятие комментариев regex-ом в `redaction.ts` ломается на строках с `//`.
  Что делать: допустимо. `redaction.ts` — константа без строк-URL, правило проверяет только импорты.

## Чек-лист завершения фазы
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — зелёные.
- Галочки задач 22–25 в `index.md` обновлены.
