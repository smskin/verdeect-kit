# Phase 3: `definitions.json`, CLI `rabbitmq definitions`, RabbitMQ в `startTestStack`, vhost на воркер

Plan: [index.md](index.md)
Tasks: 9-13
Depends on: Phase 1 (Task 3)

## Objective

Эта фаза даёт инфраструктуру брокера по M3 (§3.4 «CLI `rabbitmq definitions`»): одна внутренняя функция собирает `definitions.json`. Её используют CLI `verdeect-kit rabbitmq definitions --services … [--out …]` и `startTestStack({rabbitmq: true})`. Тестовый стек поднимает RabbitMQ из `TEST_IMAGES`, загружает definitions и создаёт vhost с пользователем на каждый воркер Vitest. `workerScope().rabbitmq` отдаёт `{vhost, url}` (§3.8, этап E5). После прогона vhost и пользователи удаляются (AC-5.18, решение П2).

## Current-Code Evidence

| Path | Symbols / lines | Why it matters |
|------|-----------------|----------------|
| `src/testing/start-test-stack.ts:25-60, 87, 179-265, 271-…` | `TestStackOptions`, `declare module 'vitest' ProvidedContext`, `StackPart {name, start, provide}`, `postgresPart`/`mailpitPart`/`minioPart`, метки `verdeect.kit.service`, `withStartupTimeout(120_000)`, `startTestStack` → `(project) => teardown`; сообщение `не удалось подготовить БД` | новая часть `rabbitmqPart` |
| `src/testing/images.ts` | `TEST_IMAGES.rabbitmq = 'rabbitmq:4.3.6-management-alpine'` | образ |
| `src/testing/worker-scope.ts:20` | `KitWorkerScope {tenant}`, мемоизация на воркер, `VITEST_POOL_ID`; шапка «rabbitmq (E5) — позже» | поле `rabbitmq` |
| `src/testing/worker-scope.test-d.ts` (в `test/unit/testing/`) | type-тест | обновить |
| B `test/support/broker.ts` (309) | `BrokerAdmin` — management API: `PUT api/vhosts/<v>`, `PUT api/permissions/<v>/<u>`, `PUT api/users/<u> {password, tags}`, `DELETE` (204/404), Basic auth из URL брокера; `VITEST_POOL_ID` 1..15 | эталон vhost на воркер (у O его нет) |
| O `docs/messaging.md:38-56` | права `orchestrator`: configure `^orchestrator(\.retry\|\.dlq)?$`, write `^(verdeect\.events\|amq\.default\|orchestrator)$`, read `^(verdeect\.events\|orchestrator(\.retry)?)$`; `amq.default` нужен для DLX `''` и `sendToQueue` | эталон M3 |
| P `docs/deployment.md:58-75` | пассивная `checkExchange` на 4.3 требует хотя бы одно право на exchange; очередь реплики `platform.authz.<id>` в правах | реплика `<svc>.replica.<id>` входит в `^<svc>(\..*)?$` |
| PRD §3.4 CLI | configure `^<svc>(\..*)?$`, write — `verdeect.events`, `amq.default` и свои очереди, read — `verdeect.events` и свои очереди; exchange topic durable; хеш пароля из окружения | контракт |
| `src/cli/main.ts:11` | `COMMANDS = {openapi, db}` — динамический `import()` обработчика | регистрация `rabbitmq` |
| `src/cli/commands/db.ts` | `DbCommandContext {cwd, write, env}`, `CommandError`, `parseArgs` strict → `USAGE`, `INVALID_ENVIRONMENT {keys}`, вывод JSON, `failureOf` | образец команды |
| `src/cli/commands/openapi.ts` | `--out` — `mkdir` + `writeFile` | образец записи файла |
| `src/internal/service-name.ts` | `assertServiceName` | формат имён `--services` |
| `test/integration/global-setup.ts` | `startTestStack({service: 'kit', postgres: true, migrations})` | + `rabbitmq: true` |
| `test/timing/global-setup.ts` | `export { timingGuard as default }` | уровень T E5 нужен стек (П19) |
| `vitest.integration.config.ts` | `fileParallelism: false`, проекты `shared`/`isolated` | `maxWorkers` |

## Files to Change

