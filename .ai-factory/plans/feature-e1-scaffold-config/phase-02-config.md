# Фаза 2: Подпуть `/config`

Plan: [index.md](index.md)
Tasks: 7–12
Depends on: Phase 1 (Tasks 1–5)

## Цель

`src/config/` реализует §3.1 PRD v1.7 целиком: фрагменты, помощники, `defineEnv`, `withBaseChecks`, `parseEnv`, `InvalidEnvironmentError`, схемы CLI, `KitConfigModule` и типы `Kit*Env`. Тесты AC-1.3–AC-1.7 и AC-1.11 зелёные.

## Свидетельства из кода (эталоны, только чтение)

Пути — `/home/administrator/projects/verdeect2/…`.

| Путь | Символы | Что берём |
|---|---|---|
| `verdeect-orchestrator/apps/orchestrator/src/shared/config/env.schema.ts` (316 строк) | `positiveInt`, `nonNegativeInt`, `optionalText`, `booleanFlag`, `jsonValue`, `uniqueBy`, `replicaId` (`hostname()` + `^[A-Za-z0-9._-]{1,128}$`), `LogLevelSchema` (стр. 54–56), `MigrateEnvSchema`/`PrepareEnvSchema` (стр. 261–274), `InvalidEnvironmentError`, `parseWith` | основа помощников и CLI-схем |
| `verdeect-bff/apps/bff/src/shared/config/env.schema.ts` (272 строки) | `port`, `httpUrl`, `serviceUrls` (`z.object({…}).catchall(httpUrl())`), `issueKeys` (полный путь через точку), `sessionEncKeys` (стр. 69–95) | путь ключа, `SERVICE_URLS`, проверка ключей шифра |
| `verdeect-orchestrator/apps/orchestrator/src/shared/config/app-config.module.ts` (20 строк) | `ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: parseEnv })` | основа `KitConfigModule` |
| `verdeect-orchestrator/…/config/env.schema.spec.ts` (342 строки), `verdeect-bff/…/config/env.schema.spec.ts` (326 строк) | `errorOf`, `expectKeysOnly(error, key, values)` | тесты переносятся и обобщаются |

Решения PRD поверх эталонов:
- путь ключа — полный, как у B (у O — первый сегмент; §3.1, AC-1.3, inventory §4 п. 10);
- `RABBITMQ_RETRY_SECONDS` по умолчанию 30 (у O — 5);
- `PORT` вместо `BFF_PORT`/`IDENTITY_PORT`;
- `METRICS_PORT` — `port()` с умолчанием 9100 (v1.7);
- `ENCRYPTION_KEYS` — JSON `[{version, secret}]`, секрет base64url (§3.6, CE-2);
- сообщение ошибки — по-русски (NFR-9).

## Файлы

| Путь | Действие | Что |
|---|---|---|
| `src/config/helpers.ts` | create | `port`, `positiveInt`, `optionalText`, `booleanFlag`, `jsonValue`, `httpUrl`, `uniqueBy`; внутренний `nonNegativeInt` |
| `src/config/fragments.ts` | create | `envBase` … `envServiceUrls`, типы `Kit*Env` |
| `src/config/parse-env.ts` | create | `parseEnv`, `InvalidEnvironmentError`, `issueKeys` (внутр.) |
| `src/config/define-env.ts` | create | `withBaseChecks`, `defineEnv` |
| `src/config/cli-schemas.ts` | create | `migrateEnvSchema`, `prepareEnvSchema` |
| `src/config/kit-config.module.ts` | create | `KitConfigModule` |
| `src/config/index.ts` | create | явный список экспортов |
| `test/unit/config/*.spec.ts`, `test/unit/config/ac-1-6-define-env.test-d.ts` | create | тесты |

## Task 7: Помощники и фрагменты окружения

**Skill:** nestjs-code generic src/config/helpers.ts (CREATE); nestjs-code generic src/config/fragments.ts (CREATE)

### Назначение
Ключи пакета называются одинаково во всех сервисах (C0). Фрагменты распаковываются в `defineEnv`.

