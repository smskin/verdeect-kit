# Фаза 1: Каркас пакета

Plan: [index.md](index.md)
Tasks: 1–6
Depends on: none

## Цель

Репозиторий собирается как npm-пакет по образцу `verdeect-platform-client`:
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck` и `pnpm test` зелёные;
- `package.json` объявляет подпути `./config` и `./testing` и peer-зависимости по NFR-3 (PRD v1.7);
- есть внутренние функции `src/internal/peer.ts` (AC-1.2) и `src/internal/service-name.ts`;
- `TEST_TIMEOUT_SCALE` читается из `src/testing/timeout-scale.ts`.

Кода подпутей ещё нет. `exports` уже указывают на `dist/config/*` и `dist/testing/*`; файлы появятся в фазах 2–4, а сборка архива проверяется только в фазе 5.

## Свидетельства из кода

| Путь | Символы / строки | Зачем |
|---|---|---|
| `verdeect-platform-client/package.json` | `exports`, `scripts`, `files`, `packageManager: pnpm@12.11.2`, `engines` | образец манифеста; `./testing` = `{types, development}` без `default` |
| `verdeect-platform-client/pnpm-workspace.yaml` | `allowBuilds` | `@swc/core: true`, `esbuild: true`, `cpu-features/protobufjs/ssh2: false` (testcontainers) |
| `verdeect-platform-client/tsconfig.json`, `tsconfig.build.json` | ES2023, NodeNext, strict, `noUncheckedIndexedAccess`, decorators | копируются с правкой `include` |
| `verdeect-platform-client/.prettierrc.json`, `.prettierignore`, `.gitignore` | 4 пробела, 100, `lf`; overrides yaml/json/md = 2 | копируются |
| `verdeect-platform-client/eslint.config.js` | flat config, `jsdoc/require-jsdoc` (publicOnly, contexts), `no-restricted-imports`, `curly: all`, `consistent-type-imports` | образец; добавляются правила AC-9.4 и границы подпутей |
| `verdeect-platform-client/vitest.config.ts` | `swc.vite({ module: { type: 'es6' } })`, `testTimeout: 5_000*scale`, `hookTimeout: 10_000*scale`, `restoreMocks` | образец конфига U |
| `verdeect-platform-client/test/support/timeout-scale.ts` | `timeoutScale()` | эталон `TEST_TIMEOUT_SCALE` (+ `verdeect-orchestrator/scripts/timeout-scale.mjs`) |
| `verdeect-platform-client/test/unit/package-manifest.spec.ts` | проверки `exports`, peer, devDeps | образец теста манифеста |
| `verdeect-orchestrator/apps/orchestrator/package.json` | `@nestjs/config 12.0.1`, `pg 8.23.1`, `@types/pg 8.23.1`, `pino-http 11.0.0` | точные версии |

## Файлы

| Путь | Действие | Что |
|---|---|---|
| `package.json` | create | манифест, скрипты, зависимости |
| `pnpm-workspace.yaml` | create | `allowBuilds` |
| `pnpm-lock.yaml` | create (генерируется) | `pnpm install` |
| `tsconfig.json`, `tsconfig.build.json` | create | компиляция |
| `.prettierrc.json`, `.prettierignore`, `.gitignore` | create/modify | формат, игнор |
| `eslint.config.js` | create | lint, границы, AC-9.4 |
| `vitest.config.ts` | create | уровень U |
| `src/testing/timeout-scale.ts` | create | `TEST_TIMEOUT_SCALE` |
| `src/internal/peer.ts` | create | `loadPeer` |
| `src/internal/service-name.ts` | create | формат имени сервиса |
| `test/unit/internal/ac-1-2-load-peer.spec.ts` | create | AC-1.2 (U) |
| `test/unit/internal/service-name.spec.ts` | create | формат имени |
| `test/unit/testing/timeout-scale.spec.ts` | create | `TEST_TIMEOUT_SCALE` |
| `test/unit/package/package-manifest.spec.ts` | create | NFR-1, NFR-3, AC-1.1 (форма `exports`) |

## Task 1: Манифест пакета и установка зависимостей

**Skill:** none — конфигурация (`package.json`, `pnpm-workspace.yaml`), команды

### Назначение
Задаёт имя, версию, точки входа и зависимости пакета (G1, G3, NFR-1, NFR-3). От манифеста зависят все следующие задачи.

### Шаги
1. Создать `package.json`. Порядок ключей — как в `verdeect-platform-client/package.json`:
   - `"name": "@verdeect/kit"`, `"version": "1.0.0"`;
   - `"description": "Общий инфраструктурный пакет сервисов Вердикта 2.0: конфигурация, наблюдаемость, HTTP, БД с RLS, идемпотентность, сообщения, шифр, Redis, тестовый контур"`;
   - `"keywords": ["verdeect", "nestjs", "infrastructure"]`;
   - `"repository": {"type": "git", "url": "git+https://github.com/smskin/verdeect-kit.git"}`, `"license": "UNLICENSED"`;
   - `"type": "module"`, `"sideEffects": false`, `"packageManager": "pnpm@12.11.2"`, `"engines": {"node": ">=22.12"}`;
   - `"files": ["dist", "README.md", "CHANGELOG.md"]`;
   - `"exports"`:
     ```json
     {
       "./config": { "types": "./dist/config/index.d.ts", "default": "./dist/config/index.js" },
       "./testing": { "types": "./dist/testing/index.d.ts", "development": "./dist/testing/index.js" },
       "./package.json": "./package.json"
     }
     ```
     Корня `.` нет. Остальные подпути добавляются в своих этапах. Поля `bin` в E1 нет: CLI-команд в этапе нет, первая появится в E3 (`openapi`);
   - `"publishConfig": {"access": "public"}`.
2. `"scripts"`:
   ```json
   {
     "build": "node -e \"fs.rmSync('dist', { recursive: true, force: true })\" && tsc -p tsconfig.build.json",
     "typecheck": "tsc -p tsconfig.json --noEmit",
     "lint": "eslint .",
     "format": "prettier --write .",
     "format:check": "prettier --check .",
     "test": "vitest run",
     "test:integration": "vitest run -c vitest.integration.config.ts",
     "test:timing": "vitest run -c vitest.timing.config.ts",
     "test:package": "vitest run -c vitest.package.config.ts",
     "pack:check": "pnpm build && pnpm test:package"
   }
   ```
   Скрипты `test:integration`, `test:timing`, `test:package` ссылаются на конфиги фаз 3 и 5. До этих фаз их не запускать.
3. `"dependencies"` — только внутренние детали, точные версии: `"semver": "7.8.6"` (сравнение версий peer, правило `peer-versions`) и `"yaml": "2.9.1"` (разбор compose, правила AC-1.8; версия — как у O).
4. `"peerDependencies"`. Диапазон — `^<мажор>.<минор>.0` проверенной версии (NFR-3: «от проверенной минорной»). Исключение — `drizzle-orm ^0.45.4`: NFR-1 называет 0.45.4, на 0.x каретка и так фиксирует минор.
   - Обязательные:
     - `@nestjs/common ^12.1.0`, `@nestjs/core ^12.1.0`, `@nestjs/config ^12.0.0`, `@nestjs/platform-fastify ^12.1.0`;
     - `fastify ^5.12.0`, `reflect-metadata ^0.2.0`, `rxjs ^7.8.0`, `zod ^4.6.0`, `drizzle-orm ^0.45.4`;
     - `nestjs-pino ^5.3.0`, `pino ^10.4.0`, `prom-client ^15.1.0`, `@sentry/nestjs ^11.7.0`, `@verdeect/auth ^1.0.0`.
   - Опциональные (`peerDependenciesMeta.<имя>.optional: true`): `pg ^8.23.0`, `ioredis ^6.0.0`, `amqplib ^2.2.0`, `amqp-connection-manager ^5.0.0`, `testcontainers ^12.2.0`, `vitest ^5.0.0`.
5. `"devDependencies"` — точные версии:
   - Nest и peer: `@nestjs/common 12.1.3`, `@nestjs/core 12.1.3`, `@nestjs/config 12.0.1`, `@nestjs/testing 12.1.3`, `reflect-metadata 0.2.2`, `rxjs 7.8.2`, `zod 4.6.7`;
   - тестовый контур: `testcontainers 12.2.1`, `vitest 5.0.4`, `pg 8.23.1`, `@types/pg 8.23.1`;
   - сборка и типы: `@types/node 22.20.5`, `@types/semver 7.8.0`, `typescript 5.9.3`, `@swc/core 1.16.18`, `unplugin-swc 2.0.0`;
   - lint и формат: `@eslint/js 10.0.1`, `eslint 10.12.0`, `eslint-config-prettier 10.1.8`, `eslint-plugin-jsdoc 65.4.0`, `globals 17.13.0`, `typescript-eslint 8.71.2`, `prettier 3.9.10`;
   - проверки архива: `publint 0.3.25`, `@arethetypeswrong/cli 0.18.5`.

   Peer следующих этапов (`fastify`, `drizzle-orm`, `nestjs-pino` и др.) в `devDependencies` не добавляются, пока их не импортирует код или тест.
6. Создать `pnpm-workspace.yaml`. Списка `packages` нет:
   ```yaml
   # Настройки pnpm для репозитория из одного пакета (списка packages нет).
   # minimumReleaseAge — явно не задан, действует значение pnpm по умолчанию (сутки) — .ai-factory/rules/base.md.
   allowBuilds:
     '@swc/core': true
     cpu-features: false
     esbuild: true
     protobufjs: false
     ssh2: false
   ```
7. Выполнить `pnpm install`. Он создаст `pnpm-lock.yaml`. Если `minimumReleaseAge` отклоняет версию, не добавлять исключение, а остановиться и сообщить пользователю.

### Контракты
- Набор и типы peer (обязательные и опциональные) проверяет тест задачи 6. Изменение набора — только через PRD.
- `./testing` без `default` (NFR-4): в production-сборке сервиса подпуть не разрешается.

### Ошибки и логи
Логов нет. Если версия недоступна в реестре, установка падает — остановиться и сообщить пользователю.

### Тесты
Набор зависимостей и форму `exports` проверяет задача 6.

### Критерии приёмки
- `pnpm install --frozen-lockfile` проходит на чистом клоне.
- В `package.json` нет `bin`, `main`, корневого `exports["."]`.

### Проверка
- `pnpm install --frozen-lockfile` — код 0.

## Task 2: TypeScript, Prettier и игнор-файлы

**Skill:** none — конфигурация (`tsconfig*.json`, `.prettierrc.json`, `.prettierignore`, `.gitignore`)

### Назначение
Компиляция и формат как в образце. От них зависят lint, тесты и сборка.

### Шаги
1. `tsconfig.json` — копия `verdeect-platform-client/tsconfig.json`:
   - `compilerOptions`: target ES2023, module/moduleResolution NodeNext, strict, noUncheckedIndexedAccess, noImplicitOverride, esModuleInterop, skipLibCheck, forceConsistentCasingInFileNames, resolveJsonModule, isolatedModules, experimentalDecorators, emitDecoratorMetadata, `noEmit: true`, `types: ["node"]`;
   - `"include": ["src", "test", "vitest.config.ts", "vitest.integration.config.ts", "vitest.timing.config.ts", "vitest.package.config.ts"]`;
   - `"exclude": ["test/consumer", "test/fixtures"]`. Фикстуры — тестовые данные (AC-1.8, AC-9.4) и не компилируются.

   tsc не падает на отсутствующих файлах `include`.
2. `tsconfig.build.json`: `extends ./tsconfig.json`; `compilerOptions`: `noEmit: false`, `rootDir: "src"`, `outDir: "dist"`, `declaration: true`, `declarationMap: false`, `sourceMap: false`; `include: ["src"]`.
3. `.prettierrc.json` — копия образца: tabWidth 4, singleQuote, semi, printWidth 100, trailingComma all, endOfLine lf. Overrides: `*.yaml,*.yml,*.json,*.md` → tabWidth 2, `README.md` → `embeddedLanguageFormatting: "off"`.
4. `.prettierignore`: `node_modules/`, `dist/`, `coverage/`, `pnpm-lock.yaml`, `requirements/`, `.ai-factory/`, `.claude/`, `.serena/`, `*.tgz`, `.ai-factory.json`, `.mcp.json`, `AGENTS.md`, `test/fixtures/`.
5. Дописать в `.gitignore` строки, которых нет: `node_modules/`, `dist/`, `coverage/`, `*.tgz`, `.npmrc`, `.serena/cache/`, `*:Zone.Identifier`, `*Zone.Identifier`. Существующие строки не удалять. `.gitignore` предварительно прочитать.

### Ошибки и логи
Нет.

### Тесты
Проверяются в задачах 3–6 (`pnpm typecheck`, `pnpm format:check`).

### Критерии приёмки
- `pnpm typecheck` проходит, когда появятся первые `.ts` (задача 4).

### Проверка
- `pnpm format:check` — код 0.

## Task 3: ESLint — стиль, границы подпутей и правила AC-9.4

**Skill:** nestjs-code generic eslint.config.js (CREATE)

### Назначение
Lint — исполнитель правил NFR-2, NFR-8, AC-9.4 и таблицы зависимостей `.ai-factory/ARCHITECTURE.md`. Тест конфига на фикстуре — задача 32.

### Шаги
1. Взять за основу `verdeect-platform-client/eslint.config.js`:
   - imports `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-jsdoc`, `globals`, `typescript-eslint`;
   - ignores: `**/node_modules/**`, `**/dist/**`, `coverage/**`, `requirements/**`, `.ai-factory/**`, `.claude/**`, `.serena/**`, `test/consumer/**`, `test/fixtures/**`;
   - `js.configs.recommended`, `...tseslint.configs.recommended`.
2. Блок `**/*.ts`: `curly: ['error', 'all']`, `@typescript-eslint/no-explicit-any: 'error'`, `@typescript-eslint/no-non-null-assertion: 'error'`, `@typescript-eslint/consistent-type-imports: 'error'`, `@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern: '^_' }]`.
3. Блок `src/**`, `test/**`, `vitest*.config.ts`: `languageOptions.globals: globals.node`, `parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true }`.
4. Блок `src/**/*.ts` — TSDoc: правило `jsdoc/require-jsdoc` дословно из образца (publicOnly, contexts).
5. Блок `src/**/*.ts` — AC-9.4 (NFR-8, NFR-2):
   ```js
   const SERVICES = 'identity|platform|orchestrator|bff|files|media';
   rules: {
       'no-console': 'error',
       'no-restricted-syntax': ['error',
           { selector: "CallExpression[callee.name='pgSchema'][arguments.0.type='Literal']",
             message: 'pgSchema с литералом — привязка к схеме сервиса (NFR-2): имя схемы передаёт сервис' },
           { selector: "CallExpression[callee.property.name='pgSchema'][arguments.0.type='Literal']",
             message: 'pgSchema с литералом — привязка к схеме сервиса (NFR-2): имя схемы передаёт сервис' },
           { selector: `Literal[value=/^(${SERVICES})\\.[a-z0-9_.-]+$/]:not(ImportDeclaration > Literal):not(ExportNamedDeclaration > Literal):not(ExportAllDeclaration > Literal):not(ImportExpression > Literal)`,
             message: 'Имя вида <svc>.<имя> известного сервиса в коде пакета (NFR-2, AC-9.4)' },
           { selector: `TemplateElement[value.raw=/^(${SERVICES})\\.[a-z0-9_-]/]`,
             message: 'Имя вида <svc>.<имя> известного сервиса в коде пакета (NFR-2, AC-9.4)' },
       ],
   }
   ```
   Комментарии ESLint не разбирает как узлы, поэтому они не проверяются. Спецификаторы импорта исключены через `:not(...)`. `test/**` под этот блок не попадает.
6. Блок `src/**/*.ts` — границы. `@typescript-eslint/no-restricted-imports` с `patterns`, у каждого `allowTypeImports: true`:
   - группа «опциональные peer»: `pg`, `ioredis`, `amqplib`, `amqp-connection-manager`, `testcontainers`, `testcontainers/*`, `vitest`, `vitest/*`. Сообщение: «Опциональный peer — только через loadPeer из src/internal/peer.ts (AC-1.2); import type разрешён»;
   - группа «собственный пакет»: `@verdeect/kit`, `@verdeect/kit/*`. Сообщение: «Внутри src — только относительные импорты с .js».
7. Блоки по подпутям (`@typescript-eslint/no-restricted-imports`, `patterns.group`):
   - `src/internal/**`: запрещены `@nestjs/*`, `../config/*`, `../testing/*`. internal зависит только от `node:*` и `zod`;
   - `src/config/**`: запрещены `../testing/*`;
   - `src/testing/**`: ограничений, кроме общих, нет.

   В ESLint 10 flat config последний блок с тем же правилом для того же файла заменяет предыдущий. Поэтому пункты 6 и 7 собираются в один объект правила на каждую группу файлов: общий массив `patterns` + специфичные. Реализовать функцией `restrictedImports(extra)` в `eslint.config.js`.
8. Блок `*.js`, `*.mjs`, `scripts/**/*.mjs`: `globals.node`. Последний элемент — `prettier`.
9. Перед написанием сверить формат опций `@typescript-eslint/no-restricted-imports` (`allowTypeImports`) и esquery-селекторов через Context7 (typescript-eslint, eslint).

### Контракты
- Вне `test/**` нарушение — ошибка, а не предупреждение.
- Набор имён сервисов — ровно `identity|platform|orchestrator|bff|files|media` (AC-9.4).

### Ошибки и логи
Нет.

### Тесты
Правила AC-9.4 проверяет задача 32 на фикстуре. Здесь — `pnpm lint` на пустом `src`.

### Критерии приёмки
- `pnpm lint` проходит на файлах фазы 1.

### Проверка
- `pnpm lint` — код 0.

## Task 4: Конфиг Vitest уровня U и `TEST_TIMEOUT_SCALE`

**Skill:** nestjs-code generic src/testing/timeout-scale.ts (CREATE); тест — nestjs-code test unit testing/timeout-scale (CREATE)

### Назначение
`TEST_TIMEOUT_SCALE` — экспорт `/testing` (§3.8, E1). Его используют все конфиги Vitest пакета и сервисов.

Эталоны:
- `verdeect-platform-client/test/support/timeout-scale.ts` — проверка числа;
- `verdeect-orchestrator/scripts/timeout-scale.mjs` — то же.

Сообщение `console.info` из O не переносится: NFR-8, логирование минимальное.

### Шаги
1. `src/testing/timeout-scale.ts`. Первая строка — `// Множитель тайм-аутов тестов (prd.md §3.8, E1); эталон — verdeect-platform-client test/support/timeout-scale.ts.`
   ```ts
   /** Множитель testTimeout/hookTimeout из TEST_TIMEOUT_SCALE; пусто — 1. */
   export function readTimeoutScale(env: Readonly<Record<string, string | undefined>>): number {
       const raw = env.TEST_TIMEOUT_SCALE?.trim() ?? '';
       if (raw === '') {
           return 1;
       }
       const scale = Number(raw);
       if (!Number.isFinite(scale) || scale <= 0) {
           throw new Error(`TEST_TIMEOUT_SCALE=${raw}: нужно число > 0`);
       }
       return scale;
   }
   /** Множитель тайм-аутов тестов текущего процесса (§3.8). */
   export const TEST_TIMEOUT_SCALE: number = readTimeoutScale(process.env);
   ```
   `readTimeoutScale` нужен для тестов. Из `src/testing/index.ts` он не реэкспортируется.

   Файл не импортирует `testcontainers`, поэтому конфиги Vitest могут импортировать его напрямую.
2. `vitest.config.ts`:
   ```ts
   import swc from 'unplugin-swc';
   import { defineConfig } from 'vitest/config';
   import { TEST_TIMEOUT_SCALE } from './src/testing/timeout-scale.js';
   export default defineConfig({
       plugins: [swc.vite({ module: { type: 'es6' } })],
       test: {
           include: ['test/unit/**/*.spec.ts'],
           environment: 'node',
           testTimeout: 5_000 * TEST_TIMEOUT_SCALE,
           hookTimeout: 10_000 * TEST_TIMEOUT_SCALE,
           restoreMocks: true,
           typecheck: { enabled: true, include: ['test/unit/**/*.test-d.ts'], tsconfig: './tsconfig.json' },
       },
   });
   ```
   Если загрузчик конфига Vitest не разрешает `.js` → `.ts`, импортировать `./src/testing/timeout-scale.ts`. Формат `typecheck` для Vitest 5.0.4 сверить через Context7.

### Контракты
- `TEST_TIMEOUT_SCALE` — `number > 0`. Неверное значение — исключение при импорте; значение попадает в сообщение (оно не секрет).

### Ошибки и логи
Без логов (минимальная политика).

### Тесты
`test/unit/testing/timeout-scale.spec.ts`:
- `§3.8: TEST_TIMEOUT_SCALE — пусто и пробелы → 1` (`{}`, `{TEST_TIMEOUT_SCALE: '  '}`);
- `§3.8: TEST_TIMEOUT_SCALE — 2.5 → 2.5`;
- `§3.8: TEST_TIMEOUT_SCALE — 0, -1, abc, Infinity → ошибка с текстом «нужно число > 0»`.

### Критерии приёмки
- `pnpm test` проходит.

### Проверка
- `pnpm test` — зелёный.

## Task 5: Внутренние функции `loadPeer` и формат имени сервиса

**Skill:** nestjs-code generic src/internal/peer.ts (CREATE); nestjs-code generic src/internal/service-name.ts (CREATE); тесты — nestjs-code test unit internal/peer, internal/service-name (CREATE)

### Назначение
- `loadPeer` — единственный способ загрузить опциональный peer (AC-1.2, NFR-3, ARCHITECTURE «Правила зависимостей»).
- Формат имени сервиса — одна функция для `startTestStack` (E1), `bootstrapService` (E3), `createCipher` (E7) и модулей (§3.4, §3.6).

### Шаги
1. `src/internal/peer.ts`:
   ```ts
   // Загрузка опционального peer с текстом ошибки AC-1.2 (prd.md §3, NFR-3).
   type Importer = (specifier: string) => Promise<unknown>;

   /** Текст ошибки AC-1.2. */
   export function missingPeerMessage(library: string, subpath: string): string {
       return `@verdeect/kit/${subpath} требует ${library} — добавьте в зависимости сервиса`;
   }

   /** Загружает peer через importer; отсутствие самого пакета → ошибка AC-1.2, прочее — как есть. */
   export async function loadPeerWith<T>(importer: Importer, library: string, subpath: string): Promise<T> {
       try {
           return (await importer(library)) as T;
       } catch (error) {
           if (isMissingPackage(error, library)) {
               throw new Error(missingPeerMessage(library, subpath), { cause: error });
           }
           throw error;
       }
   }

   /** Опциональный peer подпути; вызывается top-level await в модуле подпути. */
   export function loadPeer<T>(library: string, subpath: string): Promise<T> {
       return loadPeerWith<T>((specifier) => import(specifier), library, subpath);
   }
   ```
   `isMissingPackage(error, library)` — `true`, если:
   - `error` — объект с `code === 'ERR_MODULE_NOT_FOUND'`;
   - и `String(error.message)` содержит `'${library}'` (в одинарных кавычках, как пишет Node) или `"${library}"`.

   Отсутствующая вложенная зависимость самого peer не маскируется: её сообщение называет другой пакет. Тип `error` — `unknown`, сужение через проверку `typeof error === 'object' && error !== null && 'code' in error`.
2. `src/internal/service-name.ts`:
   ```ts
   // Имя сервиса = имя экземпляра (prd.md §3.4, §3.5, §3.6; CE-3).
   export const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
   /** Бросает TypeError, если имя вне формата; значение в сообщение попадает (это не секрет). */
   export function assertServiceName(service: string, where: string): void
   ```
   Сообщение: `${where}: имя сервиса «${service}» вне формата ^[a-z][a-z0-9-]{1,31}$`.
3. `src/internal/` наружу не экспортируется: в `exports` его нет.

### Контракты
- Текст AC-1.2 дословно: «`@verdeect/kit/<подпуть>` требует `<библиотека>` — добавьте в зависимости сервиса» (без markdown-кавычек в строке).
- `loadPeer` не кэширует результат: кэширует модульная система Node.

### Ошибки и логи
Без логов. Исходная ошибка сохраняется в `cause`.

### Тесты
`test/unit/internal/ac-1-2-load-peer.spec.ts`:
- `AC-1.2: отсутствующий peer → «@verdeect/kit/testing требует testcontainers — добавьте в зависимости сервиса»`. importer бросает `Object.assign(new Error("Cannot find package 'testcontainers' imported from /x"), { code: 'ERR_MODULE_NOT_FOUND' })`. Проверить текст и `cause`;
- `AC-1.2: отсутствует вложенная зависимость peer → исходная ошибка без замены`. Сообщение называет `'ssh2'`, library — `testcontainers`;
- `AC-1.2: ошибка выполнения модуля peer → исходная ошибка`. Ошибка без `code`;
- `AC-1.2: установленный peer загружается` — `loadPeer('yaml', 'testing')` возвращает модуль с `parse`.

`test/unit/internal/service-name.spec.ts`:
- `§3.5: формат имени сервиса — bff-app, files, ab проходят; A, 1ab, a, a_b, 33 символа → TypeError с where`.

### Критерии приёмки
- Тесты зелёные, lint проходит.

### Проверка
- `pnpm test` — зелёный. `pnpm lint` — код 0.

## Task 6: Тест манифеста (NFR-1, NFR-3, форма `exports` AC-1.1)

**Skill:** nestjs-code test unit package/package-manifest (CREATE)

### Назначение
Набор зависимостей и точек входа — контракт PRD. Тест ловит дрейф до сборки архива. Образец — `verdeect-platform-client/test/unit/package-manifest.spec.ts`.

Это тест требования: он читает `package.json`, приложение не запускает. Поэтому остаётся в уровне U (skill-context «Fast Test Suites» (5)).

### Шаги
1. `test/unit/package/package-manifest.spec.ts` читает `package.json` через `readFileSync(new URL('../../../package.json', import.meta.url))`.
2. Случаи:
   - `AC-1.1: exports — ровно ./config, ./testing, ./package.json`;
   - `AC-1.1: ./config — {types, default} на dist/config/index.*`;
   - `AC-1.1: ./testing — ключи ровно ['types', 'development'], без default (NFR-4)`;
   - `NFR-3: обязательные peer — ровно список PRD v1.7, не optional` — 14 имён из задачи 1, ни у одного нет `peerDependenciesMeta.optional`;
   - `NFR-3: опциональные peer — pg, ioredis, amqplib, amqp-connection-manager, testcontainers, vitest, у всех optional: true`;
   - `NFR-3: peer не дублируются в dependencies; dependencies — только semver и yaml, точные версии`;
   - `NFR-3: devDependencies — точные версии` — `semver.valid(v)` ≠ null для всех;
   - `NFR-1: ESM, engines.node >=22.12, packageManager pnpm`;
   - `AC-1.1: нет bin и корневого "." в E1`.

### Ошибки и логи
Нет.

### Тесты
Сам является тестом.

### Критерии приёмки
- Все случаи зелёные на манифесте задачи 1.

### Проверка
- `pnpm test` — зелёный.

## Риски фазы
- Риск: `minimumReleaseAge` отклоняет свежую версию (`semver 7.8.6`, `prom-client`).
  Что делать: остановиться и сообщить пользователю; исключения не добавлять (rules/base.md).
- Риск: один объект правила `no-restricted-imports` на файл в ESLint 10 перетирает границы.
  Что делать: собирать правило функцией `restrictedImports(extra)` (задача 3, п. 7).

## Чек-лист завершения фазы
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` — зелёные.
- Галочки задач 1–6 в `index.md` обновлены.
