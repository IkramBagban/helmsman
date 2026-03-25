# action-gateway

Manages the approval lifecycle for agent actions. Bridges the agent's intent with user confirmation before execution.

## Responsibility
Holds pending actions, intercepts transport messages to detect approve/reject responses, and gates execution behind user consent.

## Key Files
```
src/
  capability-store.ts         ← In-memory store for pending capability approvals
  redis-capability-store.ts   ← Redis-backed persistent capability store
  request-action.ts           ← Core approval request logic
  request-action-tool.ts      ← Tool the agent calls to request user approval
  transport-interceptor.ts    ← Hooks into transport to intercept approval responses
  command-handlers.ts         ← Handles /approve and /reject commands
```

## Exports
- `requestAction(action, context)` — request approval for an action
- `CapabilityStore` — interface for approval state
- `TransportInterceptor` — intercept transport messages for approval flow

## Dependencies
`@helmsman/shared`, `@helmsman/transport`
