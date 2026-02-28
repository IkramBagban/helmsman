# Tech Stack & Decisions — Helmsman

> This document explains every technology choice and why. Read when choosing a library or questioning a pattern.

---

## Core Principles

1. **Fewer dependencies, better.** Every package must justify its inclusion.
2. **Type safety everywhere.** No `any`, no unvalidated input, no untyped boundaries.
3. **Bun-native.** Use Bun's built-in APIs before reaching for npm packages.
4. **Monorepo-first.** Share types and contracts via workspace packages, not copy-paste.

---

## Runtime & Build

| Tool | Version | Why |
|------|---------|-----|
| **Bun** | 1.2+ | Runtime + package manager + bundler + test runner. Fastest TS execution, native SQLite, built-in `.env` loading. Replaces Node + npm + Jest + esbuild. |
| **TypeScript** | 5.9+ | Strict mode. Target: `ESNext`. Module: `ESNext`. |
| **Turborepo** | 2.8+ | Monorepo task orchestration. Caches builds, parallelizes across packages. No Nx (too heavy for this project size). |

### Why Bun over Node?
- 3-5x faster startup, faster `bun install`, built-in TypeScript execution
- Built-in test runner (no Vitest/Jest dependency)
- Native `.env` file loading
- Smaller container images (no separate Node install)
- Bun.serve() for HTTP if we ever need to bypass Express

---

## API & HTTP

| Tool | Why |
|------|-----|
| **Express** | Most mature Node.js web framework. Massive middleware ecosystem. Battle-tested. Works with Bun out of the box. |

### Why Express?
- Huge ecosystem of middleware (auth, CORS, rate limiting, etc.)
- Battle-tested in production at every scale
- Familiar to most TypeScript/Node developers
- Works seamlessly on Bun with no changes
- Use `@types/express` for full TypeScript support

### Why Express over Hono/Elysia/Fastify?
- **vs Hono:** Express has 10x the ecosystem; Hono's edge-runtime focus isn't needed here
- **vs Elysia:** Elysia is Bun-only, smaller community, less stable
- **vs Fastify:** Fastify's plugin system adds unnecessary complexity; Express middleware is simpler

### API Pattern
```typescript
// apps/api/src/routes/telegram.ts
import express from "express";
import { TelegramUpdateSchema } from "@helmsman/shared";

const router = express.Router();

router.post("/webhook/telegram", async (req, res) => {
  const parsed = TelegramUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(200).json({ ok: false });
  const update = parsed.data;
  // → normalize → agent-core → respond
  res.status(200).json({ ok: true });
});
```

---

## Validation

| Tool | Why |
|------|-----|
| **Zod** | Runtime schema validation + TypeScript type inference. Single source of truth for all data shapes. |

### Rules
- Every HTTP request body: Zod-validated at the route level
- Every environment variable: Zod-validated at startup (`EnvSchema.parse(process.env)`)
- Every webhook payload: Zod-validated before processing
- Every tool parameter: Zod schema defines what the tool accepts
- Derive TS types from schemas: `type Foo = z.infer<typeof FooSchema>`

---

## Database

| Tool | Why |
|------|-----|
| **PostgreSQL** | Battle-tested relational DB. JSONB for flexible metadata. Full-text search. Excellent with Prisma. |
| **Prisma** | Schema-first ORM. Auto-generated typed client. Migrations. Studio for debugging. Best DX for TypeScript + Postgres. |

### Why Prisma over Drizzle/Kysely?
- Schema-first design matches our approach (design data model → generate client)
- Better migration tooling (Prisma Migrate)
- Prisma Studio for visual debugging
- Larger ecosystem for Postgres-specific features
- Trade-off: slightly slower at runtime than Drizzle, but DX and safety win for our scale

### Database Hosting (MVP)
- **Development:** Local Postgres via Docker (`docker compose up db`)
- **Production:** Supabase (managed Postgres) or Railway
- Connection pooling via Prisma's built-in connection pool (PgBouncer for production later)

---

## LLM / AI

| Tool | Why |
|------|-----|
| **Anthropic Claude** (primary) | Best reasoning for complex multi-step tasks. Tool use (function calling) is reliable. Strong instruction following. |
| **OpenAI GPT** (fallback) | Fallback provider. Good for simpler queries. Wider model selection. |
| **Google Gemini** (optional) | Large context window. Good for analysis tasks. |
| **Custom LLM Provider** | Thin abstraction (~100 LOC) over provider SDKs. No framework. |

### Why Custom LLM Layer (No Vercel AI SDK, No LangChain)?

We write our own thin provider abstraction instead of using any LLM framework. Reasons:

1. **Full control over each provider's native SDK** — when Anthropic ships extended thinking or a new tool calling mode, we use it the next day. No waiting for a framework to catch up.
2. **Proper TypeScript types** — LangChain JS is notoriously poorly typed. Our strict `no any` policy requires clean types from each SDK directly.
3. **No abstraction tax** — LLM framework abstractions paper over real provider differences (tool calling behavior, stop reasons, streaming formats). We handle those explicitly.
4. **Debuggability** — when something breaks, you debug your 100-line adapter, not a framework's internals.
5. **OpenClaw made the same call** — built their own `pi-ai` layer instead of adopting LangChain. It's a proven pattern.

