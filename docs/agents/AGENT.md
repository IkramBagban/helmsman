# AGENT.md — Helmsman Multi-Agent Build Guide

This is the **single source of truth** for coding agents (Codex, Antigravity, or any other runtime).

If an agent receives a task, it should start here.

---

## 1) Mission Context

Helmsman vision:
- Long-term: Jarvis-style execution agent across domains
- Current build focus: DevOps-first product
- Interface strategy: Telegram first, Slack next

Read product context:
1. [../README.md](../README.md)
2. [../ROADMAP.md](../ROADMAP.md)
3. [../ARCHITECTURE.md](../ARCHITECTURE.md)
4. [../TRUST_AND_PERMISSIONS.md](../TRUST_AND_PERMISSIONS.md)

---

## 2) How to Use These Docs (No Repetition Rule)

To avoid repeated instructions across files:
- Global engineering rules live in [CONVENTIONS.md](CONVENTIONS.md)
- Skills discovery/install behavior lives in [../AGENT_SKILLS.md](../AGENT_SKILLS.md)
- Feature-specific scope lives in [../features/README.md](../features/README.md) + one feature file

Agents should reference, not copy, shared rules.

---

## 3) Multi-Agent Parallel Workflow

When multiple coding agents run in parallel:

1. Assign each agent one feature doc from [../features/README.md](../features/README.md)
2. Each agent changes only files listed in its feature doc’s ownership section
3. Shared files (config, interfaces, common modules) require contract-first updates
4. Agents must not silently change another feature’s API contract
5. Merge order should follow dependency order from features index

---

## 4) Agent Execution Checklist

For any task:
1. Read this file (`AGENT.md`)
2. Read [CONVENTIONS.md](CONVENTIONS.md)
3. Read assigned feature file in [../features](../features)
4. Implement only in-scope items
5. Add/update tests for touched behavior
6. Validate acceptance criteria from assigned feature doc
7. Document any contract changes and migration notes

---

## 5) Feature Routing

If user says:
- “Build Telegram chat” → [../features/FEATURE_TELEGRAM_CHAT.md](../features/FEATURE_TELEGRAM_CHAT.md)
- “Build planning/tool loop” → [../features/FEATURE_LLM_ORCHESTRATION.md](../features/FEATURE_LLM_ORCHESTRATION.md)
- “Add approvals/policies” → [../features/FEATURE_POLICY_APPROVAL.md](../features/FEATURE_POLICY_APPROVAL.md)
- “Add AWS read ops” → [../features/FEATURE_AWS_READ_CORE.md](../features/FEATURE_AWS_READ_CORE.md)
- “Add audit/telemetry” → [../features/FEATURE_AUDIT_OBSERVABILITY.md](../features/FEATURE_AUDIT_OBSERVABILITY.md)

---

## 6) Done Criteria for Any Agent PR

A task is complete only if:
- In-scope acceptance criteria are met
- Out-of-scope boundaries are respected
- Tests pass for touched modules
- Security/permission rules are followed
- Developer notes include what changed + open follow-ups

If blocked, agent must report:
- Exact blocker
- Which contract/file is impacted
- Smallest unblocking decision needed