| Path | Action | Required change |
|------|--------|-----------------|
| `src/internal/rabbitmq-definitions.ts` | create | `buildDefinitions`, `permissionsOf`, `hashRabbitPassword`, `passwordHashKey`, `EVENTS_EXCHANGE` |
| `src/cli/commands/rabbitmq.ts` | create | `rabbitmqCommand` — `definitions` |
| `src/cli/main.ts` | modify | `rabbitmq` в `COMMANDS` |
| `src/testing/start-test-stack.ts` | modify | `rabbitmq` — контейнер, definitions, vhost на воркер, удаление, provide |
| `src/testing/rabbitmq-admin.ts` | create | клиент management API (внутренний модуль `/testing`) |
| `src/testing/worker-scope.ts` | modify | `rabbitmq: {vhost, url}` |
| `test/integration/global-setup.ts` | modify | `rabbitmq: true` |
| `test/timing/global-setup.ts` | modify | `timingGuard` + `startTestStack({postgres, rabbitmq, migrations})` |
| `test/support/broker.ts` | create | `BrokerClient` для тестов (эталон O `test/support/broker.ts`) |
| `test/unit/internal/rabbitmq-definitions.spec.ts`, `test/unit/cli/rabbitmq.spec.ts`, `test/unit/testing/start-test-stack.spec.ts` | create / modify | U |
| `test/integration/cli/ac-5-10-rabbitmq-definitions.spec.ts`, `test/integration/testing/ac-5-18-worker-vhost.spec.ts` | create | I |

## Task 9: `buildDefinitions` — одна функция для CLI и тестового стека

### Intent
§3.4 и UC-12: инфраструктура грузит `definitions.json` в брокер при старте. Права — только на своё (UC-12 А1, AC-5.10). Тестовый контур повторяет production-путь (ARCHITECTURE «Testing → пакет»): vhost воркера собирается той же функцией.

### Implementation Steps
1. Создать `src/internal/rabbitmq-definitions.ts` (`Skill: nestjs-code generic src/internal/rabbitmq-definitions.ts (CREATE)`). Шапка: «definitions.json RabbitMQ (prd.md §3.4 M3, UC-12, AC-5.10). Эталон прав — O docs/messaging.md (or-119), P docs/deployment.md (реплика); обобщение: configure ^<svc>(\..*)?$». Без внешних пакетов: `node:crypto`.
2. Константы: `export const EVENTS_EXCHANGE = 'verdeect.events'`.
3. `export function permissionsOf(service: string): {configure: string; write: string; read: string}`:
   - экранирование: `const s = service.replaceAll('-', '\\-')`. Точка в имени сервиса невозможна по формату; `-` экранировать не обязательно, но так читаемее;
   - `configure: ^${s}(\..*)?$`;
   - `write: ^(verdeect\.events|amq\.default|${s}(\..*)?)$`;
   - `read: ^(verdeect\.events|${s}(\..*)?)$`.
   Отличие от O: O не даёт `read` на `<svc>.dlq`, а `^<svc>(\..*)?$` даёт. По PRD «read — свои очереди», значит, и DLQ (разбор DLQ сервисом). Это решение П13.
4. `export function hashRabbitPassword(password: string, salt = randomBytes(4)): string` — алгоритм `rabbit_password_hashing_sha256`: `base64(salt ‖ sha256(salt ‖ utf8(password)))`. Тест сверяет с известным вектором (задача 13). Точный формат сверить по документации RabbitMQ «Credentials and Passwords → Computing Password Hash» (Context7 или официальный сайт).
5. `export function passwordHashKey(service: string): string` → `RABBITMQ_PASSWORD_HASH_${service.toUpperCase().replaceAll('-', '_')}` (`bff-app` → `RABBITMQ_PASSWORD_HASH_BFF_APP`; решение П3, ответ пользователя).
6. `export interface KitBrokerUser {readonly service: string; readonly user?: string; readonly passwordHash: string}` и
   ```ts
   export function buildDefinitions(input: {readonly vhost?: string; readonly users: readonly KitBrokerUser[]}): RabbitDefinitions
   ```
   - `vhost` по умолчанию `/`;
   - каждый `service` проверяется `assertServiceName(service, 'rabbitmq definitions')`, дубликаты → `TypeError`;
   - `user` по умолчанию = `service`. Тестовый стек передаёт имя пользователя воркера, а права остаются для очередей `service`;
   - результат: `{rabbit_version: '4.3.6', vhosts: [{name: vhost}], users: [{name, password_hash, hashing_algorithm: 'rabbit_password_hashing_sha256', tags: []}], permissions: [{user, vhost, ...permissionsOf(service)}], exchanges: [{name: EVENTS_EXCHANGE, vhost, type: 'topic', durable: true, auto_delete: false, internal: false, arguments: {}}], queues: [], bindings: []}`;
   - очередей в definitions нет: топологию объявляет подписчик (ARCHITECTURE «Сообщения»), иначе TTL `.retry` зафиксировался бы в файле развёртывания;
   - тип `RabbitDefinitions` — внутренний.
