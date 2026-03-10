dedup keys and capability/approval records
# Architecture (Current Runtime)

Snapshot date: March 10, 2026 (UTC)

## End To End Flow

```mermaid
flowchart TD
        TG[Telegram] -->|Webhook| API[apps/api Express]
        API --> SEC[Secret header check]
        SEC --> DEDUP[Dedup store check]
        DEDUP --> CMD{Slash command?}
        CMD -->|yes| C1[/start,/help,/activate,/approve,/confirm handlers]
        CMD -->|no| PARSE[parseTelegramUpdate]
        PARSE --> ORCH[HelmsmanOrchestrator.handleMessage]

        ORCH --> PI[Prompt injection regex check]
        PI --> ROUTER[Router agent classify intent]
        ROUTER --> CHAT[chat]
        ROUTER --> QUERY[query]
        ROUTER --> SA[single_action]
        ROUTER --> MS[multi_step]

        CHAT --> DEVOPS[DevOps agent]
        QUERY --> DEVOPS
        SA --> PLAN1[Planner agent]
        PLAN1 --> GATE[runWithApproval if risky]
        SA --> DEVOPS
        MS --> PLAN2[Planner agent]
        PLAN2 --> GATE
        MS --> DEVOPS

        DEVOPS --> TOOLS[Mastra tools]
        TOOLS --> SHELL[shell_execute]
        TOOLS --> GH[github_* tools optional]
        TOOLS --> RT[devops_* runtime tools optional]
        TOOLS --> AWSK[aws_knowledge_lookup optional]

        GATE --> CONF[/approve or /confirm path]
        CONF --> EXEC[Direct shell execution for approved command]
        EXEC --> RESP[Responder agent format]
        DEVOPS --> RESP
        RESP --> SEND[Telegram sender]
```

## Application Components

### 1. API Layer (`apps/api`)

- `createApp(...)` wires middleware, health route, and Telegram webhook.
- If `REDIS_URL` exists, API uses Redis dedup and Redis capability store.
- Without Redis, API runs with in-memory dedup and capability state.
- Webhook route converts Express request to Fetch `Request` and delegates to Telegram webhook handler.
- Error middleware returns `200 {ok:true}` for webhook failures to reduce Telegram retry storms.

### 2. Transport Layer (`apps/api/src/routes/telegram.ts`)

- Validates `x-telegram-bot-api-secret-token`.
- Deduplicates by Telegram `update_id`.
- Handles command-mode paths before agent path.
- Creates orchestrator through `createHelmsman(...)` with model and optional tool integrations.
- Maintains typing heartbeat while processing.
- Sends final response with Telegram-safe formatting and Telegram-only truncation safeguards.

### 3. Agent Layer (`packages/agent-core`)

- `createHelmsman(...)` builds and wires:
    - router, devops, planner, responder, plus tool registry.
- `HelmsmanOrchestrator` is primary control plane.
- Response shortening in orchestrator is platform-aware (Telegram only, boundary-aware cut + continuation hint).
- In-memory conversation context map keeps recent chat turns.
- For risky actions, orchestrator uses capability store and pending action flow.
- `resumePendingAction(...)` executes approved command directly through `ShellExecuteTool`.

### 4. Tool Layer

- Core shell tool from `@helmsman/tools` enforces command safety and risk classification.
- GitHub and DevOps runtime tools are adapted into Mastra tools by wrappers.
- Tool wrappers log traces and normalize errors for agent consumption.
- AWS tools implemented but not wired into main orchestrator path.

### 5. Runtime Execution Layer (`packages/tools-devops-runtime`)

- Docker orchestrator creates per-task volume and network mode.
- Credentials are injected per task and cleaned on teardown.
- Stdout/stderr are redacted before returning.
- Container, volume, and network are removed in finally block.

## Control Points And Decision Logic

| Decision point | Current behavior |
| --- | --- |
| Intent routing | Structured output from router agent decides 4 intent classes |
| Risk gate | Planner step risk and shell classifier trigger approval/capability flow |
| Tool availability | Conditional by env/config (GitHub token, AWS MCP URL, runtime load success) |
| Persistence mode | Redis if configured, otherwise in-memory |
| Final response path | Responder formatting for approval execution; direct agent text for standard runs |

## State Topology

- In-memory:
    - conversation history, pending activation continuations, default capability store, default dedup store
- Redis optional:
    - dedup keys and capability/approval records
- Persistent DB model in runtime:
    - not present in active execution path

## Reliability Behavior In Code

- Orchestrator catches top-level failures and returns safe generic error.
- Tool calls and agent actions emit trace logs to file logger and console.
- Telegram sender splits large messages and handles API method failures per request.
- DevOps container tasks enforce timeout and hard cleanup on completion/failure.

## Source Files Consulted

- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/routes/telegram.ts`
- `apps/api/src/middleware/*`
- `apps/api/src/telegram/*`
- `packages/agent-core/src/mastra.ts`
- `packages/agent-core/src/orchestrator.ts`
- `packages/agent-core/src/agents/*`
- `packages/agent-core/src/tools/*`
- `packages/agent-core/src/workflows/infra-workflow.ts`
- `packages/tools-devops-runtime/src/orchestrator/*`
