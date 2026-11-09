# Project Rules for /aif-evolve

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-10-30
> Based on: 64 analyzed patches + manual rules

## Rules

### Prefer Code-Generation Skills Over Lifecycle Orchestrators
**Source**: manual
**Rule**: When a prevention point describes how to write, structure or validate a specific file type (model, action, controller, migration, DTO, job, test, store, component, etc.), target the code-generation skill that owns that file type (`laravel-code-*`, `laravel-vue-code-*`, `python-code-*`, `nestjs-code`) — not a lifecycle orchestrator (`aif-implement`, `aif-fix`, `aif-plan`, `aif-review`). Split cross-cutting prevention points into separate rules for each affected code-generation skill. Use lifecycle skills only for their own orchestration concerns: (a) `aif-implement` — task execution order, wave coordination, inter-task dependencies; (b) `aif-fix` — diagnostic strategy, root-cause workflow, fix verification; (c) `aif-plan` — task breakdown, dependency planning, estimation; (d) `aif-review` — review checklist structure, severity classification, review workflow.

### Code-Generation Skills Are User Skills
**Source**: manual, 2026-10-05
**Rule**: `laravel-*`, `laravel-vue-*`, `python-*`, `nestjs-*`, `create-*-file` skills are the user's own skills shared across projects (not project-local). Present improvements to them as proposals with the exact target file path and a note that the change affects every project using the skill; never apply them silently. Rules that are true only for the current project go to `.ai-factory/skill-context/` instead.

### Preserve Bundle Rules
**Source**: manual, 2026-10-05
**Rule**: Rules in skill-context files whose header says `Bundle: aif-prompts` form the cross-project baseline. Treat them as Case D (keep) unless the base skill now fully covers or contradicts them — then report per Steps 3–4; never delete them silently.
