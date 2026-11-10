# Фаза 5: Архив, проект-потребитель, публикация, lint-правила

Plan: [index.md](index.md)
Tasks: 26–32
Depends on: Phases 1–4

## Цель

`pnpm pack:check` собирает пакет и проверяет архив (уровни R и C):
- publint, attw, состав архива;
- импорт подпутей и условие `development` (AC-1.1);
- проект-потребитель на архиве (AC-9.1);
- отсутствие опционального peer (AC-1.2, уровень C);
- `scripts/publish.mjs` (AC-1.10, часть);
- правила lint AC-9.4 на фикстуре.

Workflow GitHub Actions и Makefile в этап не входят. Их генерируют `/aif-ci` и `/aif-build-automation` после этапа (5.1a).

## Свидетельства из кода (образец, только чтение)

Пути — `/home/administrator/projects/verdeect2/verdeect-platform-client/…` (PC).

| Путь | Что берём |
|---|---|
| `scripts/publish.mjs` | целиком: `TAG_PATTERN = /^v\d+\.\d+\.\d+$/`, `GITHUB_REF_NAME`, `--dry-run`, `isPublished` через `spawnSync('npm', ['view', \`${name}@${version}\`, 'version', '--json'])`, отказ «уже опубликована, перезапись запрещена», `npm publish --access public`, «авторизация: OIDC (Trusted Publishing)» |
| `test/package/release.spec.ts` | подставной реестр на `node:http` `127.0.0.1:0` (`missing` → 404, `published` → packument), пустой `.npmrc` в `mkdtemp`, env `GITHUB_REF_NAME`, `npm_config_registry`, `npm_config_userconfig`, `NODE_AUTH_TOKEN=''`; случаи 1–4. Случаи 5–8 (`ci.yml`, Makefile) не переносятся: workflow — 5.1a |
| `test/package/support/pack.ts` | `REPO_ROOT`, `runCommand` (`execFile` без shell, 280 с, SIGKILL, 64 МБ, не бросает), `runOrThrow`, `packTarball()` (`pnpm pack --pack-destination <mkdtemp>`, строка `.tgz`), `removeTarball` |
| `test/package/support/consumer-project.ts` | `createConsumerProject(template, tarball)`: `mkdtemp` вне репозитория, `cp -r`, замена `file:__TARBALL__`, `pnpm install --strict-peer-dependencies` |
| `test/package/consumer.spec.ts` | `testing-import.mjs` печатает `error.code`; `node --conditions=development …` → `ok` |
| `vitest.package.config.ts` | `include test/package/**/*.spec.ts`, `fileParallelism: false`, тайм-ауты `300_000 * scale` |
| `test/consumer/full/*` | шаблон: `package.json` с точными пинами и `file:__TARBALL__`, `pnpm-workspace.yaml` (`allowBuilds`), `tsconfig.json`, `vitest.config.ts` (только swc, без условий) |

## Файлы

| Путь | Действие | Что |
|---|---|---|
| `scripts/publish.mjs` | create | публикация из CI (AC-1.10) |
| `vitest.package.config.ts` | create | уровни R и C |
| `test/package/support/pack.ts`, `test/package/support/consumer-project.ts` | create | упаковка, потребитель |
| `test/consumer/minimal/**` | create | потребитель AC-9.1 |
| `test/consumer/no-testcontainers/**` | create | потребитель без опционального peer (AC-1.2, C) |
| `test/package/ac-1-1-package.spec.ts` | create | AC-1.1 |
| `test/package/ac-9-1-consumer.spec.ts` | create | AC-9.1, AC-1.1 (условие), AC-1.2 (C) |
| `test/package/ac-1-10-publish.spec.ts` | create | AC-1.10 (часть) |
| `test/fixtures/lint/violations.ts`, `test/fixtures/lint/allowed.ts` | create | фикстуры AC-9.4 |
| `test/package/ac-9-4-lint-rules.spec.ts` | create | AC-9.4 |

## Task 26: `scripts/publish.mjs`

**Skill:** nestjs-code generic scripts/publish.mjs (CREATE)

