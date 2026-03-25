# shared

Shared types, Zod schemas, error classes, constants, and utilities used across all packages.

## Responsibility
The single source of truth for cross-package contracts. No business logic — only types, schemas, and pure utilities.

## Key Files
```
src/
  index.ts        ← All exports (types, schemas, AppError, constants, utils)
  file-logger.ts  ← File-based logger utility
```

## Key Exports
- `AppError` — base error class (code, message, context)
- Common Zod schemas for external boundaries
- Shared TypeScript types and interfaces

## Rules
- Never add business logic here
- Never import from other `@helmsman/*` packages
- All exports must be re-exported from `index.ts`