### Шаги
1. `src/config/helpers.ts`. Шапка: `// Помощники zod для схем окружения (prd.md §3.1); эталон — O env.schema.ts + port/httpUrl из B.`

   Умолчание опционально у всех помощников. Без умолчания ключ обязателен.
   ```ts
   export function port(fallback?: number)            // z.coerce.number().int().min(0).max(65535) [.default(fallback)]
   export function positiveInt(fallback?: number)     // z.coerce.number().int().positive() [.default]
   export function nonNegativeInt(fallback?: number)  // внутренний: .int().nonnegative(); не реэкспортируется
   export function optionalText()                     // z.string().default('').transform(v => v.trim() === '' ? null : v.trim())
   export function booleanFlag(fallback?: boolean)    // z.enum(['true','false'])[.default(...)].transform(v => v === 'true')
   export function jsonValue<T extends z.ZodType>(schema: T, fallback?: string)  // как у O: JSON.parse → .pipe(schema)
   export function httpUrl()                          // z.url({ protocol: /^https?$/ })
   export function uniqueBy<T>(key: keyof T): (items: readonly T[], ctx: z.RefinementCtx) => void
   ```
   - Каждый `ctx.addIssue` передаёт `input: ''`. Сообщения — по-русски, без значений: `'неверный JSON'`, `` `повтор ${String(key)}` ``.
   - `port('')` даёт 0 (`z.coerce`) — так же, как в эталоне. 0 означает «порт выбирает ОС» (тесты).
2. `src/config/fragments.ts`. Шапка: `// Фрагменты схемы окружения пакета (prd.md §3.1, C0–C6).` Каждый фрагмент — объект zod-схем (raw shape), не `z.object`. Так `{...envBase, ...envDatabase}` распаковывается в `defineEnv`.
   ```ts
   const nodeEnv = z.enum(['development', 'test', 'production']).default('production');
   const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');
   const replicaId = optionalText().transform((v) => v ?? hostname()).pipe(z.string().regex(/^[A-Za-z0-9._-]{1,128}$/));
   export const envBase = {
       NODE_ENV: nodeEnv, LOG_LEVEL: logLevel, PORT: port(3000), METRICS_PORT: port(9100),
       REPLICA_ID: replicaId, SHUTDOWN_TIMEOUT_MS: positiveInt(10_000), SHUTDOWN_DRAIN_MS: nonNegativeInt(0),
   };
   export const envDatabase = {
       DATABASE_URL: z.string().min(1), DB_POOL_MAX: positiveInt(10), DB_POOL_ACQUIRE_TIMEOUT_MS: positiveInt(5000),
   };
   export const envMessaging = { RABBITMQ_URL: z.url(), RABBITMQ_RETRY_SECONDS: positiveInt(30) };
   export const envRedis = { REDIS_URL: z.url() };
   export const envSentry = {
       SENTRY_DSN: optionalText(), SENTRY_ENVIRONMENT: optionalText(), SENTRY_RELEASE: optionalText(), NODE_ENV: nodeEnv,
   };
   const encryptionSecret = z.string().regex(/^[A-Za-z0-9_-]+$/)
       .refine((v) => Buffer.from(v, 'base64url').length >= 32, { message: 'секрет короче 32 байт' });
   export const envCrypto = {
       ENCRYPTION_KEYS: jsonValue(
           z.array(z.object({ version: z.number().int().positive(), secret: encryptionSecret }))
               .min(1).superRefine(uniqueBy('version')),
       ),
   };
   export function envServiceUrls(required: readonly string[]) {
       const known = Object.fromEntries(required.map((name) => [name, httpUrl()]));
       return { SERVICE_URLS: jsonValue(z.object(known).catchall(httpUrl())) };
   }
   ```
   - `hostname` — из `node:os`.
   - У `envServiceUrls` тип результата `SERVICE_URLS: Record<string, string>`. Привести через `.transform((map): Readonly<Record<string, string>> => map)`, как у B.
   - `nodeEnv` — одна константа для `envBase` и `envSentry`: распаковка обоих фрагментов не конфликтует по типу.
   - `refine` у секрета передаёт `input: ''`. В zod 4 параметр `refine` — `{ message }`; формат сверить через Context7.