7. Пароли и хеши не логируются нигде.

### Required Interfaces and Contracts
- Формат JSON — формат импорта definitions management plugin RabbitMQ 4.x (`rabbitmqctl import_definitions`, `load_definitions`). Сверить поля по документации RabbitMQ (Context7) до реализации.

### Error Handling and Logging
- `TypeError` с текстом `rabbitmq definitions: …` — неверное имя или дубликат.

### Tests
Задача 13.

### Acceptance Criteria
- Функция чистая, детерминированная при заданной соли.

### Verification
- `make test FILTER='rabbitmq-definitions'`.

## Task 10: CLI `verdeect-kit rabbitmq definitions`

### Intent
§3.4, UC-12 шаг 1. Результат — JSON в stdout, ошибка — JSON и выход 1 (ARCHITECTURE «CLI»).

### Implementation Steps
1. `src/cli/commands/rabbitmq.ts` (`Skill: nestjs-code generic src/cli/commands/rabbitmq.ts (CREATE)`) по образцу `db.ts`:
   - `export interface RabbitmqCommandContext {cwd: string; write: (text: string) => void; env: NodeJS.ProcessEnv}` и контекст по умолчанию (`process.cwd()`, `process.stdout.write`, `process.env`);
   - `export async function rabbitmqCommand(args: readonly string[], context = defaultContext): Promise<number>`;
   - подкоманда — `args[0]`. Только `definitions`, иначе `USAGE` («подкоманда: definitions»);
   - `parseArgs({args: args.slice(1), strict: true, options: {services: {type: 'string'}, out: {type: 'string'}}})`. Ошибка разбора, нет `--services`, пустой список или имя вне формата → `USAGE`. Имена — `split(',')`, `trim`, без пустых;
   - хеши: для каждого сервиса ключ `passwordHashKey(service)` из `context.env`. Отсутствующие или пустые → `INVALID_ENVIRONMENT {keys: [...]}`, только имена ключей, в порядке `--services`. Формат значения проверяется по `^[A-Za-z0-9+/]+={0,2}$` и длине base64 ≥ 44 (4 + 32 байта), иначе тот же код с этим ключом;
   - `buildDefinitions({users})` — динамический `import('../../internal/rabbitmq-definitions.js')`;
   - без `--out` в stdout идёт `JSON.stringify(definitions, null, 2) + '\n'`. С `--out <файл>` (от `cwd`) — `mkdir(dirname, {recursive: true})`, `writeFile`, а в stdout идёт `{"out": "<абсолютный путь>", "services": [...]}`;
   - ошибки по образцу `db.ts`: stdout `{"error": {"code", "message", "keys?"}}`, stderr — pino-лог `level: error` без значений; выход 1. Логгер — `createLoggerOptions({service: 'verdeect-kit', entry: 'cli', env: {LOG_LEVEL, REPLICA_ID}})`, как в `db.ts`;
   - `info`-лог успеха: `{services, out?}`, `msg: 'rabbitmq definitions: собрано'`.
2. `src/cli/main.ts` (`Skill: nestjs-code generic src/cli/main.ts (MODIFY)`): `rabbitmq: async () => (await import('./commands/rabbitmq.js')).rabbitmqCommand` в `COMMANDS`. Текст справки (если есть) — плюс `rabbitmq definitions --services <svc,…> [--out <файл>]`.
3. Команда не импортирует `amqplib`, `pg`, `messaging` (ARCHITECTURE: CLI грузит только нужное). Lint-блок `cli` это допускает.

