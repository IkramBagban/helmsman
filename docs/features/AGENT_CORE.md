# Feature: Agent Core (LLM Orchestration)

> **Package:** `packages/agent-core`
> **Wave:** 2 (depends on: `@helmsman/db`, `@helmsman/tools`, `@helmsman/audit`, `@helmsman/shared`)
> **Estimated effort:** 5-7 days

---

## Purpose

The brain of Helmsman. Receives a normalized message, loads conversation context, classifies intent, investigates infrastructure via tools, builds an execution plan, requests approval for writes, executes the plan, and returns a response. This is the core reasoning loop.

---

## Requirements

### Must Have
- [ ] Accept a `NormalizedMessage` and return an `AgentResponse`
- [ ] Load conversation history from DB (last 50 messages)
- [ ] Classify intent: QUERY, ACTION, DEBUG, EXPLAIN, OPTIMIZE
- [ ] For QUERY intents: call read tools, compose answer, return immediately
- [ ] For ACTION intents: build a plan with steps, risk tier, and estimates → return plan for approval
- [ ] For DEBUG intents: investigate via multiple tool calls, present findings + fix plan
- [ ] Execute approved plans step-by-step with progress tracking
- [ ] Handle tool errors gracefully (retry once, then fail the step with explanation)
- [ ] Persist all messages (user, assistant, tool) to conversation history
- [ ] Use correlation ID from NormalizedMessage throughout the entire chain
- [ ] Stream-friendly architecture (even if MVP returns full response, structure should support streaming)

### Nice to Have
- [ ] Parallel tool calls when steps are independent
- [ ] Conversation compaction (summarize old messages to fit context window)
- [ ] Token usage tracking per conversation
- [ ] Provider failover: automatic switch to secondary LLM on rate limit/error (ProviderRouter)
- [ ] Model routing: fast model for classification (Haiku/GPT-4o-mini), powerful model for reasoning (Opus/GPT-4o)

### Out of Scope
- Multi-turn plan editing ("change step 3 to use a different instance type")
- Concurrent plan execution (one plan at a time per conversation)
- Custom agent personas or system prompts per team

---

## Contracts

### Input: NormalizedMessage
```typescript
// From @helmsman/shared
interface NormalizedMessage {
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
```

### Output: AgentResponse
```typescript
interface AgentResponse {
  text: string;
  status: "success" | "error" | "pending_approval";
  correlationId: string;
  plan?: PlanSummary;
  metadata?: Record<string, unknown>;
}

interface PlanSummary {
  id: string;
  summary: string;
  steps: PlanStepSummary[];
  riskTier: "read_only" | "low_risk" | "significant" | "destructive";
  estimatedDuration?: string;
  estimatedCost?: string;
}

interface PlanStepSummary {
  order: number;
  description: string;
  tool: string;
  risk: string;
}
```

### Internal: ConversationContext (built per request)
```typescript
interface ConversationContext {
  conversationId: string;
  userId: string;
  userRole: "VIEWER" | "OPERATOR" | "ADMIN";
  teamId: string;
  messages: HistoryMessage[];     // last N messages
  correlationId: string;
  currentPlan?: Plan;             // active plan awaiting approval/execution
}

interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
}
```

---

## Core Loop Architecture

```
NormalizedMessage
    │
    ▼
┌────────────────────────────────────────────────────┐
│  1. CONTEXT BUILDER                                 │
│     • Load conversation from DB                     │
│     • Load user permissions                         │
│     • Load team credentials (references, not values)│
│     • Build ConversationContext object               │
├────────────────────────────────────────────────────┤
│  2. INTENT CLASSIFIER                               │
│     • LLM call with system prompt + user message    │
│     • Returns: intent type + extracted entities      │
│     • Entities: resource IDs, service names, etc.    │
├────────────────────────────────────────────────────┤
│  3. ROUTER (based on intent)                        │
│     ├── QUERY → QueryHandler                        │
│     ├── ACTION → ActionHandler                      │
│     ├── DEBUG → DebugHandler                        │
│     ├── EXPLAIN → ExplainHandler                    │
│     └── APPROVAL_RESPONSE → ApprovalHandler         │
├────────────────────────────────────────────────────┤
│  4. HANDLER (intent-specific)                       │
│     Query:                                          │
│       • Determine which tools to call               │
│       • Execute read tools                           │
│       • LLM: compose natural language answer         │
│     Action:                                         │
│       • Investigate current state (read tools)      │
│       • LLM: build step-by-step plan                │
│       • Classify risk tier via @helmsman/policy      │
│       • Save plan to DB                             │
│       • Return plan for user approval               │
│     Debug:                                          │
│       • Run investigation tools (parallel where ok) │
│       • LLM: analyze findings, rank causes          │
│       • Propose fix plan (treated as Action)        │
│     Approval Response:                              │
│       • Match to pending plan                       │
│       • "yes/approve" → execute plan                │
│       • "no/cancel" → reject plan                   │
├────────────────────────────────────────────────────┤
│  5. PLAN EXECUTOR (for approved plans)              │
│     • Execute steps in order                        │
│     • Call tools via ToolRegistry                   │
│     • Track step status (pending → running → done)  │
│     • On step failure: stop, report, save state     │
│     • On completion: compose summary response       │
│     • Emit audit events for every step              │
├────────────────────────────────────────────────────┤
│  6. RESPONSE FORMATTER                              │
│     • Convert internal result to AgentResponse      │
│     • Format plans as clear step lists              │
│     • Format tool results as readable text          │
│     • Persist assistant message to DB               │
└────────────────────────────────────────────────────┘
    │
    ▼
AgentResponse → back to Telegram Gateway
```

