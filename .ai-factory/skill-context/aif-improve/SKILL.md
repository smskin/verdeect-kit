# Project Rules for /aif-improve

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-10-30
> Based on: manual rules

## Rules

### Skill Attribution Check
**Source**: manual, 2026-10-05
**Rule**: For every task that creates or modifies a source file, verify the `**Skill:**` field. Report as task improvements: **SKILL-001** — field missing; **SKILL-002** — the chosen skill or component type contradicts the specialist decision tree (`/laravel-specialist`, `/laravel-vue-specialist`, `/python-specialist`, `/nestjs-specialist`) and the task has no "Architectural deviation" note with ≥2 reasons; **SKILL-003** — wrong arguments (flat module given a Service argument or vice versa — Laravel `{Service}Service/`, NestJS `{name}-service/`; wrong `nestjs-code` component type; wrong CREATE/MODIFY mode for an existing/new file).

### Specialist Plan Review Checklist
**Source**: manual, 2026-10-05
**Rule**: On every pass, run all tasks through the Plan Review Checklist and Side-Effects Checklist of each relevant specialist. Missing side-effect tasks are missing-task findings; naming, layering, documentation-level and creation-order violations are task-improvement or dependency findings.

### Requirements Coverage
**Source**: manual, 2026-10-05
**Rule**: If Original Request (or Requirements Reconciliation) references `requirements/<NNNN>-<slug>/`, read its `feature.md` / `prd.md` and verify that every FR, BR, EC and AC ID **in the plan's scope** is cited by at least one task. Scope = the `Milestone scope` listed in Requirements Reconciliation (from `Скоуп этапа` in Original Request); without it — the whole package. IDs assigned to other milestones are not findings. Uncovered in-scope IDs are missing-task findings. Tasks implementing behavior absent from the package, or IDs assigned to other milestones, go to "Out of scope". Unresolved `[OPEN]` items that a task silently decides are task-quality findings. If the package revision is newer than the one cited in the plan, report which requirements changed.

### Internal Consistency
**Source**: 2026-03-04-18.30.md
**Rule**: Check data flow and plan logic: contradictions between tasks, orphaned components (created but never used or registered), unverified assumptions about existing code (field names, FK chains, method signatures — verify against actual files), schema consistency between migrations, models, DTOs, API types and frontend types.

### Log Applied Improvements as Patch Files
**Source**: manual
**Rule**: After applying approved improvements (Step 6), create a log entry for each logically distinct change using the `improve-patch-log.py` script. Do NOT create patch files manually via Write. If `~/.claude/scripts/improve-patch-log.py` does not exist, emit `WARN [improve-log] script not found` and skip logging — never block refinement on it.

```bash
python3 ~/.claude/scripts/improve-patch-log.py <keyword> <plan> <severity> <title> <problem> <root_cause> <solution> <prevention> <tags>
```

Arguments:
- `keyword` — single lowercase word for filename (e.g. `dependencies`, `missing-task`)
- `plan` — path to plan file or ultra directory (e.g. `.ai-factory/plans/feature-analytics.md`)
- `severity` — `low` | `medium` | `high`
- `title` — brief title describing the improvement
- `problem` — what gap or issue was found in the plan
- `root_cause` — WHY the plan had this gap
- `solution` — what was changed in the plan
- `prevention` — how to avoid this class of gaps in the future
- `tags` — space-separated tags (e.g. `"#description #field-reference"`)

Example:
```bash
python3 ~/.claude/scripts/improve-patch-log.py \
    field-references \
    ".ai-factory/plans/feature-analytics.md" \
    high \
    "Fix incorrect field references in DetermineEventCodeAction" \
    "Task 3c referenced surprise_pct but actual field is eps_surprise_pct" \
    "Plan used field names from design docs instead of actual models" \
    "Updated Task 3c to use eps_surprise_pct" \
    "Always verify field names against model files" \
    "#description #field-reference"
```

Multiple improvements of the same category (e.g. 3 task description fixes) MAY be grouped into one call. Independent categories (e.g. missing tasks vs dependency fixes) SHOULD be separate calls.

### Test Completeness
**Source**: manual, 2026-10-05
**Rule**: Within the plan's scope, report as missing tasks: an AC without a server test task (Pest/PHPUnit/pytest/Vitest — whatever the project uses); a UC with UI without a Playwright spec task; an endpoint without access-by-role and validation tests; (NestJS) a new tenant table without an RLS isolation test, a use-case with outbox without an atomicity test, a consumer without a redelivery test; a scenario state with no seeder profile / testing fixture task; a UI element used by scenarios without a `data-testid` or accessible name. Report a missing or incomplete `## Traceability` section as a task-quality finding.
