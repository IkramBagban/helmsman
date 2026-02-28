# Feature Spec — LLM Orchestration Core

## Goal

Build the central request loop that turns normalized chat input into safe, structured agent output.

---

## Scope (In)

- Intent classification (query/action/debug/explain)
- Context loading (conversation + user + environment)
- Plan generation for action intents
- Tool-call loop orchestration contract (without full tool catalog)
- Structured response formatting for transport adapters

## Out of Scope

- Provider-specific deep tuning/fine-tuning
- Full autonomous write execution without policy gate
- Long-term memory beyond MVP context needs

---

## Owned Areas

- Orchestration service/module
- Prompt policy and response schema handling
- Function/tool call dispatcher interfaces

---

## Contracts

### Inbound
- normalized message payload (from transport)

### Outbound
- `status` (`ok` | `needs_approval` | `needs_clarification` | `error`)
- `response_text`
- `plan` (optional structured steps)
- `tool_requests` (optional)
- `trace` metadata

---

## Functional Requirements

1. Classify intent using deterministic schema
2. For query intents, return direct answer path
3. For action intents, return structured plan (no unsafe direct execution)
4. Enforce max iteration/tool loop guardrails
5. Return machine-readable status for transport and policy modules

---

## Non-Functional Requirements

- Deterministic schema parsing
- Timeout and retry controls around model calls
- Token/cost-aware prompt composition

---

## Acceptance Criteria

- Same input shape always yields schema-valid output shape
- Action intent returns plan rather than direct write execution
- Invalid model output is sanitized and recovered gracefully

---

## Test Plan

- Unit: intent router, schema parser, status mapping
- Integration: transport stub → orchestration → policy stub
- Failure: malformed model output, timeout, tool loop overflow

---

## Handoff Notes

- Policy feature consumes `needs_approval` + `plan`
- AWS read feature plugs tools into dispatcher contract
