# Фаза 1: Основа — манифест, lint, `internal`

Plan: [index.md](index.md)
Tasks: 1-3
Depends on: none (коммит требований r9 `7d5e28a` уже в ветке)

## Цель

Подготовить общие для `/database` и `/idempotency` части без нового подпути: зависимость `drizzle-kit` для фикстур, правила lint границ новых подпутей и запрет статического `drizzle-orm/node-postgres`, `newId`/`ulid` и ключ метаданных `@Idempotent` в `src/internal/`, пометку ошибки срока пула именем пула. После фазы `make lint analyse test` зелёные, публичная поверхность не меняется.

## Свидетельства из кода

| Путь | Символы | Зачем |
|---|---|---|
| `package.json` | `devDependencies`, `scripts` | точные версии; `drizzle-kit` нет |
| `eslint.config.js` | `COMMON_PATTERNS`, `restrictedImports`, блоки `src/observability`, `src/http`, `src/cli` | шаблон блоков границ; блоков `src/database`, `src/idempotency` нет |
| `node_modules/drizzle-orm/node-postgres/driver.js` | первая строка — статический импорт `pg` | статический импорт `drizzle-orm/node-postgres` падает `ERR_MODULE_NOT_FOUND` без `pg` раньше проверки `requirePeer` (AC-1.2); драйвер — только ленивый `loadDrizzle()` (задача 4) |
| `src/internal/pg-errors.ts` | `causeChain`, `isPoolTimeout` | обход `cause`; сюда — пометка пула |
| `src/http/kit-exception.filter.ts:100-109` | ветка `isPoolTimeout`, `pool: 'unknown'` | меняется в фазе 5 (задача 22) |
| O `apps/orchestrator/src/shared/database/ids.ts` | `ulid(now)`, `newId(prefix)`, алфавит Crockford | эталон `ids` (inventory §1) |
| O `src/shared/database/ids.spec.ts` | регулярка `^msg_[0-9A-HJKMNP-TV-Z]{26}$`, порядок по времени, уникальность | тест эквивалентности AC-4.9 |
| `src/http/api/openapi-document.ts:7` | комментарий «Idempotency-Key не переносятся (E4)» | читатель ключа метаданных — фаза 6 |

## Файлы

| Путь | Действие | Изменение |
|---|---|---|
| `package.json` | modify | `drizzle-kit` 0.31.11 в `devDependencies` (точно), скрипт `db:fixtures` |
| `eslint.config.js` | modify | запрет значения `drizzle-orm/node-postgres`; блоки `src/database/**`, `src/idempotency/**` |
| `src/internal/ids.ts` | create | `ulid`, `newId`, `ID_PREFIX` |
| `src/internal/metadata.ts` | create | `IDEMPOTENT_METADATA`, тип `KitIdempotentOptions` |
| `src/internal/pg-errors.ts` | modify | `tagPoolTimeout`, `poolTimeoutOf`, тип `KitPoolName` |
| `src/internal/sql-identifier.ts` | create | `quoteIdentifier` (KT-20 п. 1) |
| `test/unit/internal/sql-identifier.spec.ts` | create | экранирование идентификаторов |
| `test/unit/internal/ac-4-9-ids.spec.ts` | create | AC-4.9 |
| `test/unit/internal/pg-errors.spec.ts` | modify | пометка пула |

## Task 1: Манифест и lint новых подпутей

### Назначение
Фикстуры миграций (фаза 2) генерирует `drizzle-kit`, как в сервисах: так `tenantPolicy` проверяется настоящей генерацией SQL (§3.3 «SQL генерирует `drizzle-kit`»). Lint заранее закрывает границы `database` и `idempotency` по таблице `ARCHITECTURE.md`.

### Шаги
(`Skill: none — манифест и конфиг lint`)
1. `package.json`, `devDependencies`: добавить `"drizzle-kit": "0.31.11"` (точно, версия сервисов — inventory §3). Выполнить `pnpm install` (lockfile обновится). Если `minimumReleaseAge` не пускает версию — остановиться и сообщить (не обходить настройку).
2. `package.json`, `scripts`: `"db:fixtures": "drizzle-kit generate --config test/fixtures/database/drizzle.config.ts"` (файл конфига появится в задаче 8).
3. `eslint.config.js`, `COMMON_PATTERNS`: новый элемент — группа `drizzle-orm/node-postgres`, `allowTypeImports: true`, сообщение «драйвер Drizzle тянет pg статически — только через loadDrizzle() из src/database/pg.ts (requirePeer + ленивый import(), AC-1.2)». Сообщение существующей группы `pg` дополнить: «… только через loadPeer, либо requirePeer + ленивый import() в src/database/pg.ts».
4. `eslint.config.js`: блок `files: ['src/database/**/*.ts']` — `restrictedImports` с группой `../testing/*`, `../http/*`, `../idempotency/*`, `../messaging/*`, `../redis/*`, `../crypto/*`, `../cli/*`, `shell-quote` и сообщением «database импортирует только observability, config и internal (ARCHITECTURE.md)».
5. Блок `files: ['src/idempotency/**/*.ts']` — группа `../testing/*`, `../messaging/*`, `../redis/*`, `../crypto/*`, `../cli/*`, `shell-quote`, сообщение «idempotency импортирует database, http, observability, config, internal (ARCHITECTURE.md)».
6. Блок `src/http/**` уже запрещает `../database/*` и `../idempotency/*` — не трогать.

