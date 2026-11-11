# @verdeect/kit

Общий инфраструктурный пакет NestJS-сервисов Вердикта 2.0: схема окружения, тестовый контур, наблюдаемость, HTTP, а в следующих этапах — БД с RLS, идемпотентность, сообщения, шифр и Redis. Один пакет с подпутями и одной версией заменяет копии `src/shared/**` в сервисах. Требования — [requirements/0000-kit/prd.md](requirements/0000-kit/prd.md).

## Совместимость

| `@verdeect/kit`         | `@verdeect/events` | `@verdeect/auth` | `@verdeect/platform-client` |
| ----------------------- | ------------------ | ---------------- | --------------------------- |
| `1.0.0-rc.N` (после E8) | `1.0.0-rc.N`       | `^1.0.1`         | `1.1.x`                     |

Промежуточных версий по этапам нет (G14): E1–E8 копятся в `[Unreleased]`, после E8 выходит `1.0.0-rc.1` (метка npm `next`), дальше `1.0.0-rc.N`. `1.0.0` (метка `latest`) — после перехода Identity. `@verdeect/events` выходит тем же порядком: `1.0.0-rc.N` после `@verdeect/kit 1.0.0-rc.1`, `1.0.0` — вместе с `@verdeect/kit 1.0.0` (prd.md §3.9). С `1.0.0` поддерживается только последний мажор (NFR-5): исправления выходят патчем последнего мажора, без бэкпортов.

## Установка

```bash
pnpm add @verdeect/kit@1.0.0-rc.N   # после E8; до 1.0.0 — точный пин rc
```

Версия пакета в сервисе — точная. Обязательные peer-зависимости (NFR-3) — точными версиями в диапазоне пакета:

- `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/platform-fastify`;
- `fastify`, `reflect-metadata`, `rxjs`, `zod`, `drizzle-orm`;
- `nestjs-pino`, `pino`, `@prometheus-io/client`, `@sentry/nestjs`, `@verdeect/auth`.

Опциональные peer нужны только подпути, который их использует. Без них подпуть не импортируется и называет библиотеку: «`@verdeect/kit/<подпуть>` требует `<библиотека>` — добавьте в зависимости сервиса» (AC-1.2).

| Подпуть                     | Опциональные peer                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `/config`                   | —                                                                                       |
| `/http`                     | —                                                                                       |
| `/database`, `/idempotency` | `pg`                                                                                    |
| `/testing`                  | `testcontainers`, `vitest`; `@nestjs/testing` — только для `createTestApp` (при вызове) |
| остальные                   | в своих этапах                                                                          |

`/database` и `/idempotency` проверяют `pg` синхронно при импорте (текст AC-1.2) и загружают `pg` и драйвер Drizzle лениво при первом вызове. Top-level await в этих подпутях нет, поэтому схему сервиса с `tenantColumn` и `createIdempotencyTable` загружает `drizzle-kit` (он грузит схему через `require`).

## Подпути

| Подпуть          | Этап | Статус                  |
| ---------------- | ---- | ----------------------- |
| `/config`        | E1   | готов, в `[Unreleased]` |
| `/testing`       | E1   | готов, в `[Unreleased]` |
| `/observability` | E2   | готов, в `[Unreleased]` |
| `/http`          | E3   | готов, в `[Unreleased]` |
| `/database`      | E4   | готов, в `[Unreleased]` |
| `/idempotency`   | E4   | готов, в `[Unreleased]` |
| `/messaging`     | E5   | в своём этапе           |
| `/crypto`        | E7   | в своём этапе           |
| `/redis`         | E8   | в своём этапе           |

Все подпути выходят вместе в `1.0.0-rc.1` после E8 (G14).

Корневой точки входа `.` нет: каждый импорт называет подпуть.

## Конфигурация окружения

```ts
import { ConfigService } from '@nestjs/config';
import {
    booleanFlag,
    defineEnv,
    envBase,
    envDatabase,
    envServiceUrls,
    KitConfigModule,
    parseEnv,
} from '@verdeect/kit/config';

export const envSchema = defineEnv({
    ...envBase,
    ...envDatabase,
    ...envServiceUrls(['identity']),
    FEATURE_X: booleanFlag(false),
});

const env = parseEnv(envSchema, process.env); // InvalidEnvironmentError при ошибке

@Module({ imports: [await KitConfigModule.forRoot({ schema: envSchema })] })
export class AppModule {}
// В провайдерах: config.get('PORT') через ConfigService.
```

Ключи пакета (prd.md §3.1):

| Фрагмент         | Ключ                                                 | Умолчание                                              |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `envBase`        | `NODE_ENV`                                           | `production` (`development`, `test`)                   |
| `envBase`        | `LOG_LEVEL`                                          | `info` (`fatal` … `trace`, `silent`)                   |
| `envBase`        | `PORT`                                               | 3000                                                   |
| `envBase`        | `METRICS_PORT`                                       | 9100; не равен `PORT`, кроме 0                         |
| `envBase`        | `REPLICA_ID`                                         | `hostname()`                                           |
| `envBase`        | `SHUTDOWN_TIMEOUT_MS`                                | 10000                                                  |
| `envBase`        | `SHUTDOWN_DRAIN_MS`                                  | 0; меньше `SHUTDOWN_TIMEOUT_MS`                        |
| `envDatabase`    | `DATABASE_URL`                                       | обязателен                                             |
| `envDatabase`    | `DB_POOL_MAX`                                        | 10                                                     |
| `envDatabase`    | `DB_POOL_ACQUIRE_TIMEOUT_MS`                         | 5000 (минимум 1)                                       |
| `envMessaging`   | `RABBITMQ_URL`                                       | обязателен                                             |
| `envMessaging`   | `RABBITMQ_RETRY_SECONDS`                             | 30 (целое ≥ 1)                                         |
| `envRedis`       | `REDIS_URL`                                          | обязателен                                             |
| `envSentry`      | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | пусто → `null`                                         |
| `envCrypto`      | `ENCRYPTION_KEYS`                                    | JSON `[{version, secret}]`, секрет base64url ≥ 32 байт |
| `envServiceUrls` | `SERVICE_URLS`                                       | JSON `{имя: http(s)-URL}`, названные имена обязательны |

Правила:

- путь ключа в ошибке — полный, через точку (`SERVICE_URLS.identity`, `ENCRYPTION_KEYS.0.secret`); ошибка без пути — `(root)`;
- значений окружения в ошибке нет никогда — только пути ключей (NFR-4);
- переименования ключей идут без псевдонимов: старое имя не читается (C0, P0);
- ключ пакета, переопределённый несовместимым типом, — ошибка компиляции (AC-1.6);
- `KitConfigModule` (через `@nestjs/config`) дописывает в `process.env` умолчания разобранных ключей. В тестах с несколькими контекстами Nest окружение сохраняется и восстанавливается целиком, а не через `vi.unstubAllEnvs()`.

## Наблюдаемость

`@verdeect/kit/observability` (prd.md §3.2) — логи, GlitchTip, `/health` и `/metrics`, остановка. Nest-модуля нет: классы собирает `bootstrapService` (`/http`) или сам сервис.

**Ранний `instrument.ts`.** Интеграции `@sentry/nestjs` требуют инициализации до загрузки приложения, поэтому `initSentry` вызывается в отдельном файле, который подключается через `node --import`:

```ts
// src/instrument.ts
import { initSentry } from '@verdeect/kit/observability';
import { redaction } from './redaction.js';

initSentry({ service: 'files', redaction });
```

```sh
node --import ./dist/instrument.js dist/main.js
```

