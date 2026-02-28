# Feature: Data Layer

> **Package:** `packages/db` + additions to `packages/shared`
> **Wave:** 1 (no internal dependencies except `@helmsman/shared`)
> **Estimated effort:** 2-3 days

---

## Purpose

Set up the Prisma schema, database client, repository functions, and shared types that all other packages depend on. This is the foundation — every feature that touches persistent data uses this package.

Full schema reference: `docs/DATA_MODEL.md`

---

## Requirements

### Must Have
- [ ] Prisma schema with all MVP models (see `docs/DATA_MODEL.md`)
- [ ] Typed Prisma client exported as `@helmsman/db`
- [ ] Repository functions for each model (no raw Prisma calls in other packages)
- [ ] Database migration scripts (initial migration)
- [ ] Seed script with test data
- [ ] Connection pooling configuration
- [ ] Shared types and Zod schemas in `@helmsman/shared`

### Nice to Have
- [ ] Soft delete support (archived flag rather than hard delete)
- [ ] Pagination helpers (cursor-based for messages, offset for admin lists)
- [ ] Transaction helpers for multi-step operations

### Out of Scope
- Admin CRUD API (Phase 2)
- Multi-tenant database isolation
- Read replicas

---

## Contracts

### Exported from `@helmsman/db`

```typescript
// Client
export { prisma } from "./client";

// Repository functions (organized by model)
export {
  // Users
  findUserByTelegramId,
  findUserById,
  createUser,
  updateUser,
} from "./repositories/user";

export {
  // Teams
  findTeamBySlug,
  findTeamById,
  getUserTeam,
} from "./repositories/team";

export {
  // Conversations
  findOrCreateConversation,
  getConversationWithHistory,
  archiveConversation,
} from "./repositories/conversation";

export {
  // Messages
  appendMessage,
  getRecentMessages,
  getMessageByPlatformId,
} from "./repositories/message";

export {
  // Plans
  createPlan,
  updatePlanStatus,
  getPendingPlan,
  getPlanWithSteps,
} from "./repositories/plan";

export {
  // Credentials
  storeCredential,
  getCredential,
  listTeamCredentials,
  rotateCredential,
} from "./repositories/credential";

export {
  // Audit
  createAuditEvent,
  getAuditLog,
  getAuditByCorrelation,
} from "./repositories/audit";

export {
  // Tool Executions
  logToolExecution,
  getToolExecutionsByCorrelation,
} from "./repositories/tool-execution";
```

### Exported from `@helmsman/shared` (Types for Other Packages)

```typescript
// Shared enums (also used in Prisma schema)
export type UserRole = "VIEWER" | "OPERATOR" | "ADMIN";
export type Platform = "TELEGRAM" | "SLACK";
export type RiskTier = "read_only" | "low_risk" | "significant" | "destructive";
export type PlanStatus = "PENDING" | "APPROVED" | "EXECUTING" | "COMPLETED" | "FAILED" | "REJECTED" | "CANCELLED";
export type MessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
export type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";

// Cross-cutting types
export interface NormalizedMessage { ... }  // defined in features/README.md
export interface AgentResponse { ... }
export interface PlanSummary { ... }

// Shared error class
export class AppError extends Error { ... }

// Shared Zod schemas
export { NormalizedMessageSchema, AgentResponseSchema } from "./schemas";

// Utility types
export type { Pagination, PaginatedResult } from "./pagination";
```

---

## File Structure

### packages/db
```
packages/db/
  package.json
  tsconfig.json
  README.md
  prisma/
    schema.prisma                   # Full Prisma schema (from docs/DATA_MODEL.md)
    migrations/                     # Generated migration files
    seed.ts                         # Seed script
  src/
    index.ts                        # Barrel export
    client.ts                       # Prisma client singleton
    repositories/
      user.ts                       # User repository functions
      user.test.ts
      team.ts
      team.test.ts
      conversation.ts
      conversation.test.ts
      message.ts
      message.test.ts
      plan.ts
      plan.test.ts
      credential.ts
      credential.test.ts
      audit.ts
      audit.test.ts
      tool-execution.ts
      tool-execution.test.ts
    utils/
      pagination.ts                 # Cursor/offset pagination helpers
      encryption.ts                 # Credential encryption/decryption
      encryption.test.ts
```

### packages/shared (additions)
```
packages/shared/
  src/
    index.ts                        # Barrel export
    types.ts                        # NormalizedMessage, AgentResponse, etc.
    errors.ts                       # AppError class
    schemas.ts                      # Shared Zod schemas
    constants.ts                    # App-wide constants
    env.ts                          # Environment variable validation
    utils/
      correlation-id.ts             # Generate/parse correlation IDs
      datetime.ts                   # Date formatting utilities
```

---

## Key Repository Functions

