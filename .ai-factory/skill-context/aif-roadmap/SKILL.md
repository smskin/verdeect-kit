# Project Rules for /aif-roadmap

> Bundle: aif-prompts 2026-10-13 (portable baseline; /aif-evolve may extend it).
> Last updated: 2026-10-30
> Based on: manual rules

## Rules

### Milestones Come From Requirements Packages
**Source**: manual, 2026-10-05
**Rule**: When the request points to a requirements package (`requirements/<NNNN>-<slug>/README.md`, section «Этапы»), take milestones from that table exactly: same order, numbers (`E1`, `E2`, …) and names; do not merge, split, rename or invent milestones. Only when no package is referenced, derive milestones yourself (codebase analysis or vision).

### Milestone Line Format
**Source**: manual, 2026-10-05
**Rule**: Every milestone line references its package and requirement IDs: `- [ ] **E{n} {Name}** — {what it delivers} · requirements/<NNNN>-<slug> · UC-…, AC-…`. A milestone delivered before packages existed may reference `—` instead of a package. Keep the base template sections (Milestones, Completed) and add `## Requirements Map` — a table `Milestone | Package | UC | AC | Depends on`.

### Append, Never Rewrite
**Source**: manual, 2026-10-05
**Rule**: For a new feature, add its milestone(s) at the position the request names (after their dependencies) with the next free `E` number; never renumber, rename or remove existing milestones. If a new package changes behavior of a delivered milestone (`Изменяет:`), add a note `(изменяется в E{m})` to that milestone instead of unchecking it.

### Completion Needs Evidence From Tests
**Source**: manual, 2026-10-05
**Rule**: In `check` mode, mark a milestone done only when, besides code evidence, tests whose titles carry its AC IDs exist (`AC-N:` in Pest/Vitest/Playwright titles, PHPUnit TestDox or `test_ac_N_` names). Code without such tests is `partial`.
