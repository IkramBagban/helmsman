# Features Workspace — Parallel Agent Execution Map

Use this folder to assign one coding agent per feature and run work in parallel.

Shared rules:
- Global rules: [../agents/CONVENTIONS.md](../agents/CONVENTIONS.md)
- Agent routing guide: [../agents/AGENT.md](../agents/AGENT.md)
- Skills policy: [../AGENT_SKILLS.md](../AGENT_SKILLS.md)

---

## Feature Files

1. [FEATURE_TELEGRAM_CHAT.md](FEATURE_TELEGRAM_CHAT.md)
2. [FEATURE_LLM_ORCHESTRATION.md](FEATURE_LLM_ORCHESTRATION.md)
3. [FEATURE_POLICY_APPROVAL.md](FEATURE_POLICY_APPROVAL.md)
4. [FEATURE_AWS_READ_CORE.md](FEATURE_AWS_READ_CORE.md)
5. [FEATURE_AUDIT_OBSERVABILITY.md](FEATURE_AUDIT_OBSERVABILITY.md)

---

## Suggested Parallelization Plan

Wave 1 (can start together):
- Telegram chat transport
- LLM orchestration core
- Audit/observability framework

Wave 2 (depends on Wave 1 contracts):
- Policy + approval gate
- AWS read tools

Reason:
- Transport and orchestration establish interaction loop
- Audit provides required traceability for all later features
- Policy/tooling then plug into established loop

---

## Dependency Notes

- `FEATURE_TELEGRAM_CHAT` depends on orchestration contract
- `FEATURE_POLICY_APPROVAL` depends on orchestration + audit
- `FEATURE_AWS_READ_CORE` depends on orchestration + policy
- `FEATURE_AUDIT_OBSERVABILITY` should expose common logging/audit APIs early

---

## Definition of Done (for any feature)

- Acceptance criteria in feature doc satisfied
- Tests added/updated
- No violation of shared conventions
- No undocumented contract breaks
