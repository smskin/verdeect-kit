# Фаза 3: Основа `/testing` — образы, контейнеры, прокси, сторож времени

Plan: [index.md](index.md)
Tasks: 13–21
Depends on: Phase 1 (Tasks 1–5)

## Цель

`src/testing/` содержит экспорты E1 из §3.8: `TEST_IMAGES`, `startTestStack` (только контейнеры `postgres`, `mailpit`, `minio`; адреса через `provide`; без подготовки БД и миграций), `tcpProxy`, `timingGuard`, `TEST_TIMEOUT_SCALE`.

У пакета есть конфиги уровней I и T. Тесты AC-1.12 и AC-1.13 зелёные на Docker хоста. `assertRepoConventions` — фаза 4.

## Свидетельства из кода (эталоны, только чтение)

Пути — `/home/administrator/projects/verdeect2/…`.

| Путь | Символы | Что берём |
|---|---|---|
| `verdeect-orchestrator/apps/orchestrator/test/support/images.ts` (7 строк) | `POSTGRES_IMAGE`, `RABBITMQ_IMAGE`, `REDIS_IMAGE`, `MINIO_IMAGE` | `TEST_IMAGES`; mailpit — из I `global-setup.ts`. Значения — §3.8 PRD |
| `verdeect-orchestrator/…/test/support/global-setup.ts` (265 строк) | `GenericContainer`, `Wait`, `TestProject`, `project.provide(...)`, `declare module 'vitest' { interface ProvidedContext }`, minio: `withExposedPorts(9000)`, `withCommand(['server','/data'])`, `Wait.forHttp('/minio/health/live', 9000)` | запуск контейнеров, `provide`, teardown |
| `verdeect-orchestrator/…/test/support/setup-error.ts` (43 строки) | `reportSetupError(stage, fn)` | текст ошибки `globalSetup` уходит в stderr до throw: Vite теряет текст ошибок globalSetup |
| `verdeect-identity/apps/identity/test/support/global-setup.ts` стр. 65–96 | mailpit: `withExposedPorts(1025, 8025)`, `Wait.forHttp('/livez', 8025).forStatusCode(200)` | mailpit |
| `verdeect-orchestrator/…/test/support/tcp-proxy.ts` (197 строк) | `class TcpProxy` (`constructor(upstreamUrl)`, `url`, `start`, `break`, `restore`, `close`, `blackhole`, `freeze`, `blackholeOn`, `delayOn`), `DEFAULT_PORTS`; `import { waitFor } from './wait.js'` (стр. 12) нужен только `brokerReconnected` (стр. 190, 194); стр. 131 — режим пересылки выбирается при приёме соединения (`if (this.delay === null)`); стр. 141 — `eslint-disable-next-line no-restricted-syntax` под правило O | переносится без `BrokerState`/`brokerReconnected` (они только для брокера; при необходимости — в E5), без `waitFor` и без директивы eslint |
| `verdeect-orchestrator/…/test/support/timing-guard.ts` (43 строки) | `loadavg()[0]`, `availableParallelism()`, `docker ps --format '{{.Label "com.docker.compose.project"}}'`, `/^verdeect-.*-e2e$/` | `timingGuard` |
| `verdeect-orchestrator/apps/orchestrator/vitest.integration.config.ts`, `vitest.timing.config.ts` | проекты `shared` (`isolate: false`) / `isolated`, `fileParallelism: false`, `testTimeout 60_000*scale`, `hookTimeout 180_000*scale` | конфиги I и T |

## Файлы

| Путь | Действие | Что |
|---|---|---|
| `src/testing/images.ts` | create | `TEST_IMAGES` |
| `src/testing/tcp-proxy.ts` | create | `TcpProxy`, `tcpProxy` |
| `src/testing/timing-guard.ts` | create | `timingGuard`, `runTimingGuard` (внутр.) |
| `src/testing/start-test-stack.ts` | create | `startTestStack`, `ProvidedContext` |
| `src/testing/index.ts` | create | экспорты E1 (дополняется в фазе 4) |
| `vitest.integration.config.ts`, `vitest.timing.config.ts` | create | уровни I, T |
| `test/integration/global-setup.ts`, `test/timing/global-setup.ts` | create | globalSetup |
| `test/unit/testing/*.spec.ts`, `test/integration/testing/*.spec.ts`, `test/timing/testing/*.spec.ts` | create | тесты |