### Шаги
1. Скопировать PC `scripts/publish.mjs`. Он не зависит от имени пакета и читает `package.json`. Шапка: `// Публикация из CI по тегу (prd.md AC-1.10, NFR-6, G13); образец — verdeect-platform-client scripts/publish.mjs.`
2. Поведение без изменений:
   - тег пуст или не `vX.Y.Z` → выход 1;
   - тег ≠ `v${version}` → выход 1 с «не совпадает»;
   - версия есть в npm → выход 1 с «уже опубликована, перезапись запрещена»;
   - ответ `npm view` не 0 и не `E404` → выход 1;
   - иначе `npm publish --access public [--dry-run]`.

   Токенов скрипт не читает (NFR-6).
3. `console.log`/`console.error` в скрипте допустимы: правило `no-console` действует только на `src/**` (AC-9.4).

### Ошибки и логи
Префикс `[publish]` в stdout. Ошибка — stderr и выход 1.

### Тесты
Задача 31.

### Критерии приёмки и проверка
- `pnpm lint` — код 0.

## Task 27: Конфиг уровня R/C и помощники упаковки

**Skill:** nestjs-code generic vitest.package.config.ts (CREATE); nestjs-code generic test/package/support/pack.ts (CREATE); nestjs-code generic test/package/support/consumer-project.ts (CREATE)

### Шаги
1. `vitest.package.config.ts`: `include: ['test/package/**/*.spec.ts']`, `environment: 'node'`, `fileParallelism: false`, `testTimeout: 300_000 * TEST_TIMEOUT_SCALE`, `hookTimeout: 600_000 * TEST_TIMEOUT_SCALE`.

   `hookTimeout` больше образца: `beforeAll` ставит два проекта-потребителя из реестра.
2. `pack.ts` — копия PC:
   - префикс временных каталогов `verdeect-kit-pack-`;
   - перед упаковкой проверяется наличие `dist/config/index.js` и `dist/testing/index.js`. Иначе — ошибка «сначала pnpm build».
3. `consumer-project.ts` — копия PC:
   - префикс `verdeect-kit-consumer-${template}-`;
   - заменяется `dependencies['@verdeect/kit']`;
   - установка `pnpm install --strict-peer-dependencies`.

   Дополнительно: если в шаблоне есть файл `repo-fixture.link`, в проект копируется `test/fixtures/repo-conventions/valid/` в `<проект>/repo-fixture/`.

### Критерии приёмки и проверка
- `pnpm typecheck` — код 0.

## Task 28: Шаблоны проектов-потребителей

**Skill:** nestjs-code generic test/consumer/minimal/src/consumer.spec.ts (CREATE); остальные файлы шаблонов — none (JSON/конфиги/mjs без логики)

### Шаги
1. `test/consumer/minimal/package.json`:
   - `"name": "verdeect-kit-consumer-minimal"`, `"private": true`, `"type": "module"`;
   - `dependencies` (точные версии, peer по NFR-3 v1.7):
     - `@verdeect/kit file:__TARBALL__`;
     - Nest: `@nestjs/common 12.1.3`, `@nestjs/core 12.1.3`, `@nestjs/config 12.0.1`, `@nestjs/platform-fastify 12.1.3`;
     - основа: `fastify 5.12.5`, `reflect-metadata 0.2.2`, `rxjs 7.8.2`, `zod 4.6.7`, `drizzle-orm 0.45.4`;
     - логи, метрики, ошибки: `nestjs-pino 5.3.1`, `pino 10.4.0`, `pino-http 11.0.0`, `prom-client 15.1.3`, `@sentry/nestjs 11.7.0`;
     - `@verdeect/auth 1.0.1`.

     `pino-http` — peer `nestjs-pino`. Если `--strict-peer-dependencies` сообщит о другом отсутствующем транзитивном peer, добавить его точной версией из `verdeect-orchestrator/apps/orchestrator/package.json`;
   - `devDependencies`: `testcontainers 12.2.1`, `vitest 5.0.4`, `typescript 5.9.3`, `@types/node 22.20.5`.
