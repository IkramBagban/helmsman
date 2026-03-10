# Later Considerations — Staff Engineering Hardening Backlog

> Purpose: capture high-value improvements that should be considered before (or during) production hardening.
> Scope: this file does **not** replace current docs; it supplements them.

---

## Status Snapshot

Current docs are strong on architecture and product direction. 
Before production-grade rollout, several operational and verification details should be tightened.

---

## Priority Tiers

### P0 (Must Address Before Production)

1. **Webhook idempotency across multiple API instances**
   - Current Telegram dedup concept (in-memory map) is not safe for horizontal scaling.
   - Use shared idempotency store (Redis/Postgres) keyed by `update_id` with TTL.
   - Define exact behavior for duplicates: return `200`, no side effects.

2. **Fast-ack + async processing contract**
   - Define strict webhook SLA (example: ack in < 2s).
   - Move heavy processing to async worker path when needed.
   - Add failure strategy: retries, dead-letter queue, replay tooling.

3. **Secrets and credential lifecycle policy**
   - Rotation intervals, revocation process, emergency key kill-switch.
   - Explicit separation for bot token, webhook secret, provider API keys.
   - Add runbook for leaked credential incident.

4. **Observability and SLOs**
   - Define SLOs for message handling, action success, and plan latency.
   - Add error budget policy and alert thresholds.
   - Enforce correlation IDs in all logs/events.

5. **Approval gate safety invariants**
   - Codify non-bypassable rules (destructive always requires hard confirmation).
   - Add invariant tests to prevent regressions.

6. **Runtime secret injection hardening (remove host secret bind mounts)**
   - Current model uses temporary host files bind-mounted into task containers.
   - Move to a mechanism that avoids host secret file mounts entirely (direct in-container write from orchestrator stream, short-lived secret sidecar, or equivalent sealed injection).
   - Add explicit verification that no secret material is exposed via `docker inspect`, host fs scans, or audit payloads.

7. **Truthful execution status (no hallucinated progress updates)**
    - Current behavior can produce status text like "retrying now" or "still working" without a real active execution handle.
    - User trust risk: conversational turns can imply background work that is not actually running.
    - Implement a state-backed execution status model:
       - Persist operation state per chat (`idle`, `queued`, `running`, `blocked`, `failed`, `completed`) with `operationId`.
       - Update state only from actual orchestrator/tool events (not generated prose).
       - Add a dedicated status responder path that reads state and refuses to fabricate progress.
    - Add response invariants:
       - Never claim "running/retrying/in progress" unless there is a live operation state.
       - If no active operation exists, answer explicitly: no active run and what is needed next.
    - Add regression tests for acknowledgement turns (`ok`, `sure`, `go ahead`) after failures so they cannot emit fake progress.

8. **Unified control-plane architecture for all agent features**
    - Current risk: behavior rules are spread across prompts, routing, and handlers instead of enforced in one architecture.
   - Reference design: `docs/UNIFIED_CONTROL_PLANE_ARCHITECTURE.md`.
    - Target model: every feature follows the same pipeline:
       - intent classification
       - deterministic planning / action extraction
       - deterministic policy and approval check
       - execution gate
       - audit event emission
       - response composition
    - The LLM may propose or explain actions, but it must never be the authority that permits execution.
    - Approval must be mandatory, structural, and non-bypassable for sensitive/destructive commands:
       - execution requires a valid approval artifact linked to user, chat, command, risk tier, and expiry
       - users cannot bypass approval with phrasing tricks, repeated confirmations, or prompt injection
       - the model cannot self-authorize, downgrade risk, or skip the policy gate
    - Add hard execution invariants:
       - no sensitive command runs without policy-engine approval
       - no command runs directly from free-form model text
       - every executed action must have traceable lineage: request -> plan -> approval -> execution -> audit log
    - Recommended implementation approach:
       - centralize all write/destructive execution through one execution gateway in code
       - make the policy engine pure/deterministic and separate from prompts
       - require typed action objects instead of free-text command execution where possible
       - make approval verification database/state based, never model judged
       - add invariant tests and adversarial tests for bypass attempts