### Conversation Repository
```typescript
// packages/db/src/repositories/conversation.ts

/** Find or create a conversation for a chat */
export async function findOrCreateConversation(
  platform: Platform,
  platformChatId: string,
  userId: string,
): Promise<Conversation> {
  return prisma.conversation.upsert({
    where: { platform_platformChatId: { platform, platformChatId } },
    update: { updatedAt: new Date() },
    create: { platform, platformChatId, userId },
  });
}

/** Get conversation with recent message history */
export async function getConversationWithHistory(
  conversationId: string,
  messageLimit: number = 50,
): Promise<ConversationWithHistory | null> {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: messageLimit,
      },
      plans: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}
```

### Credential Repository (Encrypted)
```typescript
// packages/db/src/repositories/credential.ts
import { encrypt, decrypt } from "../utils/encryption";

/** Store an encrypted credential */
export async function storeCredential(
  teamId: string,
  provider: Provider,
  label: string,
  rawData: Record<string, string>,
): Promise<Credential> {
  const { encrypted, iv, authTag } = encrypt(
    JSON.stringify(rawData),
    process.env.ENCRYPTION_KEY!,
  );

  return prisma.credential.upsert({
    where: { teamId_provider_label: { teamId, provider, label } },
    update: { encryptedData: encrypted, iv, authTag, updatedAt: new Date() },
    create: { teamId, provider, label, encryptedData: encrypted, iv, authTag },
  });
}

/** Retrieve and decrypt a credential */
export async function getCredential(
  teamId: string,
  provider: Provider,
  label: string,
): Promise<Record<string, string> | null> {
  const cred = await prisma.credential.findUnique({
    where: { teamId_provider_label: { teamId, provider, label } },
  });
  if (!cred) return null;

  const decrypted = decrypt(cred.encryptedData, cred.iv, cred.authTag, process.env.ENCRYPTION_KEY!);
  return JSON.parse(decrypted);
}
```

---

## Implementation Notes

### Prisma Client Singleton
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

### Encryption (AES-256-GCM)
```typescript
// packages/db/src/utils/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

export function encrypt(plaintext: string, key: string) {
  const iv = randomBytes(IV_LENGTH);
  const keyBuffer = Buffer.from(key, "hex"); // 32 bytes = 256 bits
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return { encrypted, iv: iv.toString("hex"), authTag };
}

export function decrypt(encrypted: string, iv: string, authTag: string, key: string): string {
  const keyBuffer = Buffer.from(key, "hex");
  const decipher = createDecipheriv(ALGORITHM, keyBuffer, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

### Docker Compose (Local Postgres)

Add to project root:
```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: helmsman
      POSTGRES_PASSWORD: helmsman_dev
      POSTGRES_DB: helmsman
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### package.json
```json
{
  "name": "@helmsman/db",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "generate": "bunx prisma generate",
    "migrate": "bunx prisma migrate dev",
    "studio": "bunx prisma studio",
    "seed": "bun prisma/seed.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@helmsman/typescript-config": "workspace:*",
    "prisma": "^6.0.0"
  }
}
```

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `encryption.test.ts` | Encrypt → decrypt roundtrip produces original value |
| `encryption.test.ts` | Wrong key fails to decrypt |
| `encryption.test.ts` | Tampered ciphertext fails auth tag check |
| `user.test.ts` | Create + find user by telegramId |
| `conversation.test.ts` | findOrCreateConversation creates on first call, updates on second |
| `conversation.test.ts` | getConversationWithHistory returns messages in order |
| `message.test.ts` | appendMessage creates with correct fields |
| `message.test.ts` | getMessageByPlatformId for dedup returns existing message |
| `plan.test.ts` | createPlan with steps → getPendingPlan returns it |
| `plan.test.ts` | updatePlanStatus PENDING → APPROVED |
| `credential.test.ts` | Store → retrieve credential (encrypt/decrypt roundtrip) |
| `audit.test.ts` | createAuditEvent → getAuditByCorrelation finds it |

### Test Database
Tests use a separate test database (configured via `DATABASE_URL` in test env):
```
DATABASE_URL="postgresql://helmsman:helmsman_dev@localhost:5432/helmsman_test"
```

---

## Acceptance Criteria

1. `bunx prisma migrate dev` runs without errors on a fresh database
2. `bunx prisma generate` produces typed client
3. All repository functions work with real Postgres (test DB)
4. Credential encryption: stored data is not readable without the key
5. Conversation dedup: `findOrCreateConversation` is idempotent
6. Message history: returns last N messages in chronological order
7. Plan lifecycle: PENDING → APPROVED → EXECUTING → COMPLETED works
8. Audit events: immutable (no update/delete functions exist)
9. Seed script creates test team + user + linked membership
10. `packages/shared` exports all cross-cutting types that other packages need
