# @verdeect/kit

Общий инфраструктурный пакет NestJS-сервисов Вердикта 2.0: схема окружения, тестовый контур, а в следующих этапах — наблюдаемость, HTTP, БД с RLS, идемпотентность, сообщения, шифр и Redis. Один пакет с подпутями и одной версией заменяет копии `src/shared/**` в сервисах. Требования — [requirements/0000-kit/prd.md](requirements/0000-kit/prd.md).

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
- `nestjs-pino`, `pino`, `prom-client`, `@sentry/nestjs`, `@verdeect/auth`.

Опциональные peer нужны только подпути, который их использует. Без них подпуть не импортируется и называет библиотеку: «`@verdeect/kit/<подпуть>` требует `<библиотека>` — добавьте в зависимости сервиса» (AC-1.2).

| Подпуть    | Опциональные peer          |
| ---------- | -------------------------- |
| `/config`  | —                          |
| `/testing` | `testcontainers`, `vitest` |
| остальные  | в своих этапах             |

## Подпути

| Подпуть          | Этап | Статус                  |
| ---------------- | ---- | ----------------------- |
| `/config`        | E1   | готов, в `[Unreleased]` |
| `/testing`       | E1   | готов, в `[Unreleased]` |
| `/observability` | E2   | готов, в `[Unreleased]` |
| `/http`          | E3   | в своём этапе           |
| `/database`      | E4   | в своём этапе           |
| `/idempotency`   | E4   | в своём этапе           |
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

`@verdeect/kit/observability` (prd.md §3.2) — логи, GlitchTip, `/health` и `/metrics`, остановка. Nest-модуля нет: классы собирает сервис (в E3 — `bootstrapService`).

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

**Логгер.** `createLoggerOptions` возвращает `Params` `nestjs-pino` с кортежем `[options, stream]`. Логгер вне Nest — `pino(...params.pinoHttp)`. На Fastify генератор trace-id передаётся и адаптеру: `new FastifyAdapter({genReqId: params.pinoHttp[0].genReqId})` (в E3 — `createHttpApp`).

**`/health` и `/metrics`.** `MetricsServer` слушает `METRICS_PORT` (`node:http`, вне Nest; `0` — порт выбирает ОС). Пробы регистрируют владельцы зависимостей: `health.register(name, probe, {critical})`. Ошибка прослушивания (`EADDRINUSE`) — отказ `listen()`, её передают в `failStartup`.

**Остановка `KitLifecycle`.** Участники регистрируются на шаг: `lifecycle.register(participant, {step})`.

| Шаг | Что                                                                       |
| --- | ------------------------------------------------------------------------- |
| 1   | `/health` → 503, пауза `SHUTDOWN_DRAIN_MS` (выполняет сам `KitLifecycle`) |
| 2   | HTTP не принимает новые соединения, начатые дорабатывают                  |
| 3   | подписчики, relay, очистка                                                |
| 4   | пулы БД, RabbitMQ, Redis                                                  |
| 5   | сервер метрик                                                             |

Участники шага работают параллельно, следующий шаг начинается после предыдущего. Два режима:

- **сигнал ОС** (`lifecycle.listen()`, `SIGTERM`, `SIGINT`) — сторож срока `SHUTDOWN_TIMEOUT_MS` от сигнала (пауза входит). Срок вышел — `error`-лог `SHUTDOWN_TIMEOUT`, событие GlitchTip, `exit(1)`. Шаги в срок — `exit` не вызывается, процесс без открытых дескрипторов выходит сам с кодом 0; если не вышел к сроку (утёк таймер или сокет) — `SHUTDOWN_NOT_EXITED` и `exit(1)`;
- **программный `close()`** (тесты сервиса, CLI) — те же шаги 1–5 без сторожа и без `exit`; ошибка участника — отказ `close()` после всех шагов (несколько — `AggregateError`). Безопасен в тестах сервиса.

**Алерты.** `alertRulesTemplate` — путь к `alerts/verdeect-kit.rules.yml` в установленном пакете: правила vmalert для метрик пакета с порогом по умолчанию. Свой порог — recording-правило `verdeect_kit_threshold:<метрика>` с меткой `service` в файле правил сервиса:

```yaml
- record: verdeect_kit_threshold:outbox_lag_seconds
  expr: vector(30)
  labels:
    service: platform
```

Пороги: `outbox_lag_seconds` (5 с за 1m), `outbox_pending` (1000 за 5m), `events_consumed` (DLQ за 15m > 0), `db_pool_wait_timeouts` (за 5m > 0), `rate_limit_unavailable` (за 5m > 0).

