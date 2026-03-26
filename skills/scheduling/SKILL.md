---
name: scheduling
description: Scheduling and reminder workflow skill. Use this whenever the user asks to schedule, remind, run checks later, configure recurring tasks, or pause/resume/cancel schedules.
---

# Scheduling & Reminders

## Workflow

1. Convert natural language time to concrete scheduling fields.
2. Select action type intentionally: `reminder`, `agent_task`, or `http_ping`.
3. Set `riskHint` on all schedule creation requests.
4. For ambiguous schedule targets, list schedules before lifecycle actions.
5. For destructive recurring tasks, warn clearly and require explicit approval.