2. `test/consumer/minimal/pnpm-workspace.yaml`: `allowBuilds: {esbuild: true, cpu-features: false, protobufjs: false, ssh2: false}`.
3. `test/consumer/minimal/tsconfig.json`: NodeNext, strict, `noEmit`, `skipLibCheck: true`, как в образце: `false` проверял бы `.d.ts` сторонних пакетов (Nest, Sentry, pino) и падал бы на чужих ошибках. Ошибки в типах `@verdeect/kit` всё равно ловятся через их использование в `types-check.ts`, `types: ["node"]`, `include: ["src", "global-setup.ts", "vitest.config.ts"]`.
4. `test/consumer/minimal/vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({ test: { include: ['src/**/*.spec.ts'], globalSetup: ['./global-setup.ts'], testTimeout: 120_000, hookTimeout: 180_000 } });
   ```
   Если `@verdeect/kit/testing` в globalSetup не разрешается без условия `development`, добавить `resolve: { conditions: ['development'] }` и `ssr: { resolve: { conditions: ['development'] } }` с комментарием.
5. `test/consumer/minimal/global-setup.ts`: `import { startTestStack } from '@verdeect/kit/testing'; export default startTestStack({ service: 'consumer', postgres: true });`.
6. `test/consumer/minimal/repo-fixture.link` — пустой маркер для задачи 27.
7. `test/consumer/minimal/src/env.ts`:
   ```ts
   import { defineEnv, envBase, envDatabase, envServiceUrls, positiveInt } from '@verdeect/kit/config';
   export const envSchema = defineEnv({ ...envBase, ...envDatabase, ...envServiceUrls(['identity']), FEATURE_LIMIT: positiveInt(5) });
   ```
8. `test/consumer/minimal/src/consumer.spec.ts`:
   - `AC-9.1: defineEnv разбирает окружение с адресом PostgreSQL из startTestStack`:
     - `const url = inject('kitPostgresUrl')`;
     - `parseEnv(envSchema, { DATABASE_URL: url, SERVICE_URLS: '{"identity":"http://identity:3000"}' })` → `DATABASE_URL === url`, `PORT === 3000`, `FEATURE_LIMIT === 5`;
   - `AC-9.1: PostgreSQL из TEST_IMAGES доступен по TCP` — `new URL(url)`, `net.connect(port, host)` → событие `connect`;
   - `AC-9.1: assertRepoConventions проходит на фикстуре` — `assertRepoConventions({ root: fileURLToPath(new URL('../repo-fixture', import.meta.url)) })`;
   - `AC-9.1: InvalidEnvironmentError из пакета` — без `DATABASE_URL` → `error.code === 'INVALID_ENVIRONMENT'`, `keys` содержит `DATABASE_URL`;
   - `AC-9.1: TEST_IMAGES и TEST_TIMEOUT_SCALE доступны` — `TEST_IMAGES.postgres` начинается с `postgres:17.11`; `TEST_TIMEOUT_SCALE === 1`.
9. `test/consumer/minimal/import-check.mjs`. Печатает одну строку `config:<результат> testing:<результат>`, где результат — `ok` или `error.code ?? String(error)`:
   ```js
   async function probe(specifier, name) { try { const m = await import(specifier); return typeof m[name] === 'function' ? 'ok' : 'no-export'; } catch (error) { return error?.code ?? String(error); } }
   console.log(`config:${await probe('@verdeect/kit/config', 'defineEnv')} testing:${await probe('@verdeect/kit/testing', 'startTestStack')}`);
   ```
10. `test/consumer/minimal/types-check.ts`. Проверяется `tsc` потребителя (AC-1.1, `.d.ts`):
    - `const schema = defineEnv({ ...envBase }); const port: number = parseEnv(schema, {}).PORT;`;
    - `// @ts-expect-error` на `defineEnv({ ...envBase, PORT: z.string() })` (`z` из `zod`);
    - добавить `"types-check.ts"` в `include` tsconfig потребителя.
