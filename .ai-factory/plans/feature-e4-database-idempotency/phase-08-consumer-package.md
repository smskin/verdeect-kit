# Фаза 8: Проект-потребитель и проверки архива

Plan: [index.md](index.md)
Tasks: 37-38
Depends on: Phases 5, 6, 7 (Tasks 22, 23, 29, 30, 31, 35)

## Цель

AC-9.1 этапа E4: потребитель на упакованном архиве — таблица компании под строгим RLS, миграции `drizzle-kit` с функцией `idempotencyPurgeSql`, `startTestStack` с `migrations`, `KitDatabaseModule` + `KitIdempotencyModule` в процессе `bootstrapService`, `assertStrictTenantIsolation`, метрика и лог очистки (AC-9.5), снимок OpenAPI с заголовками идемпотентности (AC-3.8). AC-1.1 и AC-1.2 растут: подпути `./database`, `./idempotency`; без `pg` — ошибка импорта с текстом AC-1.2.

## Свидетельства из кода

| Путь | Символы | Зачем |
|---|---|---|
| `test/consumer/minimal/package.json` | зависимости, скрипты `build`, `openapi` | + `pg`, `drizzle-kit`, `@types/pg` |
| `test/consumer/minimal/global-setup.ts` | `startTestStack({service: 'consumer', postgres: true})` | + `migrations` |
| `test/consumer/minimal/src/service/app.module.ts` | `DatabaseProbe` (TCP) | заменяется пробами `KitDatabaseModule` |
| `test/consumer/minimal/src/service/env.ts` | `defineEnv({...envBase, ...envDatabase})` | без изменений |
| `test/consumer/minimal/src/observability.spec.ts` | `startService`, `logLines`, `DATABASE_URL: kitPostgresUrl` | процесс сервиса: адрес → `kitDatabaseUrl` |
| `test/consumer/minimal/src/openapi.spec.ts`, `contracts/openapi.json` | снимок `operations: 1` | + маршрут с `@Idempotent` |
| `test/consumer/minimal/import-check.mjs` | строка `config:… http:… observability:… testing:…` | + `database`, `idempotency` |
| `test/consumer/no-testcontainers/peer-check.mjs` | импорт без `pg` и `testcontainers` | + `database`, `idempotency` |
| `test/package/ac-9-1-consumer.spec.ts` | ожидаемые строки `import-check`, `peer-check` | обновление |
| `test/package/ac-1-1-package.spec.ts` | состав архива, графы `dist` | + `dist/database`, `dist/idempotency` |
| `.prettierignore` | `test/consumer/minimal/contracts/` | + миграции потребителя |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `test/consumer/minimal/package.json` | modify | зависимости, скрипт `db:generate` |
| `test/consumer/minimal/drizzle.config.ts` | create | `drizzle-kit` потребителя |
| `test/consumer/minimal/src/service/schema.ts` | create | `company`, `idempotency` |
| `test/consumer/minimal/drizzle/**` | create (генерация) | `0000_*.sql`, `0001_force_grants_purge.sql`, `meta/` |
| `test/consumer/minimal/src/service/app.module.ts` | modify | модули БД и идемпотентности, auth |
| `test/consumer/minimal/src/service/companies.controller.ts` | create | `POST /companies` с `@Idempotent` |
| `test/consumer/minimal/global-setup.ts` | modify | `migrations: 'drizzle'` |
| `test/consumer/minimal/src/database.spec.ts` | create | AC-9.1 БД |
| `test/consumer/minimal/src/observability.spec.ts` | modify | адрес БД, AC-9.5 |
| `test/consumer/minimal/contracts/openapi.json` | modify (генерация) | снимок |
| `test/consumer/minimal/src/openapi.spec.ts` | modify | `operations: 2` |
| `test/consumer/minimal/import-check.mjs`, `types-check.ts` | modify | подпути |
| `test/consumer/no-testcontainers/peer-check.mjs` | modify | без `pg` |
| `test/package/ac-9-1-consumer.spec.ts`, `test/package/ac-1-1-package.spec.ts` | modify | ожидания |
| `.prettierignore` | modify | `test/consumer/minimal/drizzle/` |