## Task 13: `TEST_IMAGES`

**Skill:** nestjs-code generic src/testing/images.ts (CREATE)

### Шаги
1. `src/testing/images.ts`. Шапка: `// Образы тестового контура (prd.md §3.8, E1); эталон — O test/support/images.ts.`
   ```ts
   /** Образы тестов и compose сервисов (§3.8); мажорная смена образа — мажор пакета (G14). */
   export const TEST_IMAGES = {
       postgres: 'postgres:17.11-alpine3.24',
       redis: 'redis:7.4.11-alpine',
       rabbitmq: 'rabbitmq:4.3.6-management-alpine',
       mailpit: 'axllent/mailpit:v1.31.6',
       minio: 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
   } as const;
   ```
   `redis` и `rabbitmq` есть в E1: `TEST_IMAGES` — экспорт E1 целиком (§3.8), а правило `test-images` (фаза 4) проверяет все пять.
2. Внутренний помощник `imageRepository(image)` — часть до последнего `:` (`axllent/mailpit`). Экспортировать из файла для фазы 4, не из `index.ts`.

### Тесты
`test/unit/testing/test-images.spec.ts`:
- `§3.8: TEST_IMAGES — ровно пять образов PRD` — сравнить объект целиком;
- `§3.8: imageRepository` — `axllent/mailpit`, `pgsty/minio`, `postgres`.

### Критерии приёмки и проверка
- `pnpm test` — зелёный.

## Task 14: `tcpProxy`

**Skill:** nestjs-code generic src/testing/tcp-proxy.ts (CREATE)

### Назначение
Обрывы и задержки TCP в тестах (§3.8, E1). Переносится эталон O.

### Шаги
1. Скопировать `verdeect-orchestrator/apps/orchestrator/test/support/tcp-proxy.ts` в `src/testing/tcp-proxy.ts`. Шапка — эталон и коммит O: `git -C /home/administrator/projects/verdeect2/verdeect-orchestrator log -1 --format=%h -- apps/orchestrator/test/support/tcp-proxy.ts`.
   - удалить `BrokerState`, `brokerReconnected` и `import { waitFor } from './wait.js'`: `waitFor` нужен только `brokerReconnected`. Файла `wait.ts` в пакете нет;
   - удалить комментарий `// eslint-disable-next-line no-restricted-syntax -- delayOn(ms): …` (стр. 141). Правило O в пакете устроено иначе, директива стала бы неиспользуемой;
   - класс `TcpProxy` и его методы сохранить: `url`, `start`, `break`, `restore`, `close`, `blackhole`, `freeze`, `blackholeOn`, `delayOn`, `DEFAULT_PORTS`;
   - добавить TSDoc ко всем публичным методам. У `delayOn` сохранить смысл эталона: «для соединений после вызова». Режим пересылки (`pipe` или ручная очередь с задержкой) выбирается при приёме соединения, поэтому `delayOn` не влияет на уже открытые соединения.
2. Фабрика:
   ```ts
   /** Запущенный TCP-прокси к target (URL с портом или схемой из DEFAULT_PORTS). */
   export async function tcpProxy(target: string): Promise<TcpProxy> { return new TcpProxy(target).start(); }
   ```
3. `console.*` в эталоне, если есть, удалить без замены (NFR-8, lint).

### Ошибки и логи
Ошибки сокетов, которые эталон глушит, остаются заглушёнными. Логов нет.

### Тесты
`test/unit/testing/tcp-proxy.spec.ts` — локальный `net.createServer` эхо-сервер на `127.0.0.1:0`, без Docker:
- `§3.8: tcpProxy — данные проходят к цели и обратно`;
- `§3.8: break → новое соединение отклоняется; restore → снова проходит на том же порту`;
- `§3.8: blackhole — соединение принято, ответа нет`. Ожидание 200 мс, затем проверка, что данных нет;
- `§3.8: close освобождает порт`.

### Критерии приёмки и проверка
- `pnpm test -- test/unit/testing/tcp-proxy` — зелёный. В спецификации нет `sleep` дольше 300 мс.