### Required Interfaces and Contracts
- Коды: `USAGE`, `INVALID_ENVIRONMENT`. Выход 0/1.
- Значения хешей не выводятся ни в ошибке, ни в логе. В stdout успеха они есть: это и есть содержимое файла.

### Error Handling and Logging
- `info` — успех; `error` — отказ (код, ключи). Хеши в лог не попадают.

### Tests
Задача 13.

### Acceptance Criteria
- `node dist/cli/main.js rabbitmq definitions --services svc-a,svc-b` с ключами окружения `RABBITMQ_PASSWORD_HASH_SVC_A`, `RABBITMQ_PASSWORD_HASH_SVC_B` (имена — по формату `^[a-z][a-z0-9-]{1,31}$`, не короче 2 знаков) печатает definitions; без ключа — выход 1 и `INVALID_ENVIRONMENT`.

### Verification
- `make build`, затем ручной запуск команды выше с `RABBITMQ_PASSWORD_HASH_SVC_A=… RABBITMQ_PASSWORD_HASH_SVC_B=…`.

## Task 11: RabbitMQ в `startTestStack`, vhost на воркер

### Intent
§3.8 (этап E5): `startTestStack({rabbitmq})` поднимает контейнер раз на прогон и загружает `definitions.json`. Каждый воркер получает свой vhost с пользователем по правам M3 (UC-14 шаг 2). Решение пользователя (вопрос 2) и П2:

- vhost создаёт `globalSetup` заранее, на каждый `VITEST_POOL_ID` 1..`maxWorkers`;
- префикс vhost включает id прогона;
- до создания удаляются оставшиеся тестовые vhost и пользователи от упавших прогонов;
- teardown удаляет всё с префиксом;
- `workerScope()` остаётся синхронной.

### Implementation Steps
1. `src/testing/rabbitmq-admin.ts` (`Skill: nestjs-code generic src/testing/rabbitmq-admin.ts (CREATE)`) — внутренний модуль `/testing`, эталон B `BrokerAdmin`:
   - `export function rabbitAdminFromProvided(managementUrl: string, amqpAdminUrl: string): RabbitAdmin` — логин и пароль администратора берутся из `new URL(amqpAdminUrl)` (`decodeURIComponent(username/password)`), т. е. из `kitRabbitmqUrl`; `kitRabbitmqManagementUrl` учётных данных не содержит (`fetch` Node отклоняет URL с ними). Используют `rabbitmqPart` и все тесты: `rabbitAdminFromProvided(inject('kitRabbitmqManagementUrl'), inject('kitRabbitmqUrl'))`;
   - `class RabbitAdmin {constructor(managementUrl: string, user: string, password: string)}`; запросы через глобальный `fetch` с Basic auth и `content-type: application/json`;
   - методы:
     - `loadDefinitions(defs, vhost?)` → `POST api/definitions` или `POST api/definitions/<vhost>` (`encodeURIComponent`);
     - `listVhosts()` → `GET api/vhosts` → имена;
     - `listUsers()`;
     - `deleteVhost(name)`, `deleteUser(name)` — 204/404 считаются успехом;
     - `queue(vhost, name)` → `GET api/queues/<v>/<q>` → `{durable: boolean; autoDelete: boolean; exclusive: boolean; arguments: Record<string, unknown>; messages: number; messagesReady: number; messagesUnacknowledged: number; consumers: number}` | `null` (404); поля — из `durable`, `auto_delete`, `exclusive`, `arguments`, `messages`, `messages_ready`, `messages_unacknowledged`, `consumers` ответа management API;
   - экспортируемые внутренние функции того же файла (их вызывают `rabbitmqPart` и тест AC-5.18, задача 13):
     - `prepareWorkerVhosts(admin, {service, workers, runId}): Promise<{removed: string[]; workers: {vhost: string; url: string; adminUrl: string}[]}>` — удаляет vhost и пользователей с префиксом `<service>-test-` (остатки прошлых прогонов), затем на каждый `n` в `1..workers`: `buildDefinitions` + `loadDefinitions` + `PUT api/permissions/<v>/<admin>` (шаг 2.3.4);
     - `deleteTestVhosts(admin, prefix): Promise<{vhosts: number; users: number}>` — удаляет vhost и пользователей с префиксом;
   - ответ не из ожидаемого множества → `Error` с методом, путём и статусом, без тела и без пароля.