---

## File Structure

```
packages/agent-core/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                          # Public API: handleMessage()
    types.ts                          # Internal types (ConversationContext, etc.)
    orchestrator.ts                   # Main orchestration loop (steps 1-6)
    orchestrator.test.ts
    context/
      context-builder.ts              # Load conversation, user, team from DB
      context-builder.test.ts
    intent/
      intent-classifier.ts            # LLM-based intent classification
      intent-classifier.test.ts
      intent-types.ts                 # Intent enum + entity types
    handlers/
      query-handler.ts                # Handle QUERY intents
      query-handler.test.ts
      action-handler.ts               # Handle ACTION intents (plan building)
      action-handler.test.ts
      debug-handler.ts                # Handle DEBUG intents
      debug-handler.test.ts
      approval-handler.ts             # Handle approval responses (yes/no)
      approval-handler.test.ts
    executor/
      plan-executor.ts                # Execute approved plans step-by-step
      plan-executor.test.ts
    llm/
      provider.ts                     # LLMProvider interface + factory
      provider.test.ts
      anthropic-provider.ts           # Anthropic Claude adapter
      anthropic-provider.test.ts
      openai-provider.ts              # OpenAI GPT adapter
      openai-provider.test.ts
      provider-router.ts              # Failover router across providers
      provider-router.test.ts
      prompts.ts                      # System prompts for each handler
      prompts.test.ts
    formatter/
      response-formatter.ts           # Format AgentResponse text
      response-formatter.test.ts
```

---

## LLM Integration (Custom Provider Layer)

### Architecture: No Framework, Just Adapters

We do NOT use Vercel AI SDK, LangChain, or any LLM framework. Instead, we write a thin adapter (~100 LOC per provider) that wraps each provider's native SDK and normalizes the interface. See `docs/STACK.md` for the full rationale.

```typescript
// packages/agent-core/src/llm/provider.ts

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
```

### The Core Agent Loop

The main orchestration is a simple while-loop — no graph, no state machine, no framework:

```typescript
// packages/agent-core/src/orchestrator.ts
import type { LLMProvider, MessageParam } from "./llm/provider";

async function runAgentLoop(
  userMessage: string,
  context: ConversationContext,
  provider: LLMProvider,
): Promise<AgentResult> {

  const messages: MessageParam[] = buildPrompt(userMessage, context);

  while (true) {
    const response = await provider.chat({
      model: context.config.model,   // "claude-sonnet-4-20250514", "gpt-4o", etc.
      system: getSystemPrompt(context),
      messages,
      tools: toolRegistry.toLLMTools(), // normalized tool definitions
    });

    if (response.stopReason === "end_turn") {
      return finalizeResponse(response);
    }

    if (response.stopReason === "tool_use") {
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        // 1. Risk check — policy engine
        const risk = await policyEngine.assess(block.name, block.input);

        // 2. Approval gate if write/destructive
        if (risk.tier >= RiskTier.SIGNIFICANT) {
          const plan = buildPlanFromToolCall(block, risk);
          await savePlan(plan);
          return { status: "pending_approval", plan };
        }

        // 3. Execute tool
        const result = await toolRegistry.invoke(
          { tool: block.name, params: block.input, correlationId: context.correlationId },
          buildToolContext(context),
        );

        // 4. Audit log
        await audit.record({ tool: block.name, input: block.input, result, correlationId: context.correlationId });

        // 5. Feed result back into loop
        messages.push({ role: "assistant", content: [block] });
        messages.push(buildToolResult(block.id, result));
      }
    }
  }
}
```

This is ~150 lines total. Readable, typed, debuggable. No framework magic.

### System Prompt Strategy
Each handler has a specialized system prompt:

```typescript
// src/llm/prompts.ts
export const INTENT_CLASSIFIER_PROMPT = `
You are the intent classifier for Helmsman, a DevOps AI agent.
Given a user message and conversation history, classify the intent.