## Task 15: `timingGuard`

**Skill:** nestjs-code generic src/testing/timing-guard.ts (CREATE)

### Назначение
`globalSetup` уровня T: печатает нагрузку и число ядер, предупреждает при перегрузке и не даёт мерить время при запущенном e2e-контуре (эталон O).

### Шаги
```ts
// Сторож замеров времени для globalSetup уровня T (prd.md §3.8, E1); эталон — O test/support/timing-guard.ts.
interface TimingGuardDeps {
    readonly load: () => number;               // loadavg()[0]
    readonly cores: () => number;              // availableParallelism()
    readonly composeProjects: () => Promise<readonly string[] | null>;  // null — docker CLI нет
    readonly write: (line: string) => void;    // process.stderr.write
}
/** Внутренняя логика; экспорт для тестов, не из index.ts. */
export async function runTimingGuard(deps: TimingGuardDeps): Promise<void>
/** globalSetup уровня T: нагрузка, ядра, запрет при запущенном e2e-контуре verdeect-*-e2e. */
export function timingGuard(): Promise<void>
```
Порядок `runTimingGuard`:
1. Вывести `[timingGuard] load=<load.toFixed(2)> cores=<n>\n`.
2. Если `load > cores`, вывести `[timingGuard] WARN: нагрузка выше числа ядер — замеры времени ненадёжны\n`.
3. `composeProjects()`:
   - `null` → вывести `[timingGuard] docker недоступен — проверка e2e-контура пропущена\n` и выйти;
   - иначе отфильтровать `/^verdeect-.*-e2e$/`. Если есть совпадения: `message = [timingGuard] запущен e2e-контур <имена через запятую> — остановите его перед замерами времени`, вывести `message + '\n'` и бросить `new Error(message)`. Вывод в stderr до throw нужен из-за Vite, который теряет текст ошибок globalSetup (эталон).

`composeProjects` по умолчанию: `execFile('docker', ['ps', '--format', '{{.Label "com.docker.compose.project"}}'])` через `promisify`. **Любая** неудача `execFile` → `null`, как bare `catch` эталона: нет CLI (`ENOENT`), демон остановлен, нет прав на сокет. Timing-тест пакета (задача 21) Docker не требует, и остановленный демон не должен ронять `pnpm test:timing`. Строки обрезать, пустые убрать, дубли убрать.

### Ошибки и логи
Это единственные строки пакета в stderr в E1: назначение функции — сообщать о среде. Используется `process.stderr.write`, не `console`.

### Тесты
`test/unit/testing/timing-guard.spec.ts` — с подставными deps:
- `§3.8: timingGuard — печатает load и cores`;
- `… load > cores → WARN`;
- `… e2e-контур verdeect-orchestrator-e2e запущен → ошибка с именем, строка в write до throw`;
- `… docker CLI нет → пропуск без ошибки`;
- `… docker ps завершился с ошибкой (демон остановлен) → пропуск без ошибки`. Проверяется на умолчании `composeProjects`: подставить `execFile`, который отклоняется ошибкой с `code: 1`. Для этого `defaultComposeProjects(exec)` экспортируется из файла, не из `index.ts`;
- `… проект verdeect-orchestrator (без -e2e) → без ошибки`.

### Критерии приёмки и проверка
- `pnpm test` — зелёный.

## Task 16: `startTestStack`

**Skill:** nestjs-code generic src/testing/start-test-stack.ts (CREATE)

### Назначение
`globalSetup` Vitest: контейнеры раз на прогон, адреса через `provide` (§3.8, E1; AC-1.12, AC-1.13).

В E1 только `postgres`, `mailpit`, `minio`:
- без `prepareDatabase` и миграций (E4);
- без `rabbitmq`/`outboxEvents` (E5) и `redis` (E8);
- без `migrations`, `workerScope`.

Полей следующих этапов в типе нет.

### Шаги
1. Загрузка peer — top-level await (AC-1.2):
   ```ts
   import type { TestProject } from 'vitest/node';
   import type * as Testcontainers from 'testcontainers';
   const { GenericContainer, Wait } = await loadPeer<typeof Testcontainers>('testcontainers', 'testing');
   ```