2. `src/testing/start-test-stack.ts` (`Skill: nestjs-code generic src/testing/start-test-stack.ts (MODIFY)`):
   1. `TestStackOptions` + `readonly rabbitmq?: boolean` (TSDoc: «RabbitMQ TEST_IMAGES.rabbitmq: definitions.json сервиса (verdeect-kit rabbitmq definitions), vhost и пользователь на воркер; адреса — kitRabbitmqUrl, kitRabbitmqManagementUrl, kitRabbitmqWorkers»).
   2. `ProvidedContext` +
      - `kitRabbitmqUrl?: string` — `amqp://<admin>:<pw>@host:port` (vhost `/`, администратор);
      - `kitRabbitmqManagementUrl?: string` — `http://host:port15672`;
      - `kitRabbitmqWorkers?: readonly {vhost: string; url: string; adminUrl: string}[]` — индекс = `VITEST_POOL_ID − 1`. `url` — пользователь воркера, `adminUrl` — администратор, тот же vhost.
   3. `rabbitmqPart(labels, service)`:
      - `start`: `new GenericContainer(TEST_IMAGES.rabbitmq).withExposedPorts(5672, 15672).withEnvironment({RABBITMQ_DEFAULT_USER: 'kit-admin', RABBITMQ_DEFAULT_PASS: <случайный hex 16 байт>}).withLabels(labels).withWaitStrategy(Wait.forLogMessage(/Server startup complete/)).withStartupTimeout(120_000)`. Строку ожидания сверить с логом образа 4.3.6 (у O — ожидание порта). При неудаче — `Wait.forListeningPorts()` плюс опрос `GET api/overview` до 200;
      - `provide(container, project)`:
        1. `runId = randomBytes(4).toString('hex')`, `prefix = \`${service}-test-\``;
        2. **очистка от прошлых прогонов**: `listVhosts()` / `listUsers()`, удалить всё, что начинается с `prefix`. При контейнере на прогон это пустой набор, но защита нужна внешнему брокеру. Удалённые имена — в stderr одной строкой `[startTestStack] удалены vhost прошлых прогонов: …`;
        3. `workers = maxWorkersOf(project)`: `project.config.maxWorkers` (число ≥ 1). Если это строка-процент или `undefined` — `os.availableParallelism()`. При `fileParallelism: false` Vitest всё равно может назначить `VITEST_POOL_ID` 1, поэтому минимум 1. Источник значения сверить по Context7 `vitest` 5 (`TestProject.config.maxWorkers`);
        4. для `n` в `1..workers`: `vhost = user = \`${prefix}${runId}-w${n}\``, пароль — случайный hex, `definitions = buildDefinitions({vhost, users: [{service, user, passwordHash: hashRabbitPassword(password)}]})`, `admin.loadDefinitions(definitions)`. Права администратора на vhost: `definitions` их не дают, поэтому дополнительно `PUT api/permissions/<v>/kit-admin` `{configure: '.*', write: '.*', read: '.*'}` — нужно тестам и `publishTestEvent`;
        5. `buildDefinitions` грузится статически: `internal` без peer, ограничений нет;
        6. `project.provide('kitRabbitmqUrl', …)`, `provide('kitRabbitmqManagementUrl', …)`, `provide('kitRabbitmqWorkers', list)`;
        7. для teardown запомнить `{admin, prefix}`.
   4. Teardown стека (существующий): до остановки контейнеров для части `rabbitmq` вызвать `deleteTestVhosts(admin, prefix)` и написать в stderr `[startTestStack] RabbitMQ: удалено vhost ${vhosts}, пользователей ${users}` (строку проверяет задача 36). Ошибки удаления — в stderr, teardown не падает. Затем `stop()` контейнера. Шаг 2.3 (удаление остатков и создание vhost) — вызов `prepareWorkerVhosts`.
   5. Текст ошибки шага `provide` обобщить: `[startTestStack] не удалось подготовить <part.name>: …` (сейчас «БД»).
   6. Шапка файла: «E5: rabbitmq — definitions.json (internal/rabbitmq-definitions, как CLI), vhost и пользователь на воркер (эталон B test/support/broker.ts), удаление по префиксу <svc>-test-».
