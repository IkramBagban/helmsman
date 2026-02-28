# Feature Spec — AWS Read Core (MVP Tooling)

## Goal

Provide reliable read-only AWS capabilities for MVP query/debug flows.

---

## Scope (In)

Initial read operations:
- EC2 list/describe
- S3 list/basic metadata
- CloudWatch metrics for selected resources
- Cost summary (current month high-level)

## Out of Scope

- Broad write operations
- Full IAM mutation workflows
- Multi-cloud parity

---

## Owned Areas

- AWS read tool adapters
- Tool schema definitions
- Error normalization for orchestration

---

## Contracts

### Tool request format
- `tool`: `aws_read`
- `action`: explicit operation key
- `params`: typed object

### Tool response format
- `ok`: boolean
- `data`: compact structured payload
- `error_code` / `error_message` (if failed)

---

## Functional Requirements

1. Implement typed read operations with strict parameter validation
2. Normalize AWS SDK/service errors into stable error contract
3. Return compact data optimized for model consumption
4. Tag responses with freshness timestamps

---

## Non-Functional Requirements

- Least-privilege IAM usage
- Retry/backoff on throttling
- Region-aware execution

---

## Acceptance Criteria

- Orchestration can answer core infra inventory questions using tool responses
- Tool failures do not crash orchestration loop
- Returned data remains within token-efficient bounds

---

## Test Plan

- Unit: schema validation + response normalization
- Integration: orchestration tool-call path with mocked AWS APIs
- Failure: throttling, auth denied, resource-not-found

---

## Handoff Notes

- Keep action names stable; policy/agent prompts may reference them
- Add new read actions behind same response contract
