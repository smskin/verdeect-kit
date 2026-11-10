# Базовые правила проекта

> Кода пока нет. Соглашения взяты из образцов `verdeect-platform-client` и `verdeect-auth`, скила `nestjs-specialist` (в объёме библиотеки), эталонных копий в сервисах и PRD `requirements/0000-kit/prd.md`. После E1 сверьте их с кодом и при необходимости поправьте.

## Соглашения об именовании

- Файлы — kebab-case. У Nest-компонентов есть суффикс роли: `kit-config.module.ts`, `kit-exception.filter.ts`, `zod-validation.pipe.ts`, `idempotent.decorator.ts`, `idempotency.interceptor.ts`. У остальных файлов суффикса нет: `parse-env.ts`, `sanitize-error.ts`, `outbox-relay.ts`, `cipher.ts`.
- Тесты лежат в `test/<уровень>/<подпуть>/`, файлы — `*.spec.ts`. Имя файла начинается с номера AC, если тест проверяет критерий: `ac-1-3-parse-env-paths.spec.ts`.
- Переменные и функции — camelCase: `defineEnv`, `parseEnv`, `createLoggerOptions`, `newId`, `runExclusive`.
- Константы модуля — SCREAMING_SNAKE: `SENSITIVE_KEYS`, `TEST_IMAGES`, `TEST_TIMEOUT_SCALE`. DI-токены — `Symbol('…')` с тем же именем (`DRIZZLE`, `DRIZZLE_READ`).
- Классы и типы — PascalCase. Публичные Nest-модули и типы окружения начинаются с `Kit`: `KitConfigModule`, `KitLifecycle`, `KitBaseEnv`, `KitRedaction`. Ошибки оканчиваются на `Error`: `InvalidEnvironmentError`, `TenantRequiredError`, `DecryptError`, `ExpectedMessageError`. Вместо `enum` — союзы строковых литералов.
- Коды ошибок — SCREAMING_SNAKE, дословно по словарю `kitErrors` (§3.5): `VALIDATION_FAILED`, `ROUTE_NOT_FOUND`, `IDEMPOTENCY_KEY_REUSED`.
- Метрики пакета называются `verdeect_<имя>` с метками `service` и т. п. (§3.2). Метрики домена сервиса имеют префикс `<service>_`; в пакете их нет.
- Имя сервиса — имя экземпляра, `^[a-z][a-z0-9-]{1,31}$`. Проверка формата — одна внутренняя функция для `bootstrapService`, `createCipher` и модулей.

## Структура модулей

- `src/<подпуть>/` — `config`, `observability`, `http`, `database`, `idempotency`, `messaging`, `crypto`, `redis`, `testing`. Каждый подпуть — точка входа `index.ts` с явным списком реэкспортов (`export { … }`, `export type`). Что не перечислено в PRD §3, не экспортируется.
- `src/internal/` — общие функции нескольких подпутей без своей точки входа: распознавание ошибок pg по форме, проверка имени сервиса, проверка опциональных peer.
- `src/cli/` — CLI `verdeect-kit` (поле `bin`). CLI разбирает только свои ключи окружения (`migrateEnvSchema`, `prepareEnvSchema`).
- Направление импортов между подпутями задано в `.ai-factory/ARCHITECTURE.md`. Рабочий код не импортирует `testing`.
- Опциональный peer (`pg`, `ioredis`, `amqplib`, `amqp-connection-manager`, `testcontainers`, `vitest`) не импортируется статически из подпути, который должен грузиться без него (AC-1.2). `pg` в `/messaging` подключается только динамическим `import()` в ветке с БД.
- В `src/**` нет имён схем и таблиц сервисов и вызовов `pgSchema` с литералом (NFR-2, AC-9.4). Схему, папку миграций и имя сервиса передаёт вызывающий.
- Перенос кода: в шапке файла указаны эталон (`inventory.md` §1) и что взято из других копий. Тесты эталона переносятся вместе с кодом и обобщаются.
- ESM: относительные импорты с суффиксом `.js`, типы — через `import type`. `require()` и CommonJS запрещены.
- Пустые каталоги не создаются: каталог появляется вместе с первым файлом.

## Обработка ошибок

