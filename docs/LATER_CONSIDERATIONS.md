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