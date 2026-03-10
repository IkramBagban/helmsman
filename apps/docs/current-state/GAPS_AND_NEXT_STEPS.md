# Gaps And Next Steps

Snapshot date: March 2, 2026 (UTC)

This file tracks where current runtime behavior diverges from existing docs/expectations, and what should be implemented next.

## Mismatch Matrix (Code vs Existing Docs)

| Area | Existing docs claim | Current code behavior | Severity |
| --- | --- | --- | --- |
| Core architecture | Broad plan-first autonomous system with complete multi-step execution | Orchestrator includes planner/router, but risky multi-step flow currently approves and executes one command, not full plan sequence | High |
| Policy engine usage | Dedicated policy engine governs allow/deny/approval | `packages/policy` exists but main path uses orchestrator capability gating and shell risk checks | High |
| Data layer | `packages/db` documented as core package | `packages/db` directory is absent in repo | High |
| LLM stack docs | Some docs/AGENTS describe Claude primary or older provider model | Runtime path uses Mastra agents with Google model IDs by default | Medium |
| Transport docs | Telegram first, Slack next with broader gateway language | Telegram webhook implemented; Slack not implemented in inspected runtime path | Medium |
| Audit trail | Queryable durable audit trail expectations | `ConsoleAuditService` only; no persistent query backend | Medium |
| Root repository docs | Product-level setup description | Root `README.md` still Turborepo starter template | Medium |

## P0 (High Priority)

## 1. Execute full risky multi-step plans, not single command

- Problem:
risky `multi_step` intents currently gate and run first risky command, then stop.
- Target:
plan-level execution state machine with per-step status and continuation after approval.
- Owner package:
`packages/agent-core`
- Done when:
one approval can execute all approved non-destructive steps in sequence with step-by-step reporting and stop-on-failure semantics.

## 2. Unify risk and approval decisions in one policy path

- Problem:
`packages/policy` and orchestrator logic are split.
- Target:
orchestrator delegates all risk decisions to policy package interface.
- Owner package:
`packages/policy` + `packages/agent-core`
- Done when:
all approval-required decisions are traceable to one policy contract.

## 3. Introduce durable task and conversation persistence

- Problem:
core state is in-memory without Redis.
- Target:
persistent task/context store for restart resilience.
- Owner package:
new data package + `apps/api` + `packages/agent-core`
- Done when:
in-flight approvals and plan execution can survive process restart.

## P1 (Security And Reliability)

## 4. Strengthen prompt injection defenses

- Add model-assisted classification on high-risk prompts.
- Add explicit tool call policy checks on model output before execution.
- Expand regression tests with adversarial prompt suite.

## 5. Implement explicit runtime egress controls

- Current network mode logic is fail-closed in some cases, but explicit destination enforcement is not clear in code.
- Add enforceable egress filter implementation with integration tests.

## 6. Durable audit backend

- Replace console-only audit implementation with append-only storage and query API by correlation ID and user.

## P2 (Documentation And Operational Hygiene)

## 7. Align source docs with runtime reality

- Update root `README.md`.
- Update `AGENTS.md` package list and provider assumptions to match repository.
- Keep aspirational docs, but clearly label them as target state.

## 8. Deprecate or wire legacy paths

- Decide whether to keep legacy agent service and legacy approval store.
- If retained, document active usage boundaries clearly.

## Acceptance Criteria For This Gap List

- Every P0 item has a concrete owner package and done condition.
- Security-critical items are testable with integration tests.
- Documentation updates separate current state from target architecture.

## Source Files Consulted

- `AGENTS.md`
- `README.md`
- `apps/docs/README.md`
- `apps/docs/ARCHITECTURE.md`
- `apps/docs/TRUST_AND_PERMISSIONS.md`
- `apps/docs/ROADMAP.md`
- `apps/docs/features/README.md`
- `apps/api/src/routes/telegram.ts`
- `packages/agent-core/src/mastra.ts`
- `packages/agent-core/src/orchestrator.ts`
- `packages/policy/src/index.ts`
- `packages/audit/src/index.ts`