### Контракты
- `drizzle-kit` — только `devDependencies` пакета; в `dependencies`/peer не попадает (NFR-3).
- Тип из `drizzle-orm/node-postgres` (`NodePgDatabase`) импортируется только `import type`.

### Ошибки и логи
Логов нет.

### Тесты
`test/unit/package/package-manifest.spec.ts` уже проверяет точные версии `devDependencies` — новый пакет должен пройти его без правки. Правило lint проверяется `make lint` (задача 4 импортирует драйвер только динамически).

### Критерии приёмки
- `pnpm exec drizzle-kit --version` печатает 0.31.11.
- Временный файл `src/database/x.ts` со статическим импортом значения из `drizzle-orm/node-postgres` даёт ошибку lint (проверить вручную и удалить файл).

### Проверка
- `make lint analyse test` — зелёные.

## Task 2: `newId` и `ulid` в `internal`

### Назначение
`newId` нужен `/database` (реэкспорт, §3.3) и в E5 `/messaging` без значения из `database` (ARCHITECTURE «Чистые функции … лежат в internal»). AC-4.9.

### Шаги
1. Создать `src/internal/ids.ts` (`Skill: nestjs-code generic src/internal/ids.ts (CREATE)`). Шапка: «ulid, newId (prd.md §3.3, AC-4.9). Эталон — O ids.ts: алфавит Crockford, 10 знаков времени, 16 случайных; по PRD — проверка префикса ^[a-z]{2,5}$, без монотонности внутри миллисекунды».
2. Константа `CROCKFORD` — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; `ID_PREFIX` — регулярка `^[a-z]{2,5}$`.
3. `ulid(now?: number): string`: `now` по умолчанию `Date.now()`; не целое, отрицательное или больше 2^48 − 1 → `RangeError` «ulid: время вне диапазона». Время — 10 знаков (остаток от деления на 32, старший знак первым), случайная часть — 16 знаков из `randomBytes(16)` (каждый байт по модулю 32, как O: 256 делится на 32 без смещения).
4. `newId(prefix: string): string`: префикс не по `ID_PREFIX` → `TypeError` «newId: префикс «…» вне формата ^[a-z]{2,5}$» (сам префикс в тексте допустим — это не секрет); иначе `<prefix>_<ulid()>`.
5. TSDoc на обеих функциях и константе (они реэкспортируются из `/database` в задаче 22).

### Контракты
- `newId('fil')` → `fil_` + 26 знаков из `[0-9A-HJKMNP-TV-Z]`.
- Импорты — только `node:crypto` (правило `internal`).

### Ошибки и логи
Ошибки — исключения выше; логов нет.

### Тесты
`test/unit/internal/ac-4-9-ids.spec.ts` (`Skill: nestjs-code test unit internal ids`), `describe('UC-5: идентификаторы')`:
- `AC-4.9: newId('fil') — fil_ + 26 знаков Crockford` — регулярка `^fil_[0-9A-HJKMNP-TV-Z]{26}$`.
- `AC-4.9: префикс вне ^[a-z]{2,5}$ → TypeError` — `it.each`: `f`, `files1`, `Fil`, `fi-l`, пустая строка, `abcdef`.
- `AC-4.9: формат совпадает с O ids (msg_) и I newUlid (26 знаков)` — регулярка O `^msg_[0-9A-HJKMNP-TV-Z]{26}$` для `newId('msg')`.
- `AC-4.9: ulid(1000) < ulid(2000) по первым 10 знакам` (эталон O).
- `AC-4.9: 100 значений newId уникальны` (эталон O).
- `AC-4.9: ulid(-1) и ulid(2^48) → RangeError`.

### Критерии приёмки
- Все случаи выше зелёные.

### Проверка
- `make test FILTER='AC-4.9'`.

## Task 3: Ключ метаданных `@Idempotent` и пометка пула в ошибке