GlitchTip включается только при непустом верном `SENTRY_DSN` и `NODE_ENV = production`; неверное значение `SENTRY_*` выключает его без исключения.

**Общий `KitRedaction`.** Один объект на сервис — `src/redaction.ts`, только с импортом типов из `@verdeect/kit/observability` (правило `redaction-imports`). Тот же объект передаётся и в `createLoggerOptions`, и в `initSentry`: имена и маска пути в логах и GlitchTip совпадают.

```ts
// src/redaction.ts
import type { KitRedaction } from '@verdeect/kit/observability';

export const redaction: KitRedaction = {
    sensitiveKeys: ['inn'],
    maskPath: (path) => path.replace(/^\/share\/[^/]+/, '/share/***'),
};
```

**Логгер.** `createLoggerOptions` возвращает `Params` `nestjs-pino` с кортежем `[options, stream]`. Логгер вне Nest — `pino(...params.pinoHttp)`. На Fastify генератор trace-id передаётся и адаптеру: `new FastifyAdapter({genReqId: params.pinoHttp[0].genReqId})` — так делает `createHttpApp`.

**Один журнал доступа на процесс.** `nestjs-pino` 5.3 создаёт один pino-http на процесс (первая конфигурация выигрывает), сбросить его пакет не даёт. Сервис — одно приложение на процесс, и это не мешает: опции журнала доступа (`trustTraceparent` для строки доступа, `quietRoutes`, `redaction`) берутся из первого созданного приложения. Логгер ядра каждого приложения (`KitLifecycle`, `HealthRegistry`, сервер метрик) и trace-id адаптера — свои. В тестах сервиса `createTestApp` с другими опциями логгера (`trustTraceparent`, `quietRoutes`, `redaction`) кладите в отдельный файл Vitest: каждый файл идёт в своём процессе.

**`/health` и `/metrics`.** `MetricsServer` слушает `METRICS_PORT` (`node:http`, вне Nest; `0` — порт выбирает ОС). Пробы регистрируют владельцы зависимостей: `health.register(name, probe, {critical})`. Ошибка прослушивания (`EADDRINUSE`) — отказ `listen()`, её передают в `failStartup`.

**Остановка `KitLifecycle`.** Участники регистрируются на шаг: `lifecycle.register(participant, {step})`.

| Шаг | Что                                                                       |
| --- | ------------------------------------------------------------------------- |
| 1   | `/health` → 503, пауза `SHUTDOWN_DRAIN_MS` (выполняет сам `KitLifecycle`) |
| 2   | HTTP не принимает новые соединения, начатые дорабатывают; потоки SSE      |
| 3   | хуки модулей Nest, подписчики, relay, очистка                             |
| 4   | пулы БД, RabbitMQ, Redis                                                  |
| 5   | сервер метрик                                                             |

Участники шага работают параллельно, следующий шаг начинается после предыдущего. Два режима:

- **сигнал ОС** (`lifecycle.listen()`, `SIGTERM`, `SIGINT`) — сторож срока `SHUTDOWN_TIMEOUT_MS` от сигнала (пауза входит). Срок вышел — `error`-лог `SHUTDOWN_TIMEOUT`, событие GlitchTip, `exit(1)`. Шаги в срок — `exit` не вызывается, процесс без открытых дескрипторов выходит сам с кодом 0; если не вышел к сроку (утёк таймер или сокет) — `SHUTDOWN_NOT_EXITED` и `exit(1)`;
- **программный `close()`** (тесты сервиса, CLI) — те же шаги 1–5 без сторожа и без `exit`; ошибка участника — отказ `close()` после всех шагов (несколько — `AggregateError`). Безопасен в тестах сервиса.

**Метрики.** `kitMetrics` построен на `@prometheus-io/client` (обязательный peer `^0.16.1`, PRD v1.12): свой `Registry` на экземпляр приложения, метка `service`, метрики процесса Node.

**Алерты.** `alertRulesTemplate` — путь к `alerts/verdeect-kit.rules.yml` в установленном пакете: правила vmalert для метрик пакета с порогом по умолчанию. Свой порог — recording-правило `verdeect_kit_threshold:<метрика>` с меткой `service` в файле правил сервиса:

```yaml
- record: verdeect_kit_threshold:outbox_lag_seconds
  expr: vector(30)
  labels:
    service: platform
```

Пороги: `outbox_lag_seconds` (5 с за 1m), `outbox_pending` (1000 за 5m), `events_consumed` (DLQ за 15m > 0), `db_pool_wait_timeouts` (за 5m > 0), `rate_limit_unavailable` (за 5m > 0).

## HTTP

`@verdeect/kit/http` (prd.md §3.5) — точка входа сервиса, словарь ошибок, проверка ввода, keyset-пагинация и OpenAPI.

**`main.ts`.** `bootstrapService` разбирает окружение **до** создания приложения: при неверном окружении — `failStartup`, порт не открывается. Затем логгер, `createHttpApp`, сервер метрик (`METRICS_PORT`, шаг 5), `KitLifecycle.listen()` и `PORT` на `0.0.0.0`. `instrument.ts` подключается через `node --import`; если `SENTRY_DSN` задан, `NODE_ENV = production`, а Sentry не подключён — `warn` `SENTRY_NOT_PRELOADED`, запуск продолжается.

```ts
// src/main.ts
import 'reflect-metadata';
import { bootstrapService } from '@verdeect/kit/http';
import { AppModule } from './app.module.js';
import { envSchema } from './env.js';
import { redaction } from './redaction.js';

await bootstrapService({ module: AppModule, service: 'files', env: envSchema, redaction });
```

```ts
// src/app.module.ts — KitConfigModule обязателен, схема — тот же объект, что в main.ts
@Module({ imports: [KitConfigModule.forRoot({ schema: envSchema }), ItemsModule] })
export class AppModule {}
```

Без `KitConfigModule.forRoot({schema})` сборка падает: «модуль сервиса не импортирует KitConfigModule.forRoot({schema})». С той же схемой `KitConfigModule` берёт окружение, разобранное `bootstrapService`, и не разбирает его повторно.

Опции по роли сервиса: BFF — `logger: {trustTraceparent: false}` (trace-id всегда новый); P, O — `logger: {quietRoutes: ['/internal/…']}` (успешный ответ — `debug`); O — `redaction`; `http: {bodyLimit}` — лимит тела (по умолчанию — лимит Fastify 1 MiB, больше — 413). Журнал доступа — один на процесс, см. «Один журнал доступа на процесс» в разделе «Наблюдаемость».

`createHttpApp` даёт: заголовки `X-Content-Type-Options: nosniff` и `Referrer-Policy: no-referrer` на каждом ответе (HSTS, CSP и `no-store` для HTML — сервис и Traefik), trace-id, `GET /ok` (`{status: 'ok'}`, `no-store`, вне журнала доступа и OpenAPI), `KitExceptionFilter`, 404 `ROUTE_NOT_FOUND`. Модули сервиса внедряют `KitLifecycle` и `HealthRegistry`.

**Остановка.** `app.close()` = `lifecycle.close()`: шаги 1–5 без сторожа и `exit`. Шаг 2 — участник `http` (`server.close()` Fastify, keep-alive закрываются) и участники сервиса параллельно; шаг 3 — участник `nest` (исходный `app.close()` Nest: `onModuleDestroy` → `beforeApplicationShutdown` → адаптер → `onApplicationShutdown`). Правило для модулей: `beforeApplicationShutdown` — шаг 3, `onApplicationShutdown` — шаг 4. `enableShutdownHooks()` не вызывайте: сигналы ловит `KitLifecycle.listen()`.

