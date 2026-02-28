# Feature: Audit & Observability

> **Package:** `packages/audit`
> **Wave:** 1 (no internal dependencies except `@helmsman/shared`)
> **Estimated effort:** 2 days

---

## Purpose

Provide structured logging, audit event emission, and correlation context propagation for the entire application. Every package imports `@helmsman/audit` for consistent, traceable logging. Every significant action is recorded as an immutable audit event.

---

## Requirements

### Must Have
- [ ] `createLogger(component)` — returns a structured JSON logger (pino) scoped to a component
- [ ] `emitAuditEvent(event)` — persist an audit event to the database
- [ ] `correlationContext` — async-local storage for correlation IDs (propagated through the request lifecycle)
- [ ] Log levels: debug, info, warn, error
- [ ] Every log line includes: `correlationId`, `component`, `timestamp`
- [ ] Audit events for: message received, intent classified, plan created, plan approved/rejected, tool executed, plan completed/failed
- [ ] Structured JSON output (for log aggregation tools like Datadog, CloudWatch Logs, etc.)
- [ ] No sensitive data in logs (credentials, tokens, API keys automatically filtered)

### Nice to Have
- [ ] Request duration tracking (start/end timing)
- [ ] Log sampling for high-volume debug logs in production
- [ ] Pretty-print logs in development (human-readable format)
- [ ] OpenTelemetry-compatible trace IDs

### Out of Scope
- Log storage/shipping (that's infrastructure, not application code)
- Dashboard or UI for viewing audit events
- Real-time alerting

---

## Contracts

### Logger Interface

```typescript
export interface Logger {
  debug(obj: LogContext, msg: string): void;
  info(obj: LogContext, msg: string): void;
  warn(obj: LogContext, msg: string): void;
  error(obj: LogContext, msg: string): void;
}

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

/** Create a logger scoped to a component */
export function createLogger(component: string): Logger;
```

### Audit Event Schema

```typescript
export const AuditEventInputSchema = z.object({
  teamId: z.string(),
  userId: z.string().optional(),         // null for system events
  correlationId: z.string().uuid(),
  eventType: z.string(),                  // "message.received", "plan.approved", etc.
  severity: z.enum(["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]).default("INFO"),
  action: z.string(),                     // human-readable: "User approved EC2 stop plan"
  resource: z.string().optional(),        // target: "arn:aws:ec2:...:i-0abc123"
  planSnapshot: z.unknown().optional(),   // plan state at time of event
  result: z.unknown().optional(),         // outcome data
  metadata: z.record(z.unknown()).optional(),
});

export type AuditEventInput = z.infer<typeof AuditEventInputSchema>;

/** Emit an audit event (persists to DB) */
export function emitAuditEvent(event: AuditEventInput): Promise<void>;
```

### Correlation Context

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  correlationId: string;
  startTime: number;
  userId?: string;
  teamId?: string;
}

/** Get the current correlation context */
export function getCorrelationContext(): RequestContext | undefined;

/** Run a function with a correlation context */
export function withCorrelationContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T>;
```

---

## Standard Event Types

| Event Type | When | Severity |
|-----------|------|----------|
| `message.received` | User sends a message | INFO |
| `message.sent` | Agent sends a response | INFO |
| `intent.classified` | Intent classification completed | INFO |
| `plan.created` | Agent generates an execution plan | INFO |
| `plan.approved` | User approves a plan | INFO |
| `plan.rejected` | User rejects a plan | INFO |
| `plan.executing` | Plan execution starts | INFO |
| `plan.completed` | All plan steps succeeded | INFO |
| `plan.failed` | Plan execution failed | ERROR |
| `tool.executed` | A tool call completed | INFO |
| `tool.failed` | A tool call failed | WARN |
| `policy.evaluated` | Risk/approval decision made | INFO |
| `policy.denied` | Action denied by policy | WARN |
| `credential.accessed` | Credential decrypted for use | INFO |
| `error.unhandled` | Unexpected error caught at boundary | ERROR |

---

## File Structure

```
packages/audit/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                        # Public API: createLogger, emitAuditEvent, correlation context
    logger.ts                       # Pino logger factory
    logger.test.ts
    audit-emitter.ts                # Audit event persistence
    audit-emitter.test.ts
    correlation.ts                  # AsyncLocalStorage correlation context
    correlation.test.ts
    sensitive-filter.ts             # Strip sensitive data from log objects
    sensitive-filter.test.ts
    event-types.ts                  # Standard event type constants
```

---

## Implementation Notes

### Logger Factory (Pino)

```typescript
// src/logger.ts
import pino from "pino";
import { getCorrelationContext } from "./correlation";
import { filterSensitive } from "./sensitive-filter";

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
  serializers: {
    // Custom serializer to filter sensitive fields
    ...pino.stdSerializers,
  },
});

