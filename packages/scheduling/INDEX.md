# scheduling

Cron job scheduling system. Lets users create, manage, and run scheduled tasks via the agent.

## Responsibility
Manages the full lifecycle of scheduled jobs: creation, storage, execution, status tracking, and agent-facing tools.

## Key Files
```
src/
  engine.ts     ← Core cron engine: registers jobs, ticks, fires them on schedule
  service.ts    ← CRUD service: create/update/delete/list scheduled jobs
  store.ts      ← Job persistence (file-based or DB-backed)
  tools.ts      ← Agent-facing scheduling tools (schedule_create, schedule_list, etc.)
  types.ts      ← ScheduledJob, JobStatus, CronExpression types
  risk.ts       ← Risk assessment for scheduled destructive actions
  sender.ts     ← Sends job results/notifications back to the user
```

## Exports
- `schedulingTools` — tools to register with the agent
- `SchedulingEngine` — core engine class
- `SchedulingService` — service for managing jobs

## Dependencies
`@helmsman/shared`, `@helmsman/audit`, `@helmsman/transport`
