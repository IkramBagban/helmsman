# Conventions — Shared Engineering Rules

This file contains cross-cutting implementation rules for all Helmsman features.

---

## 1) Architecture and Modularity

- Use clear module boundaries: transport, orchestration, tools, policy, audit, storage
- Keep business logic out of transport handlers (Telegram/Slack)
- Prefer interfaces/contracts for integrations (LLM, cloud providers, storage)
- Make components swappable (Telegram now, Slack later) without core rewrites

---

## 2) Reusable Code Rules

- No duplicate utility logic across features
- Put shared code in common modules with stable function signatures
- Keep feature logic thin; move reusable behavior into shared services
- If a feature needs a new shared primitive, document it in feature notes

---

## 3) API and Schema Rules

- Use explicit typed request/response models
- Validate all external inputs at boundaries
- Keep backward-compatible schema changes when possible
- Add version fields to long-lived persisted records/events

---

## 4) Reliability Rules

- All external calls must have timeout + retry policy
- Retries must be idempotent-safe
- Use structured errors with machine-readable codes
- Long-running actions must emit progress checkpoints

---

## 5) Security and Permission Rules

- Enforce plan → approval → execution for write/destructive actions
- Never log secrets or sensitive tokens
- Use least-privilege credentials
- Re-check critical resource state before destructive actions

---

## 6) Observability Rules

- Emit structured logs with correlation IDs
- Track latency per step (intent, planning, tool call, execution)
- Track tool error rates and retries
- Write immutable audit entries for state-changing actions

---

## 7) Testing Rules

- Add unit tests for domain logic
- Add integration tests for feature contracts
- Mock external services in tests; avoid flaky network dependence
- Include at least one failure-path test for each feature

---

## 8) Documentation Rules

- Do not repeat shared rules in each feature doc
- Feature docs should contain: scope, dependencies, contracts, acceptance criteria
- Keep docs implementation-oriented and unambiguous

---

## 9) Parallel Agent Merge Rules

- Each feature branch should modify only owned files unless contract change is approved
- Contract changes require a small “impact note” in PR description
- Avoid broad refactors during feature delivery unless explicitly requested
