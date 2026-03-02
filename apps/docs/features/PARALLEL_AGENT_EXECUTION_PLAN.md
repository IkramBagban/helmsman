# Helmsman Parallel Agent Execution Plan

> Purpose: give you an execution-ready plan to run multiple coding agents in parallel without collisions.
> Source of truth for scope, ownership, dependencies, merge order, and acceptance checks.

---

## 1) Goal

Stabilize and harden the current Mastra-based Helmsman architecture by delivering these feature outcomes in parallel:

1. Strict pre-execution approval enforcement for risky actions
2. Deterministic multi-step workflow execution
3. Durable orchestration state (approvals + conversation/task context)
4. Client-agnostic transport contract for future Slack/CLI/mobile adapters
5. Better observability and test reliability

---

## 2) Current Constraints

- Keep architecture centered on existing packages (no framework swap)
- Respect package boundaries from AGENTS.md
- Avoid touching unrelated root config files
- Preserve existing public contracts unless explicitly versioned

---

## 3) Parallel Workstreams

## WS-A — Safety Gate Hardening (Critical)

### Owner
Agent A

### Scope
- Enforce risk and approval decision before any significant/destructive command execution
- Remove or neutralize post-execution approval paths for risky tool calls

### Packages
- packages/agent-core
- packages/tools (only if needed for risk metadata accuracy)

### Primary Files
- packages/agent-core/src/orchestrator.ts
- packages/agent-core/src/workflows/infra-workflow.ts
- packages/agent-core/tests/orchestrator.test.ts

### Deliverables
- A single policy path: risky action -> pending approval -> execute only after resume
- Explicit guard tests proving risky actions do not execute before approval

### Out of Scope
- Persistent storage implementation
- UI/Telegram wording redesign

### Acceptance Criteria
- No code path can execute significant/destructive action before approval
- Existing read_only and low_risk flows remain functional
- Tests cover approval-required and approval-denied scenarios

---

## WS-B — Deterministic Multi-Step Executor

### Owner
Agent B

### Scope
- Execute planner output through workflow-managed steps, not freeform agent reinterpretation
- Add ordered step execution with deterministic state transitions
- Add output-variable passing between steps

### Packages
- packages/agent-core

### Primary Files
- packages/agent-core/src/workflows/infra-workflow.ts
- packages/agent-core/src/agents/planner.ts
- packages/agent-core/src/orchestrator.ts
- packages/agent-core/tests/orchestrator.test.ts

### Deliverables
- Structured plan execution model
- Per-step result record (success/error/output summary)
- Abort strategy when a required step fails

### Out of Scope
- Deep rollback automation beyond a basic stop-and-report model

### Acceptance Criteria
- Multi-step request executes exactly in plan order
- Failed step halts downstream execution and reports partial completion
- Step outputs are available for dependent steps

---

## WS-C — Durable State and Resume

### Owner
Agent C

### Scope
- Move in-memory approval state to durable store
- Persist short conversation/task context needed for approval and workflow continuation

### Packages
- packages/db
- packages/agent-core
- apps/api