3. Типы в `fragments.ts`:
   ```ts
   export type KitBaseEnv = z.output<z.ZodObject<typeof envBase>>;
   export type KitDatabaseEnv = z.output<z.ZodObject<typeof envDatabase>>;
   export type KitMessagingEnv = z.output<z.ZodObject<typeof envMessaging>>;
   export type KitRedisEnv = z.output<z.ZodObject<typeof envRedis>>;
   export type KitCryptoEnv = z.output<z.ZodObject<typeof envCrypto>>;
   ```
   `KitSentryEnv` не экспортируется: его нет в §3.1.
4. TSDoc у каждого экспорта: назначение, умолчание, ссылка на §3.1.

### Контракты
- Умолчания (AC-1.5, v1.7):

  | Ключ | Умолчание |
  |---|---|
  | `NODE_ENV` | `production` |
  | `LOG_LEVEL` | `info` |
  | `PORT` | 3000 |
  | `METRICS_PORT` | 9100 |
  | `REPLICA_ID` | `hostname()` |
  | `SHUTDOWN_TIMEOUT_MS` | 10 000 |
  | `SHUTDOWN_DRAIN_MS` | 0 |
  | `DB_POOL_MAX` | 10 |
  | `DB_POOL_ACQUIRE_TIMEOUT_MS` | 5000 (мин. 1) |
  | `RABBITMQ_RETRY_SECONDS` | 30 (целое ≥ 1) |

- P0: псевдонимов старых ключей нет (N9).

### Ошибки и логи
Без логов. Значения в сообщения issue не попадают (NFR-4).

### Тесты
В задаче 10.

### Критерии приёмки
- `pnpm typecheck` проходит.

### Проверка
- `pnpm typecheck`, `pnpm lint` — код 0.

## Task 8: `parseEnv`, `InvalidEnvironmentError`, `withBaseChecks`, `defineEnv`, схемы CLI

**Skill:** nestjs-code generic src/config/parse-env.ts (CREATE); nestjs-code generic src/config/define-env.ts (CREATE); nestjs-code generic src/config/cli-schemas.ts (CREATE)

### Назначение
Единая точка разбора окружения и проверок между ключами пакета (§3.1, AC-1.3, AC-1.4, AC-1.6).

### Шаги
1. `src/config/parse-env.ts`:
   ```ts
   /** Ошибка окружения: только пути ключей, без значений (NFR-4). */
   export class InvalidEnvironmentError extends Error {
       readonly code = 'INVALID_ENVIRONMENT' as const;
       readonly keys: readonly string[];
       constructor(keys: readonly string[]) {
           super(`Неверное окружение: ${keys.join(', ')}`);
           this.name = 'InvalidEnvironmentError';
           this.keys = keys;
       }
   }
   function issueKeys(error: z.ZodError): string[] {   // эталон B
       const keys = error.issues.map((i) => (i.path.length === 0 ? '(root)' : i.path.map(String).join('.')));
       return [...new Set(keys)];
   }
   /** Результат схемы или InvalidEnvironmentError. */
   export function parseEnv<S extends z.ZodType>(schema: S, env: Readonly<Record<string, unknown>>): z.output<S>
   ```
   Без `cause`: `ZodError` содержит `input` в issues. Ошибка zod не сохраняется ни в `cause`, ни в полях.
