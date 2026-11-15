# План реализации: выпуск `1.0.0-rc.9` — порядок шага 2 `KitLifecycle` (r25, PRD v1.30)

Mode: full
Branch: fix/rc9-stop-accepting-order
Created: 2026-11-14

## Original Request
Реализуй выпуск 1.0.0-rc.9 по пакету требований requirements/0000-kit/ (ревизия r25, PRD v1.30).

Скоуп: изменения v1.30 относительно v1.29 — §3.2 KitLifecycle шаг 2 в два этапа: (2а) участники шага 2, зарегистрированные сервисом (register(p, {step: 2})), вызываются одновременно и ожидаются; (2б) затем участник http пакета вызывает server.close(); порядок не зависит от порядка регистрации; оба этапа в общем сроке SHUTDOWN_TIMEOUT_MS, участник 2а сверх срока — общий сторож; AC-2.10 (T, поддельные участники: участник сервиса, зарегистрированный после http, вызывается и завершается до server.close()), AC-3.9 (T: приложение из bootstrapService, участник шага 2 закрывает WebSocket кодом 1001 — клиент получает 1001, не 1005/1006, раньше прекращения приёма); README («хук onStopAccepting» — участник шага 2; новые соединения между 2а и 2б — /health 503 с шага 1); CHANGELOG [1.0.0-rc.9] с «Как перейти» (обход server.close в сервисе можно убрать), version 1.0.0-rc.9. Источник истины — requirements/0000-kit/prd.md. На каждый пункт — тест с ID AC, где возможно — сначала падающий на старом коде. Тесты без реальных пауз (кроме проверяемых сроков уровня T), сроки не поднимать. Уже реализованный код не переделывать без требования. Соседние репозитории — только чтение. Перед make test-full — free -h и uptime: available ≥ 3 ГБ, load < 5. Открытые вопросы не додумывай — спроси меня.

## Settings
- Testing: yes. Тесты — по уровням AC (`prd.md` §5): AC-2.10 и AC-3.9 — уровень T (`test/timing/<подпуть>`). Тест пишется первым и запускается на старом коде; падение фиксируется в отчёте реализации. Для AC-2.10 падение — ошибка импорта или компиляции: внутренней функции регистрации участника `http` в rc.8 нет. Для AC-3.9 — по поведению: код 1005 вместо 1001. Реальные паузы допустимы только для проверяемого срока (сторож, `SHUTDOWN_TIMEOUT_MS`). Порядок этапов проверяется без `sleep`, на промисах. Сроки в spec-файлах не поднимать.
- Logging: verbose — только `pino`/`nestjs-pino`, без `console.*` (NFR-8, AC-9.4). Конкретные строки — в задачах.
- Docs: no — обязательного чекпоинта `/aif-docs` нет (`WARN [docs]`). README, CHANGELOG и версию обновляют задачи 4–5 («Library Package Scope» (7), AC-9.3).
- Настройки — как в rc.8, ответ пользователя от 14.11.2026.

## Roadmap Linkage
Milestone: "none"
Rationale: вехи E1–E8 закрыты. План — выпуск `1.0.0-rc.N` по находке перехода BFF-77 (G14); отдельной вехи в `.ai-factory/ROADMAP.md` нет.

## Requirements Reconciliation
Authority: `requirements/0000-kit/prd.md` v1.30 (r25) > ответы пользователя на вопросы плана (14.11.2026) > текст запроса > `ARCHITECTURE.md` / `DESCRIPTION.md`. Скоуп — изменения v1.30 относительно v1.29: §3.2, строка `KitLifecycle`; AC-2.10; AC-3.9. Код rc.8 — существующий: расширять, не переписывать.

Причина находки (BFF-77, чтение `verdeect-bff`): `@fastify/http-proxy` 11.6.5 (`index.js:511–522`) подменяет `server.close` и закрывает WS-клиентов без кода — клиент получает 1005. В rc.8 участник `http` регистрируется первым (`src/http/create-http-app.ts:189`). Его `stop` синхронно доходит до `server.close()` раньше, чем вызывается участник сервиса, поэтому сервису пришлось обернуть `server.close` в `onReady` (`apps/bff/src/modules/proxy/plugins/api-proxy.plugin.ts:154–169`).