### Primary Files
- packages/db/prisma/schema.prisma
- packages/db/src/**
- packages/agent-core/src/orchestrator.ts
- apps/api/src/routes/telegram.ts

### Deliverables
- Repository layer for pending approvals and workflow pointers
- TTL/expiration handling in durable layer
- Migration + docs for new schema entities

### Out of Scope
- Full long-term memory/rag system

### Acceptance Criteria
- Server restart does not lose pending approvals
- Expired approvals are reliably rejected
- DB-backed repository tests pass

---

## WS-D — Transport-Agnostic Interaction Contract

### Owner
Agent D

### Scope
- Define channel-neutral contract for inbound message, outbound response, approval prompts, and progress updates
- Keep Telegram as adapter implementation of that contract

### Packages
- packages/shared
- apps/api
- packages/agent-core

### Primary Files
- packages/shared/src/index.ts (or split contract files)
- apps/api/src/routes/telegram.ts
- packages/agent-core/src/orchestrator.ts

### Deliverables
- Typed transport contract with extensible metadata
- Adapter notes for future Slack/CLI/mobile implementation

### Out of Scope
- Implementing actual Slack/CLI/mobile runtime integrations

### Acceptance Criteria
- Telegram route compiles against new shared contract without behavior regressions
- Contract supports approvals and progress events without Telegram-specific fields

---

## WS-E — Observability and Run Diagnostics

### Owner
Agent E

### Scope
- Expand structured trace events around planning, approval, and per-step execution
- Add stable event naming and minimal event schema guide

### Packages
- packages/agent-core
- packages/audit (optional integration)

### Primary Files
- packages/agent-core/src/trace-logger.ts
- packages/agent-core/src/orchestrator.ts
- packages/agent-core/src/workflows/infra-workflow.ts

### Deliverables
- More complete event coverage for end-to-end run timelines
- Redaction/preview rules documented

### Out of Scope
- Third-party APM vendor integration

### Acceptance Criteria
- Single correlationId can reconstruct run lifecycle from logs
- No secrets leaked in logs under normal flow

---

## WS-F — Test Stabilization and Quality Gate

### Owner
Agent F

### Scope
- Strengthen tests around approval gate, multi-step flow, and tool execution wrappers
- Add deterministic mocks for runtime/tool behavior

### Packages
- packages/agent-core/tests
- apps/api/tests

### Primary Files
- packages/agent-core/tests/orchestrator.test.ts
- packages/agent-core/tests/router.test.ts
- packages/agent-core/tests/shell-execute-tool.test.ts
- apps/api/tests/routes/telegram-webhook.test.ts

### Deliverables
- Expanded integration-like tests on orchestrator and webhook path
- Reliable test fixtures for approval + resume + expiration

### Out of Scope
- Load/performance test suite

### Acceptance Criteria
- Critical safety flows are covered by tests
- Failing tests produce actionable assertions (not brittle snapshot noise)

---

## 4) Dependency and Merge Order

## Wave 1 (Run in Parallel Immediately)
- WS-A Safety Gate Hardening
- WS-E Observability
- WS-F Test Stabilization (initial scaffolding)

## Wave 2 (After WS-A baseline merges)
- WS-B Deterministic Multi-Step Executor

## Wave 3 (Can run mostly in parallel after Wave 2 contracts are stable)
- WS-C Durable State
- WS-D Transport-Agnostic Contract

## Wave 4 (Final integration and cleanup)
- WS-F final pass (full regression and integration assertions)

---

## 5) File Ownership Rules (To Prevent Agent Collisions)

- WS-A owns orchestrator approval logic sections
- WS-B owns workflow step execution model and planner-to-workflow mapping
- WS-C owns DB schema/repositories and persistence wiring
- WS-D owns shared transport type contracts
- WS-E owns trace event schema and logging helper behavior
- WS-F owns tests and fixtures; can request small testability hooks from other streams

If two streams must touch the same file, lock by section:
- orchestrator.ts: WS-A (approval), WS-B (multi-step execution), WS-E (events)
- telegram.ts: WS-C (persistence wiring), WS-D (contract adapter)


---

## 7) Contract Checklist Before Merge

Before merging any workstream:

1. Type contracts compile across dependent packages
2. No breaking change to existing public package exports unless documented
3. Approval semantics remain explicit in response status values
4. Telegram adapter behavior remains functional for start/help/approve/message paths

---

## 8) Execution Checklist Per Agent

- Read AGENTS.md + assigned workstream section from this file
- Confirm allowed package boundaries
- Implement feature slice with tests
- Run package-local test and typecheck
- Open PR with:
  - summary
  - changed files
  - acceptance criteria mapping
  - known risks

---

## 9) Suggested Agent Prompts (Copy/Paste)

## Prompt for Agent A (Safety)
Implement WS-A from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Enforce pre-execution approval for significant/destructive actions in packages/agent-core, add tests proving no risky action executes before approval, and keep read_only/low_risk behavior unchanged.

## Prompt for Agent B (Multi-Step)
Implement WS-B from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Execute planner output deterministically in workflow order with variable passing and halt-on-failure behavior. Add tests for successful and partial-failure plans.

## Prompt for Agent C (Durable State)
Implement WS-C from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Replace in-memory pending approvals with durable storage in packages/db and wire into agent-core/api with TTL semantics and tests.

## Prompt for Agent D (Transport Contract)
Implement WS-D from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Add transport-agnostic shared contracts and keep Telegram route as adapter without changing user-visible behavior.

## Prompt for Agent E (Observability)
Implement WS-E from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Expand structured tracing for plan creation, approval suspend/resume, and per-step execution while preserving redaction safety.

## Prompt for Agent F (Quality)
Implement WS-F from apps/docs/features/PARALLEL_AGENT_EXECUTION_PLAN.md. Add deterministic tests for approval, multi-step execution, and webhook integration paths; reduce flaky behavior.

---

## 10) Done Definition (Program Level)

- All six workstreams merged in dependency order
- Safety gate is enforced before risky execution
- Multi-step execution is deterministic and resumable
- Durable state survives process restart for pending approvals
- Shared transport contract is client-agnostic
- Logs can reconstruct full run lifecycle by correlationId
- Core tests pass in agent-core and api packages
