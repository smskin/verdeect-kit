# Project Rules for /aif-build-automation

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-11-09
> Based on: reference project Makefile (Laravel + Docker) + NestJS service layout + manual rules

## Rules

### Makefile Is the Single Entry Point
**Source**: reference project, 2026-10-05
**Rule**: Generate a GNU Makefile with `SHELL := bash`, `.ONESHELL`, `.SHELLFLAGS := -eu -o pipefail -c`, `.DELETE_ON_ERROR`, `--warn-undefined-variables`, `--no-builtin-rules`, a self-documenting `help` default goal (`## description`, `##@ Section`). Multi-line recipes that share variables are written as one command joined with `; \` (macOS ships make 3.81, where `.ONESHELL` is ignored). Tool variables overridable: `PHP ?= php`, `COMPOSER ?= composer`, `NPM ?= npm`, `COMPOSE ?= docker compose`.

### Tests Run on the Host
**Source**: reference project, 2026-10-05
**Rule**: The header comment MUST explain: code checks (`test`, `lint`, `analyse`, frontend checks) run **on the host**, never in the `app` container — container env vars override `phpunit.xml` and `RefreshDatabase` would wipe the development database. Only targets that need the running stack use `$(COMPOSE) exec`.

### Required Targets
**Source**: reference project, 2026-10-05
**Rule**: Provide at least these sections and targets (names fixed so other skills can rely on them):
- **Setup:** `install` (composer + npm ci), `setup` (install, build, up, seed).
- **Development:** `up`, `down`, `restart`, `ps`, `logs`, `shell`, `watch`, `build`.
- **Application:** `migrate`, `seed` (asks for confirmation, `migrate:fresh --seed`), `routes`, `tinker`, `queue-restart`.
- **Checks:** `test` (`vendor/bin/pest`, or `php artisan test` in PHPUnit projects), `test-filter FILTER=…`, `test-db` (creates a separate test database in the dev PostgreSQL), `test-integration` (`--group=pgsql --fail-on-skipped` against that database), `lint` (`pint --test`), `fmt`, `analyse` (phpstan), `front` (`npm run check` + `types:check`), `ci` (everything, including browser tests, in pipeline order).
- **Browser tests:** `e2e-up` (separate compose project `<project>-e2e` with `--env-file .env --env-file .env.e2e -f compose.yml -f compose.override.yml -f compose.e2e.yml`, waits for `/up`, migrates), `e2e-reset` (`migrate:fresh --seed --seeder=E2eSeeder`), `test-browser SPEC=…` (depends on `build` and `e2e-reset`, runs `npm run test:browser` with `APP_URL` of the e2e port), `e2e-run` (up → reset → test → `e2e-down`, tearing down even when tests fail), `e2e-logs`, `e2e-down`, `e2e-clean` (`down -v`), `e2e-shell`.
- **Images:** `image` (all release targets with the same tags as `compose.yml`), `config-prod` (renders `compose.production.yml` with dummy values and `--env-file /dev/null`; its variable list mirrors the `${VAR:?}` list).
- **Cleanup:** `clean` (build output, `playwright-report`, `test-results`), `clean-all` (asks for confirmation, `down -v`).

### Destructive Targets Ask First
**Source**: reference project, 2026-10-05
**Rule**: Any target that drops the development database or volumes (`seed`, `clean-all`) asks for `y/N` confirmation; e2e targets never touch the development project.

### NestJS Targets
**Source**: manual, 2026-10-13
**Rule**: For a NestJS service keep the same section and target **names** (other skills rely on them) with Node commands; tool variables `PNPM ?= pnpm`, `NODE ?= node`, `COMPOSE ?= docker compose`:
- **Setup:** `install` (`pnpm install --frozen-lockfile`), `setup` (install, up, migrate).
- **Application:** `migrate` (`$(COMPOSE) run --rm migrate`), `db-generate NAME=…` (`pnpm drizzle-kit generate --name $(NAME)` on the host, then reminds to review the SQL), `db-custom NAME=…` (`drizzle-kit generate --custom`), `seed` (asks for confirmation; recreates development data), `shell`, `logs`. No `drizzle-kit push` target.
- **Checks (host):** `test` (Vitest unit: `pnpm vitest run --config vitest.config.ts`), `test-filter FILTER=…`, `test-integration` (Vitest integration + http specs: `pnpm vitest run --config vitest.integration.config.ts`; PostgreSQL/RabbitMQ come from Testcontainers, or from `TEST_DATABASE_URL` / `TEST_RABBITMQ_URL` when set — never from the development `.env`), `lint` (`eslint .` + `prettier --check .`), `fmt` (`prettier --write .` + `eslint --fix`), `analyse` (`tsc --noEmit`), `front` only when the repository has a frontend, `ci` (all of the above in pipeline order).
- **Images / Cleanup:** `image`, `config-prod`, `clean` (`dist`, `coverage`, `report.xml`), `clean-all` (asks for confirmation, `down -v`). E2E targets only when the service has a browser UI (see `/aif-dockerize` NestJS rule).
- The header comment states that tests run on the host and integration tests start their own containers, so the development database is never touched; no `test-db` target is needed.

### Test Levels
**Source**: manual, 2026-10-30 (verdeect-identity, ID-13–ID-16: integration suite 103 → 18 min)
**Rule**: The Makefile exposes test levels with fixed names (other skills rely on them):
- `test` — unit specs only, no containers; never boots the whole application module.
- `test-module M="<dir> …"` — integration + http specs of the listed module directories only (NestJS: `test/integration/<M>`, `test/http/<M>`; Laravel: the module's test directory; Python: the pytest path).
- `test-integration` — all integration + http specs, WITHOUT the timing-sensitive and load suites.
- `test-timing` — timing-sensitive specs (constant-time responses, rate windows) in their own config; refuses to run while the e2e contour is up; documented as "quiet machine only".
- `test-load` — load / p95 specs in their own config, never part of `ci` by default.
- `test-full` — `test` + `test-integration` + `test-timing`: the pre-merge gate.
`TEST_TIMEOUT_SCALE` (default 1, set manually, never derived from the load automatically) multiplies the config-level test and hook timeouts of the test runner and of Playwright; CI always uses 1. `docs/development.md` has a table "level → when to run → approximate time", and the root agent rules file (`CLAUDE.md` or `AGENTS.md`) states: while working — `test` and `test-module` for the touched modules; before `/aif-commit` and merge — `test-full`; Playwright — the whole `test-browser` before merge when pages or interactions changed, otherwise only the affected specs. Regeneration or audit of the Makefile must not drop these targets.

### Browser Tests in a Container
**Source**: manual, 2026-11-01 (verdeect-identity, ID-23–ID-24: full Playwright run never green on the host because of net::ERR_NETWORK_CHANGED; in a container 199/199)
**Rule**: `make test-browser [SPEC=…]` runs Playwright inside the pinned image `mcr.microsoft.com/playwright:v<@playwright/test version>-noble`, kept in one Makefile variable `PLAYWRIGHT_IMAGE` shared with `test-visual`. Reason: on a developer machine other sessions and Testcontainers create and remove Docker networks all the time; Chromium on the host treats every new interface as a network change and aborts navigations with `net::ERR_NETWORK_CHANGED`. Inside a container the browser sees only its own interface.
- Network: the container joins the network of the e2e contour (`<project>-e2e-*`), never `--network host`. The browser keeps using the same origins as on the host (e.g. `https://localhost:<e2e port>`, mail catcher on its host port) — the test setup forwards these host ports inside the container to the contour services (`<service>:<port>`) and closes the forwarding in global teardown whatever the outcome — so issuer, cookies and redirect URIs stay unchanged.
- Dependencies: the repository is mounted; reuse host `node_modules` when the `@playwright/test` version equals the image version (no second install over the mount). Reports (`playwright-report/`, `test-results/`, junit) are written into the mounted repository as the host user (`--user $(id -u):$(id -g)`). `TEST_TIMEOUT_SCALE`, `CI` and video flags are passed through.
- `test-browser` keeps its contract: build + `e2e-reset` once, then the run. A separate target `test-browser-host [SPEC=…]` runs on the host against the already running contour (no build, no reset) — only for debugging with `--ui`/headed; it is never a gate.
- Applies to every stack with browser tests (Laravel + Vue, NestJS + React, standalone SPA). Regeneration or audit of the Makefile must not move `test-browser` back to the host.