### Назначение
(а) `@Idempotent` (фаза 6) пишет метаданные, `@Api`/OpenAPI (`http`) их читает без импорта `idempotency` (ARCHITECTURE «Правила зависимостей»). (б) Решение E3 и KT-19 п. 3: пул `/database` (обёртка `connect`, задача 18) помечает ошибку срока именем пула и учитывает её один раз, фильтр `/http` перестаёт писать `pool: 'unknown'` (AC-4.5).

### Шаги
1. Создать `src/internal/metadata.ts` (`Skill: nestjs-code generic src/internal/metadata.ts (CREATE)`). Шапка: «ключи метаданных декораторов: Idempotent → @Api без цикла http ↔ idempotency (ARCHITECTURE.md; prd.md §3.3а, §3.5)».
   - `IDEMPOTENT_METADATA` — строка `verdeect-kit:idempotent`.
   - Тип `KitIdempotentOptions`: `required?: boolean` (умолчание `false`), `tenantFromBody?: string` (путь поля через точку). TSDoc полей — текст §3.3а.
2. `src/internal/pg-errors.ts` (`Skill: nestjs-code generic src/internal/pg-errors.ts (MODIFY)`):
   - тип `KitPoolName` — союз `'main' | 'read'`;
   - внутренний символ `POOL_TAG` (`Symbol.for('verdeect-kit.pool')`);
   - `tagPoolTimeout(error: unknown, pool: KitPoolName): boolean` — находит в цепочке `causeChain` первый узел с сообщением срока пула и, если он объект без метки, ставит неперечисляемое свойство `POOL_TAG` = имя пула; возвращает `true`, если метку поставил сейчас (вызывающий считает метрику один раз), `false` — если узла нет или метка уже стоит;
   - `poolTimeoutOf(error: unknown): KitPoolName | null` — имя пула из метки первого помеченного узла цепочки или `null`.
   - Изменить комментарий шапки: «… tagPoolTimeout/poolTimeoutOf — метка пула /database: срок учтён (решение E3, KT-19 п. 3, AC-4.5)».
3. Существующие функции не менять.
4. KT-20 п. 1 — общий помощник экранирования идентификаторов SQL: создать `src/internal/sql-identifier.ts` (`Skill: nestjs-code generic src/internal/sql-identifier.ts (CREATE)`; файл меньше 30 строк — отдельным файлом, потому что его используют `database`, `idempotency` и `testing`, а `idempotency/table.ts` и `testing` не должны тянуть `pg`). Шапка: «quoteIdentifier — экранирование идентификаторов PostgreSQL без pg (KT-20 п. 1; алгоритм escapeIdentifier pg: двойные кавычки по краям, внутренняя `"` удваивается)». `quoteIdentifier(name: string): string` — пустая строка или символ NUL → `TypeError`; иначе `"` + имя с удвоенными `"` + `"`. Единственный способ подстановки идентификатора в текст SQL в `prepareDatabase`, `runMigrations`, `moveJournal`, `startTestStack`, `createScratchDatabase`, `idempotencyPurgeSql`; строковой подстановки без экранирования нет. Тест — `test/unit/internal/sql-identifier.spec.ts` (`Skill: nestjs-code test unit internal sql-identifier (CREATE)`): `KT-20: quoteIdentifier("bff-app") → "\"bff-app\""`, `KT-20: внутренняя кавычка удваивается`, `KT-20: пустое имя → TypeError`, `KT-20: совпадает с pg.escapeIdentifier на наборе имён` (`pg` — devDependency, импорт значения в тесте разрешён).

### Контракты
- Метка неперечисляемая: `sanitizeError`, JSON-лог и событие GlitchTip её не выводят.
- `isPoolTimeout` по-прежнему по форме, с меткой и без неё.

### Ошибки и логи
Логов нет.

### Тесты
`test/unit/internal/pg-errors.spec.ts` (MODIFY, `Skill: nestjs-code test unit internal pg-errors (MODIFY)`), новый `describe('AC-4.5: метка пула')`:
- `AC-4.5: tagPoolTimeout ставит имя пула на узел срока в cause глубины 2, poolTimeoutOf его читает`;
- `AC-4.5: повторная пометка возвращает false, имя не меняется`;
- `AC-4.5: ошибка не срока пула — false, poolTimeoutOf null`;
- `AC-4.5: метка не видна в JSON.stringify и Object.keys`.

### Критерии приёмки
- Тесты выше и прежние случаи файла зелёные.

### Проверка
- `make test FILTER='AC-4.5'`; `make lint`.

## Риски
- Риск: `minimumReleaseAge` pnpm отклонит `drizzle-kit` 0.31.11. Mitigation: версия старше месяца (её используют сервисы); при отказе — остановиться, исключение только с обоснованием (rules/base.md).

## Чек-лист фазы
- Задачи 1–3 выполнены, `make lint analyse test` зелёные.
- Галочки — только в `index.md`.
