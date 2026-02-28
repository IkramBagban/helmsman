# Coding Conventions — Helmsman

> Shared rules for every agent and every package. Read once, follow always.
> This is the single source of truth for code style, patterns, and practices.

---

## TypeScript Rules

### Strictness
```jsonc
// Every package tsconfig extends this
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "exactOptionalPropertyTypes": false, // too aggressive for Prisma compatibility
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

### Types
- No `any`. Use `unknown` + type narrowing if the type is truly unknown.
- No `@ts-ignore` or `@ts-nocheck`. Fix the type error.
- Prefer `interface` for object shapes (extensible). Use `type` for unions, intersections, and mapped types.
- All exported functions must have explicit return types.
- Use `readonly` on arrays and objects that should not be mutated:
  ```typescript
  function getIds(items: readonly Item[]): readonly string[] {
    return items.map(i => i.id);
  }
  ```

### Variables & Functions
- `const` by default. `let` only when reassignment is required. Never `var`.
- Prefer `function` declarations over arrow functions for top-level exports (hoisting, stack traces).
- Use arrow functions for callbacks and inline handlers only.
- Early returns over nested conditions:
  ```typescript
  // ✅ Good
  function process(input: Input): Result {
    if (!input.valid) return Result.invalid(input);
    if (input.cached) return Result.fromCache(input);
    return Result.compute(input);
  }

  // ❌ Bad
  function process(input: Input): Result {
    if (input.valid) {
      if (!input.cached) {
        return Result.compute(input);
      } else {
        return Result.fromCache(input);
      }
    } else {
      return Result.invalid(input);
    }
  }
  ```

### Enums & Constants
- Never use TypeScript `enum`. Use `as const` objects or Zod enums:
  ```typescript
  // ✅ Good
  export const RiskTier = {
    READ_ONLY: "read_only",
    LOW_RISK: "low_risk",
    SIGNIFICANT: "significant",
    DESTRUCTIVE: "destructive",
  } as const;
  export type RiskTier = (typeof RiskTier)[keyof typeof RiskTier];

  // ✅ Also good (Zod-native)
  export const RiskTierSchema = z.enum(["read_only", "low_risk", "significant", "destructive"]);
  export type RiskTier = z.infer<typeof RiskTierSchema>;
  ```

---

## File Organization

### Naming
| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case.ts` | `intent-classifier.ts` |
| Tests | `kebab-case.test.ts` | `intent-classifier.test.ts` |
| Types/Interfaces | `PascalCase` | `ToolRequest`, `ConversationContext` |
| Functions | `camelCase` | `classifyIntent`, `buildPlan` |
| Constants | `UPPER_SNAKE_CASE` or `PascalCase` object | `MAX_RETRIES`, `RiskTier.READ_ONLY` |
| Zod schemas | `PascalCase` + `Schema` suffix | `ToolRequestSchema` |
| Env vars | `UPPER_SNAKE_CASE` | `TELEGRAM_BOT_TOKEN` |

### Package Structure
Every package follows this layout:
```
packages/example/
  package.json
  tsconfig.json
  README.md               ← required: what this package does, how to use it
  src/
    index.ts              ← barrel export (public API only)
    types.ts              ← shared types for this package
    errors.ts             ← package-specific error classes
    feature-a.ts
    feature-a.test.ts     ← colocated test
    feature-b.ts
    feature-b.test.ts
    utils/                ← internal helpers (not exported)
      helpers.ts
```

### Rules
- One concept per file. If a file exceeds 300 LOC, split it.
- Barrel exports (`index.ts`) only at package root. No nested barrels.
- Never import from another package's `src/` directly — always through the package name:
  ```typescript
  // ✅ Correct
  import { ToolRequest } from "@helmsman/tools";

  // ❌ Wrong
  import { ToolRequest } from "../../packages/tools/src/types";
  ```
- Tests are colocated, never in a separate `__tests__/` directory.

---

## Zod Patterns