2. `src/config/define-env.ts`:
   ```ts
   type KitShape = typeof envBase & typeof envDatabase & typeof envMessaging & typeof envRedis
       & typeof envSentry & typeof envCrypto & ReturnType<typeof envServiceUrls>;
   type KitKeyOutput = { [K in keyof KitShape]: z.output<KitShape[K]> };
   /** Ключ пакета в shape сервиса обязан давать тот же выходной тип (AC-1.6). */
   export type CompatibleShape<S extends z.ZodRawShape> = {
       [K in keyof S]: K extends keyof KitKeyOutput ? z.ZodType<KitKeyOutput[K]> : S[K];
   };
   /** Проверки между ключами пакета (§3.1). */
   export function withBaseChecks<T extends z.ZodObject>(schema: T): T
   /** Схема окружения сервиса: распаковка фрагментов + свои ключи (§3.1). */
   export function defineEnv<S extends z.ZodRawShape>(
       shape: S & CompatibleShape<S>,
       refine?: (env: z.output<z.ZodObject<S>>, ctx: z.RefinementCtx) => void,
   ): z.ZodObject<S>
   ```
   - `withBaseChecks` — `schema.superRefine((env, ctx) => …)`. Читает `env` как `Record<string, unknown>` и проверяет, только если значения — числа:
     - `PORT === METRICS_PORT && PORT !== 0` → issue `{ code: 'custom', path: ['METRICS_PORT'], message: 'PORT и METRICS_PORT совпадают', input: '' }`;
     - `SHUTDOWN_DRAIN_MS >= SHUTDOWN_TIMEOUT_MS` → issue с путём `['SHUTDOWN_DRAIN_MS']`, сообщение «пауза не меньше общего срока остановки».

     Возвращает тот же тип `T`: в zod 4 `superRefine` у объекта сохраняет `ZodObject`, у сервиса остаётся доступ к `.shape`. Проверить через Context7 (zod 4, `superRefine`/`check` на `ZodObject`). Если тип меняется, объявить результат как `T` через `as T` с комментарием-обоснованием («zod 4: refinement не меняет форму»).
   - `defineEnv` = `withBaseChecks(z.object(shape))`, затем `.superRefine(refine)`, если `refine` передан. `z.object` нестрогий: лишние переменные процесса отбрасываются.
3. `src/config/cli-schemas.ts` (эталон O, стр. 261–274; имена паролей — по §3.1):
   ```ts
   export const migrateEnvSchema = z.object({ DATABASE_MIGRATOR_URL: z.string().min(1), LOG_LEVEL: logLevel });
   export const prepareEnvSchema = z.object({
       DATABASE_ADMIN_URL: z.string().min(1),
       DB_OWNER_PASSWORD: z.string().min(16), DB_APP_PASSWORD: z.string().min(16), LOG_LEVEL: logLevel,
   });
   ```
   `logLevel` экспортировать из `fragments.ts` как внутренний именованный экспорт. Из `index.ts` он не реэкспортируется.

### Контракты
- Путь ключа — полный, через точку (`SERVICE_URLS.files`, `NODES.2.host`). Без пути — `(root)`. Ключи без дублей, в порядке issues.
- Текст ошибки: `Неверное окружение: <ключи через запятую>`. Значений нет никогда.

### Ошибки и логи
Без логов. Логирование отказа — `failStartup` (E2).

### Тесты
Задачи 10–11.

### Критерии приёмки
- `pnpm typecheck` проходит.

### Проверка
- `pnpm typecheck` — код 0.

## Task 9: `KitConfigModule` и публичный `index.ts`

**Skill:** nestjs-code generic src/config/kit-config.module.ts (CREATE); nestjs-code generic src/config/index.ts (CREATE)

### Назначение
`KitConfigModule` — обёртка над `ConfigModule` из `@nestjs/config`: сервис внедряет `ConfigService` (§3.1 v1.7, NFR-3 v1.7). `index.ts` — публичная поверхность `/config`.

### Шаги
1. `src/config/kit-config.module.ts` (эталон `app-config.module.ts` O):
   ```ts
   import { ConfigModule } from '@nestjs/config';
   import type { DynamicModule } from '@nestjs/common';
   /** Параметры KitConfigModule.forRoot. */
   export interface KitConfigModuleOptions<S extends z.ZodType> { readonly schema: S }
   /** Глобальный модуль окружения; перечитывает process.env при каждой сборке контекста Nest (AC-1.7). */
   export class KitConfigModule {
       static forRoot<S extends z.ZodType>(options: KitConfigModuleOptions<S>): Promise<DynamicModule> {
           return ConfigModule.forRoot({
               isGlobal: true,
               ignoreEnvFile: true,
               validate: (raw: Record<string, unknown>) => parseEnv(options.schema, raw),
           });
       }
   }
   ```
   - Не передавать `cache: true`: кэш сломал бы AC-1.7.
   - TSDoc `forRoot` фиксирует поведение `@nestjs/config` 12.0.1: с `validate` модуль вызывает `assignVariablesToProcess` (`dist/config.module.js` стр. 52–55, 166–181). Он дописывает в `process.env` каждый разобранный ключ-строку, число или логическое значение, которого там ещё нет, — например, умолчания `METRICS_PORT`, `REPLICA_ID`, `SHUTDOWN_*`. `ConfigService.get` читает сначала разобранное значение (`config.service.js` стр. 66). Поведение совпадает с эталоном O и не обходится: опции, которая его отключает, кроме `ignoreEnvVars`, нет.
   - Передачу уже разобранного окружения из `bootstrapService` добавит E3 (§3.1). В E1 этого поля нет.
   - Сигнатуру `ConfigModule.forRoot` в `@nestjs/config` 12.0.1 (async, `validate`) сверить через Context7.