| Решение | Источник | Проверка |
|---|---|---|
| Шаг 2 в два этапа. 2а — все участники шага 2, кроме участника `http` пакета, вызываются одновременно; пакет ждёт, пока завершатся все. 2б — затем участник `http` (`server.close()`). Порядок не зависит от порядка `register` | §3.2 стр. 87 | 1, 3 |
| Участник `http` отличается от участников сервиса внутренней меткой, а не именем: сервис тоже может назвать участника `'http'`. Метка — внутренняя функция `registerHttpServer(lifecycle, participant)` в `src/observability/lifecycle.ts` (`@internal`, как `shutdownRemainingMs`), из `src/observability/index.ts` не экспортируется. Публичная поверхность `register(p, {step})` не меняется (P0: новых опций нет) | §3.2; P0; решение плана | 1, 3 |
| Оба этапа — в общем сроке `SHUTDOWN_TIMEOUT_MS`, отсчёт от сигнала. Участник 2а, не уложившийся в срок, ловит общий сторож: `SHUTDOWN_TIMEOUT`, `step: 2`, `pending` — имена участников 2а, `exit(1)`. Участник `http` тогда не вызывается | §3.2 стр. 87 | 1 |
| Ошибка участника 2а — как у любого участника: `error`-лог, GlitchTip в режиме сигнала, 2б и шаги 3–5 выполняются (поведение `stopParticipant` не меняется) | §3.2 («ошибка логируется, остальные шаги выполняются», TSDoc `KitShutdownParticipant.stop`) | существующие тесты `test/unit/observability/kit-lifecycle.spec.ts` |
| Без `http` (режим `cli` у `KitCoreModule`, `createTestApp` без `listen`) — только 2а. 2б пуст: `closeServer` при `!server.listening` выходит сразу (`create-http-app.ts:170`) | §3.2 | существующие тесты |
| Между 2а и 2б новое соединение возможно; `/health` отдаёт 503 с шага 1, балансировщик реплику не ведёт. В коде — ничего, только README | §3.2 стр. 87 | 4 |
| AC-3.9, сервер WS — вручную в фикстуре (рукопожатие и кадр закрытия, без новых зависимостей). Фикстура повторяет поведение `@fastify/http-proxy`: подменяет `server.close` и шлёт клиентам пустой кадр закрытия (1005). Клиент — глобальный `WebSocket` Node (`engines` ≥ 22.12) | ответ пользователя 14.11.2026 | 2 |
| AC-3.9, «раньше, чем прекращается приём»: проверяется по строке stdout фикстуры, которую участник шага 2 пишет в момент отправки 1001, — `listening: true`. Кроме того: код у клиента 1001, отказ нового соединения после этого (существующий опрос `poll`), выход 0 в срок | ответ пользователя 14.11.2026 | 2 |
| README — «хук `onStopAccepting`» = участник шага 2 сервиса; WS закрывается своим кодом (1001), SSE — концом ответа; обход `server.close` в сервисе можно убрать | §3.2 стр. 87; запрос | 4, 5 |
| Версия `1.0.0-rc.9`, CHANGELOG `[1.0.0-rc.9]` с «Как перейти» | G14, NFR-5, запрос | 5 |

Комбинации шага 2:

| Участники шага 2 | Порядок `register` | Итог |
|---|---|---|
| `http` + сервис `ws` | `http`, затем `ws` | `ws:start`, `ws:end`, `http:start`, `http:end` |
| `http` + сервис `ws`, `sse` | любой | `ws` и `sse` стартуют оба до завершения любого; `http` — после обоих |
| только сервис (`cli`) | — | 2а, 2б пуст |
| только `http` | — | 2а пуст, 2б |
| `ws` висит, сигнал | — | сторож: `SHUTDOWN_TIMEOUT`, `step: 2`, `stage: '2a'`, `pending: ['ws']`, `http` не вызван, `exit(1)` |
| `ws` бросает | — | `error`-лог, `http` вызывается, шаги 3–5 выполняются |

## Commit Plan
- **Commit 1** (после 1–3): `fix(observability): шаг 2 KitLifecycle в два этапа — участники сервиса до server.close() (AC-2.10, AC-3.9)`
- **Commit 2** (после 4–5): `docs: README, CHANGELOG 1.0.0-rc.9, version 1.0.0-rc.9`

## Tasks

### Фаза 1: тесты на старом коде