2. Типы и аугментация:
   ```ts
   /** Параметры startTestStack в E1 (§3.8). */
   export interface TestStackOptions {
       readonly service: string;      // имя экземпляра, assertServiceName
       readonly postgres?: boolean;
       readonly mailpit?: boolean;
       readonly minio?: boolean;
   }
   declare module 'vitest' {
       interface ProvidedContext {
           /** postgres://postgres:<пароль>@<host>:<port>/postgres — суперпользователь (флаг postgres). */
           kitPostgresUrl?: string;
           /** smtp://<host>:<port 1025> (флаг mailpit). */
           kitSmtpUrl?: string;
           /** http://<host>:<port 8025> — HTTP API mailpit (флаг mailpit). */
           kitMailpitUrl?: string;
           /** http://<host>:<port 9000> (флаг minio). */
           kitS3Endpoint?: string;
           /** Пользователь MinIO (флаг minio). */
           kitS3AccessKey?: string;
           /** Пароль MinIO, случайный на прогон (флаг minio). */
           kitS3SecretKey?: string;
       }
   }
   /** globalSetup Vitest: `export default startTestStack({...})`. */
   export function startTestStack(options: TestStackOptions): (project: TestProject) => Promise<() => Promise<void>>
   ```
   Формат `ProvidedContext` и `project.provide` для Vitest 5.0.4 сверить через Context7.
3. `startTestStack` синхронно вызывает `assertServiceName(options.service, 'startTestStack')` и возвращает setup-функцию.
4. Setup-функция:
   - собрать список запусков только для флагов `=== true`;
   - каждому контейнеру — `.withLabels({ 'verdeect.kit.service': options.service })`;
   - **postgres** — `new GenericContainer(TEST_IMAGES.postgres)`:
     - `.withEnvironment({ POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: password, POSTGRES_DB: 'postgres' })`, где `password = randomBytes(16).toString('hex')`;
     - `.withExposedPorts(5432)`, `.withTmpFs({ '/var/lib/postgresql/data': 'rw' })`;
     - `.withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])`;
     - `.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))`, `.withStartupTimeout(120_000)`;
     - provide `kitPostgresUrl`;
   - **mailpit** — образ `TEST_IMAGES.mailpit`, порты 1025 и 8025, `Wait.forHttp('/livez', 8025).forStatusCode(200)`. Provide `kitSmtpUrl`, `kitMailpitUrl`;
   - **minio** — образ `TEST_IMAGES.minio`:
     - `withEnvironment({ MINIO_ROOT_USER: 'kit-test', MINIO_ROOT_PASSWORD: randomBytes(16).toString('hex') })`;
     - `withExposedPorts(9000)`, `withCommand(['server', '/data'])`, `Wait.forHttp('/minio/health/live', 9000)`, `withStartupTimeout(120_000)`;
     - provide `kitS3Endpoint`, `kitS3AccessKey`, `kitS3SecretKey`.

     Bucket не создаётся: S3-клиента в пакете нет (N8). `MINIO_KMS_SECRET_KEY` из O не переносится: он нужен только для SSE домена O;
   - адреса: `container.getHost()` и `container.getMappedPort(port)`;
   - старт параллельно, `Promise.allSettled`. При любой неудаче: остановить запущенные, `message = [startTestStack] не удалось запустить <имена>: <error.message первой неудачи>`, вывести `process.stderr.write(message + '\n')` (эталон `setup-error.ts`), бросить `new Error(message, { cause })`;
   - вернуть teardown: `await Promise.all(started.map((c) => c.stop()))`.
5. Без флагов ничего не стартует и `provide` не вызывается. Teardown — пустая функция.

### Контракты
- Пароли случайные на прогон и уходят только в `provide`, не в логи.
- Контейнеры стартуют раз на прогон — один вызов setup Vitest на `globalSetup`.

### Ошибки и логи
Одна строка в stderr при неудаче старта, без паролей: сообщение testcontainers паролей не содержит, свои значения в текст не добавляются.

### Тесты
Unit — задача 19, I — задача 20.

### Критерии приёмки и проверка
- `pnpm typecheck`, `pnpm lint` — код 0.

## Task 17: `src/testing/index.ts` (экспорты E1, часть 1)

**Skill:** nestjs-code generic src/testing/index.ts (CREATE)