---

### P1 (Should Address Early)

1. **Rate limiting and abuse controls**
   - Per-user and per-team message limits.
   - Burst protection and cooldown strategy.

2. **Cost and token governance**
   - Per-team daily model budget.
   - Tool execution quotas and long-running command caps.

3. **Data governance**
   - Retention policy per entity (messages, plans, tool outputs, audit logs).
   - PII classification and redaction standards.
   - Deletion/export workflow.

4. **Provider failover behavior**
   - Define cooldown policy and fallback order.
   - Record provider-switch audit events.
   - Add synthetic failover tests.

5. **Runbooks**
   - “Telegram webhook down”
   - “Provider outage”
   - “Tool execution outage”
   - “Approval pipeline stuck”

---

### P2 (Good Strategic Improvements)

1. **Replayable execution simulator**
   - Re-run historical plans in dry-run mode for regression checks.

2. **Policy-as-code versioning**
   - Version and diff risk/approval rules with migration notes.

3. **Progressive rollout controls**
   - Team-level feature flags.
   - Canary rollouts for tool categories.

4. **Knowledge quality pipeline**
   - Evaluate prompt packs / retrieval chunks with offline scoring.

---

## Document-Level Follow-ups

1. **TELEGRAM_GATEWAY.md**
   - Add shared idempotency store requirement (replace in-memory-only approach).
   - Add explicit fast-ack SLA and async processing path.

2. **AGENT_CORE.md**
   - Add hard token/cost budgets and timeout matrix per intent.
   - Add failover acceptance tests.

3. **TOOL_SYSTEM.md**
   - Add command execution quotas and per-tool concurrency constraints.
   - Add mandatory audit schema for every invocation.

4. **TRUST_AND_PERMISSIONS.md**
   - Add emergency lockout mode and break-glass protocol.

5. **ARCHITECTURE.md**
   - Add queue/worker path for webhook decoupling under load.
   - Add unified control-plane diagram showing routing, policy, approvals, execution gate, audit, and response composition.

6. **GIT_SSH_DEVOPS_RUNTIME.md**
   - Add final production target for secret delivery (no host bind-mounted secret files).
   - Add a validation checklist proving secret non-exposure across logs, inspect output, and crash diagnostics.

7. **TRUST_AND_PERMISSIONS.md / AGENT_CORE.md / TOOL_SYSTEM.md**
   - Refactor these docs around one shared execution-control architecture instead of feature-specific approval logic.

---

## Acceptance Gates Before Production

All gates should be green before production launch:

- [ ] Webhook idempotency validated in multi-instance deployment test
- [ ] P95 webhook ack time under target SLA
- [ ] Destructive action cannot execute without hard confirmation (automated tests)
- [ ] End-to-end traceability from inbound message to final tool result
- [ ] Secrets rotation drill completed successfully
- [ ] Provider outage drill completed (automatic fallback verified)
- [ ] Data retention + deletion policy approved and implemented
- [ ] On-call runbooks published and tested via game day
- [ ] Runtime secrets hardening verified (no host secret bind mounts in production path)
- [ ] Status truthfulness verified (no fabricated in-progress/retry claims without active operation state)
- [ ] Sensitive actions are impossible to execute without a valid approval artifact enforced in code
- [ ] Prompt injection and phrasing attacks cannot bypass approval or execution gates

---

## Recommended Sequence (Practical)

1. Finish Telegram connection MVP implementation.
2. Add shared idempotency and fast-ack/async split.
3. Add observability + SLO dashboards.
4. Add governance controls (rate/cost/retention).
5. Run failure drills and close remaining P0/P1 items.

---

## Notes

This is a living backlog. 
When a point is implemented, link the PR/commit and mark it complete here.

Related design drafts:
- `docs/UNIFIED_CONTROL_PLANE_ARCHITECTURE.md`
- `docs/DNS_DOMAIN_PLATFORM_ARCHITECTURE.md`
- `docs/OPENCLAW_LESSONS_FOR_HELMSMAN.md`