3. `test/integration/global-setup.ts` (`Skill: nestjs-code generic test/integration/global-setup.ts (MODIFY)`): `rabbitmq: true`; комментарий шапки — + AC-5.18.
4. `test/timing/global-setup.ts` (`Skill: nestjs-code generic test/timing/global-setup.ts (MODIFY)`) — П19:
   ```ts
   import type { TestProject } from 'vitest/node';
   import { startTestStack } from '../../src/testing/start-test-stack.js';
   import { timingGuard } from '../../src/testing/timing-guard.js';
   const stack = startTestStack({ service: 'kit', postgres: true, rabbitmq: true, migrations: 'test/fixtures/database/migrations' });
   export default async function setup(project: TestProject) { await timingGuard(); return stack(project); }
   ```
   `vitest.timing.config.ts` уже задаёт `globalSetup: ['test/timing/global-setup.ts']` и `fileParallelism: false` — конфиг не меняется.

### Required Interfaces and Contracts
- Новые ключи `provide` — часть `ProvidedContext` (публичный тип `/testing`), TSDoc у каждого.
- Пароли в `provide` есть только внутри URL. В stderr/логи они не попадают.

### Error Handling and Logging
- stderr `[startTestStack] …` — как у существующих частей: старт, ошибка, удаление прошлых vhost.

### Tests
Задача 13.

### Acceptance Criteria
- Интеграционный прогон поднимает RabbitMQ один раз; `kitRabbitmqWorkers` содержит `maxWorkers` записей.

### Verification
- `make test-integration` (весь набор зелёный, время старта стека в отчёте).

## Task 12: `workerScope().rabbitmq` и `test/support/broker.ts`

### Intent
§3.8: `workerScope()` → `{tenant, rabbitmq: {vhost, url}}` (поле этапа E5; `redisPrefix` — E8, в типе отсутствует).

### Implementation Steps
1. `src/testing/worker-scope.ts` (`Skill: nestjs-code generic src/testing/worker-scope.ts (MODIFY)`):
   - `KitWorkerScope` + `readonly rabbitmq: {readonly vhost: string; readonly url: string}` (TSDoc: «vhost воркера с пользователем по правам M3 сервиса из startTestStack; удаляется в teardown прогона (AC-5.18)»);
   - `rabbitmq` — свойство-геттер (`Object.defineProperty`, `enumerable: true`). При первом обращении: `inject('kitRabbitmqWorkers')` (геттер синхронный и не может ждать `loadPeer`: модуль `worker-scope.ts` на верхнем уровне делает `const vitest = await import('vitest').catch(() => undefined)` — без ошибки импорта `/testing`; при `vitest === undefined` геттер бросает `Error(missingPeerMessage('vitest', 'testing'))` из `src/internal/peer.ts`). Индекс `Number(process.env.VITEST_POOL_ID ?? '1') − 1`;
   - нет списка → `TypeError('workerScope().rabbitmq: startTestStack запущен без rabbitmq: true')`; нет записи для воркера → `TypeError` с номером воркера и длиной списка;
   - `tenant` не меняется. Мемоизация — прежняя.
