# Project Rules for /aif-fix

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-10-30
> Based on: 74 analyzed patches + manual rules

## Rules

### Search ALL Callsites After Signature Change
**Source**: 2026-03-02-21.15.md, 2026-02-23-23.30.md, 2026-03-03-15.34.md
**Rule**: When a fix changes a class, method, variable or property name or a constructor signature:
1. Grep for ALL construction/call sites (PHP: `grep -rn "ClassName" --include="*.php" app/ tests/`; Vue/TS: `resources/js/`; Python: `src/ tests/ alembic/`; NestJS: `grep -rn "ClassName" src/ test/`).
2. **Named arguments / object keys:** also search for the old name as a named argument or object key — `oldName:` in PHP 8 and TypeScript object literals, `old_name=` in Python. Renaming `$account` does NOT catch `account:` in `new Dto(account: $value)`.
3. Console commands / CLI entry points are easy to forget — always check explicitly.
4. Run the full test suite after any rename or signature change.

### Specify Skill in FIX_PLAN Tasks (planning phase)
**Source**: manual, 2026-03-30
**Rule**: When creating FIX_PLAN.md, each task that creates or modifies a code file MUST include a `**Skill:**` field with the specialized skill and mode (e.g. `laravel-code-service-http-response (MODIFY)`, `laravel-vue-code-store (MODIFY)`, `python-code-repository (MODIFY)`, `nestjs-code use-case platform members InviteMember (MODIFY)`). Use the same routing as `/aif-plan` (specialist routing tables and decision trees). Tasks that only delete files, update config or run commands may omit the field.

### Consult Side-Effects Checklist in FIX_PLAN (planning phase)
**Source**: manual, 2026-03-30
**Rule**: When a fix modifies access control, routing, signatures, data schema or cross-module interfaces, consult the specialist's Side-Effects Checklist (**Laravel** `/laravel-specialist`, **Vue** `/laravel-vue-specialist`, **Python** `/python-specialist`, **NestJS** `/nestjs-specialist`) and add missing side-effect fix tasks to FIX_PLAN.md.

### Validate FIX_PLAN Tasks Against Specialist Decision Tree
**Source**: manual, 2026-03-30
**Rule**: After drafting FIX_PLAN tasks and BEFORE saving, run them through the relevant specialist's decision trees and Plan Review Checklist (in REFERENCE mode). Fix flagged mismatches (e.g. fix creates an Action with transaction logic, adds a multi-method HTTP controller, uses the wrong documentation level) before saving.

### Post-Planning Verification via `/aif-improve` for FIX_PLAN.md
**Source**: 2026-03-04-18.30.md
**Rule**: After creating FIX_PLAN.md (Step 1.1) and BEFORE presenting "Fix Plan Created", invoke `/aif-improve @<resolved fix plan path>`. Apply returned fixes in place and re-run until no fixes are found, **at most 3 passes**; report remaining issues instead of looping further.

### Delegate to Plan-Specified Skill (implementation phase)
**Source**: manual, 2026-03-30
**Rule**: When executing a fix task (from FIX_PLAN.md or fix-now mode) that has a `**Skill:**` field, MUST invoke that skill in the specified mode BEFORE writing code; in fix-now mode, route via the specialist routing table. The skill holds rules, templates and naming conventions (OpenAPI annotations, prefixes, patterns). **Flat module convention:** when file paths have no `{Service}Service/` (Laravel) or `{name}-service/` (NestJS) segment, omit the Service argument.

### Regenerate Documentation After Fix
**Source**: manual, 2026-10-05
**Rule**: If the fix creates, deletes or renames files inside a module/service/frontend directory, regenerate the affected CLAUDE.md files bottom-up with the specialist's documentation generators.