Respond with JSON:
{
  "intent": "QUERY" | "ACTION" | "DEBUG" | "EXPLAIN" | "OPTIMIZE" | "APPROVAL_RESPONSE",
  "entities": { "services": [], "resourceIds": [], "actions": [] },
  "confidence": 0.0 to 1.0
}

Rules:
- If the message is "yes", "approve", "go", "do it" → APPROVAL_RESPONSE
- If asking about state/status/info → QUERY
- If requesting a change/creation/deletion → ACTION
- If describing a problem/error → DEBUG
- If asking "what does X do" or "explain" → EXPLAIN
`;

export const PLAN_BUILDER_PROMPT = `
You are the plan builder for Helmsman.
Given a user request, current infrastructure state, and available tools,
create a step-by-step execution plan.

Each step must specify:
- tool: the tool identifier to call
- action: the specific action
- params: parameters for the tool
- description: human-readable description
- risk: risk level of this specific step

Never include steps the user didn't ask for.
Always investigate current state before proposing changes.
`;
```

### Provider Adapters

Each provider adapter is ~80-100 lines, normalizing the provider's native SDK to our `LLMProvider` interface:

```typescript
// packages/agent-core/src/llm/anthropic-provider.ts
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ChatRequest, ChatResponse } from "./provider";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(config: { apiKey: string }) {
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async chat(params: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      system: params.system,
      messages: this.toAnthropicMessages(params.messages),
      tools: params.tools?.map(t => this.toAnthropicTool(t)),
      max_tokens: params.maxTokens ?? 4096,
    });

    return {
      content: response.content.map(b => this.normalizeBlock(b)),
      stopReason: this.normalizeStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  // ... normalize methods for each provider's quirks
}
```

Same pattern for `openai-provider.ts` (wrapping `openai` SDK) and `gemini-provider.ts` (wrapping `@google/generative-ai`).

---

## Implementation Notes

### Approval Flow
1. Agent builds plan → saves to DB with `status: PENDING` → returns plan to user
2. User responds "yes" → next message classified as `APPROVAL_RESPONSE`
3. Approval handler finds the pending plan → marks `APPROVED` → triggers executor
4. User responds "no" → plan marked `REJECTED`, agent acknowledges

### Plan Matching
- When user sends "yes", find the most recent `PENDING` plan in this conversation
- If no pending plan exists, treat as a regular message

### Error Recovery
- If a step fails, mark it `FAILED`, mark the plan `FAILED`
- Save the error message and which step failed
- Report to user: "Step 3 failed: [error]. Steps 1-2 were completed. Would you like me to retry step 3 or rollback?"
- For MVP, no automatic rollback — report and let user decide

### Token Management
- Track tokens per LLM call → store in message metadata
- If conversation exceeds ~80% of context window, compact old messages:
  ```
  [System] Summary of conversation so far: [LLM-generated summary]
  [Recent messages continue normally]
  ```

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `intent-classifier.test.ts` | "how many EC2 instances?" → QUERY |
| `intent-classifier.test.ts` | "stop the staging instance" → ACTION |
| `intent-classifier.test.ts` | "my website isn't loading" → DEBUG |
| `intent-classifier.test.ts` | "yes" / "approve" → APPROVAL_RESPONSE |
| `action-handler.test.ts` | Builds plan with correct steps for "create S3 bucket" |
| `approval-handler.test.ts` | "yes" matches pending plan and triggers executor |
| `approval-handler.test.ts` | "no" rejects pending plan |
| `plan-executor.test.ts` | Executes steps in order, updates status |
| `plan-executor.test.ts` | Stops on step failure, reports correctly |
| `context-builder.test.ts` | Loads conversation with last 50 messages |
| `response-formatter.test.ts` | Formats plan as readable text |

### Integration Tests
| Test | What |
|------|------|
| Full QUERY flow | NormalizedMessage → tool call → formatted answer |
| Full ACTION flow | NormalizedMessage → plan → approval → execution → result |
| Conversation continuity | Multi-turn conversation maintains context |

---

## Acceptance Criteria

1. QUERY: "How many EC2 instances are running?" → calls DescribeInstances tool → returns count and list
2. ACTION: "Stop the staging instance" → shows plan with instance ID, risk tier, and "Approve?" → user says yes → instance stopped → confirmation
3. DEBUG: "My S3 website isn't loading" → investigates bucket policy, CloudFront config → presents findings and fix plan
4. APPROVAL: "yes" after plan → executes the pending plan; "no" → cancels
5. Unknown intent: graceful handling with "I'm not sure what you mean. Could you rephrase?"
6. Tool error: step fails → plan marked failed → user gets clear error message
7. All messages (user + assistant + tool calls) persisted to conversation history
8. Correlation ID flows through every log line and audit event