- [x] **Task 1: тесты AC-2.10 — этапы 2а/2б на поддельных участниках** — §3.2, AC-2.10
  - **Skill:** nestjs-code test timing observability ac-2-10-shutdown-deadline (MODIFY) → `test/timing/observability/ac-2-10-shutdown-deadline.spec.ts`
  - Импорт `registerHttpServer` из `../../../src/observability/lifecycle.js` (внутренний, как `shutdownRemainingMs` в `test/unit/observability/kit-lifecycle.spec.ts:13`).
  - Существующие три теста не менять. Первый тест регистрирует `http` обычным `register`, поэтому остаётся участником 2а и его ожидания верны.
  - Новые тесты в `describe('UC-8: срок остановки')`:
    - `AC-2.10: участник сервиса шага 2, зарегистрированный после участника http, вызывается и завершается до server.close()`. Сначала `registerHttpServer(lifecycle, {name: 'http', stop})`, затем `register(ws, {step: 2})` и `register(sse, {step: 2})`. `ws` и `sse` завершаются по промисам: отпускаются в тесте после того, как оба записали `:start`, без `sleep`. `SHUTDOWN_DRAIN_MS: 0`, `close()`. Журнал: `ws:start` и `sse:start` раньше `ws:end` и `sse:end`; `http:start` — после `ws:end` и `sse:end`; `exit` не вызван;
    - `AC-2.10: участник 2а сверх SHUTDOWN_TIMEOUT_MS — общий сторож, участник http не вызывается`. `SHUTDOWN_TIMEOUT_MS: 300`, `SHUTDOWN_DRAIN_MS: 0`. `ws` висит (`releaseHanging`), `http` через `registerHttpServer` пишет в журнал. `listen(['SIGTERM'])`, `process.emit('SIGTERM')`. Ожидается: `exit(1)` не раньше 300 мс, `error`-лог `{code: 'SHUTDOWN_TIMEOUT', step: 2, stage: '2a', pending: ['ws']}` (`'2a'` — латиница), событие GlitchTip `SHUTDOWN_TIMEOUT`, `http` не вызван. Это проверяемый срок уровня T — реальное ожидание допустимо.
  - Шапка файла — дополнить: «v1.30 (BFF-77): шаг 2 в два этапа».
  - На старом коде падает: `registerHttpServer` нет в `lifecycle.ts` (ошибка импорта); зафиксировать в отчёте.
  - Запуск одного файла: сначала `uptime` (load < 5, иначе замеры недостоверны — `Makefile:110–112`), затем `pnpm test:timing test/timing/observability/ac-2-10-shutdown-deadline.spec.ts`.
  - Логи: нет.

