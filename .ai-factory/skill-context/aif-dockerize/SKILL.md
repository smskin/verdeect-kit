# Project Rules for /aif-dockerize

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-11-09
> Based on: reference project layout (Laravel modular monolith) + NestJS service layout + manual rules

## Rules

### Four Compose Files
**Source**: reference project, 2026-10-05
**Rule**: Generate exactly four compose files with these responsibilities:
- `compose.yml` — **base**: only the services that run in every contour (web: `angie` + `app` php-fpm; `supervisor` for queue/scheduler/consumers; realtime/renderer services the app owns; `redis`). No `env_file`, no published ports, healthchecks on every service, networks `frontend` + `backend`. Header comment lists every contour and its start command. `name: ${COMPOSE_PROJECT_NAME:-<project>}`.
- `compose.override.yml` — **development**, picked up automatically by `docker compose up -d`: `target: development` image, `env_file: .env`, source mounted (`.:/app`) with `storage` kept as a volume, Xdebug via `XDEBUG_MODE` (off for workers), **all infrastructure that is external in production** (PostgreSQL, broker, S3-compatible storage such as MinIO + a one-shot bucket-init service, mail catcher if needed). Service addresses are pinned in `environment:` (a stale developer `.env` must not break the contour). Published ports are shifted per project so several services can run side by side; ports are declared as `${VAR:-default}`.
- `compose.e2e.yml` — **browser-test contour**, an overlay on top of base + override, with its **own compose project name** (`name: <project>-e2e`) so containers, network and volumes (database!) are separate from development and both contours run at once. Ports = development port with a `1` appended (83 → 831, 8083 → 8831, …); internal-only services get `ports: !override []`. Only e2e differences are declared here (`APP_ENV: local`, `APP_URL`, public URLs of realtime/storage for the host browser, `E2E_TESTING_ROUTES: 'true'`, `E2E_SEED_PROFILE`, Xdebug off). Values needed for real external login (identity provider test accounts) are listed as **names without values** and come from `--env-file .env --env-file .env.e2e` at launch.
- `compose.production.yml` — **hardened**: images from the registry (`build: !reset null`), no published ports (reverse proxy such as Traefik finds services by labels on an external network), `read_only`, `cap_drop: ALL`, `no-new-privileges`, tmpfs, resource limits, json-file log rotation, `traefik.enable=false` on internal services, internal `backend` network. All variables listed by name from CI/CD variables; required ones as `${VAR:?reason}`; no secret defaults; `name: ${COMPOSE_PROJECT_NAME:?…}` without a default (multi-tenant hosts). `E2E_TESTING_ROUTES: 'false'` is hard-coded, never taken from a variable.

### Object Storage Images (MinIO)
**Source**: reference project, 2026-10-06
**Rule**: Do not use the official `minio/minio` and `minio/mc` images — pulling them now fails with 403 (closed behind authorization). Use the mirror `pgsty/minio:latest` (`command: ['server', '/data', '--console-address', ':9001']`, healthcheck `['CMD', 'mc', 'ready', 'local']`) and `pgsty/mc:latest` for the one-shot `minio-init` service (`mc alias set local http://minio:9000 …` then `mc mb --ignore-existing local/$${AWS_BUCKET}`; the bucket stays **private**, files leave only via signed URLs). The app services wait for `minio-init: condition: service_completed_successfully`, not for `minio` itself. Declare two storage addresses: `AWS_ENDPOINT=http://minio:9000` (inside the stack) and `AWS_PUBLIC_ENDPOINT=http://localhost:<published port>` (what the browser uses and what URLs are signed with — SigV4 covers the Host header), plus `AWS_USE_PATH_STYLE_ENDPOINT: 'true'`. Add a comment in the compose file explaining why the mirror is used.

### Fast Throwaway Database in the E2E Contour
**Source**: reference project, 2026-10-06
**Rule**: In `compose.e2e.yml` only, start PostgreSQL with durability off: `command: ['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off']`. The e2e database is recreated before every run, so durability is useless there, while commits waiting on the Docker Desktop / WSL virtual disk can take up to ~2 s under load and make browser scenarios flaky. Never apply these settings to `compose.override.yml` (development data) or `compose.production.yml`. Explain the reason in a comment next to the setting.

### Error Tracking Variables
**Source**: manual, 2026-10-12
**Rule**: Follow `glitchtip-integration` (GT02, GT11–GT14). `compose.production.yml` lists `SENTRY_LARAVEL_DSN` and `SENTRY_FRONTEND_DSN` and `SENTRY_ENVIRONMENT` as `${VAR:?reason}`, `SENTRY_RELEASE: ${VERSION}`, `SENTRY_TRACES_SAMPLE_RATE: '0'`, `SENTRY_SEND_DEFAULT_PII: 'false'` on every PHP service. `compose.override.yml` and `compose.e2e.yml` pin both DSNs to `''` (only production reports). The Dockerfile `assets` stage receives the GlitchTip auth token **only** through `RUN --mount=type=secret,id=sentry_auth_token` and the release/org/project as build args; never `ARG`/`ENV` for the token. Built assets contain no `*.map` files.

