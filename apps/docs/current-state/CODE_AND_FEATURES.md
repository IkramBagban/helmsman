# Code And Features (Current)

Snapshot date: March 2, 2026 (UTC)

## Repo Reality At A Glance

- Runtime and package manager: Bun (`bun@1.2.20`)
- API runtime: Express in `apps/api`
- Primary LLM integration in code: Mastra agents using Google model IDs (default `google/gemini-2.0-flash`)
- Chat transport implemented: Telegram webhook only
- Slack transport: not implemented in code paths inspected
- Root `README.md` is still Turborepo starter text and does not describe current product

## Implemented Packages And Status

| Package/App | Current status |
| --- | --- |
| `apps/api` | Implemented webhook API with Telegram route, middleware, dedup, approval/activation command handling |
| `packages/agent-core` | Implemented Mastra-based orchestrator with router/planner/devops/responder agents, approval/capability gating |
| `packages/tools` | Implemented typed tool registry + shell execution + command safety/risk classifier |
| `packages/tools-github` | Implemented 17 read-only GitHub tools and wrappers |
| `packages/tools-devops-runtime` | Implemented Docker-isolated git/ssh/shell tools and orchestrator |
| `packages/tools-aws` | Implemented basic typed AWS tool classes; currently not wired into main orchestrator path |
| `packages/policy` | Implemented simple risk policy engine; currently not wired into main orchestrator path |
| `packages/shared` | Implemented shared contracts, AppError, Telegram payload validator, file logger |
| `packages/audit` | Implemented console audit service interface; no persistent backend implementation |
| `packages/db` | Not present in repository at snapshot time |

## Current Runtime Feature Set

## 1. Telegram Intake And Response

- Route: `POST /webhook/telegram`
- Webhook secret header validated before processing.
- Update deduplication supported via in-memory or Redis store.
- Supported command shortcuts:
`/start`, `/help`, `/activate <role> <id>`, `/approve <id>`, `/confirm <target>`
- Typing indicator sent every 4 seconds while agent processes.
- Outbound messages are HTML-escaped and chunked to Telegram limit.

## 2. Agent Core Orchestration

- Message handling entrypoint:
`HelmsmanOrchestrator.handleMessage(...)`
- Intent classes used:
`chat`, `query`, `single_action`, `multi_step`
- Router uses structured output schema (Zod) for intent classification.
- Planner uses structured output schema for step plans and risk.
- DevOps agent uses native tool/function calling through Mastra tools.
- Responder agent formats raw output into Telegram-friendly responses.
- Prompt injection regex checks run before intent classification.

## 3. Tooling Model

- Always available:
`shell_execute`
- Optional when configured:
`aws_knowledge_lookup` (MCP endpoint)
- Optional when token present:
GitHub tool set (17 wrappers)
- Optional when runtime loads:
DevOps runtime tools (git/ssh/shell inside Docker)

## 4. Approval And Capability Gating

- Risky commands are gated by capability activation plus command confirmation.
- Capability roles:
`operator`, `commander`
- TTLs (in-memory defaults):
activation 5m, operator session 30m, commander session 15m, pending action 10m
- Significant flow:
`/activate operator <id>` then `/approve <code>`
- Destructive flow:
`/activate operator <id>` and `/activate commander <id>`, then `/confirm <target>`

## 5. State And Persistence Modes

- Conversation context:
in-memory per chat sliding window (8 turns in orchestrator)
- Dedup:
in-memory TTL map or Redis `SET NX`
- Capability/approval state:
in-memory store in agent-core or Redis-backed store in API
- Database-backed domain persistence:
not currently wired in runtime path

## 6. Operational Constraints In Code

- Shell tool timeout: 30s
- Shell tool output truncation: 64KB
- Shell command max length: 2000 chars
- Agent max steps per run: 8
- Agent response truncation target: 3000 chars
- Telegram sender hard chunk size: 4096 chars
- DevOps runtime default timeout: 300s (env-overridable)

## 7. Notable Legacy/Parallel Code Paths

- `packages/agent-core/src/agent/*` legacy service remains exported for backward compatibility.
- `apps/api/src/telegram/approval-store.ts` exists but command flow currently relies on capability store path.
- `packages/agent-core/src/workflows/infra-workflow.ts` exists but main route currently executes approval flow through orchestrator direct methods.

## Source Files Consulted

- `apps/api/src/index.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/telegram.ts`
- `apps/api/src/telegram/*`
- `packages/agent-core/src/mastra.ts`
- `packages/agent-core/src/orchestrator.ts`
- `packages/agent-core/src/agents/*`
- `packages/agent-core/src/tools/*`
- `packages/tools/src/*`
- `packages/tools-github/src/*`
- `packages/tools-devops-runtime/src/*`
- `packages/tools-aws/src/*`
- `packages/policy/src/index.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/file-logger.ts`
- `packages/audit/src/index.ts`