### Шаги
1. `export { TEST_IMAGES } from './images.js'`, `export { startTestStack } from './start-test-stack.js'`, `export { tcpProxy } from './tcp-proxy.js'`, `export type { TcpProxy } from './tcp-proxy.js'`, `export { timingGuard } from './timing-guard.js'`, `export { TEST_TIMEOUT_SCALE } from './timeout-scale.js'`.
2. `assertRepoConventions` добавляет задача 23.
3. Рабочий код пакета `src/testing` не импортирует (lint, задача 3).

### Критерии приёмки и проверка
- `pnpm typecheck` — код 0.

## Task 18: Конфиги Vitest уровней I и T, globalSetup пакета

**Skill:** nestjs-code generic vitest.integration.config.ts (CREATE); nestjs-code generic vitest.timing.config.ts (CREATE); nestjs-code generic test/integration/global-setup.ts (CREATE); nestjs-code generic test/timing/global-setup.ts (CREATE)

### Шаги
1. `vitest.integration.config.ts`:
   ```ts
   const INCLUDE = ['test/integration/**/*.spec.ts'];
   // isolated: файлы, которые пишут process.env / vi.stubEnv, используют vi.mock, патчат прототипы
   // или инициализируют процесс-глобальное состояние; каждый — с причиной. Остальные — shared (skill-context «Fast Test Suites» (3)).
   const ISOLATED: string[] = [];
   export default defineConfig({
       plugins: [swc.vite({ module: { type: 'es6' } })],
       test: {
           environment: 'node',
           globalSetup: ['test/integration/global-setup.ts'],
           fileParallelism: false,
           testTimeout: 60_000 * TEST_TIMEOUT_SCALE,
           hookTimeout: 180_000 * TEST_TIMEOUT_SCALE,
           projects: [
               { extends: true, test: { name: 'shared', include: INCLUDE, exclude: ISOLATED, isolate: false } },
               { extends: true, test: { name: 'isolated', include: ISOLATED, isolate: true } },
           ],
       },
   });
   ```
   - Проект с пустым `include` Vitest может отвергнуть («No test files found» на проект). Тогда проект `isolated` добавляется условно: `...(ISOLATED.length > 0 ? [isolatedProject] : [])`. Комментарий в конфиге сохраняется.
   - `extends: true` и наследование `globalSetup` в Vitest 5 сверить через Context7.
2. `test/integration/global-setup.ts`: `export default startTestStack({ service: 'kit', postgres: true });` — импорт из `../../src/testing/start-test-stack.js`.
3. `vitest.timing.config.ts`: `include: ['test/timing/**/*.spec.ts']`, `globalSetup: ['test/timing/global-setup.ts']`, `fileParallelism: false`, `testTimeout: 60_000 * TEST_TIMEOUT_SCALE`, `hookTimeout: 60_000 * TEST_TIMEOUT_SCALE`, плагин swc. Проектов нет.
4. `test/timing/global-setup.ts`: `export { timingGuard as default } from '../../src/testing/timing-guard.js';`.

### Критерии приёмки и проверка
- `pnpm test:integration` и `pnpm test:timing` проходят после задач 20–21.

## Task 19: Unit-тесты `startTestStack`

**Skill:** nestjs-code test unit testing/start-test-stack (CREATE)

### Шаги
`test/unit/testing/start-test-stack.spec.ts`:
- `§3.8: startTestStack — имя сервиса вне формата → TypeError при вызове` (`'Kit'`, `'k'`);
- `AC-1.12: без флагов — ни одного контейнера и provide не вызывается`. Подставной `project = { provide: vi.fn() }`, `await (await startTestStack({ service: 'kit-unit' })(project as never))()`. Проверить `provide` без вызовов. Контейнеры не стартуют: тест работает без Docker.

### Критерии приёмки и проверка
- `pnpm test` — зелёный без Docker.

## Task 20: Integration-тесты AC-1.12 и AC-1.13

**Skill:** nestjs-code test integration testing/start-test-stack (CREATE)

### Шаги
1. `test/support/docker.ts` (общий для I):
   ```ts
   /** Образы запущенных контейнеров с меткой verdeect.kit.service=<service>. */
   export async function runningImages(service: string): Promise<string[]>
   ```
   `execFile('docker', ['ps', '--filter', `label=verdeect.kit.service=${service}`, '--format', '{{.Image}}'])`.