11. `test/consumer/no-testcontainers/package.json`: те же `dependencies`, что у minimal, без `devDependencies`. `testcontainers` и `vitest` не установлены. `pnpm-workspace.yaml` — как у minimal.
12. `test/consumer/no-testcontainers/peer-check.mjs`:
    ```js
    const results = [];
    try { await import('@verdeect/kit/config'); results.push('config:ok'); } catch (e) { results.push(`config:${e?.code ?? e}`); }
    try { await import('@verdeect/kit/testing'); results.push('testing:ok'); } catch (e) { results.push(`testing:${e?.message ?? e}`); }
    console.log(results.join('\n'));
    ```

### Критерии приёмки и проверка
- Используются в задаче 30.

## Task 29: Тест архива — AC-1.1

**Skill:** nestjs-code test unit package/ac-1-1-package (CREATE)

### Шаги
`test/package/ac-1-1-package.spec.ts`. `beforeAll` — `packTarball()`:
- `AC-1.1: publint --strict без замечаний` — `pnpm exec publint --strict` в корне, код 0; stdout не содержит `Warning`/`Error`;
- `AC-1.1: attw --profile esm-only без замечаний` — `pnpm exec attw --pack . --profile esm-only`, код 0;
- `AC-1.1: состав архива` — `tar -tzf <tgz>`. Каждая запись под `package/` ∈ {`package.json`, `README.md`, `CHANGELOG.md`, `dist/**/*.js`, `dist/**/*.d.ts`}. Нет `src/`, `test/`, `*.spec.*`, `*.map`, `tsconfig`, `eslint`, `vitest`;
- `AC-1.1: dist рабочих подпутей не импортирует testing` — регулярное выражение по спецификаторам `from '…'` и `import('…')` в `dist/config/**/*.js` и `dist/internal/**/*.js`: нет `testing`.

README и CHANGELOG к этой фазе ещё не написаны. Временно создать минимальные файлы-заглушки: `README.md` — `# @verdeect/kit`, `CHANGELOG.md` — `# Changelog` и `## [Unreleased]`. Иначе publint предупредит о `files`, которых нет. Фаза 6 заменяет их целиком.

### Критерии приёмки и проверка
- `pnpm pack:check` — тесты этого файла зелёные.

## Task 30: Тест проектов-потребителей — AC-9.1, AC-1.1 (условие), AC-1.2 (C)

**Skill:** nestjs-code test unit package/ac-9-1-consumer (CREATE)

### Шаги
`test/package/ac-9-1-consumer.spec.ts`. `beforeAll`: `packTarball()`, затем `createConsumerProject('minimal', tgz)` и `createConsumerProject('no-testcontainers', tgz)`. `afterAll` — удаление.
- `AC-9.1: проект-потребитель проходит свои тесты на упакованном архиве (startTestStack, defineEnv, assertRepoConventions)` — `pnpm exec vitest run` в minimal, код 0. Нужен Docker;
- `AC-1.1: /testing без условия development — ERR_PACKAGE_PATH_NOT_EXPORTED` — `node import-check.mjs` → `config:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED`;
- `AC-1.1: с условием development — оба подпути` — `node --conditions=development import-check.mjs` → `config:ok testing:ok`;
- `AC-1.1: типы пакета проверяются tsc потребителя` — `pnpm exec tsc -p tsconfig.json` в minimal, код 0;
- `AC-1.2: без pg и testcontainers /config импортируется, /testing — «@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса»`:
  - сначала проверить, что в no-testcontainers нет `node_modules/pg` и `node_modules/testcontainers` (`existsSync` → `false`);
  - затем `node --conditions=development peer-check.mjs`. stdout содержит `config:ok` и `testing:@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса`.

### Критерии приёмки и проверка
- `pnpm pack:check` — зелёный (Docker, сеть до реестра npm).

## Task 31: Тест `publish.mjs` — AC-1.10 (часть)

**Skill:** nestjs-code test unit package/ac-1-10-publish (CREATE)

