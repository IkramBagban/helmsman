# audit

Structured logging, audit event emission, and trace/correlation context propagation.

## Responsibility
Every operation in Helmsman is logged. This package provides the logger factory, audit event emitter (persists to DB), and async correlation context.

## Key Files
```
src/
  index.ts    ← createLogger(), emitAuditEvent(), withCorrelationContext(), getCorrelationContext()
```

## Exports
- `createLogger(component)` — returns a pino logger tagged with the component name
- `emitAuditEvent(event)` — validates and persists an audit event
- `withCorrelationContext(id, fn)` — wraps async execution with a correlation ID
- `getCorrelationContext()` — retrieves the current correlation ID

## Dependencies
`@helmsman/shared`, `@helmsman/db`
