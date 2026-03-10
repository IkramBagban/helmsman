# AI Persistent Memory Plan (Phase-Oriented)

Status: In Progress
Owner: Agent-Core + API + Docs
Last updated: March 4, 2026 (UTC)

---

## 1) Goal

Create a practical persistent-memory system that helps AI coding/execution agents:
- remember durable project knowledge across sessions,
- avoid re-learning repo structure and decisions,
- keep short-term execution context separate from long-term facts,
- stay auditable and safe.

This plan is designed to coexist with existing full-context files (no removals required now).

---

## 2) Memory Model (What to store)

Use 4 memory tiers with clear ownership:

1. Session Memory (ephemeral)
- Scope: one chat/session
- TTL: hours to 1 day
- Stores: temporary assumptions, pending tasks, unresolved questions
- Never treated as source of truth

2. Working Memory (task lifecycle)
- Scope: one implementation plan or feature
- TTL: until task closes
- Stores: active plan, checkpoints, blockers, decisions made during execution
- Source: plan files in `apps/docs/plans/`

3. Project Memory (durable)
- Scope: repository-wide
- TTL: long-lived
- Stores: architecture truths, folder/feature map, conventions, integration contracts
- Source: `apps/docs/current-state/*` + map doc

4. Decision Memory (durable + traceable)
- Scope: major technical choices
- TTL: long-lived
- Stores: ADR-style rationale, alternatives, consequences
- Source: `docs/adr/*` (or `apps/docs/adr/*` if unified later)

---

## 3) Canonical Sources (single-writer policy)

To prevent drift, each memory type must have a canonical home:

- Repo/feature map: `apps/docs/MAP.md` (create)
- Current runtime truth: `apps/docs/current-state/*`
- Execution plans: `apps/docs/plans/*`
- Architectural decisions: `docs/adr/*`

Rule: when memory conflicts, prefer canonical source over ad-hoc notes.

---

## 4) File Structure to Implement

Minimum structure:

- `apps/docs/MAP.md`
- `apps/docs/plans/INDEX.md`
- `apps/docs/plans/templates/PLAN_TEMPLATE.md`
- `apps/docs/plans/templates/STATUS_TEMPLATE.md`
- `apps/docs/plans/<YYYY-MM-DD>-<short-topic>.md` (per active plan)

Optional (later):
- `apps/docs/memory/OPERATING_RULES.md`
- `apps/docs/memory/CHANGELOG.md`

---

## 5) Agent Operating Protocol (how agents use memory)

Every coding/execution agent run should follow this protocol:

1. Read order
- `AGENTS.md`
- target feature doc
- `apps/docs/MAP.md`
- relevant `apps/docs/current-state/*`
- active plan file in `apps/docs/plans/`

2. During execution
- append checkpoint notes to active plan file:
  - what changed,
  - why,
  - validation status,
  - remaining risks.

3. On completion
- update current-state docs only when runtime truth changed,
- mark plan status (Done/Blocked/Deferred),
- link related commits/PRs.

4. Guardrails
- do not store secrets/tokens in memory docs,
- do not copy full logs unless necessary; summarize and link paths,
- keep decision records concise and traceable.

---

## 6) Metadata Standard (for each plan file)

Each plan file should include frontmatter-like header:

- Title
- Status: Draft | In Progress | Blocked | Done | Deferred
- Owner
- Start date
- Last updated
- Scope
- Dependencies
- Risks
- Success criteria

And sections:
- Context
- Plan steps
- Execution log
- Validation
- Open issues
- Decision notes

---

## 7) Rollout Phases

Phase 1 (now, low effort)
- Create map + plans index + templates
- Start recording new work in one plan-per-topic files
- Keep existing full-context docs unchanged

Phase 2 (next)
- Add update cadence to team workflow:
  - plan updated per meaningful change,
  - current-state updated on merged behavior changes
- Add lightweight docs ownership table in `apps/docs/README.md`

Phase 3 (later, optional automation)
- Add script/check to verify required plan metadata fields
- Add CI doc check for stale `Last updated` in current-state docs
- Consider vectorized retrieval only after canonical docs are stable

---

## 8) Success Criteria

This persistent-memory plan is successful when:
- agents can find "where a feature lives" in under 1 minute,
- active work always has a live plan file,
- current-state docs reflect merged runtime behavior,
- repeated context re-explaining drops significantly.

---

## 9) Immediate Next Actions

- [x] Create `apps/docs/MAP.md` with package-to-feature mapping.
- [x] Create `apps/docs/plans/INDEX.md` and templates.
- [x] Start first live plan file for current active development stream.
- [x] Add one paragraph in `apps/docs/README.md` describing this workflow.

Current phase: Phase 1