export function createLogger(component: string): Logger {
  const child = baseLogger.child({ component });

  const withContext = (obj: LogContext): LogContext => {
    const ctx = getCorrelationContext();
    const filtered = filterSensitive(obj);
    return {
      ...filtered,
      correlationId: obj.correlationId ?? ctx?.correlationId,
    };
  };

  return {
    debug: (obj, msg) => child.debug(withContext(obj), msg),
    info: (obj, msg) => child.info(withContext(obj), msg),
    warn: (obj, msg) => child.warn(withContext(obj), msg),
    error: (obj, msg) => child.error(withContext(obj), msg),
  };
}
```

### Sensitive Data Filter

```typescript
// src/sensitive-filter.ts
const SENSITIVE_KEYS = new Set([
  "password", "secret", "token", "apiKey", "api_key",
  "accessKeyId", "access_key_id", "secretAccessKey", "secret_access_key",
  "sessionToken", "session_token", "authorization", "cookie",
  "encryptedData", "encrypted_data", "privateKey", "private_key",
]);

export function filterSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = filterSensitive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

### Correlation Context (AsyncLocalStorage)

```typescript
// src/correlation.ts
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<RequestContext>();

export interface RequestContext {
  correlationId: string;
  startTime: number;
  userId?: string;
  teamId?: string;
}

export function getCorrelationContext(): RequestContext | undefined {
  return storage.getStore();
}

export function withCorrelationContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(context, fn);
}
```

### Audit Emitter

```typescript
// src/audit-emitter.ts
import { createLogger } from "./logger";

const logger = createLogger("audit");

// In MVP, audit events are logged AND persisted to DB
// The DB persistence is delegated to @helmsman/db
// This module provides the formatting and validation layer

export async function emitAuditEvent(event: AuditEventInput): Promise<void> {
  const parsed = AuditEventInputSchema.parse(event);

  // 1. Log the event (always, even if DB write fails)
  logger.info(
    {
      correlationId: parsed.correlationId,
      eventType: parsed.eventType,
      action: parsed.action,
      resource: parsed.resource,
      severity: parsed.severity,
    },
    `audit: ${parsed.action}`,
  );

  // 2. Persist to DB (fire-and-forget with error logging)
  try {
    // Dynamic import to avoid circular dependency with @helmsman/db
    const { createAuditEvent } = await import("@helmsman/db");
    await createAuditEvent(parsed);
  } catch (err) {
    logger.error({ err, event: parsed }, "failed to persist audit event");
    // Never throw on audit failure — the operation should continue
  }
}
```

---

## Usage Examples

### In Telegram Gateway
```typescript
import { createLogger, withCorrelationContext } from "@helmsman/audit";

const logger = createLogger("telegram-gateway");

app.post("/webhook/telegram", async (c) => {
  const correlationId = crypto.randomUUID();

  return withCorrelationContext({ correlationId, startTime: Date.now() }, async () => {
    logger.info({ updateId: update.update_id }, "webhook received");
    // ... process message
    logger.info({ durationMs: Date.now() - startTime }, "webhook processed");
  });
});
```

### In Agent Core
```typescript
import { createLogger, emitAuditEvent } from "@helmsman/audit";

const logger = createLogger("agent-core");

// After plan approval
await emitAuditEvent({
  teamId: context.teamId,
  userId: context.userId,
  correlationId: context.correlationId,
  eventType: "plan.approved",
  action: `User approved plan: ${plan.summary}`,
  resource: plan.steps[0]?.params.instanceId,
  planSnapshot: plan,
});
```

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `logger.test.ts` | createLogger returns logger with all 4 methods |
| `logger.test.ts` | Log output includes component and correlationId |
| `sensitive-filter.test.ts` | Filters `password`, `apiKey`, `secretAccessKey` |
| `sensitive-filter.test.ts` | Recursively filters nested objects |
| `sensitive-filter.test.ts` | Does not filter non-sensitive keys |
| `correlation.test.ts` | withCorrelationContext sets context visible to getCorrelationContext |
| `correlation.test.ts` | Nested contexts don't leak |
| `correlation.test.ts` | Context is undefined outside run |
| `audit-emitter.test.ts` | emitAuditEvent validates input with Zod |
| `audit-emitter.test.ts` | Invalid event throws validation error |
| `audit-emitter.test.ts` | DB failure doesn't throw (logs error instead) |

---

## Acceptance Criteria

1. `createLogger("telegram")` produces logs with `{"component":"telegram","correlationId":"..."}` in JSON
2. Log output in development is pretty-printed (human-readable)
3. Sensitive keys (`password`, `token`, `secretAccessKey`, etc.) are always `[REDACTED]`
4. `withCorrelationContext` propagates correlationId through async operations
5. `emitAuditEvent` validates input, logs event, and persists to DB
6. Audit persistence failure doesn't crash the application
7. All standard event types from the table above are exported as constants