- P0: опция допустима только для различия по роли сервиса, названного в PRD. Режимов совместимости, псевдонимов старых ключей и чтения старых форматов нет.
- Ошибки конфигурации — `InvalidEnvironmentError {code, keys}`. Пути ключей полные, через точку; без пути — `(root)`. Значений в ошибке нет никогда.
- Отказ запуска — через `failStartup`: `fatal`-лог, событие GlitchTip с ожиданием до 2 с, `exit(1)`. Ошибки сервиса реализуют `StartupFailure`.
- HTTP:
  - `DomainError(code, details?)` получает статус из словаря `defineErrors`; уровень `warn`, без GlitchTip;
  - прочее ≥ 500 → `INTERNAL_ERROR`, `error`, ровно одно событие GlitchTip;
  - текст исходной ошибки, стек и SQL в ответ не попадают;
  - тело — `{error: {code, message, details}}`, `message` по-русски.
- Ожидаемые ошибки (домен, валидация, `ExpectedMessageError`, срок пула) в GlitchTip не отправляются или отправляются через `captureThrottled`. Неожиданные — `captureError`, ровно раз на ошибку.
- Ошибки распознаются по форме объекта, с обходом `cause`, без импорта драйвера: `isUniqueViolation`, `isConnectionError`, `isPoolTimeout`.
- Ошибки шифра — `DecryptError {reason}`, без открытого текста и ключей.

## Поток управления

- Prefer flat, readable control flow over deeply nested conditionals. Use guard clauses, early `return`/`continue`, small named helper methods, or explicit classification logic when they make the code easier to follow. Handle edge cases and irrelevant branches early so the main path stays visible.
- Шаги процессов из PRD (остановка `KitLifecycle` 1–5, `bootstrapService`, relay, подписчик) идут в коде в том же порядке. Номер шага указан в комментарии.
- Всегда фигурные скобки (`curly: all`), однострочных `if` нет.
- Фоновые задачи (очистка, relay) учитывают остановку: текущая пачка дорабатывает, новая не начинается.

## Логирование

- Логи только через `pino`/`nestjs-pino`. `console.*` в `src/**` запрещён (`no-console`, AC-9.4).
- Лог каждой фоновой операции содержит поля `service` и `replica` (NFR-8).
- В логи, GlitchTip и ответы не попадают значения окружения, секреты, ПДн, ключи Redis и параметры SQL. Редактирование — по `SENSITIVE_KEYS` ∪ `KitRedaction.sensitiveKeys`; базовый список не отключается. Ошибки проходят через `sanitizeError`.
- `err.code` не скрывается. Путь в логе доступа — без query, через `maskPath`.

## Тесты

- Vitest, Jest не используется. Метаданные декораторов пишет `unplugin-swc`.
- Уровни задаёт столбец «Уровень» AC в PRD §5:
  - U — `test/unit/<подпуть>`, без сети и Docker;
  - I — `test/integration/<подпуть>`, Testcontainers на `TEST_IMAGES` через собственный `startTestStack`, контейнеры раз на прогон, изоляция воркеров;
  - T — `test/timing/<подпуть>`, через `timingGuard`;
  - C — `test/consumer` на упакованном архиве;
  - R — проверки репозитория и архива.
- Имена `describe`/`it` начинаются с ID критерия: `AC-1.3: …`, `UC-8: …`.
- Тайм-ауты в spec-файлах не поднимаются. На загруженной машине используется `TEST_TIMEOUT_SCALE`.
- Эквивалентность с сервисами: тесты эталона из `inventory.md` §2 переносятся и обобщаются, а не пишутся заново.
- Репозитории сервисов — только чтение. Их контуры не запускаются.

## Комментарии и документация в коде

- Первая строка файла — комментарий `//` с назначением, ссылками на требования (`prd.md §3.4`, `AC-5.6`) и эталоном переноса.
- TSDoc `/** … */` — у каждого публичного экспорта и его полей. Проверяет ESLint.
- Изменение публичной поверхности (экспорты, опции, ключи окружения, коды ошибок, имена метрик, правила `assertRepoConventions`) сопровождается TSDoc, README и записью в `CHANGELOG.md`. Версия меняется по G14.
- Комментарии и документация — по-русски, идентификаторы — по-английски.

## Стиль кода

- Prettier: отступ 4 пробела (в yaml, json и md — 2), одинарные кавычки, точки с запятой, ширина строки 100, висячие запятые, `lf`.
- TypeScript `strict` и `noUncheckedIndexedAccess`. `any` запрещён, кроме границ с внешними библиотеками (с комментарием). Недоверенный ввод — `unknown` и проверка zod.
- `readonly` — у полей публичных интерфейсов и параметров конструктора.
- Зависимости (NFR-3):
  - обязательные и опциональные peer — строго по списку NFR-3, диапазоны `^` от проверенной минорной;
  - `dependencies` — только внутренние детали, точные версии;
  - `devDependencies` — точные версии;
  - `minimumReleaseAge` pnpm — значение по умолчанию. Исключения — только с обоснованием и условием снятия.