2. `src/config/index.ts` — только `export { … } from './….js'` и `export type { … }`:
   - значения: `envBase`, `envDatabase`, `envMessaging`, `envRedis`, `envSentry`, `envCrypto`, `envServiceUrls`, `defineEnv`, `withBaseChecks`, `parseEnv`, `InvalidEnvironmentError`, `migrateEnvSchema`, `prepareEnvSchema`, `port`, `positiveInt`, `optionalText`, `booleanFlag`, `jsonValue`, `httpUrl`, `uniqueBy`, `KitConfigModule`;
   - типы: `KitBaseEnv`, `KitDatabaseEnv`, `KitMessagingEnv`, `KitRedisEnv`, `KitCryptoEnv`.

   `CompatibleShape` и `KitConfigModuleOptions` не реэкспортируются: в §3.1 их нет, а TypeScript разворачивает их в `.d.ts`.

### Контракты
- `/config` не импортирует `src/testing` и опциональные peer (lint, задача 3).

### Ошибки и логи
`InvalidEnvironmentError` из `validate` пробрасывается: промис `forRoot` отклоняется. Логов нет.

### Тесты
Задача 12.

### Критерии приёмки
- `pnpm typecheck`, `pnpm lint` (включая TSDoc) — код 0.

### Проверка
- `pnpm lint`, `pnpm typecheck`.

## Task 10: Тесты разбора окружения — AC-1.3, AC-1.4, AC-1.5, AC-1.11 и помощники

**Skill:** nestjs-code test unit config/parse-env (CREATE)

### Назначение
Переносим тесты эталонов `env.schema.spec.ts` (O, B) и обобщаем их на фрагменты пакета. Доменные ключи сервисов (`MODEL_PROVIDERS`, `SESSION_ENC_KEYS`, …) не переносятся.

### Шаги
1. `test/unit/config/support.ts`:
   - `errorOf(fn): InvalidEnvironmentError` — ловит ошибку, иначе `expect.fail`;
   - `expectKeysOnly(error, key, values)` — эталон B: `keys` содержит ключ, `message` содержит ключ, `${message} ${JSON.stringify(keys)}` не содержит ни одного значения.
2. `test/unit/config/ac-1-3-parse-env.spec.ts`:
   - `AC-1.3: SERVICE_URLS.files не URL → путь SERVICE_URLS.files, секрет не в тексте`. `envServiceUrls(['files'])`, значение `'not-a-url-SECRET_MARKER_1'`;
   - `AC-1.3: NODES.2.host → полный путь`. Своя схема `NODES: jsonValue(z.array(z.object({ host: z.string().min(1) })))`, третий элемент `{host: ''}`;
   - `AC-1.3: ошибка без пути → (root)`. `defineEnv({}, (_, ctx) => ctx.addIssue({ code: 'custom', message: 'x', input: '' }))`;
   - `AC-1.3: InvalidEnvironmentError — code INVALID_ENVIRONMENT, name, сообщение «Неверное окружение: …»`;
   - `AC-1.3: несколько ошибок — ключи без дублей`.
3. `test/unit/config/ac-1-4-base-checks.spec.ts`:
   - `AC-1.4: PORT = METRICS_PORT = 3000 → путь METRICS_PORT`;
   - `AC-1.4: PORT = METRICS_PORT = 0 → допустимо`;
   - `AC-1.4: SHUTDOWN_DRAIN_MS = SHUTDOWN_TIMEOUT_MS → путь SHUTDOWN_DRAIN_MS`;
   - `AC-1.4: SHUTDOWN_DRAIN_MS > SHUTDOWN_TIMEOUT_MS → путь SHUTDOWN_DRAIN_MS`;
   - `AC-1.4: withBaseChecks на схеме без этих ключей — без ошибок`.
