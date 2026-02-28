# Feature Spec — Telegram Chat Interface

## Goal

Users can chat with Helmsman in Telegram and receive reliable LLM responses in the same conversation.

This is the first end-user interaction surface for MVP.

---

## Scope (In)

- Telegram bot webhook endpoint
- Message ingestion + normalization
- Correlation of chat/thread/user context
- Send message to orchestration service
- Return model response back to Telegram chat
- Basic error handling + user-friendly failures

## Out of Scope (for this feature)

- Slack integration
- Advanced approval UX/buttons
- Full multi-step execution engine
- Rich media attachments beyond plain text

---

## Owned Areas

Agent working this feature should primarily change:
- Transport layer for Telegram
- Webhook validation and message mapping
- Telegram response delivery adapter

Avoid deep changes in policy/tool modules unless contract changes are approved.

---

## Contracts

### Input contract to orchestration

Normalized payload fields:
- `platform` (`telegram`)
- `chat_id`
- `message_id`
- `user_id`
- `text`
- `timestamp`
- `correlation_id`

### Output contract from orchestration

- `response_text`
- `status` (`ok` | `error` | `needs_clarification`)
- `metadata` (optional trace info)

---

## Functional Requirements

1. Webhook receives Telegram updates and verifies authenticity
2. Duplicate update IDs are safely ignored
3. Non-text messages return graceful guidance message
4. Text messages are normalized and forwarded to orchestration
5. Orchestration result is posted back to same chat
6. Timeout/failure path returns fallback message

---

## Non-Functional Requirements

- Low-latency acknowledgment path
- Structured logs with correlation IDs
- Resilient retry behavior for transient Telegram API failures

---

## Acceptance Criteria

- A Telegram user sends a text message and receives model response in same chat
- Duplicate webhook deliveries do not duplicate replies
- Invalid payloads do not crash service
- Error paths produce user-safe response

---

## Test Plan

- Unit: payload normalization, dedupe, error mapping
- Integration: webhook → orchestration stub → Telegram send
- Failure: orchestration timeout and Telegram send failure

---

## Handoff Notes for Next Features

- Expose stable normalized message schema for policy/orchestration modules
- Emit correlation IDs for audit feature consumption