## Тесты сервиса

Подпуть `/testing` разрешается только с условием `development` (NFR-4): в production-сборке сервиса его нет. Vitest включает это условие сам; для `node` — `node --conditions=development`.

```ts
// test/integration/global-setup.ts
import { startTestStack } from '@verdeect/kit/testing';

export default startTestStack({ service: 'files', postgres: true, mailpit: true });
```

Контейнеры `TEST_IMAGES` стартуют раз на прогон, адреса доходят до тестов через `inject`:

| Ключ `inject`    | Флаг       | Значение                                              |
| ---------------- | ---------- | ----------------------------------------------------- |
| `kitPostgresUrl` | `postgres` | `postgres://postgres:<пароль>@<host>:<port>/postgres` |
| `kitSmtpUrl`     | `mailpit`  | `smtp://<host>:<port>`                                |
| `kitMailpitUrl`  | `mailpit`  | `http://<host>:<port>` — HTTP API mailpit             |
| `kitS3Endpoint`  | `minio`    | `http://<host>:<port>`                                |
| `kitS3AccessKey` | `minio`    | пользователь MinIO                                    |
| `kitS3SecretKey` | `minio`    | пароль MinIO, случайный на прогон                     |

После E1 `startTestStack` не готовит БД и не применяет миграции (это E4), RabbitMQ и Redis появятся в E5 и E8.

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

Ещё в `/testing`: `tcpProxy(target)` — обрывы (`break`, `restore`, `blackhole`, `freeze`, `blackholeOn`) и задержки (`delayOn`) TCP; `timingGuard` — `globalSetup` замеров времени (нагрузка, ядра, отказ при запущенном e2e-контуре `verdeect-*-e2e`); `TEST_TIMEOUT_SCALE` — множитель тайм-аутов конфигов Vitest.

## Развёртывание

- Порт метрик `METRICS_PORT` не публикуется наружу: его читает только сборщик метрик внутри сети.
- Балансировщик проверяет готовность по `/health` на `METRICS_PORT`: с начала остановки — 503, реплика выводится из балансировки за паузу `SHUTDOWN_DRAIN_MS`.
- Правила алертов: подключите файл `alertRulesTemplate` (`node_modules/@verdeect/kit/alerts/verdeect-kit.rules.yml`) в vmalert рядом с правилами сервиса; свои пороги — `verdeect_kit_threshold:<метрика>`.
- `REPLICA_ID` не задавать ни в compose, ни в `env_file`: умолчание — `hostname()` контейнера.
- `stop_grace_period: 15s` при `SHUTDOWN_TIMEOUT_MS` 10000: срок Docker должен быть больше срока остановки сервиса.
- Пул соединений PostgreSQL: сервис открывает до `2 × DB_POOL_MAX × реплики` соединений (основной пул и пул чтения) — `max_connections` считается по этой формуле.
- DLQ разбирается в течение 7 дней.
- Смена ключа шифра (UC-10): новый секрет `verdeect-kit crypto generate-secret` (с E7) → новая версия первой в `ENCRYPTION_KEYS` → перезапуск → перешифровка → удаление старой версии.
- Смена TTL `.retry` (`RABBITMQ_RETRY_SECONDS`): очередь `<svc>.retry` удалить и пересоздать, иначе отказ запуска (prd.md §3.4).

## Реестр префиксов id

Формат префикса `^[a-z]{2,5}$`, id — `<prefix>_<ulid>`. Новый префикс добавляется строкой в этот реестр в плане сервиса.

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
- `KitConfigModule` — `forRoot({schema})`: глобальный `ConfigModule`, окружение перечитывается при каждой сборке контекста.
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

### @verdeect/kit/testing

- `TEST_IMAGES` — образы тестов и compose сервисов.
- `startTestStack` — `globalSetup` Vitest: контейнеры раз на прогон, адреса через `provide`.
- `assertRepoConventions` — проверка репозитория сервиса по правилам выше.
- `tcpProxy` — запущенный TCP-прокси к цели.
- `TcpProxy` — тип прокси: `url`, `break`, `restore`, `blackhole`, `freeze`, `blackholeOn`, `delayOn`, `close`.
- `timingGuard` — `globalSetup` уровня замеров времени.
- `TEST_TIMEOUT_SCALE` — множитель тайм-аутов из `TEST_TIMEOUT_SCALE`, по умолчанию 1.

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