### Test Images Pinned and Identical Everywhere
**Source**: manual, 2026-11-02 (verdeect-identity ID-31, ID-33; verdeect-bff BFF-33–BFF-36)
**Rule**: (1) Images whose output the tests compare byte for byte or render (Playwright for `test-browser` and `test-visual`) are pinned by manifest digest: `PLAYWRIGHT_IMAGE := mcr.microsoft.com/playwright:v<version>-noble@sha256:<digest>`, one variable used by every target and by CI. The digest is the registry manifest (OCI index) digest from `docker buildx imagetools inspect <image:tag>` or `docker inspect --format '{{json .RepoDigests}}'` — never the local image ID (`docker images`, `.Id`); check with `docker pull` of the full reference on a clean daemon. Reason: a tag can be republished with different content (on 2026-11-01 `v1.64.1-noble` moved from Node 24 to Node 26 without corepack), and local and CI runs silently diverge. A new digest is a deliberate change, together with a full `test-visual` run. (2) Service images used by tests — PostgreSQL, Redis, RabbitMQ, mail catcher — have the same tag in the test setup (Testcontainers / global setup constants), in CI `services` (via `*_IMAGE` variables) and in `compose.override.yml`. A unit test (no containers, part of `make test`) compares them with the CI file and the compose file, naming the file and both tags on mismatch. It takes the test-setup tags either by importing exported constants or — when importing the setup module would load heavy dependencies into the unit level (Testcontainers, its undici, container clients) — by reading the setup source file as text and extracting the tags; coverage is the same (verdeect-bff `image-tags.spec.ts`, 68a94c3). Reason: `postgres:16` (Debian, locale collation) locally against `postgres:16-alpine` (byte order) in CI made text-ordered assertions pass locally and fail in CI. (3) Do not rely on `corepack` inside third-party images (absent since Node 25): install the package manager with `npm install -g <pm>@<version from packageManager>`.