4. `test/unit/config/ac-1-5-defaults.spec.ts`. `defineEnv({...envBase, ...envDatabase})` на `{ DATABASE_URL: 'postgres://x' }`:
   - `AC-1.5: умолчания` — `NODE_ENV = production`, `LOG_LEVEL = info`, `PORT = 3000`, `METRICS_PORT = 9100`, `REPLICA_ID = os.hostname()`, `SHUTDOWN_TIMEOUT_MS = 10000`, `SHUTDOWN_DRAIN_MS = 0`, `DB_POOL_MAX = 10`, `DB_POOL_ACQUIRE_TIMEOUT_MS = 5000`;
   - `AC-1.5: DB_POOL_ACQUIRE_TIMEOUT_MS = 0 → путь DB_POOL_ACQUIRE_TIMEOUT_MS`;
   - `AC-1.5: REPLICA_ID вне ^[A-Za-z0-9._-]{1,128}$ → путь REPLICA_ID; пустой → hostname()`;
   - `§3.1: RABBITMQ_RETRY_SECONDS — умолчание 30, 0 → ошибка`;
   - `§3.1: LOG_LEVEL вне списка → ошибка; NODE_ENV вне списка → ошибка`;
   - `§3.1: envSentry — пустые значения → null`.
5. `test/unit/config/ac-1-11-service-urls.spec.ts`:
   - `AC-1.11: нет identity → путь SERVICE_URLS.identity`;
   - `AC-1.11: identity не URL → путь SERVICE_URLS.identity, значение не в тексте`;
   - `AC-1.11: лишние имена допустимы` (`files` с http-URL);
   - `AC-1.11: лишнее имя не URL → путь SERVICE_URLS.<имя>` (эталон B, `catchall`);
   - `AC-1.11: SERVICE_URLS не JSON → путь SERVICE_URLS`.
6. `test/unit/config/helpers.spec.ts` — `§3.1: помощники`:
   - `port(65536)`, `port(-1)` → ошибка;
   - `booleanFlag(true)`: `'false'` → `false`, `'1'` → ошибка;
   - `jsonValue` с `fallback`;
   - `uniqueBy` — повтор → ошибка;
   - `optionalText` → `null` / обрезка;
   - `httpUrl` — `ftp://` → ошибка.
7. `test/unit/config/env-crypto.spec.ts`:
   - `§3.6 (envCrypto): секрет 32 байта base64url — ок; 31 байт → путь ENCRYPTION_KEYS.0.secret`;
   - `… с '=' → ошибка`;
   - `… повтор version → ENCRYPTION_KEYS`;
   - `… пустой массив → ошибка`;
   - `… секрет не в тексте ошибки`.

   Секрет генерировать `randomBytes(32).toString('base64url')`.
8. `test/unit/config/cli-schemas.spec.ts`:
   - `§3.1: prepareEnvSchema — пароль короче 16 → путь DB_OWNER_PASSWORD, пароль не в тексте`;
   - `§3.1: migrateEnvSchema без DATABASE_MIGRATOR_URL → путь DATABASE_MIGRATOR_URL`.

### Ошибки и логи
Нет.

### Тесты
Сама задача — тесты.

### Критерии приёмки
- Все случаи зелёные. В каждом тесте на ошибку проверяется отсутствие значения в тексте.

### Проверка
- `pnpm test -- test/unit/config` — зелёный.

## Task 11: Тест типов AC-1.6

**Skill:** nestjs-code test unit config/define-env-types (CREATE)

### Назначение
Несовместимое переопределение ключа пакета ловит компилятор (§3.1, AC-1.6).

