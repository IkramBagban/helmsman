# GCP MCP Implementation Plan (Helmsman)

## Why this doc
You asked for a GCP implementation that keeps Helmsman smart, low-hallucination, and safe around dangerous operations.

This document does two things:
1. Explains how dangerous actions are handled **today** in your codebase.
2. Defines how to implement the same safety + reasoning model for GCP.

---

## Current Safety Model (What exists now)

### 1) Risky actions are not executed immediately
Current orchestrator flow:
- Intent -> planning -> risky-step extraction
- Command validation (placeholder/shell-safety checks)
- If risky: route through capability gates (`operator` / `commander`), not direct execution

Relevant files:
- packages/agent-core/src/orchestrator.ts
- packages/agent-core/src/capability-store.ts
- apps/api/src/routes/telegram.ts

### 2) Capability-gated approval flow
Current decisions:
- `significant` => requires `operator`
- `destructive` => requires `commander`

Current user flow:
- `/activate operator <ID>` or `/activate commander <ID>`
- `/approve <code>` for operator-gated actions
- `/confirm <target>` for commander destructive confirmation

### 3) Dangerous command execution boundary
Important: once approval is completed, command is executed directly via shell tool in the resume step.

That is intentional and explicit:
- dangerous actions are blocked pre-approval
- dangerous actions execute only post-approval
- execution result is formatted and returned

### 4) Recovery behavior
If approved command fails:
- bounded self-recovery loop
- diagnose -> read/discover -> retry (max attempts)
- if unresolved, ask one precise question with proposed next move

### 5) Hallucination controls already present
- command validation before approval
- placeholder rejection/clarification
- runtime date/context added in prompt path
- no-tool responder used for pre-approval elicitation/briefing

---

## GCP Target Architecture

## A) Add GCP tool layer
Create `packages/tools-gcp` similar to AWS tools package.

Use the **same hybrid architecture as AWS**:
- Layer 1 (curated tools): high-frequency, typed, well-understood operations
- Layer 2 (generic CLI): long-tail operations through a generic executor with strong policy gates

Core tools (AWS-aligned pattern):
- `gcloud_execute` (generic executor for most operations)
- `gcloud_readonly_execute` (optional stricter read-only wrapper)
- `gcp_context_get` (active account/project/region/zone diagnostics)

Optional high-value helper tools (few, not exhaustive):
- `gcp_billing_get`
- `gcp_iam_policy_get`
- `gcp_iam_policy_set` (Commander tier only)

Implementation notes:
- Wrap `gcloud` and related commands with strict arg schemas
- Normalize outputs to stable JSON structures
- Include project/region/zone inference helpers
- Do not create one tool per GCP API operation; rely on generic execution + strong risk/policy layer

When to promote generic CLI -> curated GCP tool:
- If analytics show >10% of GCP CLI calls repeatedly use the same action shape, promote it to a curated typed tool (same rule as AWS).

## B) Add GCP Knowledge MCP grounding
Use MCP for canonical product behavior (not live account state).

Rule split:
- Live account/resource state -> cloud tools (`gcloud` wrappers)
- Product semantics/limits/default behavior -> GCP Knowledge MCP

Do not let the model answer unknown GCP behavior from memory when MCP can answer.

## B.1) Credentials and identity model (required)
GCP auth must be explicit and first-class in implementation.

Requirements:
- Support service-account based auth (`gcloud auth activate-service-account`) with JSON key material.
- Store credentials encrypted at rest (same security bar as AWS credentials).
- Never echo key JSON or secret contents in responses/logs.
- Require active project context for write/destructive operations (`gcloud config set project` or explicit `--project`).
- Include identity introspection tools (`whoami`, active project, token validity) for fast auth debugging.

## C) Risk classification for GCP
Define risk map similar to AWS:
- `read_only`: list/describe/get operations
- `low_risk`: tagging/metadata updates, non-critical config writes
- `significant`: creates/major updates (new VM, bucket, SQL instance)
- `destructive`: delete/terminate/drop/force operations

Use these tiers to preserve existing orchestrator gate logic.

## D) Keep approval model unchanged (re-use)
No new approval semantics needed:
- significant -> operator + `/approve`
- destructive -> commander + `/confirm`

Explicit exception:
- `gcp_iam_policy_set` and equivalent IAM binding mutations are always **Commander tier**.

This consistency keeps human trust high across cloud providers.