### Schema Definition
```typescript
import { z } from "zod";

// Define schema
export const CreateBucketParamsSchema = z.object({
  bucketName: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  region: z.string().default("us-east-1"),
  versioning: z.boolean().default(true),
  encryption: z.enum(["AES256", "aws:kms"]).default("AES256"),
});

// Derive type
export type CreateBucketParams = z.infer<typeof CreateBucketParamsSchema>;
```

### Validation at Boundaries
```typescript
// ✅ Validate at the entry point (route handler)
app.post("/webhook/telegram", async (c) => {
  const parsed = TelegramUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "Invalid payload" }, 400);
  }
  return handleUpdate(parsed.data); // parsed.data is fully typed
});

// ❌ Never pass unvalidated data deeper into the system
app.post("/webhook/telegram", async (c) => {
  const body = await c.req.json(); // unknown shape!
  return handleUpdate(body); // danger
});
```

### Schema Location
- Schemas live in the package that owns the concept.
- `@helmsman/shared`: cross-cutting schemas (NormalizedMessage, AppError, etc.)
- `@helmsman/tools`: ToolRequest, ToolResponse schemas
- `@helmsman/db`: model-related validation schemas
- `@helmsman/policy`: RiskTier, ApprovalDecision schemas

---

## Prisma Patterns

### Client Access
```typescript
// packages/db/src/client.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

### Repository Pattern
Never use Prisma directly in route handlers. Use repository functions:
```typescript
// packages/db/src/repositories/conversation.ts
import { prisma } from "../client";

export async function getConversation(chatId: string) {
  return prisma.conversation.findUnique({
    where: { chatId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}

export async function appendMessage(conversationId: string, message: NewMessage) {
  return prisma.message.create({
    data: { conversationId, ...message },
  });
}
```

### Migrations
```bash
# Create migration after schema change
cd packages/db && bunx prisma migrate dev --name add_audit_events

# Never edit migration files after they've been applied
# Never use prisma db push in production
```

---

## Error Handling

### AppError Class
```typescript
// packages/shared/src/errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  static badRequest(code: string, message: string, context?: Record<string, unknown>) {
    return new AppError(code, message, 400, context);
  }

  static notFound(code: string, message: string, context?: Record<string, unknown>) {
    return new AppError(code, message, 404, context);
  }

  static unauthorized(code: string, message: string, context?: Record<string, unknown>) {
    return new AppError(code, message, 401, context);
  }

  static forbidden(code: string, message: string, context?: Record<string, unknown>) {
    return new AppError(code, message, 403, context);
  }
}
```

### Error Codes (Namespaced)
```typescript
// Error codes follow: PACKAGE.ENTITY.ACTION pattern
"TELEGRAM.WEBHOOK.INVALID_SIGNATURE"
"AGENT.INTENT.CLASSIFICATION_FAILED"
"TOOLS.AWS.CREDENTIALS_INVALID"
"POLICY.APPROVAL.TIMEOUT"
"DB.CONVERSATION.NOT_FOUND"
```

### Boundary Handling
```typescript
// Catch at route/handler boundary, not inside business logic
app.onError((err, c) => {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, context: err.context }, err.message);
    return c.json({ error: err.code, message: err.message }, err.statusCode);
  }
  logger.error({ err }, "unhandled error");
  return c.json({ error: "INTERNAL", message: "Something went wrong" }, 500);
});
```

---

## Testing Patterns

### Unit Tests
```typescript
// packages/agent-core/src/intent-classifier.test.ts
import { describe, it, expect } from "bun:test";
import { classifyIntent } from "./intent-classifier";

describe("classifyIntent", () => {
  it("should classify infrastructure questions as QUERY", () => {
    const result = classifyIntent("how many EC2 instances are running?");
    expect(result.type).toBe("QUERY");
  });

  it("should classify action requests as ACTION", () => {
    const result = classifyIntent("stop the staging EC2 instance");
    expect(result.type).toBe("ACTION");
  });

  it("should classify problem descriptions as DEBUG", () => {
    const result = classifyIntent("my website isn't loading");
    expect(result.type).toBe("DEBUG");
  });
});
```

### Mocking External Services
```typescript
import { describe, it, expect, mock } from "bun:test";

