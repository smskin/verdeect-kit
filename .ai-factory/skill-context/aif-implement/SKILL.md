# Project Rules for /aif-implement

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-10-30
> Based on: 74 analyzed patches + manual rules

## Rules

### Delegate to Plan-Specified Skill
**Source**: manual, 2026-03-30
**Rule**: When a task contains a `**Skill:**` field (e.g. `Skill: laravel-code-service-http-response (CREATE)`), MUST invoke that skill in the specified mode BEFORE writing any code for the task. If the Skill tool is available (main session), invoke the skill directly. If it is unavailable (subagent/worker context), read the skill files instead: (1) resolve `~/.claude/skills/<skill-name>/` (or `.claude/skills/<skill-name>/`); (2) read `SKILL.md`, plus `references/RULES.md` and `references/TEMPLATES.md` when they exist (the `nestjs-*` skills keep rules and templates inside `SKILL.md`); (3) implement following ALL rules; (4) verify the output against every rule in RULES.md. **Flat module convention:** when the task's `**Files:**` paths have no `{Service}Service/` segment (Laravel) or `{name}-service/` segment (NestJS), omit the Service argument. Never write PHP / Vue / TS / Python / NestJS source files directly without the owning skill — if a task lacks `**Skill:**`, route via the stack specialist's routing table.

### Mandatory Context7 Lookup for External Libraries
**Source**: 2026-03-05-12.00.md
**Rule**: Before implementing a task that uses an external package API (any dependency from `composer.json`, `package.json` or `pyproject.toml` — e.g. Spatie Data, PrimeVue, SQLAlchemy, NestJS, Drizzle, zod, amqplib, SDK clients), MUST verify the current API via the Context7 MCP server: (1) `resolve-library-id` to find the library, (2) `query-docs` for the specific API/methods used. Tool names may carry a host-specific prefix (e.g. `mcp__Context7__…`, `mcp__claude_ai_Context7__…`) — use whichever is available; if Context7 is unavailable, emit `WARN [context7]` and continue. Skip for the language standard library, internal project modules, and trivial stable ORM CRUD (save, find, where, delete).

### Search for All Callsites After Rename or Signature Change
**Source**: 2026-02-23-23.30.md, 2026-02-24-00.00.md, 2026-03-02-21.15.md, 2026-03-03-15.34.md
**Rule**: After renaming a class, method, variable, property or changing a constructor/method signature:
1. Grep for the old name across source and tests (PHP: `grep -rn "OldName" app/ tests/ --include="*.php"`; Vue/TS: `grep -rn "OldName" resources/js/`; Python: `grep -rn "OldName" src/ tests/ alembic/`; NestJS: `grep -rn "OldName" src/ test/ drizzle/`).
2. **PHP 8 / Python named arguments, TypeScript object keys:** also search for the old name as a named argument or object key — `oldName:` in PHP and TS object literals/destructuring, `old_name=` in Python. Renaming `$account` does NOT catch `account:` in `new Dto(account: $value)`, and renaming a TS property does not catch `{ account }` shorthand.
3. Console commands / CLI entry points are outside the main request flow — always check them explicitly.
4. Run the full test suite. PSR-4 / import filename case mismatches only break on case-sensitive filesystems (Linux CI, Docker), not on macOS/Windows hosts.

### Run Commands Through the Project Makefile
**Source**: manual, 2026-10-05 (replaces "Run Commands Inside Docker")
**Rule**: Use the project's Makefile targets when they exist (`make test`, `make test-integration`, `make lint`, `make analyse`, `make front`, `make test-browser`, `make migrate`, …). **Never run the PHP test suite inside the `app` container**: container environment variables override `phpunit.xml`, and `RefreshDatabase` would run `migrate:fresh` on the development database. Tests run on the host (SQLite in memory); PostgreSQL-only tests run via `make test-integration` against the separate test database; browser scenarios run only via `make test-browser` against the isolated e2e compose project. Application commands that need the running stack (`artisan migrate`, `tinker`, queue) go through `docker compose exec app …` (use `sh`, not `bash`). Never remove the config-cache guard in `tests/TestCase.php`. **NestJS:** `make test` runs Vitest unit specs on the host; `make test-integration` runs integration and http specs against PostgreSQL/RabbitMQ started by Testcontainers (Docker on the host) or the URLs in `TEST_DATABASE_URL` / `TEST_RABBITMQ_URL` — never against the development database. Schema changes: `make db-generate NAME=…` (drizzle-kit generate), review the SQL, apply with `make migrate` (owner role); never `drizzle-kit push`.

### No Commit Checkpoint Prompts
**Source**: user workflow, 2026-10-05
**Rule**: Do not ask at commit checkpoints — behave as if "Skip all commit checkpoints" was chosen for the whole run (this persists across `/clear` because it is a project rule). The user reviews and commits once at the end via `/aif-verify` → `/aif-review` → `/aif-commit`.

### Milestone Completion Requires Full Plan
**Source**: manual, 2026-10-05
**Rule**: Mark the milestone from `## Roadmap Linkage` done in ROADMAP.md only when every task of the plan is completed and the plan's tests pass; otherwise emit `WARN [roadmap] milestone left open: <reason>` and leave it unchecked. Never mark milestones that the plan is not linked to.

### Requirement IDs in Test Names
**Source**: manual, 2026-10-05
**Rule**: Every test that verifies a requirement carries the requirement ID at the start of its name: Pest `test('AC-9: …')`; PHPUnit `#[TestDox('AC-9: …')]` (or method `test_ac_9_…` when TestDox is not used); pytest `test_ac_9_…`; Vitest `it('AC-9: …')` inside `describe('UC-3: …')`; Playwright `test('AC-9: …')` inside `test.describe('UC-3: …')`. Put the PRD/requirements references (UC-, AC-, FR-, BR-, EC- IDs and package path) in the file header comment. This is how `/aif-verify` builds the traceability matrix.

### Test Levels While Working
**Source**: manual, 2026-10-30 (verdeect-identity)
**Rule**: During implementation run `make test` and `make test-module M="<touched modules>"` after each group of tasks, `make test-integration` once at the end of a phase, `make test-full` only in the final verification. A new integration file that writes env, mocks modules or patches prototypes is added to the `isolated` project with its reason (aif-plan rule "Fast Test Suites"). On a loaded machine (load average above the number of cores) set `TEST_TIMEOUT_SCALE=2..3` locally; a test that fails only by timeout is re-run alone before any investigation. Never raise timeouts inside spec files or lower the production hashing cost outside the test configuration to make a run green.

### Visual Regression Against Mockups
**Source**: manual, 2026-10-21
**Rule**: Never make `make test-visual` green by running `--update-snapshots` on mockup baselines, raising `threshold` / `maxDiffPixels`, adding a mask or an `elements` deviation, or editing files under `requirements/**/mockups`. Fix the page, the styles or the template. If the difference can only be resolved by changing the mockup or by an approved deviation, stop and ask the user. The final "Visual check" task of a UI plan is never skipped, and a red visual run blocks marking the milestone done.
