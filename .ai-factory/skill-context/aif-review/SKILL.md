# Project Rules for /aif-review

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-11-09
> Based on: manual rules

## Rules

### Review Against Specialist Constraints
**Source**: manual, 2026-10-05
**Rule**: In addition to the generic checklist, review each changed file against the MUST DO / MUST NOT DO constraints and dependency rules of the relevant specialist: `/laravel-specialist` (module boundaries — only `I{Service}Service` and Events across modules; invokable single-method HTTP controllers with OpenAPI; Spatie Data requests/responses; `Type|null` instead of `?Type`; `declare(strict_types=1)`; no `$guarded`; no array/json casts), `/laravel-vue-specialist` (no direct API calls from views/components; `storeToRefs`; `shallowRef` for chart instances; no `any`, no TS enums; components ≤300 lines), `/python-specialist` (layer direction CLI → Pipeline → Services → Models/DTO; no sibling feeder imports; services stateless), `/nestjs-specialist` (module boundaries — only `I*Service` contracts and events across modules; one route per HTTP controller with `@Permission()` or justified `@Public()`; transactions, audit and outbox only in use-cases; actions never open transactions; tenant and user only from `RequestContext`; every tenant table with RLS + `FORCE ROW LEVEL SECURITY`; consumers idempotent through the inbox; no publishing to RabbitMQ outside the outbox; zod validation with `.strict()`; no `any`, non-null assertions, CommonJS or `drizzle-kit push`; display text only via i18n keys). Violations of these are at least `major` severity.

### Untracked Files
**Source**: manual, 2026-10-05
**Rule**: When reviewing without arguments and nothing is staged, also list untracked files (`git status --porcelain`) and include new source files in the review — a new feature consists mostly of untracked files that `git diff` does not show.

### Error Reporting
**Source**: manual, 2026-10-12
**Rule**: Flag as `major`: a `catch` that swallows a `Throwable` / `Error` without `report()` / `capture_exception` / `Sentry.captureException`; a DSN or GlitchTip token in code, config, compose defaults or `.env.example`; `send_default_pii` enabled, user context with e-mail/name/IP, or request bodies/tokens reaching events; tracing/replay/profiling turned on; a frontend DSN baked into the bundle (`VITE_*`). Rules: local skill `glitchtip-integration` (GT01–GT16).

### Test Speed Regressions
**Source**: manual, 2026-10-30 (verdeect-identity)
**Rule**: Treat as blocking: timeouts raised inside spec files instead of fixing the cause; a file moved to the `isolated` project without a stated reason, or a file that writes env / mocks modules / patches prototypes left in `shared`; timing or load specs added to `test-integration`; a unit spec that imports the whole application module; production compose or `.env.example` setting the test hashing cost; real waits (`sleep`, polling) where elapsed time is not the subject of the test. Non-blocking (minor): new integration files without cleanup in `afterAll`.

### Browser Tests in a Container
**Source**: manual, 2026-11-01 (verdeect-identity, ID-24)
**Rule**: Treat as blocking: `test-browser` moved back to the host or switched to `--network host`; a separate Playwright image version for e2e and visual runs; host-port forwarding inside the test container without teardown on failure; test-only helpers (API sign-in, `Sec-Fetch-Site` headers, time-shifting fixtures) reachable without `E2E_TESTING_ROUTES` or writing tokens to logs.

### Test Images and Order Determinism
**Source**: manual, 2026-11-02 (verdeect-identity ID-31, ID-33, ID-34)
**Rule**: Treat as blocking: a Playwright image referenced by tag without `@sha256:` digest, or a digest that is a local image ID; a test service image whose tag differs between the test setup, CI and compose, or a new service missing from the image-equality test; `corepack` relied on inside third-party CI images; an assertion on text-ordered database rows without `collate "C"` or an explicit sort; mail ordering by timestamp strings or "the n-th mail" of one recipient where several cases share it.

### Visual Regression Against Mockups
**Source**: manual, 2026-10-21
**Rule**: Treat as blocking: new or widened entries in `tests/Visual/deviations.ts` without a user approval in the plan; changes to `threshold`, `maxDiffPixels`, baseline generation or the guard tests of the catalog; edits of files under `requirements/**/mockups`; UI changes in screens that have mockups without a passing `make test-visual`.

### Expected Errors Are Not Reported
**Source**: manual, 2026-10-23 (verdeect-bff, review E1)
**Rule**: Exceptions to "Error Reporting" — not findings: (1) health/readiness probes that turn a dependency failure into a probe status (`/health` 503 or `degraded`) without reporting — reporting every probe of a down dependency floods GlitchTip; (2) expected error responses — the known codes of the project's error table, including expected 503/504 of an unavailable dependency and 4xx request errors of the framework (body parsing, size, content type) — logged as `warn` and counted in metrics instead of being reported. Only unexpected errors (`INTERNAL_ERROR`, unhandled exceptions of consumers, jobs and entry points) go to GlitchTip. A `catch` that hides an unexpected error is still `major`.

### Public Package Surface
**Source**: manual, 2026-11-09 (verdeect-kit, adapted from verdeect-platform-client; requirements P0, G14, NFR-2–NFR-4)
**Rule**: Treat as blocking: a `default` condition added to `exports["./testing"]`, or an import of `testing` from any other subpath; a static top-level import of an optional peer (`pg`, `ioredis`, `amqplib`, `amqp-connection-manager`, `testcontainers`, `vitest`) from a subpath that must load without it (AC-1.2); a peer from NFR-3 moved into `dependencies` or a required peer made optional (or the reverse) without a requirement; an option, mode or alias that keeps a historical difference between services (P0); a schema or table name of a service, or `console.*`, in `src/**` (NFR-2, NFR-8); environment values, secrets, PII, Redis keys or SQL parameters reaching logs, GlitchTip events, HTTP bodies or error texts (NFR-4); a public export, option, environment key, error code, metric name or `assertRepoConventions` rule added, removed or changed without TSDoc, README and `CHANGELOG.md` updates; a version bump lower than G14 requires (major: removal or rename of an export, a changed signature or meaning, a new required `envBase` key, a new `assertRepoConventions` rule, a major change of a `TEST_IMAGES` image, a raised peer minimum on a major, a change of the AMQP driver; minor: new subpath, exports, options with a safe default; patch: fixes without contract change); a major without a «Как перейти» section in `CHANGELOG.md`; edits in service repositories under `/home/administrator/projects/verdeect2/verdeect-*` other than this one; any secret, environment URL or `.npmrc` with a token committed.
