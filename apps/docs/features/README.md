# Feature Specs — Helmsman

> Index of all feature specifications. Each feature doc is self-contained and can be assigned to a separate coding agent.
> Read `AGENTS.md` first (root), then your assigned feature doc.

---

## Feature List

| Feature | Doc | Package(s) | Complexity | Owner Agent |
|---------|-----|------------|------------|-------------|
| Data Layer | [DATA_LAYER.md](./DATA_LAYER.md) | `packages/db`, `packages/shared` | Medium | Agent 1 |
| Tool System | [TOOL_SYSTEM.md](./TOOL_SYSTEM.md) | `packages/tools` | Medium | Agent 2 |
| Audit & Observability | [AUDIT_LOG.md](./AUDIT_LOG.md) | `packages/audit` | Low-Medium | Agent 3 |
| Telegram Gateway | [TELEGRAM_GATEWAY.md](./TELEGRAM_GATEWAY.md) | `apps/api` (telegram routes) | Medium | Agent 4 |
| Agent Core | [AGENT_CORE.md](./AGENT_CORE.md) | `packages/agent-core` | High | Agent 5 |
| Policy Engine | [POLICY_ENGINE.md](./POLICY_ENGINE.md) | `packages/policy` | Medium | Agent 6 |
| AWS Tools | [AWS_TOOLS.md](./AWS_TOOLS.md) | `packages/tools-aws` | Medium-High | Agent 7 |
| GitHub Intelligence | [GIT_SSH_DEVOPS_RUNTIME.md](./GIT_SSH_DEVOPS_RUNTIME.md) | `packages/tools-github` | Medium | Agent 8 |
| Git / SSH / DevOps Runtime | [GIT_SSH_DEVOPS_RUNTIME.md](./GIT_SSH_DEVOPS_RUNTIME.md) | `packages/tools-devops-runtime` | High | Agent 9 |

---

## Dependency Map

```
                    ┌──────────────┐
                    │  @helmsman/  │
                    │   shared     │ ◄── every package depends on this
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼──┐  ┌──────▼─────┐  ┌──▼──────────┐
    │  packages/ │  │ packages/  │  │  packages/  │
    │    db      │  │   tools    │  │   audit     │
    └─────┬──────┘  └──────┬─────┘  └──────┬──────┘
          │                │               │
          │         ┌──────▼─────┐  ┌──────────────────────┐  │
          │         │ packages/  │  │ packages/            │  │
          │         │ tools-aws  │  │ tools-github         │  │
          │         └────────────┘  │ tools-devops-runtime │  │
          │                         └──────────────────────┘  │
          │                                │
    ┌─────▼────────────────────────────────▼──┐
    │           packages/agent-core            │
    │  (depends on: db, tools, audit, shared)  │
    └─────────────────┬───────────────────────┘
                      │
    ┌─────────────────▼───────────────────────┐
    │           packages/policy                │
    │  (depends on: shared, db)                │
    └─────────────────┬───────────────────────┘
                      │
    ┌─────────────────▼───────────────────────┐
    │              apps/api                    │
    │  (depends on: all packages)              │
    └─────────────────────────────────────────┘
```

---

## Build Waves (Parallel Agent Scheduling)

### Wave 1 — No Internal Dependencies (Build in Parallel)

These features only depend on `@helmsman/shared` (basic types, errors, utils). All 4 can be built simultaneously.

| Feature | What It Produces | Contract Output |
|---------|-----------------|----------------|
| **Data Layer** | Prisma schema, client, repositories, seed | Typed DB client + repository functions |
| **Tool System** | `ToolInterface`, `ToolRegistry`, `ToolRequest`/`ToolResponse` types | Base tool abstraction other tools implement |
| **Audit & Observability** | Logger factory, audit event emitter, correlation context | `createLogger()`, `emitAuditEvent()` |
| **Telegram Gateway** | Webhook handler, message parser, dedup, reply sender | `NormalizedMessage` type, response delivery |

### Wave 2 — Depends on Wave 1 (Build After Wave 1 Merges)

| Feature | Dependencies | What It Produces |
|---------|-------------|-----------------|
| **Agent Core** | db (conversations), tools (registry), audit (logging) | Orchestration engine: intent → plan → execute |
| **Policy Engine** | shared (types), db (user roles, plans) | Risk classifier + approval gate |
| **AWS Tools** | tools (ToolInterface to implement) | EC2, S3, CloudWatch, Cost tools |
| **GitHub Intelligence** | tools (ToolInterface), shared | Read-only GitHub API tools |
| **Git / SSH / DevOps Runtime** | tools (ToolInterface), shared, audit | Container-isolated git + SSH execution tools |

### Wave 3 — Integration (After Wave 2)

Wire everything together in `apps/api`:
- Connect Telegram Gateway → Agent Core
- Connect Agent Core → AWS Tools (via Tool Registry)
- Connect Agent Core → Policy Engine (for approval gates)
- End-to-end integration tests

---

## Shared Contracts (Cross-Cutting Types)

These types live in `@helmsman/shared` and are used by multiple features. Any agent can add types here, but must not modify existing ones without coordination.

```typescript
// packages/shared/src/types.ts

/** A normalized message from any chat platform */
export interface NormalizedMessage {
  platform: "telegram" | "slack";
  chatId: string;
  messageId: string;
  userId: string;
  text: string;
  timestamp: Date;
  correlationId: string;
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
}

/** The agent's response to send back to the user */
export interface AgentResponse {
  text: string;
  status: "success" | "error" | "pending_approval";
  correlationId: string;
  plan?: PlanSummary;
  metadata?: Record<string, unknown>;
}

/** Summary of a plan for display to the user */
export interface PlanSummary {
  id: string;
  summary: string;
  steps: PlanStepSummary[];
  riskTier: string;
  estimatedDuration?: string;
  estimatedCost?: string;
}

export interface PlanStepSummary {
  order: number;
  description: string;
  tool: string;
  risk: string;
}
```

---

## Definition of Done (Per Feature)

- [ ] All types from the feature doc's "Contracts" section are implemented and exported
- [ ] All acceptance criteria from the feature doc are met
- [ ] Unit tests pass with > 80% coverage on business logic
- [ ] `bun test` passes in the package
- [ ] `bun run check-types` passes (no TS errors)
- [ ] Package has a `README.md` with usage examples
- [ ] No hardcoded secrets or config values
- [ ] Follows `docs/CONVENTIONS.md`