2. `test/unit/testing/worker-scope.test-d.ts` (`Skill: nestjs-code test unit testing worker-scope (MODIFY)`): стр. 7 `toEqualTypeOf<{ readonly tenant: string }>()` → `toEqualTypeOf<{ readonly tenant: string; readonly rabbitmq: { readonly vhost: string; readonly url: string } }>()`; стр. 8 `.not.toHaveProperty('rabbitmq')` → `toHaveProperty('rabbitmq')`; `.not.toHaveProperty('redisPrefix')` остаётся; тест переименовать в `§3.8: в типе tenant и rabbitmq, нет redisPrefix (E8)`, комментарий шапки («в типе E4 только tenant») обновить. `test/unit/testing/worker-scope.spec.ts` (`Skill: nestjs-code test unit testing worker-scope (MODIFY)`) — случаи `§3.8: workerScope().rabbitmq без kitRabbitmqWorkers → TypeError «startTestStack запущен без rabbitmq: true»` и `§3.8: нет записи для VITEST_POOL_ID → TypeError с номером воркера`. `inject` подменяется через `vi.mock('vitest', …)` нельзя (тест сам на vitest), поэтому чтение списка выносится во внутренний параметр `workerScopeWith(readWorkers)`, а `workerScope()` вызывает его с `inject`.
3. `test/support/broker.ts` (`Skill: nestjs-code generic test/support/broker.ts (CREATE)`) — эталон O `test/support/broker.ts` (166), подключение к vhost воркера:
   - `export function workerBroker(): {url, adminUrl, vhost}` — из `inject('kitRabbitmqWorkers')`;
   - `export class BrokerClient`:
     - `static connect(url = workerBroker().adminUrl)` — `amqplib.connect`, канал confirm;
     - `capture(pattern = '#')` → массив `{routingKey, properties, body}` из exclusive auto-delete очереди, привязанной к `verdeect.events`;
     - `publishRaw(routingKey, content, props)`;
     - `sendToQueue(queue, content, props)`;
     - `queueInfo(queue)` → `{messageCount, consumerCount} | null` через `withProbe` (одноразовый канал, 404 не рвёт основной);
     - `take(queue)` (`get` noAck);
     - `purge(...queues)`, `deleteQueue`, `exchangeExists`, `deleteExchange`, `declareEventsExchange`, `close`;
   - `Error.prepareStackTrace` — обход O (`global-setup.ts`: vite-раннер падает на стеках amqplib) только если ошибка воспроизводится. Проверить на первом тесте и сослаться на O в комментарии.

### Error Handling and Logging
Нет (тестовая поддержка).

### Tests
Задача 13.

### Acceptance Criteria
- `workerScope().rabbitmq.url` подключается пользователем воркера к своему vhost.

### Verification
- `make test FILTER='worker-scope'` (typecheck), `make test-integration FILTER='AC-5.18'`.

## Task 13: Тесты фазы — definitions, CLI, AC-5.18

### Implementation Steps
1. `test/unit/internal/rabbitmq-definitions.spec.ts` (`Skill: nestjs-code test unit internal rabbitmq-definitions (CREATE)`):
   - `AC-5.10: permissionsOf('orchestrator') — configure ^orchestrator(\..*)?$, write и read с verdeect.events (+ amq.default у write)`;
   - `AC-5.10: регулярки permissionsOf принимают orchestrator, orchestrator.retry, orchestrator.dlq, orchestrator.replica.r-1 и отклоняют platform, orchestratorx, platform.retry`;
   - `§3.4: buildDefinitions — exchange verdeect.events topic durable, пользователь = сервис, очередей нет`;
   - `§3.4: buildDefinitions — дубликат или имя вне формата → TypeError`;
   - `§3.4: hashRabbitPassword — известный вектор` (соль `908DC60A`, пароль `test12` → `kI3GCqW5JLMJa4iX1lo7X4D6XbYqlLgxIs30+P6tENUV2POR` — пример из документации RabbitMQ; сверить и заменить, если пример другой);
   - `§3.4: passwordHashKey('bff-app') → RABBITMQ_PASSWORD_HASH_BFF_APP`.
2. `test/unit/cli/rabbitmq.spec.ts` (`Skill: nestjs-code test unit cli rabbitmq (CREATE)`), контекст с подменённым `write` и `env`:
   - `UC-12: rabbitmq definitions --services svc-a,svc-b — JSON с двумя пользователями`;
   - `UC-12: без --services / неизвестная подкоманда / имя Bad_Name → USAGE, выход 1`;
   - `UC-12: нет RABBITMQ_PASSWORD_HASH_SVC_B → INVALID_ENVIRONMENT {keys: ['RABBITMQ_PASSWORD_HASH_SVC_B']}, значения в выводе нет`;
   - `UC-12: --out пишет файл и печатает {out, services}` (каталог во временной папке `os.tmpdir()`).
