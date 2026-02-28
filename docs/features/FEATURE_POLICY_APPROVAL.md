# Feature Spec — Policy and Approval Gate

## Goal

Ensure all write/destructive actions pass risk-based authorization before execution.

---

## Scope (In)

- Action risk tiering (read/low/significant/destructive)
- Approval requirement resolution by role + environment
- Hard-confirm flow for destructive operations
- Policy decision records for audit

## Out of Scope

- Full enterprise SSO integration
- Complex multi-party UI workflows beyond text-based confirmations

---

## Owned Areas

- Policy engine
- Approval state machine
- Role/environment rule evaluation

---

## Contracts

### Input
- Proposed plan from orchestration
- User role, environment, resource metadata

### Output
- `decision` (`allow` | `require_approval` | `require_hard_confirm` | `deny`)
- `reason`
- `required_confirmation_payload` (optional)

---

## Functional Requirements

1. Classify plan steps into risk tiers
2. Enforce role-based and environment-based constraints
3. Require explicit hard-confirm token for destructive actions
4. Return clear, user-readable approval prompt text
5. Emit decision record to audit pipeline

---

## Non-Functional Requirements

- Deterministic policy evaluation
- No silent fallbacks on unknown policy state
- Safe default = deny or require explicit approval

---

## Acceptance Criteria

- Write actions never execute without required approval path
- Destructive actions never execute without hard confirmation
- Policy decisions are traceable in audit logs

---

## Test Plan

- Unit: tier classifier, rule evaluator, confirm-token validation
- Integration: orchestration plan → policy decision → execution gate stub
- Failure: missing role/env data, malformed policy config

---

## Handoff Notes

- Execution modules must consume `decision` output as hard gate
- Transport modules should render approval prompts verbatim