### Dockerfile Stages
**Source**: reference project, 2026-10-05
**Rule**: One multi-stage Dockerfile: `base` (runtime + extensions, pinned versions) → `ci` (base + tools for pipeline checks: node/npm/git) → `vendor` → `assets` (needs PHP when the frontend build calls artisan, e.g. Wayfinder) → `development` (Xdebug, entrypoint, sources mounted) → `production` (non-root user, optimized autoloader, state dirs pre-created, healthcheck) → `angie` (static from production) → extra service stages. Use BuildKit cache mounts, pin versions with `ARG`, put OCI labels with `VERSION` at the end of release stages.

### Browser Tests Stay Out of Containers and CI
**Source**: reference project, 2026-10-05
**Rule**: Do not add a Playwright container or a CI e2e service. Playwright runs on the host against the published port of the e2e contour; the contour is created, reset (`migrate:fresh --seed` with the E2E seeder) and torn down by Makefile targets. Testing routes (`/__testing__/*`) exist only when `APP_ENV` is `local`/`testing` **and** `E2E_TESTING_ROUTES=true`.

### Comments Explain Decisions
**Source**: reference project, 2026-10-05
**Rule**: Every non-obvious setting gets a short comment in the project language explaining **why** (ports, two-address services, healthcheck choices, why a variable is pinned). Keep the list of required production variables identical to the `config-prod` Makefile target and say so in a comment.

### NestJS Services
**Source**: manual, 2026-10-13
**Rule**: For a NestJS service (see `/nestjs-specialist`) keep the four-file scheme with these differences:
- **Services:** one image, several roles selected by `APP_ROLE`: `app` (HTTP API, `APP_ROLE=api`) and `worker` (`APP_ROLE=worker`: outbox relay, RabbitMQ consumers, `@Cron` jobs). No php-fpm/`angie`; the reverse proxy (Traefik) routes straight to `app`. Add `migrate` as a one-shot service (`node dist/migrate.js`, programmatic Drizzle migrator) that `app` and `worker` wait for with `condition: service_completed_successfully`.
- **Two database roles:** `DATABASE_URL` — application role without table ownership and without `BYPASSRLS` (RLS must apply); `DATABASE_MIGRATION_URL` — owner role used only by `migrate`. In `compose.override.yml` a PostgreSQL init script (`docker/postgres/init/*.sql`) creates both roles; production receives both URLs from CI/CD variables.
- **Development:** `target: development`, `pnpm dev` (watch), sources mounted with `node_modules` kept as a named volume (host and container binaries differ), PostgreSQL, RabbitMQ (`rabbitmq:<version>-management`, management port published) and MinIO (rule above) only when the service uses them.
- **E2E contour:** generate `compose.e2e.yml` only when the repository serves a browser UI. Backend-only services test integration through Testcontainers (Vitest) and do not get an e2e contour.
- **Dockerfile stages:** `base` (`node:<24.x>-alpine` pinned, `corepack enable`, pnpm version from `packageManager`) → `deps` (`pnpm fetch` + `pnpm install --frozen-lockfile --offline` with a BuildKit cache mount on the pnpm store) → `ci` (deps + git and tools for pipeline checks) → `build` (`pnpm build` → `dist/`) → `development` → `production` (`pnpm deploy --prod` or `pnpm prune --prod`, user `node`, `NODE_ENV=production`, `--enable-source-maps`, `init: true`/tini, healthcheck through `node -e` fetch of `/healthz` because alpine has no curl). OCI labels with `VERSION` at the end.
- **Error tracking:** `@sentry/nestjs`; production lists `SENTRY_DSN` (backend, not `SENTRY_LARAVEL_DSN`) and `SENTRY_ENVIRONMENT` as `${VAR:?reason}`, `SENTRY_RELEASE: ${VERSION}`, traces sample rate `0`, `sendDefaultPii` off; development and e2e pin `SENTRY_DSN: ''`.

### Library Package Without Docker
**Source**: manual, 2026-11-09 (verdeect-kit, adapted from verdeect-platform-client)
**Rule**: This repository is the published npm library `@verdeect/kit`, not a service: it has no Dockerfile, no compose files, no e2e contour and no runtime environment of its own. All rules above about compose files, Dockerfile stages, MinIO, databases, e2e and GlitchTip variables do not apply. Integration and timing tests start PostgreSQL, RabbitMQ, Redis, mailpit and MinIO with Testcontainers from test code (`startTestStack`, `TEST_IMAGES`); they need a Docker daemon, not Docker files in this repository. Compose files and Dockerfiles under `test/fixtures/**` are test data for `assertRepoConventions` (AC-1.8), not infrastructure of this repository. If invoked, report "Docker is not applicable to a library package" and change nothing.
