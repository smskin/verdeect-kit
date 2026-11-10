# Changelog

Все заметные изменения `@verdeect/kit`. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [Semantic Versioning](https://semver.org/lang/ru/). У мажорной версии есть раздел «Как перейти» (NFR-5).

## [Unreleased]

Первый выпуск: подпути `/config` и `/testing` (этап E1, PRD v1.7).

### Added

- `/config`: фрагменты окружения `envBase`, `envDatabase`, `envMessaging`, `envRedis`, `envSentry`, `envCrypto`, `envServiceUrls`.
- `/config`: `defineEnv` — схема окружения сервиса; несовместимое переопределение ключа пакета — ошибка компиляции.
- `/config`: `withBaseChecks` — `PORT` ≠ `METRICS_PORT` (кроме 0), `SHUTDOWN_DRAIN_MS` < `SHUTDOWN_TIMEOUT_MS`.
- `/config`: `parseEnv` и `InvalidEnvironmentError` — полные пути ключей через точку, без значений.
- `/config`: `KitConfigModule.forRoot({schema})` — обёртка над `ConfigModule` из `@nestjs/config`.
- `/config`: схемы CLI `migrateEnvSchema`, `prepareEnvSchema`.
- `/config`: помощники `port`, `positiveInt`, `optionalText`, `booleanFlag`, `jsonValue`, `httpUrl`, `uniqueBy`.
- `/config`: типы `KitBaseEnv`, `KitDatabaseEnv`, `KitMessagingEnv`, `KitRedisEnv`, `KitCryptoEnv`.
- `/testing`: `TEST_IMAGES` — PostgreSQL 17.11, Redis 7.4.11, RabbitMQ 4.3.6, mailpit 1.31.6, MinIO RELEASE.2026-08-04.
- `/testing`: `startTestStack` — контейнеры `postgres`, `mailpit`, `minio` раз на прогон, адреса через `provide`.
- `/testing`: `assertRepoConventions` — правила `test-images`, `replica-id`, `stop-grace-period`, `env-keys`, `peer-versions`, `instrument-import`, `command-unrecognized`, `redaction-imports`.
- `/testing`: `assertRepoConventions` — правило команды «на запрет» (PRD v1.11): у приложения обязателен распознанный запуск; `main.*` в аргументах любой команды, вызов оболочки с `-c` без выделенного скрипта, опция `tini`/`dumb-init` вне списка, переменная без умолчания на месте программы, опций `node` или файла входа — `command-unrecognized`; длинные опции и `-O`/`+O` оболочки поддержаны.
- `/testing`: `tcpProxy` и тип `TcpProxy` — обрывы и задержки TCP.
- `/testing`: `timingGuard` — `globalSetup` замеров времени.
- `/testing`: `TEST_TIMEOUT_SCALE` — множитель тайм-аутов тестов.
