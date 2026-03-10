# Memory Foundation Setup

Status: In Progress
Owner: Docs + Agent-Core
Start date: 2026-03-04
Last updated: 2026-03-04
Scope: Establish persistent-memory workflow docs while retaining existing full-context files.
Dependencies: `apps/docs/MAP.md`, `apps/docs/current-state/*`, `apps/docs/README.md`
Risks: dual docs roots (`docs/` and `apps/docs/`) can drift without clear ownership
Success criteria: map + plans workflow is active and used by agents

---

## Context

Need one reliable memory operating layer for AI agents so they stop re-discovering repo context every session.

## Plan Steps

1. Create canonical map (`apps/docs/MAP.md`) for folder-feature ownership.
2. Keep active work in `apps/docs/plans/*` with one plan per workstream.
3. Keep runtime truth in `apps/docs/current-state/*` and update when behavior changes.
4. Define and enforce agent read-order (AGENTS → MAP → current-state → feature doc → active plan).

## Execution Log

- 2026-03-04 00:00 UTC Created persistent-memory plan and plan templates.
- 2026-03-04 00:00 UTC Added plans index and docs index links.
- 2026-03-04 00:00 UTC Created repository-wide `apps/docs/MAP.md` (web excluded).

## Validation

- [x] `apps/docs/MAP.md` exists and is populated
- [x] plans index exists with active-plan workflow
- [x] persistent-memory plan checklist completed
- [ ] at least one full feature cycle follows this workflow end-to-end

## Open Issues

- Need explicit ownership/cadence for updates across `docs/` vs `apps/docs/`.

## Decision Notes

- Keep full-context docs for now; avoid destructive consolidation early.
- Use map + plans + current-state as canonical operational memory layer.
