# Helmsman — Monorepo Map

> Quick-reference for agents and humans. Every package has an `INDEX.md` with internal context.
> Read this first for orientation. Then read the relevant `INDEX.md` before touching any package.

---

## Root

```
AGENTS.md                       ← Single entrypoint for all AI coding agents (read this first)
SOUL.md                         ← Product soul / values
apps/
packages/
```

---

## apps/

```
apps/
  api/                      ← Express HTTP server: Telegram webhook + agent HTTP API
    src/
      app.ts                ← Express app setup, middleware registration
      config.ts             ← Validated env config (Zod)
      index.ts              ← Server entry point
      routes/               ← Route handlers (webhook, agent, health)
      middleware/           ← Auth, error handling, logging middleware
      services/             ← App-level service wiring
      transports/           ← Transport adapters (Telegram bot setup)

  web/                      ← Next.js dashboard 
  docs/                     ← All project documentation (you are here)
    MAP.md                  ← This file
    README.md               ← Documentation index
    ARCHITECTURE.md         ← System design and data flow
    CONVENTIONS.md          ← Coding patterns and standards
    DATA_MODEL.md           ← Prisma schema and model reference
    AGENT_DESIGN.md         ← Agent reasoning loop and LLM orchestration
    PRD.md                  ← Product requirements
    TRUST_AND_PERMISSIONS.md← Security model and approval gates
    features/               ← Active feature specifications
    guides/                 ← Deep-dive engineering guides
    archive/                ← Legacy docs, research notes, old plans
```

---

## packages/

```
agent-core/                     ← LLM orchestration: intent → plan → execute loop
action-gateway/                 ← Approval flow: pending actions, capability store, user confirmation
audit/                          ← Structured logging, audit events, trace context
dns/                            ← DNS management tools (Cloudflare provider)
policy/                         ← Risk tiers, approval gates, permission checks
scheduling/                     ← Cron job scheduling: create, run, manage scheduled tasks
shared/                         ← Shared types, Zod schemas, errors, constants, utils
tools/                          ← Base ToolInterface and shell execution sandbox
tools-aws/                      ← AWS tool implementations (EC2, S3, CloudWatch, Cost)
tools-devops-runtime/           ← DevOps runtime tools (Docker, K8s, Git, SSH)
tools-github/                   ← GitHub tool implementations (repos, PRs, issues)
transport/                      ← Chat transport abstraction (Telegram adapter)
eslint-config/                  ← Shared ESLint config for the monorepo
typescript-config/              ← Shared tsconfig bases for the monorepo
ui/                             ← Shared UI components (web dashboard)
```
