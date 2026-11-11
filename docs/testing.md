# Тесты пакета

[← README](../README.md)

Уровни задаёт столбец «Уровень» AC в prd.md §5. Имя каждого теста требования начинается с ID: `AC-1.3: …`, `§3.8: …`.

| Уровень | Где                          | Что                                                                  | Запуск                  | Docker      |
| ------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------- | ----------- |
| U       | `test/unit/<подпуть>`        | без сети и Docker; типы — `*.test-d.ts`                              | `make test`             | нет         |
| I       | `test/integration/<подпуть>` | Testcontainers на `TEST_IMAGES` через собственный `startTestStack`   | `make test-integration` | да          |
| T       | `test/timing/<подпуть>`      | замеры времени, `globalSetup` — `timingGuard`                        | `make test-timing`      | нет         |
| R       | `test/package`               | архив, publint, attw, `publish.mjs`, правила lint, документы, алерты | `make pack-check`       | да (алерты) |
| C       | `test/consumer`              | проекты-потребители на упакованном архиве                            | `make pack-check`       | да          |

`/observability`: U — `test/unit/observability` (логи на стенде Nest + Fastify через `inject`, без порта; GlitchTip — подделка SDK и настоящий SDK с поддельным транспортом `test/support/fake-sentry.ts`); I — `test/integration/observability` (`/health` по HTTP, проба PostgreSQL из `startTestStack`); T — `test/timing/observability` (сроки остановки `KitLifecycle`, дочерний процесс на собранном `dist` в `node_modules/.cache/kit-timing-dist` — выход 0 или 1); R — `test/package/ac-2-11-alert-rules.spec.ts` (`vmalert -dryRun` и `vmalert-tool unittest` в Docker — нужен Docker для `make pack-check`).

`/http` и CLI: U — `test/unit/http` (приложение на `createTestApp` через `inject`; `bootstrapService` с `PORT=0`, `METRICS_PORT=0`, перехватом stdout и подменой `process.exit`; `nestjs-pino` держит один журнал доступа на процесс — файл теста запускает приложения с одной конфигурацией логгера) и `test/unit/cli` (команда `openapi` в процессе); I — `test/integration/http` (keyset на PostgreSQL, временная схема на файл); T — `test/timing/http` (остановка под нагрузкой: дочерний процесс `test/fixtures/http/shutdown-app.mjs` на `bootstrapService` из `node_modules/.cache/kit-timing-dist`, `/health` 503 раньше закрытия HTTP, долгий запрос дорабатывает, поток SSE закрывает участник шага 2). C — сервис потребителя `test/consumer/minimal/src/service` на TypeScript собирается `tsc -p tsconfig.build.json` в `globalSetup` и стартует как в production: `node --import ./dist/service/instrument.js dist/service/main.js`; снимок `contracts/openapi.json` сравнивается с выводом `verdeect-kit openapi` (после изменения маршрута — `pnpm build && pnpm openapi` в потребителе).

`make pack-check` (`pnpm pack:check`) = `pnpm build` + `pnpm test:package`. Уровень C ставит зависимости потребителей из реестра npm — нужна сеть.

## Когда запускать

| Цель                                  | Когда                                  | Время (примерно) |
| ------------------------------------- | -------------------------------------- | ---------------- |
| `make test`, `make test-module M='…'` | во время работы                        | секунды          |
| `make test-integration`               | перед коммитом, в `ci`                 | ~15 с            |
| `make test-timing`                    | перед слиянием, на тихой машине        | секунды          |
| `make pack-check`                     | перед коммитом, в `ci`                 | ~1 мин           |
| `make test-full`                      | перед `/aif-commit` слияния и выпуском | ~1,5 мин         |
| `make test-load`                      | нагрузочного набора нет                | —                |

## Тайм-ауты

Тайм-ауты конфигов Vitest умножаются на `TEST_TIMEOUT_SCALE` (по умолчанию 1). На загруженной машине (load average выше числа ядер) задайте `TEST_TIMEOUT_SCALE=2..3` — только локально, в CI — 1. Тайм-ауты внутри spec-файлов не поднимаются. Тест, который упал только по тайм-ауту, сначала перезапускается отдельно.

`make test-timing` — только на тихой машине: `timingGuard` печатает нагрузку и отказывает при запущенном e2e-контуре `verdeect-*-e2e`.

## Проекты интеграционного конфига

`vitest.integration.config.ts` делит файлы на два проекта:

- `shared` — `isolate: false`, модули грузятся один раз на воркер;
- `isolated` — `isolate: true`, свой кэш модулей на файл.

В `isolated` (список `ISOLATED`) файл попадает, только если пишет `process.env` или `vi.stubEnv`, использует `vi.mock`, патчит прототипы или инициализирует процесс-глобальное состояние. Каждая строка списка — с комментарием-причиной. Пустой список — проект `isolated` не создаётся.

Файлы `isolated` (E4):

| Файл                                                                  | Причина                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| `test/integration/database/ac-4-5-pool-timeout.spec.ts`               | `initFakeSentry` — процесс-глобальный Sentry             |
| `test/integration/idempotency/ac-4-14-idempotency.spec.ts`            | `initFakeSentry` — процесс-глобальный Sentry             |
| `test/integration/idempotency/ac-4-14-missing-purge-function.spec.ts` | `vi.stubEnv` и `process.exit` — стенд `bootstrapService` |

Прочие файлы уровня I передают окружение приложения через `setPreparsedEnv` (`test/support/database.ts`, `createDbApp`) — без `vi.stubEnv`, проект `shared`.

`globalSetup` уровня I — `startTestStack({service: 'kit', postgres: true, migrations: 'test/fixtures/database/migrations'})`: БД `kit` подготовлена и мигрирована фикстурой, шаблон `kit_template` — для `createScratchDatabase()`. Фикстура `test/fixtures/database` — схема `kit` (`note`, `setting`, `idempotency_key`) и миграции `drizzle-kit` из `devDependencies`; после правки `schema.ts` — `pnpm db:fixtures` (новая миграция), ручной SQL (FORCE, права, `idempotencyPurgeSql`) — `drizzle-kit generate --custom`. Повторный `pnpm db:fixtures` должен сообщать «No schema changes».

Контейнеры стартуют один раз на прогон в `test/integration/global-setup.ts`, файлы идут последовательно (`fileParallelism: false`).