## E) Parameter elicitation (agent-driven)
For GCP create/modify tasks:
1. Infer what can be discovered automatically (project, region/zone, network defaults, existing service account)
2. Ask only truly missing required fields in one grouped block
3. Offer safe defaults as optional suggestions
4. Never run write/destructive commands in elicitation phase

## F) Recovery-first behavior for GCP errors
When GCP command fails:
1. Parse error category (auth, quota, bad flag, invalid zone, missing API enablement, permission denied)
2. Read-only checks to validate assumptions
3. Retry corrected command (bounded)
4. If still blocked, ask one precise question and propose next action

Examples of auto-recoverable GCP failures:
- wrong zone/region
- missing network/subnet reference that can be discovered
- disabled API that can be suggested/enabled with approval

---

## Dangerous Decisions: How to handle correctly on GCP

Dangerous means any action with irreversible or high-blast-radius outcomes.

For each destructive plan step, always include in approval brief:
- exact target resource(s)
- what data/config can be lost
- whether rollback exists
- whether snapshots/backups exist
- explicit confirmation command required

Do not collapse multi-resource deletes into one opaque action unless user explicitly requested bulk destructive action.

---

## Prompt Additions (GCP-specific)

Use this block in system instructions for GCP mode:

- You must not invent project IDs, zones, service account names, bucket names, or IAM principals.
- If missing, discover with read-only tools first.
- If still missing, ask one grouped clarification block with optional defaults.
- For destructive actions, show impact + recoverability and require explicit confirmation.
- If command fails, recover before escalating (max 2 attempts).
- Use GCP Knowledge MCP for service behavior and limits; use live tools for account state.

---

## Concrete file changes to implement

1. New package
- packages/tools-gcp/
  - src/base.ts
  - src/gcloud-execute.ts
  - src/gcloud-readonly-execute.ts (optional)
  - src/context-tools.ts
  - src/billing-tools.ts (optional high-value)
  - src/iam-tools.ts (focused helper)
  - src/curated/ (optional, phase-driven; only for promoted high-frequency actions)
  - src/index.ts
  - tests/

2. Agent-core wiring
- packages/agent-core/src/mastra.ts
  - register GCP tools when enabled
- packages/agent-core/src/agents/devops-agent.ts
  - add GCP behavior guidance
- packages/agent-core/src/agents/planner.ts
  - add GCP planning patterns
- packages/agent-core/src/tools/risk-classifier.ts (or equivalent)
  - use one shared provider-aware classifier: `classifyRisk(provider, commandOrAction)`
  - return the same canonical tiers for AWS and GCP (`read_only|low_risk|significant|destructive`)

3. Config and env
- apps/api/src/config.ts
  - add GCP toggles and MCP endpoint config
- package-level .env.example files

4. Safety and policy reuse
- reuse current capability gates in orchestrator
- keep approval/activation/confirmation transport flow unchanged

---

## Test Matrix (must pass)

### Unit
- Risk classification: GCP commands map correctly to tiers
- Elicitation: no write calls before approval
- Recovery: bounded retries and escalation question behavior
- Auth model: invalid credentials, expired token, wrong active project are detected and surfaced clearly
- IAM mutation paths: always classified Commander tier

### Integration
- Significant create path requires operator activation + approval
- Destructive delete path requires commander activation + explicit confirm
- Approved execution executes once and records outcome
- API-not-enabled flow: diagnose -> propose/perform safe enablement path with correct approval gate
- Permission-denied flow: diagnose missing role/permission and ask one precise remediation question

### Hallucination guard
- Missing project/zone -> discover or ask (never invent)
- GCP behavior questions -> MCP-backed answer path

---

## Definition of Done (GCP)

- GCP tools integrated with agent-core
- Existing capability gate model reused unchanged
- No pre-approval dangerous execution path
- Recovery-first loop works for common GCP failures
- Elicitation is grouped, concise, and minimal
- Tests cover risk, approval, recovery, and hallucination constraints

---

## Final recommendation
Do not build GCP as a separate safety model.

Build GCP as a new provider under the same orchestration contract:
- same risk tiers
- same approval semantics
- same recovery policy
- same anti-hallucination contract

That gives you consistency, lower bug surface, and faster trust-building across clouds.

Implementation note:
- Enforce this structurally in code (shared provider-aware risk classifier), not only in docs, to prevent AWS/GCP drift over time.