### Шаги
`test/package/ac-1-10-publish.spec.ts` — перенос случаев 1–4 PC `release.spec.ts` с подставным реестром. Версия — из `package.json` (`1.0.0`):
- `AC-1.10: тег = version, версии нет в npm → npm publish --dry-run, авторизация OIDC` — код 0, stdout содержит `[publish] npm publish` и `OIDC (Trusted Publishing)`;
- `AC-1.10: тег ≠ version → выход 1 до публикации («не совпадает»)` — тег `v9.9.9`;
- `AC-1.10: версия уже есть в npm → выход 1 («уже опубликована»)`;
- `AC-1.10: тег не vX.Y.Z → выход 1` (`1.0.0`, `v1.0`, `v1.0.0-rc.1`).

`npm publish --dry-run` в первом случае требует `npm pack`, то есть `dist/`. Конфиг запускается из `pack:check` после `pnpm build`, поэтому `dist/` уже есть.

### Критерии приёмки и проверка
- Зелёный в `pnpm pack:check`.

## Task 32: Правила lint AC-9.4 на фикстуре

**Skill:** nestjs-code test unit package/ac-9-4-lint-rules (CREATE); фикстуры — none (тестовые данные)

### Шаги
1. `test/fixtures/lint/violations.ts`. Каждая строка нарушения помечена комментарием `// expect: <rule>`:
   ```ts
   import { pgSchema } from 'drizzle-orm/pg-core';
   console.log('x'); // expect: no-console
   export const a = pgSchema('identity'); // expect: no-restricted-syntax
   export const b = schemas.pgSchema('platform'); // expect: no-restricted-syntax
   export const c = 'orchestrator.outbox'; // expect: no-restricted-syntax
   export const d = `bff.${'x'}`; // expect: no-restricted-syntax
   declare const schemas: { pgSchema(name: string): unknown };
   ```
2. `test/fixtures/lint/allowed.ts`:
   ```ts
   // identity.outbox и pgSchema('identity') в комментарии не проверяются
   import type { X } from 'identity.client';
   export { type X };
   export const name = 'kit.outbox';
   export const schema = (svc: string) => pgSchemaLike(svc);
   declare function pgSchemaLike(name: string): unknown;
   ```
3. `test/package/ac-9-4-lint-rules.spec.ts`. ESLint Node API: `new ESLint({ cwd: REPO_ROOT })`, `lintText(source, { filePath })`:
   - `AC-9.4: нарушения в src/** — no-console и no-restricted-syntax на каждой помеченной строке`. Текст `violations.ts`, `filePath = join(REPO_ROOT, 'src/config/lint-fixture.ts')`. Множество `(line, ruleId)` сообщений этих двух правил равно множеству строк с `// expect:`;
   - `AC-9.4: комментарии, спецификаторы импорта и прочие строки не проверяются` — `allowed.ts` как `src/config/lint-fixture.ts`: 0 сообщений `no-console`/`no-restricted-syntax`;
   - `AC-9.4: test/** не проверяется` — `violations.ts` как `test/unit/lint-fixture.spec.ts`: 0 сообщений этих правил;
   - `AC-9.4: исходники пакета проходят lint` — `eslint.lintFiles(['src/**/*.ts'])`: сумма `errorCount` = 0.

   Если `lintText` для несуществующего пути игнорирует файл (предупреждение «File ignored»), использовать `filePath` в `src/` без создания файла: ESLint 10 разбирает текст по пути без проверки существования. Это сверить через Context7 (`ESLint#lintText`).

### Критерии приёмки и проверка
- Зелёный в `pnpm pack:check`.

## Риски фазы
- Риск: установка потребителей требует сети до реестра npm и долго идёт.
  Что делать: тайм-ауты конфига (задача 27). Сеть и Docker — условия `pack:check`, как в образце.
- Риск: `@verdeect/auth 1.0.1` недоступен в реестре.
  Что делать: остановиться и сообщить пользователю. Не подменять локальным `file:`.

## Чек-лист завершения фазы
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm pack:check` — зелёные.
- Галочки задач 26–32 в `index.md` обновлены.