3. `test/unit/testing/start-test-stack.spec.ts` (`Skill: nestjs-code test unit testing start-test-stack (MODIFY)`): файл уже содержит `§3.8: startTestStack — имя сервиса вне формата → TypeError при вызове` и `AC-1.12: без флагов — ни одного контейнера и provide не вызывается` — второй остаётся зелёным (без `rabbitmq` контейнера RabbitMQ нет). Новый случай `§3.8: maxWorkersOf — число → оно же, строка-процент и undefined → os.availableParallelism()` для экспортируемой внутренней `maxWorkersOf` (задача 11, шаг 2.3).
4. `test/integration/cli/ac-5-10-rabbitmq-definitions.spec.ts` (`Skill: nestjs-code test integration cli rabbitmq-definitions (CREATE)`):
   - `AC-5.10: definitions из CLI загружаются в брокер — пользователь входит, exchange verdeect.events виден пассивной проверкой`. Шаги:
     1. `rabbitmqCommand(['definitions', '--services', 'kitcli'], ctx)` с `RABBITMQ_PASSWORD_HASH_KITCLI = hashRabbitPassword(pw)`;
     2. JSON грузится в новый vhost `kit-test-cli-<hex>` через `RabbitAdmin.loadDefinitions(defs с подменённым vhost)`. Поле `vhost` в definitions меняется в тесте — CLI пишет `/`;
     3. `amqplib.connect` пользователем `kitcli` → `checkExchange('verdeect.events')` проходит;
     4. в `finally` vhost и пользователь удаляются.
   Остальная часть AC-5.10 (операции relay и подписчика, `ACCESS_REFUSED`) — задача 27.
5. `test/integration/testing/ac-5-18-worker-vhost.spec.ts` (`Skill: nestjs-code test integration testing worker-vhost (CREATE)`):
   - `AC-5.18: workerScope().rabbitmq — vhost воркера с префиксом <svc>-test-, пользователь воркера входит только в свой vhost`. Соединение по `url` проходит. Соединение тем же пользователем к vhost `/` — `ACCESS_REFUSED` или ошибка 530/403 (сверить код amqplib);
   - `AC-5.18: teardown удаляет vhost и пользователей с префиксом; vhost прошлого прогона удаляется до создания новых`. Вложенный `startTestStack` не запускается (свой контейнер — дорого). Тест вызывает внутренние функции `prepareWorkerVhosts(admin, {service: 'kitvh', workers: 2, runId})` и `deleteTestVhosts(admin, 'kitvh-test-')` — их `rabbitmqPart` использует сам, они вынесены в `src/testing/rabbitmq-admin.ts` (задача 11). `admin = rabbitAdminFromProvided(inject('kitRabbitmqManagementUrl'), inject('kitRabbitmqUrl'))` основного стека. Шаги:
     1. создать «остаток прошлого прогона» `kitvh-test-old-w1`;
     2. `prepareWorkerVhosts` → старый удалён, созданы `kitvh-test-<run>-w1`, `-w2`;
     3. `deleteTestVhosts` → `listVhosts()` / `listUsers()` без префикса `kitvh-test-`.
   - `AC-5.18: после прогона в брокере нет vhost с префиксом теста` — проверка уровня прогона. Задача 36 запускает проект-потребитель (`ac-9-1-consumer.spec.ts`): после его `vitest run` контейнер остановлен, а состояние до остановки проверяет teardown-лог. Поэтому дополнительно: teardown `startTestStack` пишет в stderr `[startTestStack] RabbitMQ: удалено vhost N, пользователей N`, и задача 36 проверяет эту строку в выводе потребителя.

### Tests
Перечислены выше.

### Acceptance Criteria
- `make test`, `make test-integration` зелёные; AC-5.18 и часть AC-5.10 покрыты.

### Verification
- `make test FILTER='rabbitmq'`; `make test-integration FILTER='AC-5.1[08]'`.

## Phase Risks and Mitigations
- Риск: `POST api/definitions/<vhost>` в RabbitMQ 4.3 не принимает `users` и `vhosts` (definitions одного vhost). Смягчение: тогда для vhost воркера пользователь и права создаются раздельно — `PUT api/vhosts`, `PUT api/users`, `PUT api/permissions` из того же объекта `buildDefinitions` (функция `applyDefinitions(admin, defs)` обходит его разделы). Источник прав остаётся одним. Проверка — тест AC-5.18 и AC-5.10.
- Риск: 15672 медленно поднимается после 5672. Смягчение: опрос `api/overview` в `start`.
- Риск: `maxWorkers` больше 15 (B-ограничение `VITEST_POOL_ID`). Смягчение: ограничений по числу нет, создание vhost — O(workers) запросов.

## Phase Completion Checklist
- Задачи 9–13 выполнены; `make test`, `make test-integration`, `make test-timing` (стек стартует) зелёные.
- `index.md` обновлён.