- [x] **Task 2: тест AC-3.9 — WebSocket закрывается кодом 1001 до прекращения приёма** — §3.2, AC-3.9
  - **Skill:** nestjs-code test timing http ac-3-9-shutdown (MODIFY) → `test/timing/http/ac-3-9-shutdown.spec.ts`; фикстура `test/fixtures/http/shutdown-app.mjs` (MODIFY, `.mjs` без skill — тот же стиль, что у режима `sse`)
  - Фикстура, новый режим `ws` (аргумент `mode`, как `plain` и `sse`):
    - `bootstrapService({module, service, env, http: {configureFastify}})` — поле `http?: KitHttpOptions` (`src/http/bootstrap-service.ts:44`, `configureFastify` — `src/http/create-http-app.ts:46`, вызывается до регистрации маршрутов и до `listen`). Для режимов `plain` и `sse` `http` не передаётся. В `configureFastify(fastify)` — только для `ws`:
      1. сохранить `fastify.server` в переменную модуля;
      2. `server.on('upgrade', (req, socket) => …)` для `/ws`: `Sec-WebSocket-Accept` = base64(sha1(`sec-websocket-key` + `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)), ответ `101 Switching Protocols`, сокет — в `Set`. У каждого сокета — `socket.on('error', () => undefined)` (сброс клиентом не роняет процесс) и `socket.once('close', () => set.delete(socket))`. Прочие пути — `socket.destroy()`;
      3. подмена `server.close` по образцу `@fastify/http-proxy` 11.6.5 (`index.js:511–522`, комментарий со ссылкой): каждому сокету из `Set`, который не `destroyed` и не `writableEnded`, — пустой кадр закрытия `Buffer.from([0x88, 0x00])` (клиент получает 1005), затем `socket.end()`; потом исходный `close.call(this, cb)`. На новом коде `Set` к этому моменту пуст: участник уже закрыл сокеты, и запись в закрытый сокет («write after end») исключена.
    - `SseService` (или новый класс рядом) в режиме `ws` регистрирует участника шага 2 `{name: 'ws', stop}`. `stop` для каждого сокета, который не `destroyed` и не `writableEnded`: пишет в stdout одну JSON-строку `{"msg":"ws: 1001 отправлен","listening":<server.listening>}` (через `process.stdout.write`, как строки pino), отправляет кадр `Buffer.from([0x88, 0x02, 0x03, 0xe9])` и ждёт `close` сокета. Ответный кадр закрытия клиента (`data`) → `socket.end()`.
    - Шапка фикстуры — режим `ws`, ссылка на BFF-77 и §3.2 v1.30.
  - Тест — новый `it` в `describe('UC-8: остановка HTTP под нагрузкой')`, по образцу SSE-теста:
    `AC-3.9: участник шага 2 закрывает WebSocket кодом 1001 — клиент получает 1001 (не 1005/1006) раньше, чем прекращается приём соединений`.
    Шаги: `start('ws')`, `new WebSocket(\`ws://127.0.0.1:${port}/ws\`)`, дождаться `open`. Промис `close` → `event.code`. Затем `kill('SIGTERM')` и `poll(app, app.exited)`. Проверки:
    - `code === 1001`;
    - в `output()` строка `ws: 1001 отправлен` с `listening: true`;
    - `okRefused` не `null` — приём прекратился;
    - `exit.code === 0`, `exit.at - signalledAt < TIMEOUT_MS`;
    - вывод без `SHUTDOWN_TIMEOUT`.
  - Существующие тесты файла не менять.
  - На старом коде падает: `code === 1005` (подмена `server.close` срабатывает раньше участника), `listening: false` или строки нет; зафиксировать в отчёте.
  - Запуск одного файла: сначала `uptime` (load < 5), затем `pnpm test:timing test/timing/http/ac-3-9-shutdown.spec.ts`.
  - Логи: нет (stdout фикстуры — проверяемая строка, не лог пакета).

### Фаза 2: код

- [x] **Task 3: шаг 2 в два этапа в `KitLifecycle`, участник `http` — через `registerHttpServer`** — §3.2, AC-2.10, AC-3.9 (depends on 1, 2)
  - **Skill:** nestjs-code generic src/observability/lifecycle.ts (MODIFY); nestjs-code generic src/http/create-http-app.ts (MODIFY)
  - `lifecycle.ts`:
    - `const httpServers = new WeakSet<KitShutdownParticipant>()`. `registerHttpServer(lifecycle, participant)` с TSDoc `@internal` («участник `http` пакета — этап 2б (§3.2)»): `lifecycle.register(participant, {step: 2})` и `httpServers.add(participant)`. В `src/observability/index.ts` не добавлять;
    - `runStep`: для шага 2 — два вызова общего метода этапа: сначала `list.filter((p) => !httpServers.has(p))` со `stage: '2a'`, затем `list.filter((p) => httpServers.has(p))` со `stage: '2b'`. Значения `stage` — латиница (`'2a'`/`'2b'`, машинное поле лога); «2а/2б» кириллицей — только в прозе README и CHANGELOG. Остальные шаги — как сейчас (один этап без `stage`). Участники этапа — `Promise.allSettled`, как сейчас. `pending` пополняется именами участников этапа в начале этапа, а не всего шага: `pending` сторожа на 2a не содержит `http`;
    - поле `currentStage: '2a' | '2b' | null`. Выставляется в начале каждого этапа шага 2 и сбрасывается в `null` в начале шагов 3–5. В `error`-логе `SHUTDOWN_TIMEOUT` поле `stage` есть только при `currentStage !== null` (`...(this.currentStage === null ? {} : {stage: this.currentStage})`);
    - TSDoc `KitShutdownStep` и `register`: шаг 2 сервиса — «хук `onStopAccepting`», закрытие долгих соединений (WS — своим кодом, например 1001; SSE — концом ответа); выполняется до `server.close()` участника `http` при любом порядке регистрации. Шапка файла — ссылка на v1.30, BFF-77.
  - `create-http-app.ts` (`installLifecycle`, стр. 189–201): `lifecycle.register(…, {step: 2})` участника `http` → `registerHttpServer(lifecycle, {...})`. `debug`-строка «http: участник шага 2 зарегистрирован» → `{participant: 'http', stage: '2b'}`. Шапка (стр. 4) — «шаг 2б `http`».
  - Логи (`debug`): «остановка: шаг начат» и «остановка: шаг завершён» — с полем `stage` у шага 2 (`{step: 2, stage: '2a', participants: [...]}`). Значений окружения и тел нет.
  - Готово, когда: задачи 1 и 2 зелёные (`pnpm test:timing` по двум файлам). Зелёные также `pnpm typecheck`, `test/unit/observability`, `test/unit/http` и `test/timing/observability/ac-2-13-shutdown-drain.spec.ts`.

### Фаза 3: документация и выпуск

- [x] **Task 4: README** — §3.2, AC-9.3 (depends on 3)
  - **Skill:** none (Markdown)
  - `README.md`:
    1. таблица шагов (стр. 168), строка шага 2. 2а — участники сервиса (`register(p, {step: 2})`, «хук `onStopAccepting`»): закрывают SSE (концом ответа), WebSocket (своим кодом, например 1001) и другие долгие соединения; вызываются одновременно, пакет ждёт их. 2б — затем участник `http` пакета: `server.close()`, начатые запросы дорабатывают. Порядок не зависит от порядка регистрации. Оба этапа — в `SHUTDOWN_TIMEOUT_MS`; участник 2а сверх срока — общий сторож;
    2. абзац «**Остановка.**» (стр. 299): «Шаг 2 — участник `http` … и участники сервиса параллельно» → «Шаг 2 — сначала участники сервиса (2а), затем участник `http` (2б: `server.close()` Fastify, keep-alive закрываются)». Добавить: между 2а и 2б новое соединение теоретически возможно, но `/health` отдаёт 503 с шага 1 и балансировщик реплику не ведёт. Подменять `server.close` в сервисе не нужно — библиотека, которая закрывает клиентов в `server.close()` (например, `@fastify/http-proxy` закрывает WS без кода, 1005), сработает уже после участника сервиса;
    3. абзац о SSE (стр. 301): «Поток SSE и WebSocket (это „`onStopAccepting`“ §3.2) закрывает участник шага 2 сервиса: SSE — `reply.raw.end()` или `destroy()`, WebSocket — `socket.close(1001, …)`». Пример кода не менять.
  - Логи: нет.

- [x] **Task 5: CHANGELOG и версия** — G14, NFR-5 (depends on 4)
  - **Skill:** none (Markdown, JSON)
  - `CHANGELOG.md`: `## [1.0.0-rc.9] - 2026-11-14` сразу под `## [Unreleased]`, по образцу rc.8:
    - строка-источник: «Находка BFF-77 (PRD v1.30, r25).»;
    - `### Changed`: «**Шаг 2 `KitLifecycle` в два этапа:** участники шага 2 сервиса (закрытие SSE, WebSocket и других долгих соединений) вызываются одновременно и завершаются до `server.close()` участника `http` пакета, при любом порядке регистрации (раньше — параллельно с `http`, и `server.close()` вызывался первым). Оба этапа — в `SHUTDOWN_TIMEOUT_MS`; в `error`-логе `SHUTDOWN_TIMEOUT` шага 2 — поле `stage` (`'2a'` | `'2b'`)»;
    - `### Как перейти`: обход `server.close` в сервисе (подмена в `onReady`, чтобы закрыть потоки раньше `@fastify/http-proxy`) можно убрать — достаточно участника шага 2. Участники шага 2, которые рассчитывали работать одновременно с `server.close()`, теперь завершаются до него.
  - `package.json`: `"version": "1.0.0-rc.9"`.
  - Логи: нет.

### Фаза 4: проверка

- [x] **Task 6: полная проверка** (depends on 3, 5)
  - Команды по одной (правило пользователя: без `&&`):
    1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
    2. `free -h` и `uptime`: available ≥ 3 ГБ, load < 5. Иначе — стоп и сообщить пользователю;
    3. `make test-full` (lint, analyse, test, test-integration, test-timing, pack-check).
  - Падения не маскировать подъёмом сроков. Правки существующих тестов — только по изменению поведения v1.30, каждая — в отчёт (файл, было → стало, основание).
  - Соседние репозитории не трогать.

## Traceability

| UC/AC | Задачи | Тест |
|---|---|---|
| UC-8, AC-2.10 (2а до 2б, порядок не зависит от регистрации) | 1, 3 | `test/timing/observability/ac-2-10-shutdown-deadline.spec.ts` — `AC-2.10: участник сервиса шага 2, зарегистрированный после участника http, вызывается и завершается до server.close()` |
| UC-8, AC-2.10 (участник 2а сверх срока — сторож) | 1, 3 | `test/timing/observability/ac-2-10-shutdown-deadline.spec.ts` — `AC-2.10: участник 2а сверх SHUTDOWN_TIMEOUT_MS — общий сторож, участник http не вызывается` |
| UC-8, AC-3.9 (WS 1001 раньше прекращения приёма) | 2, 3 | `test/timing/http/ac-3-9-shutdown.spec.ts` — `AC-3.9: участник шага 2 закрывает WebSocket кодом 1001 …` |
| AC-9.3 (README, CHANGELOG) | 4, 5 | `make test-full` (уровень R) |