Поток SSE (это «`onStopAccepting`» §3.2) закрывает участник шага 2 сервиса вызовом `reply.raw.end()` или `destroy()`; иначе остановка ждёт до срока:

```ts
@Injectable()
export class EventsStream implements OnModuleInit {
    private readonly streams = new Set<ServerResponse>();

    constructor(private readonly lifecycle: KitLifecycle) {}

    onModuleInit(): void {
        this.lifecycle.register(
            { name: 'sse', stop: () => this.streams.forEach((raw) => raw.end()) },
            { step: 2 },
        );
    }
}
```

**Ошибки.** Словарь — `defineErrors({...kitErrors, ITEM_NOT_FOUND: {status: 404, message: 'Запись не найдена'}})` один раз на процесс; повторный вызов объединяет словари, тот же код с другим статусом — ошибка при определении, код пакета с другим статусом — ошибка компиляции. `throw new DomainError('ITEM_NOT_FOUND', {id})` → `{error: {code, message, details}}`, статус словаря, `warn` без GlitchTip. Доменные 4xx — только `DomainError`: `HttpException` без тела с другим статусом, чем 400/401/403/404/413/415/429, — 500 `INTERNAL_ERROR` (ошибка разработчика). Тело `{error}` guard'ов `@verdeect/auth` и `@verdeect/platform-client` проходит без изменений. Срок пула БД (в том числе в `cause`) — 503 `SERVICE_UNAVAILABLE` + `Retry-After: 1` без метрики и события в фильтре: срок пулов `KitDatabaseModule` учитывает сам пул — `verdeect_db_pool_wait_timeouts_total{pool="main"|"read"}` и одно событие `captureThrottled`; срок собственного пула сервиса — 503 без метрики.

| Код                      | Статус | Код                        | Статус |
| ------------------------ | ------ | -------------------------- | ------ |
| `UNAUTHENTICATED`        | 401    | `RATE_LIMITED`             | 429    |
| `FORBIDDEN`              | 403    | `INTERNAL_ERROR`           | 500    |
| `VALIDATION_FAILED`      | 422    | `SERVICE_UNAVAILABLE`      | 503    |
| `BAD_REQUEST`            | 400    | `SERVICE_STOPPING`         | 503    |
| `PAYLOAD_TOO_LARGE`      | 413    | `PLATFORM_UNAVAILABLE`     | 503    |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | `IDEMPOTENCY_KEY_REUSED`   | 422    |
| `ROUTE_NOT_FOUND`        | 404    | `IDEMPOTENCY_IN_PROGRESS`  | 409    |
| `VERSION_CONFLICT`       | 409    | `IDEMPOTENCY_KEY_REQUIRED` | 400    |

**Ввод.** `@Body(new ZodValidationPipe(schema))` — ошибка → 422 `VALIDATION_FAILED`, `details.issues: [{path, code}]` (путь через точку, без значений). Неразобранный JSON — 400 `BAD_REQUEST`, неподдерживаемый `Content-Type` — 415, тело больше лимита — 413.

**Пагинация.** `PageQuerySchema` (`cursor`, `limit` 1–200, умолчание 100), чтение `limit + 1` строк, `pageOf(rows, limit, keyOf)` → `{items, nextCursor}`; условие — `afterCursor([t.createdAt, t.id], decodeCursor(query.cursor, 2), 'desc')`. Последний ключ сортировки — `primaryKey()` или `unique()`, все ключи сортировки — `NOT NULL` (`null` в курсоре — 422); неверный курсор — 422 `path: cursor`.

