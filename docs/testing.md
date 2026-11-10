# Тесты пакета

[← README](../README.md)

Уровни задаёт столбец «Уровень» AC в prd.md §5. Имя каждого теста требования начинается с ID: `AC-1.3: …`, `§3.8: …`.

| Уровень | Где                          | Что                                                                | Запуск                  | Docker |
| ------- | ---------------------------- | ------------------------------------------------------------------ | ----------------------- | ------ |
| U       | `test/unit/<подпуть>`        | без сети и Docker; типы — `*.test-d.ts`                            | `pnpm test`             | нет    |
| I       | `test/integration/<подпуть>` | Testcontainers на `TEST_IMAGES` через собственный `startTestStack` | `pnpm test:integration` | да     |
| T       | `test/timing/<подпуть>`      | замеры времени, `globalSetup` — `timingGuard`                      | `pnpm test:timing`      | нет    |
| R       | `test/package`               | архив, publint, attw, `publish.mjs`, правила lint, документы       | `pnpm pack:check`       | нет    |
| C       | `test/consumer`              | проекты-потребители на упакованном архиве                          | `pnpm pack:check`       | да     |

`pnpm pack:check` = `pnpm build` + `pnpm test:package`. Уровень C ставит зависимости потребителей из реестра npm — нужна сеть.

## Тайм-ауты

Тайм-ауты конфигов Vitest умножаются на `TEST_TIMEOUT_SCALE` (по умолчанию 1). На загруженной машине (load average выше числа ядер) задайте `TEST_TIMEOUT_SCALE=2..3` — только локально, в CI — 1. Тайм-ауты внутри spec-файлов не поднимаются. Тест, который упал только по тайм-ауту, сначала перезапускается отдельно.

`pnpm test:timing` — только на тихой машине: `timingGuard` печатает нагрузку и отказывает при запущенном e2e-контуре `verdeect-*-e2e`.

## Проекты интеграционного конфига

`vitest.integration.config.ts` делит файлы на два проекта:

- `shared` — `isolate: false`, модули грузятся один раз на воркер;
- `isolated` — `isolate: true`, свой кэш модулей на файл.

В `isolated` (список `ISOLATED`) файл попадает, только если пишет `process.env` или `vi.stubEnv`, использует `vi.mock`, патчит прототипы или инициализирует процесс-глобальное состояние. Каждая строка списка — с комментарием-причиной. Пока список пуст, проект `isolated` не создаётся.

Контейнеры стартуют один раз на прогон в `test/integration/global-setup.ts`, файлы идут последовательно (`fileParallelism: false`).
