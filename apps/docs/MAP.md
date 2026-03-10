# Helmsman Repository Map (Web Excluded)

Last updated: March 4, 2026 (UTC)
Scope: Full repo map for AI agents and contributors, excluding `apps/web` implementation details.

---

## 1) Top-Level Layout

```text
Helmsman/
├─ AGENTS.md
├─ HELMSMAN_FULL_CONTEXT.md
├─ SOUL.md
├─ apps/
│  ├─ api/
│  └─ docs/
├─ packages/
│  ├─ agent-core/
│  ├─ tools/
│  ├─ tools-aws/
│  ├─ tools-github/
│  ├─ tools-devops-runtime/
│  ├─ policy/
│  ├─ shared/
│  ├─ audit/
│  ├─ eslint-config/
│  ├─ typescript-config/
│  └─ ui/
└─ docs/
   ├─ adr/
   └─ strategic notes (*.md)
```

---
## 2) Root Files (High Importance)

- `AGENTS.md`
  - Primary operating instructions for coding agents.

- `HELMSMAN_FULL_CONTEXT.md`
  - Broad context snapshot; useful for orientation but not canonical runtime truth.

- `SOUL.md`
  - Product voice/behavioral principles for Helmsman responses.

- `package.json`, `turbo.json`
  - Monorepo scripts, task orchestration, workspace behavior.

---

## 3) Apps

### `apps/api` — Runtime API + Telegram entrypoint

Key files:
- `src/index.ts`
  - App bootstrap/start.
- `src/app.ts`
  - Express app wiring.
- `src/config.ts`
  - Environment/config parsing.

Routes:
- `src/routes/health.ts`
  - Health endpoint.
- `src/routes/telegram.ts`

Middleware:
- `src/middleware/correlation-id.ts`
- `src/middleware/error-handler.ts`

Telegram transport internals:
- `src/telegram/commands.ts` — slash command handling
- `src/telegram/sender.ts` — outbound message formatting/sending
- `src/telegram/capability-store.ts` — role/approval storage (api-side)
- `src/telegram/approval-store.ts` — legacy/parallel approval path
Tests:
- `tests/routes/*`

---

### `apps/docs` — Product, architecture, feature, current-state, and planning docs

Core docs:
- `PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CONVENTIONS.md`, `STACK.md`
# Helmsman Repository Map (Web Excluded)

Feature specs:
- `features/*.md` (Telegram gateway, agent core, tools, policy, AWS tools, etc.)

- `current-state/CODE_AND_FEATURES.md`
- `current-state/ARCHITECTURE_CURRENT.md`
- `current-state/SECURITY_POSTURE.md`
- `current-state/GAPS_AND_NEXT_STEPS.md`

Persistent memory docs:
- `MAP.md` (this file)
- `plans/INDEX.md`
- `plans/AI_PERSISTENT_MEMORY_PLAN.md`
- `plans/templates/*`

---

## 4) Packages

### `packages/agent-core` — Central reasoning/orchestration engine

Entry and assembly:
- `src/index.ts`
- `src/mastra.ts` — agent/tool wiring for runtime

SPECIAL FILE (primary control plane):
- `src/orchestrator.ts`
  - Main orchestrator class and routing entrypoint.

Orchestrator modules (refactored):
- `src/orchestrator/intent-handlers.ts` — chat/query/single_action/multi_step handling
- `src/orchestrator/approval-flow.ts` — approval, activation continuation, recovery, elicitation
- `src/orchestrator/helpers.ts` — prompt/truncation/format/validation helpers
- `src/orchestrator/constants.ts` — runtime limits and orchestrator constants
- `src/orchestrator/types.ts` — orchestrator-specific types
Agent specializations:
- `src/agents/router.ts` — intent classification
- `src/agents/planner.ts` — plan generation
- `src/agents/responder.ts` — response formatting

- `src/security/prompt-injection.ts` — injection detection and refusal behavior

- `src/tools/index.ts`
- `src/tools/shell-execute.ts`
- `src/tools/devops-tools.ts`
- `src/tools/aws-knowledge.ts`

Legacy/parallel path:
- `src/agent/*` — legacy service retained for compatibility/testing

- `src/workflows/infra-workflow.ts`
Tests:
- `tests/router.test.ts`, `tests/prompt-injection.test.ts`, etc.
---


- `src/index.ts` — exports
- `src/shell-safety.ts` — command parsing/safety/risk rules
Use this package when changing command allowlist, blocking rules, or risk classification.
---

### `packages/tools-aws` — AWS tool implementations

- `src/base.ts` — base patterns

---

Core:
- `src/github-client.ts`
- `src/tool-factory.ts`

Tool groups:
- `src/tools/list-issues.ts`

---

- `src/index.ts`
- `src/types.ts`
- `src/tools/*` — runtime-facing tools
- `src/orchestrator/container-orchestrator.ts`
- `src/orchestrator/container-config.ts`
- `src/orchestrator/network-policy.ts`

Use this package for Docker isolation, egress/runtime policy, credential injection, and cleanup behavior.

### `packages/policy` — Policy engine package
- `src/index.ts`

Status: available but partially integrated relative to orchestrator-native approval gating.

- `src/file-logger.ts` — shared file logger

Use this package for cross-package types/contracts.
- `base.js`, `next.js`, `react-internal.js`
### `packages/typescript-config` — Shared TS configs

- `base.json`, `nextjs.json`, `react-library.json`

### `packages/ui` — Shared UI components (library package)

- `src/button.tsx`, `src/card.tsx`, `src/code.tsx`

Note: requested map excludes `apps/web`, but `packages/ui` remains relevant shared UI infra.

---

## 5) Legacy/External Docs Root

### `docs/` (root-level docs)

Contains strategic notes and ADRs outside `apps/docs`:
- `docs/adr/*` — architecture decisions
- `docs/LATER_CONSIDERATIONS.md`
- `docs/HELMSMAN_ROAD.md`
- `docs/AWS_MCP_PROMPT.md`
- `docs/GCP_MCP_IMPLEMENTATION.md`

Important: this is a second docs root; keep ownership clear to prevent drift with `apps/docs`.

---

## 6) “Where is X?” Quick Lookup

- Main request orchestration logic → `packages/agent-core/src/orchestrator.ts`
- Intent routing behavior → `packages/agent-core/src/agents/router.ts`
- Plan generation schema/logic → `packages/agent-core/src/agents/planner.ts`
- Approval and recovery flow → `packages/agent-core/src/orchestrator/approval-flow.ts`
- Conversation/activation memory handling → `packages/agent-core/src/orchestrator/conversation-state.ts`
- Prompt injection checks → `packages/agent-core/src/security/prompt-injection.ts`
- Telegram webhook entrypoint → `apps/api/src/routes/telegram.ts`
- Telegram slash commands → `apps/api/src/telegram/commands.ts`
- Shell safety rules → `packages/tools/src/shell-safety.ts`
- Shell execution wrapper → `packages/tools/src/shell-execute.ts`
- Runtime container isolation policy → `packages/tools-devops-runtime/src/orchestrator/*`
- Current runtime truth docs → `apps/docs/current-state/*`
- Active implementation plans → `apps/docs/plans/*`

---

## 7) Agent Read Order (Recommended)

1. `AGENTS.md`
2. `apps/docs/MAP.md`
3. `apps/docs/current-state/README.md` + relevant current-state docs
4. feature spec in `apps/docs/features/*`
5. active plan in `apps/docs/plans/*`

This order minimizes context drift and repeated discovery work.