## Task 37: Потребитель с БД и идемпотентностью

### Шаги
(`Skill: none — проект-потребитель вне src/ (TypeScript сервиса), соглашения nestjs-code; тесты — nestjs-code test conventions`)
1. `package.json` потребителя: `dependencies` — `pg` 8.23.1; `devDependencies` — `drizzle-kit` 0.31.11, `@types/pg` 8.23.1 (`@nestjs/testing` не добавляется: тесты потребителя запускают процесс и ходят в БД через `pg`); скрипт `db:generate` — `drizzle-kit generate`. `--strict-peer-dependencies` установки (`consumer-project.ts`) должен пройти.
2. `src/service/schema.ts`: `consumer = pgSchema('consumer')`; таблица `company`: `id text primary key` (значение `newId('cmp')`), `tenant` — `tenantColumn()`, `name text not null`; `tenantPolicy`; `idempotency = createIdempotencyTable(consumer)`. Импорты — из `@verdeect/kit/database` и `@verdeect/kit/idempotency`.
3. `drizzle.config.ts`: `schema: './src/service/schema.ts'`, `out: './drizzle'`, `schemaFilter: ['consumer']`, `entities.roles: false`. Генерация выполняется разработчиком **один раз** в шаблоне (после `pnpm install` в копии проекта с архивом) и коммитится: `drizzle/0000_*.sql` + `meta/`. Затем `drizzle-kit generate --custom --name force_grants_purge` → `0001_force_grants_purge.sql`:
   ```sql
   ALTER TABLE "consumer"."company" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   ALTER TABLE "consumer"."idempotency_key" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   GRANT SELECT, INSERT, UPDATE, DELETE ON "consumer"."company", "consumer"."idempotency_key" TO "consumer_app";--> statement-breakpoint
   <текст idempotencyPurgeSql(consumer) без изменений>
   ```
   Это пример README (задача 39).
4. `global-setup.ts`: `startTestStack({service: 'consumer', postgres: true, migrations: 'drizzle'})`.
5. `app.module.ts`: удалить `DatabaseProbe` (пробы даёт `KitDatabaseModule`); `imports` — `KitConfigModule.forRoot({schema: serviceEnvSchema})`, `KitDatabaseModule.forRoot({schema})`, `KitIdempotencyModule.forRoot({table: idempotency})`, `VerdeectAuthModule.forRoot({issuers: [{iss: AUTH_ISSUER, jwksUri: AUTH_JWKS_URI}], resource: AUTH_RESOURCE})` — три ключа окружения потребителя добавить в `src/service/env.ts` (`z.string().url()`/`min(1)`) и в окружение `startService` теста (`http://127.0.0.1:9/jwks` — JWKS не запрашивается, токенов в тесте процесса нет); `controllers` — `ItemsController`, `CompaniesController`.
6. `companies.controller.ts`: `POST /companies`, `@UseGuards(VerdeectAuthGuard)`, `@RequireTenant()`, `@Idempotent({required: true})`, `@Api({summary: 'Создать компанию', response: Company})`, тело — `ZodValidationPipe` `{name}`; обработчик — `Db.transaction` с `DbContext` из принципала (`tenant`), вставка строки с `newId('cmp')`, `Location: /companies/<id>`. В тестах процесса маршрут не вызывается (нужен только для снимка и сборки DI).
7. `src/database.spec.ts`, `describe('UC-1: БД потребителя')`, `pg` по адресам `inject`:
   - `AC-9.1: startTestStack подготовил и мигрировал БД — журнал consumer.__migrations, роли consumer_*`;
   - `AC-9.1: assertAppRoleIsNotOwner проходит под kitDatabaseUrl`;
   - `AC-9.1: assertStrictTenantIsolation({schema: 'consumer'}) проходит после вставки строк двух компаний` (строки — администратором, тенанты `workerScope().tenant` и `globex`);
   - `AC-9.1: 0001_force_grants_purge.sql содержит idempotencyPurgeSql(consumer) без изменений`;
   - `AC-9.1: createScratchDatabase — пустая мигрированная БД, drop()`;
   - `AC-9.1: newId('cmp') по формату`.
