# Scheduling Foundation (JSON-first, DB-ready)

Status: Planned
Owner: API + Agent-Core + Worker
Start date: 2026-03-04
Last updated: 2026-03-04
Scope: Add natural-language scheduling with safe confirmation, BullMQ execution, JSON persistence for v1, and clean migration path to PostgreSQL.
Dependencies: `apps/api`, `packages/agent-core`, Redis/BullMQ runtime, Telegram sender
Risks: time ambiguity, timezone errors, silent failures, duplicate execution, expired credentials
Success criteria: users can create/list/pause/resume/update/cancel schedules reliably with execution history and failure notifications

---

## Context

Helmsman can execute one-off actions, but users also need delayed and recurring automation from natural language (for example: bills, cert checks, URL health checks, reminders).

Current constraint: no database package in runtime path yet. V1 persistence must use JSON files safely while keeping interfaces DB-compatible.

---

## Goals

1. Parse user scheduling requests from natural language into structured schedule intent.
2. Confirm interpretation before creating schedules (especially when ambiguous).
3. Execute schedules via BullMQ worker with idempotency and retry/failure controls.
4. Support full schedule lifecycle commands: list, pause, resume, update, cancel, cancel-all.
5. Keep storage and service contracts migration-ready for future PostgreSQL.

---

## Non-Goals (V1)

1. Calendar UI or dashboard management.
2. Complex holiday calendars or business-day exceptions.
3. Multi-region active-active workers.
4. Full DB migrations in this workstream.

---

## Architecture Summary

User message
→ Router classifies `schedule_action` or `schedule_manage`
→ Schedule parser produces `ScheduleIntent` (or one clarification question)
→ Confirmation message + approval token (reuse action gateway)
→ Save schedule in JSON store
→ Register delayed/repeat BullMQ job(s)
→ Worker executes action at trigger time
→ Result/failure delivered to chat + run history written

---

## Data Contracts (Storage-Agnostic)

### ScheduleIntent

- `kind`: `once` | `delay` | `recurring`
- `timezone`: IANA timezone (required for time-of-day recurring)
- `timesOfDay`: optional array for multi-fire daily schedules (e.g., 02:00, 14:00, 20:00)
- `cron`: optional normalized cron string per trigger
- `delayMs`: optional for relative schedules (after X minutes/hours)
- `actionType`: `agent_task` | `http_ping` | `reminder`
- `actionPayload`: typed payload required by action type
- `confidence`: parser confidence score
- `ambiguities`: list of unresolved fields requiring clarification

### ScheduledJob (JSON persisted)

- `id`, `name`, `ownerUserId`, `platform`, `chatId`
- `status`: `active` | `paused` | `cancelled` | `degraded`
- `timezone`, `triggers[]`, `actionType`, `actionPayload`
- `approval`: token id + approvedAt
- `failurePolicy`: max retries, consecutive failure thresholds
- `lastRunAt`, `nextRunAt`, `consecutiveFailures`
- `createdAt`, `updatedAt`

### ScheduleRun

- `id`, `scheduleId`, `plannedAt`, `startedAt`, `finishedAt`
- `status`: `success` | `failed` | `skipped_idempotent`
- `idempotencyKey` (`scheduleId + plannedAt`)
- `resultSummary`, `errorSummary`

---

## JSON Persistence Design (V1)

Files:

- `apps/api/data/schedules.json` (source of truth for schedules)
- `apps/api/data/schedule-runs.json` (latest runs; bounded retention)
- `apps/api/data/schedule-events.log` (append-only audit trail)

Rules:

1. All writes use atomic temp-file + rename.
2. In-process mutex for writes; reject concurrent mutation collisions.
3. Startup validation and repair mode for malformed JSON.
4. Keep repository-style interface so backend can switch to DB later without API changes.

---

## Execution Model (BullMQ Worker)

1. API process only creates/updates schedules and queues trigger jobs.
2. Worker process executes job handlers.
3. Job idempotency check before execution.
4. Fetch credentials at runtime (never snapshot secrets in queue payload).
5. Retry with exponential backoff and capped attempts.
6. On repeated failures, notify user and auto-mark schedule as `degraded` (or `paused` after threshold).

---

## Ambiguity & Confirmation Policy

1. If parser confidence is low or key fields missing, ask exactly one concise clarification question.
2. Always echo interpreted schedule before save:
   - schedule type
   - timezone
   - next run time
   - action summary
3. Require explicit approval token for significant/destructive scheduled actions.
4. For read-only reminders or low-risk notifications, allow streamlined confirmation.

---

## User Commands (Must Support)

1. `what schedules do I have` → list active jobs + next run + timezone + status
2. `pause <schedule>` / `resume <schedule>`
3. `cancel <schedule>` / `cancel all schedules` (confirmation required)
4. `change <schedule> to 9am` (update triggers + re-register jobs)
5. `show schedule history <schedule>`

---

## Risks and Mitigations

1. Timezone and DST errors
   - Mitigation: IANA timezone required/stored, timezone-aware next-run computation.
2. Silent failures
   - Mitigation: run history + user notifications + degraded status.
3. Duplicate execution
   - Mitigation: idempotency key + worker-side locking + dedupe checks.
4. Credential expiry
   - Mitigation: runtime credential fetch + actionable failure message.
5. Job sprawl/abuse
   - Mitigation: per-user schedule limits, min interval, URL policy, rate limits.

---

## Implementation Phases

### Phase 1 — Contracts + JSON Store

1. Add schedule domain types and Zod schemas in `packages/shared`.
2. Add `ScheduleRepository` interface and JSON file implementation in API.
3. Add startup validation for JSON files and repair-safe fallback.

### Phase 2 — Router + Parser + Confirmation

1. Extend intent routing for `schedule_action` and `schedule_manage`.
2. Add schedule parser in `packages/agent-core` producing `ScheduleIntent`.
3. Add ambiguity prompts + interpretation confirmation + approval token linkage.

### Phase 3 — BullMQ Integration + Worker

1. Create `apps/worker` process for schedule execution.
2. Register delayed/repeat jobs from schedule definitions.
3. Execute `agent_task` / `http_ping` / `reminder` handlers.
4. Record `ScheduleRun` and deliver chat notifications.

### Phase 4 — Lifecycle Management + Hardening

1. Implement list/pause/resume/update/cancel command handling.
2. Add idempotency safeguards and run dedupe.
3. Add failure escalation policies (3 fails notify, 5 fails pause).
4. Add end-to-end tests for parsing, scheduling, and execution recovery.

### Phase 5 — DB Migration Preparation (No Runtime Switch Yet)

1. Keep repository methods stable across storage backends.
2. Define future DB schema mapping from JSON structures.
3. Add migration notes and cutover checklist.

---

## Acceptance Criteria

- [ ] User can schedule delayed and recurring jobs from natural language.
- [ ] Ambiguous schedules always trigger clarification before creation.
- [ ] User can list/pause/resume/update/cancel schedules by chat command.
- [ ] Schedule runs are idempotent and logged with visible history.
- [ ] Failures generate user notifications and escalation after repeated errors.
- [ ] JSON store survives restart and reloads active schedules correctly.
- [ ] Architecture can move to DB backend without changing external API contracts.

---

## Execution Log

- 2026-03-04 UTC Plan created.

---

## Open Questions

1. Should low-risk read-only schedules require `/approve` or only one-shot confirmation text?
2. What default timezone should be used when user profile has none (UTC vs inferred from platform metadata)?
3. Should `cancel all schedules` require commander-level confirmation?
4. What retention window should be used for `schedule-runs.json` in v1?