### Provider Interface
```typescript
// packages/agent-core/src/llm/provider.ts

import type { ToolDefinition } from "@helmsman/tools";

export interface LLMProvider {
  chat(params: ChatRequest): Promise<ChatResponse>;
  stream(params: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: MessageParam[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: ContentBlock[];       // text + tool_use blocks
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: { inputTokens: number; outputTokens: number };
}

export interface MessageParam {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
}

// Factory
export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic": return new AnthropicProvider(config);
    case "openai":    return new OpenAIProvider(config);
    case "gemini":    return new GeminiProvider(config);
    default:          throw new AppError("LLM.UNKNOWN_PROVIDER", `Unknown provider: ${config.provider}`);
  }
}
```

### Provider Failover (Inspired by OpenClaw's Model Resolver)
```typescript
// If primary provider fails or is rate-limited, cool down and switch
export class ProviderRouter {
  private providers: { provider: LLMProvider; cooldownUntil: number }[];

  async chat(params: ChatRequest): Promise<ChatResponse> {
    for (const entry of this.providers) {
      if (Date.now() < entry.cooldownUntil) continue; // skip cooled-down providers
      try {
        return await entry.provider.chat(params);
      } catch (err) {
        if (isRateLimitError(err)) {
          entry.cooldownUntil = Date.now() + 60_000; // cool down for 60s
          continue;
        }
        throw err;
      }
    }
    throw new AppError("LLM.ALL_PROVIDERS_DOWN", "All LLM providers are unavailable");
  }
}
```

---

## Chat Transport

| Tool | Why |
|------|-----|
| **grammY** | Telegram Bot API framework. TypeScript-first. Middleware-based. Plugin ecosystem. Active maintenance. |

### Why grammY over Telegraf/node-telegram-bot-api?
- Modern TypeScript (Telegraf v4 improved but grammY was built TS-first)
- Middleware pattern familiar from Express (consistent codebase feel)
- Better plugin system (sessions, menus, conversations)
- Active development + good docs

### Phase 2: Slack
- **Bolt for JavaScript** (@slack/bolt) — Slack's official framework
- Added as a separate route in `apps/api`, same agent-core underneath

---

## AWS

| Tool | Why |
|------|-----|
| **AWS SDK v3** (@aws-sdk/*) | Modular (import only what you need). TypeScript types. Tree-shakeable. |

### Import Pattern (Modular)
```typescript
// ✅ Correct: import specific client
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";

// ❌ Wrong: never import the entire SDK
import AWS from "aws-sdk"; // v2, banned
```

---

## Logging & Observability

| Tool | Why |
|------|-----|
| **pino** | Fastest Node/Bun JSON logger. Structured logging. Low overhead. |
| **OpenTelemetry** (future) | Distributed tracing standard. Not MVP but architecture should support it. |

### Pattern
```typescript
import { createLogger } from "@helmsman/audit";

const logger = createLogger("agent-core");
logger.info({ correlationId, userId, intent }, "classified user intent");
```

---

## Testing

| Tool | Why |
|------|-----|
| **Bun test** | Built-in test runner. Jest-compatible API. fastest execution. No config needed. |

### Structure
```
packages/agent-core/
  src/
    orchestrator.ts
    orchestrator.test.ts     ← colocated
    intent-classifier.ts
    intent-classifier.test.ts
```

---

## Development Tools

| Tool | Purpose |
|------|---------|
| **Prettier** | Code formatting (already configured) |
| **ESLint** | Linting (shared config in `packages/eslint-config`) |
| **Prisma Studio** | Visual database browser |
| **Docker Compose** | Local Postgres + Redis (if needed) |

---

## Explicitly Not Using

| Tool | Why Not |
|------|---------|
| **Hono** | Edge-runtime focused, smaller ecosystem than Express, not needed here |
| **Nest.js** | Too heavy, too many abstractions and decorators for an agent app |
| **tRPC** | Overkill — our API is mostly webhook ingress + internal, not client-facing RPC |
| **Drizzle** | Good but Prisma's migration + studio tooling is better for this stage |
| **Redis** | Not needed for MVP. Bun's built-in Map + Postgres is enough. Add when session state or queues require it. |
| **Kafka/RabbitMQ** | Way too heavy. Use Postgres-backed job queue (pg-boss or BullMQ) if needed Phase 2+. |
| **Terraform/Pulumi** | Helmsman IS the infrastructure tool — it calls AWS SDK directly |
| **LangChain/LangGraph** | Too much abstraction. Poorly typed in JS. Papers over real provider differences. We don't need graph orchestration — our loop is simple. |
| **Vercel AI SDK** | Good library, but still an abstraction layer we don't need. Our agent loop is ~150 lines. Provider SDKs are excellent directly. |
| **CrewAI/AutoGen** | Multi-agent frameworks — overkill. Helmsman is one agent with tools, not a swarm. |

---

## Package Registry (npm Scope)

All internal packages use the `@helmsman/` scope:
```
@helmsman/shared
@helmsman/db
@helmsman/agent-core
@helmsman/tools
@helmsman/tools-aws
@helmsman/policy
@helmsman/audit
```

Configured in each package's `package.json`:
```json
{
  "name": "@helmsman/shared",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

---

## Environment Variables

All env vars validated at startup via Zod schema in `packages/shared/src/env.ts`:

```typescript
import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_DEFAULT_REGION: z.string().default("us-east-1"),
  ENCRYPTION_KEY: z.string().min(32),
});

export type Env = z.infer<typeof EnvSchema>;
```