// Mock AWS SDK
const mockDescribeInstances = mock(() => ({
  Reservations: [{ Instances: [{ InstanceId: "i-123", State: { Name: "running" } }] }],
}));

mock.module("@aws-sdk/client-ec2", () => ({
  EC2Client: class { send = mockDescribeInstances; },
  DescribeInstancesCommand: class { constructor(public input: unknown) {} },
}));
```

### Test Naming Convention
```
describe("ModuleName or FunctionName")
  it("should [expected behavior] when [condition]")
```

---

## Logging Conventions

### Structured Logging Only
```typescript
// ✅ Good: structured with context
logger.info({ correlationId, userId, intent: "QUERY", duration: 230 }, "intent classified");

// ❌ Bad: string interpolation
logger.info(`User ${userId} intent classified as QUERY in ${duration}ms`);
```

### Log Levels
| Level | When |
|-------|------|
| `error` | Unrecoverable failure, needs attention |
| `warn` | Recoverable issue, degraded behavior |
| `info` | Key business events (request received, plan approved, tool executed) |
| `debug` | Development details (only in dev) |

### Required Fields
Every log line must include:
- `correlationId`: traces a single user request end-to-end
- `component`: which package/module (`"agent-core"`, `"telegram-gateway"`, etc.)

---

## Async Patterns

### Always Use Async/Await
```typescript
// ✅ Good
async function fetchInstances(): Promise<Instance[]> {
  const response = await ec2Client.send(new DescribeInstancesCommand({}));
  return parseInstances(response);
}

// ❌ Bad: raw promises
function fetchInstances(): Promise<Instance[]> {
  return ec2Client.send(new DescribeInstancesCommand({}))
    .then(response => parseInstances(response));
}
```

### Parallel When Independent
```typescript
// ✅ Good: independent calls in parallel
const [instances, buckets, costs] = await Promise.all([
  fetchInstances(),
  fetchBuckets(),
  fetchMonthlyCost(),
]);

// ❌ Bad: sequential when they don't depend on each other
const instances = await fetchInstances();
const buckets = await fetchBuckets();
const costs = await fetchMonthlyCost();
```

### Timeout Everything External
```typescript
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AppError("TIMEOUT", `${label} timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timeout]);
}

// Usage
const instances = await withTimeout(fetchInstances(), 10_000, "EC2.DescribeInstances");
```

---

## Git Conventions

### Branch Naming
```
feature/<package>-<short-description>
fix/<package>-<short-description>
```
Examples: `feature/agent-core-intent-classifier`, `fix/tools-aws-credential-rotation`

### Commit Messages
```
<package>: <action> <what>
```
Examples:
```
agent-core: add intent classification with Claude
tools-aws: implement EC2 describe instances
policy: add risk tier classification for write ops
db: add conversation and message models
shared: add AppError class and error codes
telegram: handle webhook verification
```

### PR Rules
- One feature per PR
- All tests passing
- No TypeScript errors
- PR description references the feature doc

---

## Import Order

Enforced by linter. When in doubt:
```typescript
// 1. Node/Bun built-ins
import { readFile } from "node:fs/promises";

// 2. External packages
import express from "express";
import { z } from "zod";

// 3. Workspace packages
import { AppError } from "@helmsman/shared";
import { prisma } from "@helmsman/db";

// 4. Local imports
import { classifyIntent } from "./intent-classifier";
import type { ConversationContext } from "./types";
```

---

## Security Conventions

- Never log secrets, tokens, or credentials. Filter them before logging.
- Never hardcode secrets. Always use environment variables.
- Never commit `.env` files. Only `.env.example` with placeholder values.
- All user input is untrusted. Validate with Zod before processing.
- All AWS calls use scoped IAM credentials (never root keys).
- Destructive operations require explicit user confirmation (never auto-approve).
- Sensitive data at rest: encrypt with envelope encryption (AES-256 + KMS).