### Visual Regression Target
**Source**: manual, 2026-10-21
**Rule**: In projects with UI and exported mockups the Makefile keeps the target `test-visual` (Playwright inside the pinned image `mcr.microsoft.com/playwright:v<@playwright/test version>-noble`, optional `SPEC=`), and `ci` includes it. Regeneration or audit of the Makefile must not drop it.

### Library Package Targets
**Source**: manual, 2026-11-09 (verdeect-kit, adapted from verdeect-platform-client; requirements G13, AC-1.1, AC-1.10, AC-9.1, NFR-7)
**Rule**: This repository is the published npm library `@verdeect/kit` without its own Docker files. This rule overrides "Required Targets" and "NestJS Targets" and adapts "Test Levels" to the library. The Makefile has exactly these targets, all running on the host with `PNPM ?= pnpm`: `install` (`$(PNPM) install --frozen-lockfile`), `lint` (eslint + prettier check; includes the lint-config fixture test of AC-9.4), `analyse` (`tsc --noEmit` and static dependency policies, e.g. peer/dependency placement of NFR-3), `build` (`tsc -p tsconfig.build.json` into `dist/`, including the `verdeect-kit` CLI binary), `pack-check` (`publint --strict`, `attw --pack --profile esm-only`, tarball content test, and the consumer project `test/consumer` installing the packed tarball — levels R and C of the requirements), `test-package`, the test levels — `test` (level U: `test/unit`, no containers; optional `FILTER=`), `test-module M="<subpath> …"` (U + I of the listed subpaths: `test/unit/<m>`, `test/integration/<m>`; without `M` — U only), `test-integration` (level I: `test/integration`, Testcontainers started once per run in `globalSetup` through the package's own `startTestStack` with `TEST_IMAGES`; exports `KIT_OUTBOX_COVERAGE=1` from the messaging milestone on), `test-timing` (level T: `test/timing` in its own config `vitest.timing.config.ts`, real waits only where a real driver or shutdown is tested; prints load average and core count, WARN when load > cores; quiet machine only), `test-load` (no load suite: prints a message and exits 0, no fake tests), `test-full` (`lint analyse test test-integration test-timing pack-check` — pre-merge and pre-release gate) — then `ci` (`lint analyse test test-integration build pack-check`; level I is part of `ci` because it needs only public images, unlike `verdeect-platform-client`) and `clean` (`dist`, `coverage`, `*.tgz`, test run directories). `TEST_TIMEOUT_SCALE ?= 1` is exported. No `up`, `down`, `migrate`, `seed`, `shell`, `e2e-*`, `front`, `test-browser`, `test-visual`, `image`, `config-prod` targets. There is no publish target: publishing happens only in CI.
