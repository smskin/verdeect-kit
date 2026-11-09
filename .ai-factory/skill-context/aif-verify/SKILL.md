# Project Rules for /aif-verify

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-11-09
> Based on: manual rules

## Rules

### Requirements Package Acceptance
**Source**: manual, 2026-10-05
**Rule**: If the plan references `requirements/<NNNN>-<slug>/`, verify every AC (and FR/BR/EC) ID **in the plan's scope** (the `Milestone scope` in Requirements Reconciliation; whole package when absent) from its `feature.md` / `prd.md` against the code and tests; IDs of other milestones are not checked; report each uncovered or contradicted ID as a requirements-provenance failure. UI states promised in the package (loading / empty / error) must exist in the implemented views. For change packages, verify that the old behavior listed in "Было → станет" is actually gone.

### Skill Convention Compliance
**Source**: manual, 2026-10-05
**Rule**: For files created or modified by tasks with a `**Skill:**` field, spot-check the result against that skill's `references/RULES.md` (naming prefixes, OpenAPI attributes, strict types, readonly DTOs, `<script setup lang="ts">`, no `any`, etc.). For Laravel services/modules touched by the plan, run `laravel-review-service-structure` / `laravel-review-module-structure` when available. For NestJS, check the general rules of `nestjs-code` and the anti-patterns of `nestjs-specialist`: relative imports with `.js`, no `any` / non-null assertions, one route per HTTP controller, transactions and outbox only in use-cases, tenant only from `RequestContext`, RLS + `FORCE ROW LEVEL SECURITY` on every tenant table, consumers through the inbox.

### Documentation Freshness
**Source**: manual, 2026-10-05
**Rule**: Verify that CLAUDE.md files of every touched module/service/frontend directory were regenerated after the code changes (documented components match files on disk). Stale docs are a WARN in normal mode and a FAIL in `--strict`.

### Quality Gates Through the Makefile
**Source**: manual, 2026-10-05 (replaces "Build and Tests Inside Docker")
**Rule**: Run the project's gates via Makefile targets on the host: `make lint`, `make analyse`, `make test`, `make test-integration`, `make front` (or their equivalents listed in the Makefile help). NestJS uses the same target names: `lint` = ESLint + Prettier check, `analyse` = `tsc --noEmit`, `test` = Vitest unit, `test-integration` = Vitest integration + http on Testcontainers; `front` only when the repository has a frontend. Never run the test suite inside the `app` container. If the plan touches UI (views, components, routes) also run `make test-browser`; e2e scenarios run only locally against the isolated e2e contour and are a merge gate even though CI does not run them. A missing Makefile target is reported as WARN with the exact command used instead.

### Traceability Matrix Gate
**Source**: manual, 2026-10-05
**Rule**: Build a matrix from the requirements package for the plan's scope: every in-scope AC ID → at least one passing test whose name starts with that ID (Pest title / PHPUnit TestDox or `test_ac_N_` method under `tests/Unit|Feature|Integration`, pytest `test_ac_N_` function, Vitest `it('AC-N: …')` in `src/**/*.spec.ts` / `test/**`, Playwright under `tests/Browser`); every UC ID with a UI → a Playwright `test.describe('UC-N: …')` (or file header reference) covering its main flow and each alternative/error flow. Print the matrix in the report. Uncovered AC/UC = FAIL in `--strict`, WARN otherwise. Requirements listed as waived in the package README are reported as WAIVED, not FAIL.

### Milestone Completion
**Source**: manual, 2026-10-05
**Rule**: When the plan has `## Roadmap Linkage` and the traceability matrix is fully covered (or WAIVED), report the milestone as complete; if `/aif-implement` did not mark it, suggest `/aif-roadmap check`. If the milestone is already marked done but the matrix is not fully covered (and not WAIVED), report FAIL in `--strict` (WARN otherwise) and suggest `/aif-roadmap` to uncheck it.

### Error Tracking Gate
**Source**: manual, 2026-10-12
**Rule**: When the project uses GlitchTip (`sentry/sentry-laravel`, `@sentry/vue`, `sentry-sdk` or `@sentry/nestjs` present), check: DSNs are empty in `phpunit.xml`/pytest/Vitest config, `compose.override.yml`, `compose.e2e.yml` and `.env.example`; production compose lists the `SENTRY_*` variables by name; the scrubber and user-context tests pass; new entry points from this plan report their errors. Missing items are WARN (FAIL in `--strict`). When the project has no integration yet, report WARN `[error-tracking] not integrated` and suggest a milestone for it.