### Шаги
`test/unit/config/ac-1-6-define-env.test-d.ts` (`import { expectTypeOf, test } from 'vitest'`):
- `AC-1.6: переопределение PORT своим port(4000) компилируется` — `defineEnv({...envBase, PORT: port(4000)})`;
- `AC-1.6: PORT как z.string() — ошибка компиляции`. `// @ts-expect-error` перед вызовом `defineEnv({...envBase, PORT: z.string()})`;
- `AC-1.6: DATABASE_URL как z.number() — ошибка компиляции` (`@ts-expect-error`);
- `AC-1.6: свой ключ сервиса — любой тип`. `defineEnv({...envBase, FEATURE_X: booleanFlag(false)})`; `expectTypeOf(parseEnv(schema, {}).FEATURE_X).toEqualTypeOf<boolean>()`;
- `AC-1.6: вывод типа` — `expectTypeOf(parseEnv(defineEnv({...envBase}), {}).PORT).toEqualTypeOf<number>()`.

Если `@ts-expect-error` не срабатывает (переопределение компилируется), исправить `CompatibleShape` в `define-env.ts` (задача 8). Ослаблять тест нельзя.

### Ошибки и логи
Нет.

### Тесты
Запуск через `typecheck` Vitest (задача 4) и `pnpm typecheck`.

### Критерии приёмки
- `pnpm test` проходит typecheck-файл. `pnpm typecheck` — код 0.

### Проверка
- `pnpm test`, `pnpm typecheck`.

## Task 12: Тест `KitConfigModule` — AC-1.7

**Skill:** nestjs-code test unit config/kit-config-module (CREATE)

### Назначение
Окружение перечитывается при каждой сборке контекста Nest (§3.1, AC-1.7). Сервис получает разобранные значения через `ConfigService`.

### Шаги
`test/unit/config/ac-1-7-kit-config-module.spec.ts`. Импорт `reflect-metadata` первым, затем `@nestjs/testing` `Test`, `@nestjs/config` `ConfigService`.
- `AC-1.7: два контекста с разным process.env получают разные значения`:
  1. `vi.stubEnv('PORT', '3001')`;
  2. собрать `Test.createTestingModule({ imports: [await KitConfigModule.forRoot({ schema: defineEnv({...envBase}) })] }).compile()`, взять `get(ConfigService).get('PORT')` → `3001` (число);
  3. `vi.stubEnv('PORT', '3002')`, собрать второй контекст → `3002`;
  4. закрыть оба (`close()`).

  Гигиена окружения: `ConfigModule` дописывает умолчания в `process.env` (задача 9), а `vi.unstubAllEnvs()` их не убирает. Поэтому:
  - в `beforeEach` — `saved = { ...process.env }`;
  - в `afterEach` — удалить ключи `process.env`, которых нет в `saved`, и вернуть остальные значения `saved`; затем `vi.unstubAllEnvs()`.
- `AC-1.7: неверное окружение → forRoot отклоняется InvalidEnvironmentError с путём METRICS_PORT` (`PORT = METRICS_PORT = 3005`).
- `§3.1: ConfigService отдаёт разобранные типы` — `get('SHUTDOWN_TIMEOUT_MS')` — число 10000.
- `§3.1: KitConfigModule дописывает умолчания разобранных ключей в process.env (поведение @nestjs/config)`. До сборки удалить `METRICS_PORT` из `process.env`; после контекста без него — `process.env.METRICS_PORT === '9100'`. Благодаря гигиене ключ после теста удаляется.

Если `@nestjs/config` 12 кэширует окружение между `forRoot` и тест падает, это дефект реализации, а не теста. Сверить через Context7 `ConfigModule.forRoot` (`validate`, `ignoreEnvFile`) и при необходимости передать `validationOptions`. Тест не ослаблять.

### Ошибки и логи
Нет.

### Тесты
Сама задача — тесты.

### Критерии приёмки
- Тесты зелёные.

### Проверка
- `pnpm test -- test/unit/config/ac-1-7` — зелёный.

## Риски фазы
- Риск: generics zod 4 (`z.ZodType<Output>` в `CompatibleShape`) пропускают несовместимый тип.
  Что делать: AC-1.6 на `@ts-expect-error` ловит это сразу. Правка — в `CompatibleShape`, тест не меняется.
- Риск: `z.coerce.number()` превращает пустую строку в 0.
  Что делать: поведение эталона сохраняется. Для `DB_POOL_*` и `SHUTDOWN_TIMEOUT_MS` 0 отсекает `positive()`.

## Чек-лист завершения фазы
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — зелёные.
- Галочки задач 7–12 в `index.md` обновлены.