**OpenAPI.** `@Api({summary, response?, envelope?, errors?, extra?})` на маршруте; `verdeect-kit openapi --out contracts/openapi.json --module dist/app.module.js#AppModule` строит OpenAPI 3.1 по метаданным без запуска приложения (окружение не нужно), `info` — из `package.json`. Тело, query и path — из `ZodValidationPipe`, ответ — `response`, ошибки — `errors` + стандартные 400/422/429 (401/403 — у защищённых; 409 `TENANT_REQUIRED` — у маршрутов с `@RequireTenant()`, тело guard'а `{error: {code: 'TENANT_REQUIRED', message: 'Не выбрана компания', details: {}}}`). `security` — по `@UseGuards(VerdeectAuthGuard)` и `Require*` из `@verdeect/auth/nest`; защиту через `APP_GUARD` генерация не видит, поэтому `@UseGuards` ставится на контроллер, а маршрут без guard'а документируется без `security`. Наследование — как у Nest при регистрации маршрутов: методы собираются по цепочке прототипов, `@Api` базового (в том числе абстрактного, без `@Controller`) контроллера попадает в документ с путём наследника, метод наследника с тем же именем заменяет метод предка — один маршрут. Метод наследника переопределяет и `@Api`: без своего `@Api` он в документ не попадает. Расхождений с регистрацией маршрутов Nest нет. Что генерация не выражает (SSE, сырой прокси) — `extra` или `contracts/openapi.extra.json` рядом с `--out`. Снимок `contracts/openapi.json` коммитится; тест сравнивает его с документом из кода байт в байт, поэтому добавьте его в `.prettierignore` сервиса — иначе форматирование Prettier разойдётся с выводом CLI:

```gitignore
# .prettierignore
contracts/openapi.json
```

Результат — `{"written": "<путь>", "operations": N}` в stdout, выход 0. Ошибка — `{"error": {"code", "message"}}` в stdout, выход 1:

| Код                    | Когда                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `USAGE`                | нет `--out` или неизвестная опция                                                    |
| `MODULE_NOT_FOUND`     | нет файла `--module` или в нём нет экспорта (`#<экспорт>`, по умолчанию `AppModule`) |
| `INVALID_PACKAGE_JSON` | нет `package.json` в cwd, он не разбирается или без `name` / `version`               |
| `INVALID_EXTRA`        | `contracts/openapi.extra.json` — не объект JSON                                      |
| `INVALID_ENVIRONMENT`  | неверные `LOG_LEVEL` или `REPLICA_ID` (в `keys` — имена, без значений)               |
| `OPENAPI_FAILED`       | прочий сбой сборки документа (например, код из `errors` не зарегистрирован)          |
| `UNKNOWN_COMMAND`      | команда не `openapi` и не `db`                                                       |

## База данных

`KitDatabaseModule.forRoot({schema})` — глобальный модуль БД (окружение — `envDatabase` из `KitConfigModule`): основной пул и пул чтения (`default_transaction_read_only`, `statement_timeout` 5 с), `Db`, токены `DRIZZLE` и `DRIZZLE_READ` (Drizzle со схемой сервиса для запросов вне `Db`), критичные пробы `/health` `database` и `database-read`; пулы закрываются на шаге 4 остановки. Соединений на реплику — `2 × DB_POOL_MAX`.

```ts
const ctx: DbContext = { tenant: principal.tenant, traceId: request.id, actor: { channel: 'http' } };
await db.transaction(ctx, async (tx) => {
    await tx.insert(file).values({ id: newId('fil'), tenant: ctx.tenant, name });
    db.afterCommit(tx, () => cache.invalidate(name)); // только то, что можно потерять
});
const rows = await db.read(ctx, (tx) => tx.select().from(file)); // read-only, пул чтения
const flags = await db.readGlobal((reader) => reader.select().from(setting)); // без компании
```

- `Db.transaction(ctx, fn)` — ровно один `set_config('app.tenant', …, true)` на транзакцию; значение не переживает транзакцию. `Db.read(ctx, fn)` — read-only транзакция на пуле чтения; без тенанта — `TenantRequiredError`. Чтение без компании — только `Db.readGlobal(fn)` (без транзакции и `set_config`).
- `Db.afterCommit(tx, task)` — задачи после `COMMIT` по порядку; при откате не выполняются; ошибка задачи — `error`-лог и GlitchTip, не пробрасывается; в `read`/`readGlobal` — `AfterCommitInReadOnlyError`; с транзакцией не этого `Db` (другой `Db`, `DRIZZLE`, вложенная `tx.transaction()`) — `AfterCommitOutsideTransactionError` (задача не теряется молча).
- `Db.setLocal(tx, name, value)` — своя переменная транзакции `app.*` (`^app\.[a-z_]{1,48}$`), имя и значение — параметрами. Служебная `app.tenant` запрещена (`TypeError`): тенант задаётся только `DbContext` в `transaction`/`read`.
- Строгий RLS (P0): колонка `tenantColumn()` и политика `tenantPolicy(t.tenant)` — `tenant = current_setting('app.tenant', true)`, SQL генерирует `drizzle-kit` сервиса. `FORCE ROW LEVEL SECURITY` и права роли приложения — SQL-миграцией сервиса (`drizzle-kit generate --custom`), как в фикстуре пакета:

```sql
ALTER TABLE "files"."file" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "files"."file" TO "files_app";
```

- Первая строка первой миграции `drizzle-kit` — `CREATE SCHEMA "<svc>";`: замените её на `CREATE SCHEMA IF NOT EXISTS "<svc>";` — схему заранее создаёт `prepareDatabase` (обязательный шаг после первой генерации).
- `prepareDatabase({service, adminUrl, ownerPassword, appPassword})` — идемпотентно: роли `<svc>_owner` (миграции), `<svc>_app` (приложение, без `CREATE` на базе и схеме), `<svc>_directory` (`NOLOGIN`, `BYPASSRLS`, владелец функций `SECURITY DEFINER`), схема `<svc>`; повтор — `created: []`. `runMigrations({url, folder, schema})` — миграции под `<svc>_owner`, журнал — `<svc>.__migrations` (схемы `drizzle` нет), повтор — `{applied: 0}`.
- `deleteInBatches({db, sql, batchSize, maxBatches, shouldContinue?, connection?})` — транзакция на пачку до неполной пачки или `maxBatches`; `sql(batchSize)` возвращает одну строку с целой колонкой `deleted` (`WITH d AS (DELETE … LIMIT n RETURNING 1) SELECT count(*)::int AS deleted FROM d`); строки компаний системный контекст не видит — их удаляет функция `SECURITY DEFINER`. Остановка `Db` (шаг 3) ждёт текущую пачку, новая не начинается. `connection` — соединение блокировки `runExclusive`: пачки идут на нём, второе соединение пула не берётся.
- `runExclusive(db, key, (connection) => …)` — `pg_try_advisory_lock` без ожидания: `fn` в одной реплике, занято — `{ran: false}`. Блокировка держит соединение основного пула и передаётся в `fn`: работа на нём (`deleteInBatches({…, connection})`) не берёт второе соединение — очистка работает и при `DB_POOL_MAX = 1`; транзакции `Db` внутри `fn` берут другие соединения пула.
- `occurredAtColumn(name)` и `ifNewer(column, occurredAt)` — обновление только событием новее сохранённого (`rowCount` 0 — нормальный итог).
- `newId(prefix)` и `ulid()` — id `<prefix>_<ulid>` (реестр префиксов — ниже). `isUniqueViolation(err, constraint?)`, `isConnectionError(err)`, `isPoolTimeout(err)` — распознавание ошибок pg по форме с обходом `cause`.
- Срок пула: `verdeect_db_pool_wait_timeouts_total{pool="main"|"read"}` и `captureThrottled` пишет пул `/database` при ошибке получения соединения — и для `Db`, и для прямых `DRIZZLE`/`DRIZZLE_READ`; фильтр `/http` отвечает 503.

CLI `verdeect-kit db` (результат — одна строка JSON в stdout, логи — stderr; ошибка — `{"error": {"code", …}}` и выход 1, без адресов, паролей и текста ошибки pg):

| Команда                                     | Окружение                                                    | Результат                    |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| `db prepare --service <svc>`                | `DATABASE_ADMIN_URL`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` | `{database, roles, created}` |
| `db migrate --folder <путь> --schema <svc>` | `DATABASE_MIGRATOR_URL`                                      | `{schema, applied}`          |
| `db move-journal --from drizzle --to <svc>` | `DATABASE_MIGRATOR_URL`                                      | `{from, to, moved}`          |

Коды ошибок: `USAGE` (нет подкоманды или опции, имя вне формата, нет журнала `drizzle-kit` в папке), `INVALID_ENVIRONMENT` (`keys` — имена), `DATABASE_UNAVAILABLE`, `DB_COMMAND_FAILED` (`sqlState`).

## Идемпотентность

`KitIdempotencyModule.forRoot({table})` (нужен `KitDatabaseModule`) и `@Idempotent({required?, tenantFromBody?})` на маршруте — повтор с тем же `Idempotency-Key` и телом возвращает сохранённые статус, тело и `Location` с `Idempotent-Replayed: true`.

```ts
// schema.ts
export const idempotency = createIdempotencyTable(files);

// controller
@Post()
@UseGuards(VerdeectAuthGuard)
@Idempotent({ required: true })
create(@Body(new ZodValidationPipe(CreateFile)) body: CreateFileDto) { … }
```

- Таблица `createIdempotencyTable(pgSchema('<svc>'))` — `idempotency_key` (с меткой попытки `attempt`: ответ пишет только попытка, захватившая строку; если обработчик шёл дольше 5 минут и строку перехватил повтор, его ответ не сохраняется — `warn`) под политикой `tenant IS NOT DISTINCT FROM nullif(current_setting('app.tenant', true), '')`. В SQL-миграцию сервиса — `FORCE`, права `<svc>_app` и текст `idempotencyPurgeSql(<схема>)` без изменений (функция очистки `SECURITY DEFINER`, владелец `<svc>_directory`); пример — `test/consumer/minimal/drizzle/0001_force_grants_purge.sql`. Нет функции `<svc>.idempotency_purge` — отказ запуска с текстом про `idempotencyPurgeSql`.
- `@Idempotent` — **только на маршрутах с `VerdeectAuthGuard`**: без проверенного принципала — 500 `INTERNAL_ERROR` при любом ключе.
- Область ключа: пользователь и агент — компания токена и `sub` (поле тела не учитывается); служба — `client_id` и, при `tenantFromBody: 'tenant'`, компания из поля тела (нет поля — без компании).
- Ответы: нет ключа при `required` — 400 `IDEMPOTENCY_KEY_REQUIRED`; ключ не по формату `^[\x21-\x7E]{1,200}$` — 422 `VALIDATION_FAILED` (`path: Idempotency-Key`); другое тело — 422 `IDEMPOTENCY_KEY_REUSED`; запрос ещё идёт — 409 `IDEMPOTENCY_IN_PROGRESS`. Сохраняются только успешные ответы; брошенная `in_progress` переиспользуется через 5 минут, запись — 24 часа. Заголовки и коды попадают в OpenAPI по метаданным `@Idempotent`.
- Очистка — при старте и раз в час, одной репликой (`runExclusive`), пачками функцией `idempotency_purge`. Метрика `verdeect_cleanup_runs_total{table, result}`: `ok`, `partial` (упёрлась в предел пачек — очистка не успевает), `interrupted` (остановлена при выкате; алерт не срабатывает), `error`; алерт `VerdeectCleanupFailing` (`error` и `partial`) (порог `verdeect_kit_threshold:cleanup_runs`). Число удалённых строк — в `info`-логе прохода «очистка идемпотентности: проход» (`service`, `replica`, `table`, `deleted`).

## Тесты сервиса

Подпуть `/testing` разрешается только с условием `development` (NFR-4): в production-сборке сервиса его нет. Vitest включает это условие сам; для `node` — `node --conditions=development`.

```ts
// test/integration/global-setup.ts
import { startTestStack } from '@verdeect/kit/testing';

export default startTestStack({
    service: 'files',
    postgres: true,
    migrations: 'drizzle',
    mailpit: true,
});
```

Контейнеры `TEST_IMAGES` стартуют раз на прогон, адреса доходят до тестов через `inject`:

| Ключ `inject`         | Флаг       | Значение                                                  |
| --------------------- | ---------- | --------------------------------------------------------- |
| `kitPostgresUrl`      | `postgres` | `postgres://postgres:<пароль>@<host>:<port>/postgres`     |
| `kitDatabaseUrl`      | `postgres` | роль `<svc>_app` к БД `<svc>` — `DATABASE_URL` тестов     |
| `kitDatabaseOwnerUrl` | `postgres` | роль `<svc>_owner` к БД `<svc>` — `DATABASE_MIGRATOR_URL` |
| `kitDatabaseAdminUrl` | `postgres` | суперпользователь к БД `<svc>`                            |
| `kitDatabaseService`  | `postgres` | имя сервиса: схема и роли                                 |
| `kitDatabaseTemplate` | `postgres` | шаблонная БД `<svc>_template`                             |
| `kitSmtpUrl`          | `mailpit`  | `smtp://<host>:<port>`                                    |
| `kitMailpitUrl`       | `mailpit`  | `http://<host>:<port>` — HTTP API mailpit                 |
| `kitS3Endpoint`       | `minio`    | `http://<host>:<port>`                                    |
| `kitS3AccessKey`      | `minio`    | пользователь MinIO                                        |
| `kitS3SecretKey`      | `minio`    | пароль MinIO, случайный на прогон                         |

При `postgres: true` `startTestStack` готовит БД как в production: `prepareDatabase` на шаблоне `<svc>_template`, миграции папки `migrations` (путь от корня проекта; без `postgres` — `TypeError`), затем копия `<svc>`. RabbitMQ и Redis появятся в E5 и E8.

- `createScratchDatabase()` — пустая мигрированная БД из шаблона за доли секунды (`{name, url, ownerUrl, adminUrl, drop()}`); тест сам вызывает `drop()`.
- `workerScope().tenant` — слаг компании воркера (`w<VITEST_POOL_ID>-<8 hex>`, формат claim `tenant`): то же значение в `DbContext.tenant` и в токене; `tenantId` и строку компании создаёт фабрика сервиса.
- `countQueries(pool, fn)` — `{result, count, queries}`: все запросы пула за время `fn` (транзакция `Db` с одним запросом — 4: `begin`, `set_config`, запрос, `commit`).
- `assertStrictTenantIsolation(pool, {schema, except?})` — один тест сервиса под ролью приложения после вставки данных фабриками: каждая таблица с колонкой `tenant` — RLS, `FORCE`, строгая политика, 0 строк под пустым тенантом; `idempotency_key` и `outbox` — исключения строгой модели; функция `idempotency_purge` — `SECURITY DEFINER`, владелец `<svc>_directory`, `search_path`, без `EXECUTE` у `PUBLIC`.
- `assertAppRoleIsNotOwner(db)` — роль соединения не суперпользователь, без `BYPASSRLS`, не владеет схемами и таблицами, без `CREATE` на базе и схемах.

`TEST_IMAGES`: `postgres:17.11-alpine3.24`, `redis:7.4.11-alpine`, `rabbitmq:4.3.6-management-alpine`, `axllent/mailpit:v1.31.6`, `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`. Мажорная смена образа — мажор пакета (G14).

`assertRepoConventions({ root })` — один тест репозитория сервиса. Новое правило после `1.0.0` — мажор (G14); между `rc` — допустимо.

| Правило                | Что проверяется                                                                                                                                                                                                             | Кого                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `test-images`          | образы `postgres`, `redis`, `rabbitmq`, `axllent/mailpit`, `pgsty/minio` в `compose*.yml` и CI (`.gitlab-ci.yml`, `.github/workflows/*`) — ровно с тегом `TEST_IMAGES`                                                      | все сервисы                                                                                                 |
| `replica-id`           | `REPLICA_ID` не задан в `environment:` и `env_file:`                                                                                                                                                                        | все сервисы                                                                                                 |
| `stop-grace-period`    | `stop_grace_period` > `SHUTDOWN_TIMEOUT_MS`                                                                                                                                                                                 | приложения                                                                                                  |
| `env-keys`             | нет старых ключей: `IDENTITY_PORT`, `BFF_PORT` → `PORT`; `DATABASE_MIGRATION_URL` → `DATABASE_MIGRATOR_URL`; `SESSION_ENC_KEYS`, `SIGNING_KEY_ENCRYPTION_KEYS`, `CLIENT_SECRET_KEY`, `IDENTITY_SECRETS` → `ENCRYPTION_KEYS` | приложения                                                                                                  |
| `peer-versions`        | peer пакета в `package.json` сервиса — точная версия в peer-диапазоне `@verdeect/kit`                                                                                                                                       | манифесты с `@verdeect/kit`                                                                                 |
| `instrument-import`    | команда запуска приложения содержит `--import` со значением, где есть `instrument`, в аргументах `node` (`NODE_OPTIONS` не засчитывается)                                                                                   | `command:`/`entrypoint:` приложений, Dockerfile `CMD`/`ENTRYPOINT`, `scripts.start`                         |
| `command-unrecognized` | команда запуска — одна из распознаваемых форм; иначе «команда не распознана: <форма>; нужна форма `node --import ./dist/instrument.js dist/main.js`»                                                                        | `command:`/`entrypoint:` приложений и заданий, стадии Dockerfile, на которые они ссылаются, `scripts.start` |
| `redaction-imports`    | `src/redaction.ts` импортирует только типы из `@verdeect/kit/observability`                                                                                                                                                 | `src/redaction.ts`, `apps/*/src/redaction.ts`                                                               |

- **Приложение** — слитый сервис `compose*.yml` (база ⊕ переопределение), у которого в `environment:` или в файлах `env_file:` есть хотя бы один ключ `envBase`. Подделка вида `*.main.ts` / `*.main.js` (например, `fake-services.main.ts`) и инфраструктурные сервисы (без ключей `envBase`) этими правилами не проверяются. **Одноразовое задание** — сервис с командой (`command:`/`entrypoint:`, своей или унаследованной) без запуска приложения и без формы «команда не распознана» (например, `pnpm db:migrate`, `node dist/cli.js migrate`): правила `stop-grace-period` и `instrument-import` к нему не применяются, `test-images`, `replica-id`, `env-keys` и `command-unrecognized` — применяются; сервис без команды запускается командой Dockerfile и считается приложением.
- **Запуск приложения** — команда `node`, у которой первый аргумент после опций — файл входа `main`, `main.js`, `main.mjs`, `main.cjs` или `main.ts`. Разбор — по правилам shell (`shell-quote`): `sh`/`bash`/`ash`/`dash` с опциями до `-c` раскрываются: короткие флаги и кластеры (`-ec`, `-lc`, `-e -c`), `o`/`O` с именем опции (`-o pipefail`, `-eo pipefail`, `-O extglob`, `+O …`), длинные `--<имя>` (`--login`, `--norc`; `--rcfile <f>`, `--init-file <f>` — со значением); команды через `&&`, `||`, `;`, `&`, `|`, перевод строки и в подоболочке `( … )` проверяются по отдельности; комментарий `#` в начале слова снимается до конца строки, `\` — продолжение строки. Снимаются обёртки: `exec`, `tini` (опции `-s`, `-g`, `-v`, `-w`, `-l`, `-p <сигнал>`, `-e <код>`, `--`), `dumb-init` (`-c`/`--single-child`, `-v`/`--verbose`, `-r`/`--rewrite <s:r>`, `--`), `env [VAR=…] [-флаги]`, ведущие `VAR=…`, `pnpm|npm|yarn exec|dlx`, `npx`. `${VAR:-x}` и `${VAR-x}` подставляются умолчанием. **У приложения обязателен распознанный запуск**: у стадии Dockerfile, которой запускается приложение без своего `command:`/`entrypoint:`, и у `scripts.start` итоговая команда (по правилам Docker и Compose) без запуска приложения — «не найден запуск приложения: <голова>…».
- **Команда не распознана** (`command-unrecognized`): раннеры (`pnpm`/`npm`/`yarn start*` и `run start*`, `node --run start*`, `nest start`, `tsx`, `ts-node`, `pm2`, `pm2-runtime`, `nodemon`), `gosu`, `su-exec`, опция `tini`/`dumb-init` вне списка, вызов оболочки с `-c` без выделенного скрипта, `$(…)` и `` `…` ``, `eval`, переменная без умолчания на месте программы или обёртки, среди опций `node` до файла входа или в самом файле входа (аргументы после файла входа не проверяются: `dist/main.js --port $PORT` — без нарушения), `main.*` в аргументах любой команды, кроме файла входа `node` (`node --max-old-space-size 512 dist/main.js`, `./docker-entrypoint.sh node dist/main.js`).
- **Dockerfile**: действуют последние `CMD` и `ENTRYPOINT` стадии; `FROM <стадия>` наследует их, `ENTRYPOINT` дочерней стадии сбрасывает унаследованный `CMD`; `CMD` внутри `HEALTHCHECK` — не `CMD` стадии; `\` с пробелами или табуляцией перед переводом строки — продолжение. Exec-форма `ENTRYPOINT` получает `CMD` аргументами (exec-форма как есть, shell-форма как `/bin/sh -c "…"`); у `ENTRYPOINT ["sh", "-c", "<скрипт>"]` запуск ищется в скрипте, `CMD` — только `$0…`; shell-форма `ENTRYPOINT` игнорирует `CMD`; невалидный JSON (`CMD ['node', …]`) — shell-форма, как в Docker.
- **Compose**: базовый файл — первый найденный из `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml`. Переопределение проверяется как слитый сервис: `environment:`/`env_file:` сливаются с базой, `command:`, `entrypoint:`, `build:`, `stop_grace_period` без своего значения берутся из базы; `!reset` возвращает умолчание, `!override` заменяет значение базы целиком. `entrypoint:` задан — `CMD` образа отбрасывается, `command:` — его аргументы; только `command:` — аргументы `ENTRYPOINT` стадии `build:` (`target` или последняя стадия), если Dockerfile найден.
- `stop_grace_period` — после подстановки `${VAR:-default}`; переменная без умолчания — «значение не определено»; нет нигде — 10 с Docker. `SHUTDOWN_TIMEOUT_MS` — целое или `${NAME:-N}`; нет нигде — 10000; иное — «значение не определено или не целое число мс» (без значения в тексте). В `env_file` у значения без кавычек ` #…` — комментарий, как в Compose.
- `image:` в compose разбирается как значение: подстановка `${VAR:-default}`, без префикса `docker.io/library/` или `docker.io/`, дайджест `@sha256:…` отдельно, без тега — `latest`. Неразрешённая переменная в теге образа из `TEST_IMAGES` — нарушение «тег не определён»; образы вне `TEST_IMAGES` и с неопределяемым репозиторием не проверяются. В тексте CI префикс `docker.io/library/` и `docker.io/` снимается так же, тег учитывается, только если в нём есть точка или буква (`postgres:5432` — адрес, а не образ).

HTTP-тесты: `createTestApp({module, service, overrides?})` — тот же `createHttpApp` на `Test.createTestingModule`, запросы — `app.inject(...)`, закрытие — `app.close()`. Нужен `@nestjs/testing` в зависимостях сервиса (иначе — текст AC-1.2 при вызове). `expectProblem(res, {status, code, issues?})` — ответ-ошибка; `expectMatchesApi(res, [ItemsController, 'list'])` — статус и тело по `@Api` маршрута: успешный статус — схема `response`, описанный статус ошибки (стандартные, `errors`, 401/403/409 guard'а) — `{error: {code, message, details}}`, прочий статус — падение (Ajv 2020, тот же построитель, что у CLI; схема компилируется один раз на маршрут и статус).

Ещё в `/testing`: `tcpProxy(target)` — обрывы (`break`, `restore`, `blackhole`, `freeze`, `blackholeOn`) и задержки (`delayOn`) TCP; `timingGuard` — `globalSetup` замеров времени (нагрузка, ядра, отказ при запущенном e2e-контуре `verdeect-*-e2e`); `TEST_TIMEOUT_SCALE` — множитель тайм-аутов конфигов Vitest.

## Развёртывание

- Порт метрик `METRICS_PORT` не публикуется наружу: его читает только сборщик метрик внутри сети.
- Балансировщик проверяет готовность по `/health` на `METRICS_PORT`: с начала остановки — 503, реплика выводится из балансировки за паузу `SHUTDOWN_DRAIN_MS`.
- Правила алертов: подключите файл `alertRulesTemplate` (`node_modules/@verdeect/kit/alerts/verdeect-kit.rules.yml`) в vmalert рядом с правилами сервиса; свои пороги — `verdeect_kit_threshold:<метрика>`.
- `REPLICA_ID` не задавать ни в compose, ни в `env_file`: умолчание — `hostname()` контейнера.
- `stop_grace_period: 15s` при `SHUTDOWN_TIMEOUT_MS` 10000: срок Docker должен быть больше срока остановки сервиса.
- Пул соединений PostgreSQL: сервис открывает до `2 × DB_POOL_MAX × реплики` соединений (основной пул и пул чтения) — `max_connections` считается по этой формуле.
- БД при каждом выкате: `verdeect-kit db prepare --service <svc>` → `verdeect-kit db migrate --folder drizzle --schema <svc>` (отдельные шаги до запуска приложения). Переход сервиса с журнала `drizzle.__drizzle_migrations` — один раз `verdeect-kit db move-journal --from drizzle --to <svc>`.
- DLQ разбирается в течение 7 дней.
- Смена ключа шифра (UC-10): новый секрет `verdeect-kit crypto generate-secret` (с E7) → новая версия первой в `ENCRYPTION_KEYS` → перезапуск → перешифровка → удаление старой версии.
- Смена TTL `.retry` (`RABBITMQ_RETRY_SECONDS`): очередь `<svc>.retry` удалить и пересоздать, иначе отказ запуска (prd.md §3.4).

## Реестр префиксов id

Формат префикса `^[a-z]{2,5}$`, id — `<prefix>_<ulid>`; id создаёт `newId(prefix)` из `/database`. Новый префикс добавляется строкой в этот реестр в плане сервиса.

| Префикс | Сущность                | Сервис       |
| ------- | ----------------------- | ------------ |
| `evt`   | событие outbox          | все (kit)    |
| `trn`   | ход (turn)              | orchestrator |
| `msg`   | сообщение хода          | orchestrator |
| `lse`   | аренда (lease) рантайма | orchestrator |
| `jup`   | загрузка журнала        | orchestrator |
| `chm`   | сообщение канала        | orchestrator |
| `chr`   | запрос канала           | orchestrator |

## API

### @verdeect/kit/config

- `envBase` — базовые ключи каждого сервиса.
- `envDatabase` — ключи БД.
- `envMessaging` — ключи RabbitMQ.
- `envRedis` — ключ Redis.
- `envSentry` — ключи GlitchTip.
- `envCrypto` — ключи шифра `ENCRYPTION_KEYS`.
- `envServiceUrls` — `envServiceUrls(required)`: `SERVICE_URLS` с обязательными именами.
- `defineEnv` — схема окружения сервиса из фрагментов и своих ключей, с `withBaseChecks`.
- `withBaseChecks` — проверки между ключами пакета (`PORT` ≠ `METRICS_PORT`, `SHUTDOWN_DRAIN_MS` < `SHUTDOWN_TIMEOUT_MS`).
- `parseEnv` — разбор окружения схемой; ошибка — `InvalidEnvironmentError`.
- `InvalidEnvironmentError` — `{code: 'INVALID_ENVIRONMENT', keys}`, без значений.
- `KitConfigModule` — `forRoot({schema})`: глобальный `ConfigModule`, окружение разбирается при каждой сборке контекста (при `bootstrapService` — без повторного разбора), `process.env` не меняется.
- `migrateEnvSchema` — окружение CLI `db migrate`: `DATABASE_MIGRATOR_URL`, `LOG_LEVEL`.
- `prepareEnvSchema` — окружение CLI `db prepare`: `DATABASE_ADMIN_URL`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `LOG_LEVEL`.
- `port` — порт 0–65535.
- `positiveInt` — целое > 0.
- `optionalText` — пусто → `null`, иначе текст без крайних пробелов.
- `booleanFlag` — только `true`/`false`.
- `jsonValue` — JSON-значение со своей схемой.
- `httpUrl` — URL `http`/`https`.
- `uniqueBy` — проверка уникальности поля элементов массива.
- `KitBaseEnv` — тип разобранных `envBase`.
- `KitDatabaseEnv` — тип разобранных `envDatabase`.
- `KitMessagingEnv` — тип разобранных `envMessaging`.
- `KitRedisEnv` — тип разобранных `envRedis`.
- `KitCryptoEnv` — тип разобранных `envCrypto`.

### @verdeect/kit/observability

- `SENSITIVE_KEYS` — базовый список чувствительных имён (§3.2); каждое скрывается на уровнях 0–2, `err.code` виден.
- `KitRedaction` — `{sensitiveKeys?, maskPath?}`: имена добавляются к `SENSITIVE_KEYS`, `maskPath` — маска пути в логе доступа и GlitchTip.
- `createLoggerOptions` — `createLoggerOptions({service, entry, env, trustTraceparent?, quietRoutes?, extraBase?, redaction?})`: опции `nestjs-pino` (HTTP — stdout, CLI — stderr).
- `KitLoggerOptions` — тип опций `createLoggerOptions`.
- `KitLoggerParams` — тип результата: `Params` с кортежем `pinoHttp: [options, stream]`.
- `sanitizeError` — ошибка без SQL, параметров и значений: ветки pg/Drizzle, ioredis и зарегистрированные; цепочка `cause` до 10.
- `registerErrorSanitizer` — `registerErrorSanitizer(match, sanitize)`: своя ветка сервиса, глобально на процесс.
- `initSentry` — `initSentry({service, redaction?})` в `instrument.ts`; возвращает, включён ли GlitchTip.
- `KitSentryOptions` — тип опций `initSentry`.
- `captureError` — `captureError(err, {tags?, extra?})`: ровно одно событие на ошибку.
- `captureThrottled` — `captureThrottled(key, err, {windowMs = 60_000})`: одно событие за окно на ключ; возвращает, отправлено ли.
- `HealthRegistry` — пробы `/health`: `register(name, probe, {critical})`, `markStopping()`, `evaluate()`; срок пробы 2 с.
- `HealthProbe` — тип пробы `() => Promise<boolean>`.
- `HealthReport` — `{status: 'ok' | 'degraded' | 'unavailable', checks}`.
- `MetricsServer` — `/health` и `/metrics` на `METRICS_PORT`: `listen()`, `address()`, `close()`.
- `kitMetrics` — `kitMetrics({service})`: свой реестр экземпляра с меткой `service`, метрики процесса Node и `verdeect_*`.
- `KitMetrics` — тип реестра и метрик пакета.
- `alertRulesTemplate` — абсолютный путь к `alerts/verdeect-kit.rules.yml`.
- `failStartup` — `failStartup(raw, logger)`: `fatal`-лог, событие GlitchTip с ожиданием до 2 с, `exit(1)`.
- `StartupFailure` — интерфейс ошибки запуска сервиса `{startupCode, startupDetails()}`.
- `KitLifecycle` — остановка по шагам 1–5: `register`, `listen()` (сигнал ОС, сторож срока), `close()` (без сторожа).
- `KitShutdownParticipant` — участник `{name, stop()}`.
- `KitShutdownStep` — шаг участника `2 | 3 | 4 | 5`.

### @verdeect/kit/http

- `bootstrapService` — `bootstrapService({module, service, env, logger?, http?, redaction?})`: точка входа `main.ts`.
- `KitBootstrapOptions` — тип опций `bootstrapService`.
- `createHttpApp` — `createHttpApp({module, service, bodyLimit?, securityHeaders?})`: Fastify-приложение Nest сервиса.
- `KitHttpAppOptions` — тип опций `createHttpApp`.
- `kitErrors` — общие коды пакета `{status, message}`.
- `defineErrors` — `defineErrors({...kitErrors, …})`: словарь сервиса на процесс.
- `KitErrorDictionary` — тип словаря `код → {status, message}`.
- `KitErrorEntry` — тип записи словаря.
- `DomainError` — `new DomainError(code, details?, {cause}?)`: ошибка домена со статусом из словаря, `toBody()`.
- `KitExceptionFilter` — фильтр ошибок (регистрирует `createHttpApp`; BFF собирает свой на `DomainError`).
- `ZodValidationPipe` — `new ZodValidationPipe(schema)`: 422 `VALIDATION_FAILED`.
- `PageQuerySchema` — `{cursor?, limit}` (умолчание 100, максимум 200).
- `Page` — тип ответа `{items, nextCursor}`.
- `pageOf` — `pageOf(rows, limit, keyOf)`: страница из `limit + 1` строк.
- `encodeCursor` — курсор base64url от JSON ключей.
- `decodeCursor` — `decodeCursor(cursor, arity)`: ключи или `null`; неверный — 422 `path: cursor`.
- `afterCursor` — `afterCursor(cols, cursor, dir)`: условие Drizzle «после курсора».
- `Api` — `@Api({summary, response?, envelope?, errors?, extra?})`: маршрут в OpenAPI.
- `KitApiOptions` — тип опций `@Api`.

CLI: `verdeect-kit openapi --out <файл> [--module <файл>#<экспорт>]` — результат `{written, operations}` в stdout; нет файла, экспорта или `version` в `package.json` — JSON `{error: {code}}` и выход 1.

### @verdeect/kit/database

- `KitDatabaseModule` — `forRoot({schema})`: пулы, `Db`, `DRIZZLE`, `DRIZZLE_READ`, пробы `database`/`database-read`, закрытие пулов на шаге 4.
- `KitDatabaseModuleOptions` — тип опций `KitDatabaseModule.forRoot`.
- `DRIZZLE` — токен Drizzle основного пула со схемой сервиса.
- `DRIZZLE_READ` — токен Drizzle пула чтения со схемой сервиса.
- `Db` — `transaction(ctx, fn)`, `read(ctx, fn)`, `readGlobal(fn)`, `afterCommit(tx, task)`, `setLocal(tx, name, value)`.
- `DbContext` — `{tenant, traceId, actor: {clientId?, accountId?, memberId?, onBehalfOf?, channel}}`.
- `DbTx` — тип транзакции `Db.transaction`/`Db.read`.
- `DbReader` — тип дескриптора `Db.readGlobal`.
- `AfterCommitTask` — тип задачи `() => void | Promise<void>`.
- `TenantRequiredError` — `Db.read` без тенанта.
- `AfterCommitInReadOnlyError` — `afterCommit` в `read`/`readGlobal`.
- `AfterCommitOutsideTransactionError` — `afterCommit` с транзакцией не этого `Db` или вложенной.
- `tenantColumn` — `tenantColumn(name = 'tenant')`: колонка тенанта `text not null`.
- `tenantPolicy` — `tenantPolicy(column)`: строгая политика `tenant_isolation`.
- `prepareDatabase` — `prepareDatabase({service, adminUrl, ownerPassword, appPassword}, logger?)`: роли и схема сервиса.
- `KitPrepareDatabaseOptions` — тип опций `prepareDatabase`.
- `KitPrepareDatabaseResult` — `{database, roles, created}`.
- `runMigrations` — `runMigrations({url, folder, schema}, logger?)`: `{applied}`, журнал `<schema>.__migrations`.
- `KitRunMigrationsOptions` — тип опций `runMigrations`.
- `deleteInBatches` — `deleteInBatches({db, sql, batchSize, maxBatches, shouldContinue?, connection?})`: `{deleted, batches, complete}`.
- `KitDeleteInBatchesOptions` — тип опций `deleteInBatches`.
- `KitDeleteInBatchesResult` — тип итога `deleteInBatches`.
- `runExclusive` — `runExclusive(db, key, (connection) => …)`: `{ran: true, result}` или `{ran: false}`; `fn` получает соединение блокировки.
- `occurredAtColumn` — `occurredAtColumn(name)`: `timestamptz` nullable.
- `ifNewer` — `ifNewer(column, occurredAt)`: условие «событие новее».
- `newId` — `newId(prefix)`: `<prefix>_<ulid>`, префикс `^[a-z]{2,5}$`.
- `ulid` — `ulid(now?)`: 26 знаков Crockford.
- `isUniqueViolation` — `isUniqueViolation(err, constraint?)`: 23505 в ошибке или `cause`.
- `isConnectionError` — обрыв соединения с PostgreSQL по форме.
- `isPoolTimeout` — срок ожидания клиента пула.

CLI: `verdeect-kit db prepare --service <svc>`, `db migrate --folder <путь> --schema <svc>`, `db move-journal --from <схема> --to <svc>` — см. «База данных».

### @verdeect/kit/idempotency

- `KitIdempotencyModule` — `forRoot({table})`: интерсептор `@Idempotent`, проверка функции очистки при старте, очистка раз в час.
- `KitIdempotencyModuleOptions` — тип опций `KitIdempotencyModule.forRoot`.
- `Idempotent` — `@Idempotent({required?, tenantFromBody?})`: маршрут принимает `Idempotency-Key`.
- `KitIdempotentOptions` — тип опций `@Idempotent`.
- `createIdempotencyTable` — `createIdempotencyTable(schema)`: таблица `idempotency_key` схемы сервиса.
- `KitIdempotencyTable` — тип таблицы идемпотентности.
- `idempotencyPurgeSql` — `idempotencyPurgeSql(schema)`: текст SQL функции очистки для миграции сервиса.

### @verdeect/kit/testing

- `createTestApp` — `createTestApp({module, service, overrides?, bodyLimit?})`: приложение сервиса для тестов.
- `KitTestAppOptions` — тип опций `createTestApp`.
- `KitTestOverride` — подмена провайдера `{provide, useValue}`.
- `expectProblem` — `expectProblem(res, {status, code, issues?})`: утверждение об ответе-ошибке.
- `KitExpectedProblem` — тип ожидаемой ошибки.
- `KitTestResponse` — тип ответа `{statusCode, json()}`.
- `expectMatchesApi` — `expectMatchesApi(res, [Controller, 'method'])`: ответ по схеме `@Api`.
- `TEST_IMAGES` — образы тестов и compose сервисов.
- `startTestStack` — `globalSetup` Vitest: контейнеры раз на прогон, адреса через `provide`.
- `assertRepoConventions` — проверка репозитория сервиса по правилам выше.
- `tcpProxy` — запущенный TCP-прокси к цели.
- `TcpProxy` — тип прокси: `url`, `break`, `restore`, `blackhole`, `freeze`, `blackholeOn`, `delayOn`, `close`.
- `timingGuard` — `globalSetup` уровня замеров времени.
- `TEST_TIMEOUT_SCALE` — множитель тайм-аутов из `TEST_TIMEOUT_SCALE`, по умолчанию 1.
- `createScratchDatabase` — пустая мигрированная БД из шаблона `startTestStack`.
- `KitScratchDatabase` — `{name, url, ownerUrl, adminUrl, drop()}`.
- `workerScope` — `workerScope()`: область воркера Vitest.
- `KitWorkerScope` — `{tenant}`: слаг компании воркера.
- `countQueries` — `countQueries(pool, fn)`: `{result, count, queries}`.
- `KitCountablePool` — тип пула с событием `acquire`.
- `assertStrictTenantIsolation` — `assertStrictTenantIsolation(db, {schema, except?})`: строгий RLS схемы под ролью приложения.
- `KitTenantIsolationOptions` — тип опций `assertStrictTenantIsolation`.
- `assertAppRoleIsNotOwner` — `assertAppRoleIsNotOwner(db)`: роль приложения не владелец.
- `KitQueryable` — тип соединения с `query` (`pg.Pool`, `pg.Client`).

## Документация

- [docs/testing.md](docs/testing.md) — уровни тестов пакета и как их запускать.
- [docs/releasing.md](docs/releasing.md) — выпуск версии.
- [CHANGELOG.md](CHANGELOG.md) — изменения по версиям.

## Выпуск

Выпусков по этапам нет: E1–E8 копятся в `[Unreleased]`. После E8 — `1.0.0-rc.1` вручную мейнтейнером с меткой `next`, затем `npm trust`; дальше `1.0.0-rc.N` (после E8) — тегом `v1.0.0-rc.N` через CI с меткой `next`; `1.0.0` — после перехода Identity, тегом `v1.0.0` (метка `latest`). Публикует CI через npm Trusted Publishing. Подробно — [docs/releasing.md](docs/releasing.md).

## Разработка

```bash
make install
make help              # все цели
make lint              # ESLint, Prettier, правила lint AC-9.4
make analyse           # tsc --noEmit, политика зависимостей
make test              # U: без сети и Docker; make test FILTER='AC-1.8'
make test-module M='config testing'  # U + I подпутей
make test-integration  # I: Testcontainers
make test-timing       # T: только на тихой машине
make pack-check        # сборка, архив, проекты-потребители, publish.mjs
make ci                # конвейер CI
make test-full         # перед слиянием и выпуском
```

Для `test-integration`, `test-timing`, `pack-check`, `ci` и `test-full` нужен Docker. Цели вызывают скрипты `pnpm` из `package.json`.

## Лицензия

UNLICENSED.