### Test Levels in Verification
**Source**: manual, 2026-10-30 (verdeect-identity)
**Rule**: The test gate is `make test-full` (or `test` + `test-integration` + `test-timing` when the target is missing — WARN `[test-levels] missing targets`), plus `test-browser` / `test-visual` per the other rules. `test-timing` needs a quiet machine: when load average ≥ 8 (or above the number of cores), report it as DEFERRED with the measured value instead of FAIL, and list it under open items. A test that fails by timeout under load and passes when re-run alone is reported as FLAKY-UNDER-LOAD with file, test and duration — never silently dropped. In `--strict` it is FAIL if a file that writes env, mocks modules or patches prototypes runs in the `shared` (non-isolated) project, or if the hashing cost of the test configuration leaks into production compose / `.env.example`.

### Browser Tests in a Container
**Source**: manual, 2026-11-01 (verdeect-identity, ID-24)
**Rule**: The browser-test gate is `make test-browser` running in the pinned Playwright image (aif-build-automation rule of the same name); a host run (`test-browser-host`, `npx playwright test`) does not count as the gate. Report total / passed / failed per Playwright project and the number of `net::ERR_NETWORK_CHANGED` failures — expected 0; a non-zero count means the run was not isolated: FAIL in `--strict` until rerun in the container. In `--strict` it is also FAIL if `test-browser` runs on the host or with `--network host`, or if `PLAYWRIGHT_IMAGE` differs between `test-browser` and `test-visual`.

### Test Images and Order Determinism
**Source**: manual, 2026-11-02 (verdeect-identity ID-31, ID-33, ID-34)
**Rule**: In `--strict` it is FAIL if `PLAYWRIGHT_IMAGE` (Makefile and CI) is not pinned by manifest digest or differs between them, if the unit test comparing service image tags across the test setup, CI and compose is missing or red, or if the plan added a service to tests without adding it to that test. Report the pinned Playwright digest and the Node version inside it.

### Browser Tests Without a Vue Stack
**Source**: manual, 2026-10-15
**Rule**: "The plan touches UI" includes React/TSX pages and any other browser application in the repository, not only Vue views. For such plans run `make test-browser` and require in the traceability matrix a Playwright `test.describe('UC-N: …')` for every in-scope UC with UI. A NestJS repository with a browser application is not a "backend-only service": missing e2e contour or missing UC specs are FAIL in `--strict`.

### Visual Regression Against Mockups
**Source**: manual, 2026-10-21
**Rule**: When the requirements package has exported mockups and the plan touches UI, run `make test-visual` (see the aif-plan rule of the same name). In `--strict` it is FAIL if: the run is red; the contour (`playwright.visual.config.ts`, `tests/Visual/`, Makefile target, CI job) is missing; an artboard of the plan's screens is missing from the catalog; `tests/Visual/deviations.ts` got entries without a recorded user approval in the plan; baselines, `threshold` or `maxDiffPixels` were changed to make tests pass. Report the path to the diff images. Add "artboard → visual test" to the traceability matrix.

### Library Package Gates
**Source**: manual, 2026-11-09 (verdeect-kit, adapted from verdeect-platform-client; requirements G13, AC-1.1, AC-1.10, AC-9.1–AC-9.5)
**Rule**: This repository is the published npm library `@verdeect/kit`. Quality gates are `make ci` (`lint analyse test test-integration build pack-check`); before merge and before a release the gate is `make test-full` (adds `test-timing`; requires Docker). `test-timing` under load (load average ≥ 8 or above the number of cores) is DEFERRED with the measured value, not FAIL; an integration or timing test that fails only by a timeout under load is re-run alone and reported as FLAKY-UNDER-LOAD. Targets `test-module`, `test-integration`, `test-timing`, `test-load`, `test-full` exist; `front`, `test-browser`, `test-visual` do not exist here and are not reported as missing. "Error Tracking Gate" does not apply. The traceability matrix lists every in-scope AC with its level (U, I, T, C, R) and test; the cross-cutting AC-9.1, AC-9.3–AC-9.5 are re-checked in every milestone for the subpaths released so far. Additionally FAIL in `--strict` if: `exports["./testing"]` has a `default` condition or another subpath imports `testing`; a subpath fails to import without an optional peer it does not need (AC-1.2); a peer from NFR-3 is in `dependencies`; the tarball contains `src/`, specs, maps or config files; `src/**` contains `console.*` or a service schema/table name (AC-9.4); a public export, environment key, error code, metric name or `assertRepoConventions` rule changed without a matching `CHANGELOG.md` entry; `package.json` version does not match G14 for the change.