8. `src/observability.spec.ts` (MODIFY): `DATABASE_URL` процесса — `inject('kitDatabaseUrl')`; новые случаи:
   - `AC-9.1: /health — database и database-read up` (вместо TCP-пробы);
   - `AC-9.5: после старта — лог «очистка идемпотентности: проход» с service consumer и replica consumer-1; /metrics — verdeect_cleanup_runs_total{service="consumer",table="idempotency_key",result="done"} ≥ 1` (ожидание строки лога — без `sleep`, по потоку stdout);
   - остановка по `SIGTERM` в срок с выходом 0 — существующий случай теперь закрывает пулы (шаг 4) и очистку (шаг 3).
9. Снимок OpenAPI: `pnpm build` и `pnpm openapi` в копии проекта → обновлённый `contracts/openapi.json` (маршрут `POST /companies` с `Idempotency-Key` required, `Idempotent-Replayed`, 409/422/400) закоммитить в шаблон; `openapi.spec.ts` — `operations: 2`.
10. `import-check.mjs`: + `database:<probe 'newId'>`, `idempotency:<probe 'Idempotent'>` — строка `config:ok database:ok http:ok idempotency:ok observability:ok testing:…` (порядок по алфавиту). `types-check.ts` — использование типов `DbContext`, `KitIdempotentOptions`, `KitWorkerScope` (проверка `tsc`).
11. `test/consumer/no-testcontainers/peer-check.mjs`: для `database` и `idempotency` — печать `message` ошибки (`<подпуть>:<message>`), остальные — как есть.
12. `.prettierignore`: `test/consumer/minimal/drizzle/` (вывод `drizzle-kit`).

### Ошибки и логи
Проект-потребитель логирует через пакет; пароли и адреса — только в окружении процесса.

## Task 38: Проверки архива (R/C)

### Шаги
(`Skill: nestjs-code test unit package pack (MODIFY)`)
1. `test/package/ac-9-1-consumer.spec.ts`:
   - ожидаемые строки `import-check`: без условия — `config:ok database:ok http:ok idempotency:ok observability:ok testing:ERR_PACKAGE_PATH_NOT_EXPORTED`; с `development` — все `ok`;
   - случай AC-1.2 переименовать: `AC-1.2: без pg и testcontainers /config, /http, /observability импортируются; /database — «@verdeect/kit/database требует pg — добавьте в зависимости сервиса»; /idempotency — «@verdeect/kit/idempotency требует pg — …»; /testing — «… требует testcontainers …»` и добавить ожидания двух новых строк.
2. `test/package/ac-1-1-package.spec.ts`:
   - состав архива: `package/dist/database/index.js`, `package/dist/idempotency/index.js`;
   - список каталогов «dist рабочих подпутей не импортирует testing и shell-quote» — + `database`, `idempotency`;
   - новый случай `AC-1.2: dist/database и dist/idempotency не импортируют pg и drizzle-orm/node-postgres статически` — граф `importGraph` по `dist/database/index.js` и `dist/idempotency/index.js`: среди спецификаторов статических `import … from` нет `pg` и `drizzle-orm/node-postgres` (динамические `import(` допустимы — различать по регулярке `from`);
   - `dist/http` — по-прежнему без `pg`, `testing` и `database`; без `idempotency`.
3. `test/package/support/consumer-project.ts` — без изменений (шаблоны те же).

### Проверка
- `make pack-check` (Docker и сеть до реестра npm).

## Риски
- Риск: `drizzle-kit` в потребителе ставится из реестра — время `pack-check` растёт. Mitigation: только `devDependencies` шаблона, генерация не выполняется в тесте (миграции закоммичены).

## Чек-лист фазы
- Задачи 37–38 выполнены; `make pack-check` зелёный.