2. `test/integration/testing/ac-1-13-postgres.spec.ts` — использует globalSetup пакета (`service: 'kit'`, `postgres: true`):
   - `AC-1.13: kitPostgresUrl передан через provide, PostgreSQL 17.11 отвечает`. `inject('kitPostgresUrl')` определён. `new pg.Client({ connectionString })` → `show server_version` начинается с `17.11`;
   - `AC-1.13: контейнер — образ TEST_IMAGES.postgres` — `runningImages('kit')` содержит `TEST_IMAGES.postgres`;
   - `AC-1.13: подготовки БД нет` — `select count(*) from pg_roles where rolname like '%\_app'` = 0; схем, кроме стандартных, нет (`select nspname from pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg\_%'` → пусто);
   - `AC-1.13: без флага postgres контейнер не стартует`. Вызвать `startTestStack({ service: 'kit-no-pg', mailpit: false })` с подставным `provide`. `runningImages('kit-no-pg')` пуст, `provide` не вызван с `kitPostgresUrl`.
3. `test/integration/testing/ac-1-12-mailpit-minio.spec.ts` — вызывает `startTestStack` напрямую с подставным `project`, собирающим `provide` в `Map`; teardown в `afterAll`:
   - `AC-1.12: mailpit и minio подняты из TEST_IMAGES` — `runningImages('kit-mail-s3')` равен множеству `{TEST_IMAGES.mailpit, TEST_IMAGES.minio}`;
   - `AC-1.12: адреса переданы через provide` — `kitSmtpUrl` (`smtp://`), `kitMailpitUrl` + `fetch(url + '/livez')` → 200, `kitS3Endpoint` + `fetch(endpoint + '/minio/health/live')` → 200, `kitS3AccessKey`, `kitS3SecretKey` непустые;
   - `AC-1.12: без флагов mailpit/minio не стартуют` — `startTestStack({ service: 'kit-no-mail', postgres: false })`, `runningImages('kit-no-mail')` пуст, ключи `kitSmtpUrl`/`kitS3Endpoint` не переданы;
   - `AC-1.12: после teardown контейнеров нет` — `runningImages('kit-mail-s3')` пуст после вызова teardown.

### Ошибки и логи
Нет.

### Критерии приёмки и проверка
- `pnpm test:integration` — зелёный (нужен Docker).

## Task 21: Timing-тест `tcpProxy`

**Skill:** nestjs-code test integration testing/tcp-proxy-delay (CREATE)

### Шаги
`test/timing/testing/tcp-proxy-delay.spec.ts`:
Порядок важен: `delayOn` действует только на соединения, открытые после вызова (режим выбирается при приёме соединения).
- `§3.8 (T): tcpProxy.delayOn задерживает совпавший пакет не меньше заданного` — эхо-сервер, **сначала** `proxy.delayOn(/ping/, 300)`, затем открыть клиентское соединение к `proxy.url`. Время ответа на `ping` ≥ 300 мс и < 300 мс + 1000 × `TEST_TIMEOUT_SCALE`;
- `§3.8 (T): после count задержек трафик идёт без задержки` (`count = 1`). Второй `ping` — в **том же** соединении, после ответа на первый; ответ быстрее 100 мс × `TEST_TIMEOUT_SCALE`.

Сигнатура сверена с эталоном: `delayOn(pattern: RegExp, ms: number, count = 1): void` (стр. 83 `tcp-proxy.ts` O).

### Критерии приёмки и проверка
- `pnpm test:timing` — зелёный на тихой машине.

## Риски фазы
- Риск: `Wait.forLogMessage(…, 2)` у postgres alpine — сообщение готовности выводится дважды (init и рабочий старт).
  Что делать: так и задумано. Если образ меняет поведение, использовать `Wait.forListeningPorts()` + `pg_isready` через `container.exec`.
- Риск: Vitest теряет текст ошибки globalSetup.
  Что делать: stderr до throw (задача 16).

## Чек-лист завершения фазы
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:timing` — зелёные.
- Галочки задач 13–21 в `index.md` обновлены.
