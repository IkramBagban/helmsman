# @helmsman/agent-core

LLM orchestration package built on [Mastra](https://mastra.ai). Routes user messages through specialized agents (router → devops/planner/responder) and manages tool execution with approval workflows.

## Architecture

```
User Message
    │
    ▼
┌─────────────────┐
│  Router Agent    │  ← classifies intent (chat / query / single_action / multi_step)
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼
  chat     query    single_action  multi_step
  (LLM)   (tools)    (tools)     (planner → workflow)
    │         │          │          │
    ▼         ▼          ▼          ▼
┌─────────────────┐  ┌─────────────────────┐
│ Responder Agent  │  │ Approval Workflow   │
│ (format output)  │  │ (suspend / resume)  │
└─────────────────┘  └─────────────────────┘
```

### Agents

| Agent | Purpose |
|-------|---------|
| **Router** | Intent classification via structured output |
| **DevOps** | Main agent with native function calling (shell, GitHub, AWS, container tools) |
| **Planner** | Generates structured execution plans for multi-step operations |
| **Responder** | Formats raw tool output into human-friendly Telegram messages |

### Key Exports

```ts
import {
  // Mastra orchestrator (primary API)
  HelmsmanOrchestrator,
  createHelmsman,

  // Agents
  createRouterAgent,
  createDevOpsAgent,
  createPlannerAgent,
  createResponderAgent,
  classifyIntent,
  generatePlan,
  formatResponse,

  // Tools
  shellExecuteTool,
  classifyShellCommandRisk,
  createAwsKnowledgeTool,
  normalizeAwsKnowledgeResponse,
  createMastraGitHubTools,
  createMastraDevopsTools,

  // Legacy (backward compat)
  HelmsmanAgentService,
  createLLMProvider,
} from "@helmsman/agent-core";
```

## Environment Variables

The Mastra agents use `@ai-sdk/google` which reads `GOOGLE_GENERATIVE_AI_API_KEY` from `process.env`. The API layer bridges `GEMINI_API_KEY`/`GOOGLE_API_KEY` automatically.

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Google AI API key (or set `GEMINI_API_KEY` / `GOOGLE_API_KEY` in the API layer) |

Optional AWS Knowledge MCP settings are passed via `createHelmsman({ ... })` config:
- `awsKnowledgeMcpUrl`
- `awsKnowledgeMcpApiKey`
- `awsKnowledgeMcpTimeoutMs`

## Usage

```ts
import { createHelmsman } from "@helmsman/agent-core";

const { orchestrator } = await createHelmsman();

const response = await orchestrator.handleMessage({
  text: "list all EC2 instances in us-east-1",
  userId: "user-123",
  chatId: "chat-456",
  platform: "telegram",
});

// response.text — formatted response for the user
// response.status — "success" | "error" | "pending_approval"
// response.approvalId — present when status is "pending_approval"
```

## Testing

```bash
bun test
```
