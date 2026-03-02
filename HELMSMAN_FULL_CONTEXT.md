# Helmsman — Complete Application Context Document

> This document is a comprehensive dump of the entire Helmsman application — what it is, what's built, how it works, what's broken, and what I want. Use it as full context for helping me redesign the agent architecture.

---

## 1. What Is Helmsman?

Helmsman is a **Jarvis-style AI DevOps agent** that lives inside **Telegram**. Users chat with it in natural language and it reasons about, plans, and executes infrastructure operations. Think: "Hey Helmsman, create an S3 bucket called `my-assets`, set up a CloudFront distribution pointing at it, and write a read-only bucket policy."

First vertical: **DevOps** (AWS, GitHub, server management). Long-term: expand across domains.

**Current status:** Working end-to-end but responses are frequently wrong, the agent doesn't plan multi-step tasks properly, leaks raw JSON, makes mistakes, and doesn't behave like a smart autonomous agent.

---

## 2. Tech Stack

| Layer | Choice | Details |
|-------|--------|---------|
| Runtime | **Bun** | Package manager + runtime + test runner |
| Language | **TypeScript 5.9+** | Strict mode, no `any` |
| Monorepo | **Turborepo** | Task orchestration, caching |
| API framework | **Express** | Runs on Bun |
| Validation | **Zod** | All external input validated at boundaries |
| LLM | **Google Gemini** (primary) | `gemini-2.0-flash` via REST API. OpenAI as fallback option. |
| Chat transport | **Telegram Bot API** | Via webhook to Express server |
| Cloud target | **AWS** | Full CLI access via `shell.execute` |
| Container runtime | **Docker** (via dockerode) | Isolated execution for git/ssh/shell ops |

---

## 3. Monorepo Structure

```
apps/
  api/                          ← Express server: Telegram webhook + agent HTTP API
  web/                          ← Next.js dashboard (future, not active)
packages/
  agent-core/                   ← LLM orchestration: the agent brain
  tools/                        ← Tool registry, shell.execute, shell safety
  tools-github/                 ← 17 typed GitHub tools via Octokit
  tools-devops-runtime/         ← 12 Docker-isolated runtime tools (git, ssh, shell)
  tools-aws/                    ← Legacy typed AWS tools (mostly unused, shell.execute covers everything)
  policy/                       ← Risk tier evaluation, approval gates
  shared/                       ← Shared types, Zod schemas, errors, constants
  audit/                        ← Console-based audit logging
```

---

## 4. Complete Tool Inventory

### 4.1 `shell.execute` — The Swiss Army Knife (packages/tools)

This is the most important tool. It executes CLI commands via `Bun.spawn` with safety controls.

**How it works:**
1. Command is parsed and tokenized (handles quoted strings)
2. Binary is checked against allowlist: `aws`, `kubectl`, `helm`, `docker`, `curl`, `jq`
3. Command is checked against blocked patterns (no `&&`, `||`, `$()`, pipes to shell, etc.)
4. Risk is classified dynamically:
   - `read_only`: `describe-*`, `list-*`, `get-*`, `ls`, `head`, etc.
   - `significant`: `create-*`, `put-*`, `update-*`, `modify-*`, `start-*`, `stop-*`
   - `destructive`: `delete-*`, `remove-*`, `terminate-*`, `--force`
5. Command executes with 30s timeout, 64KB output cap

**What it covers:** Every AWS service (EC2, S3, RDS, Lambda, IAM, CloudWatch, ECS, Route53, Cost Explorer, CloudFront, etc.), kubectl, helm, docker, curl, jq.

### 4.2 GitHub Tools (packages/tools-github) — 17 Typed Tools

All read-only, using Octokit with Zod validation:

| Tool Name | What It Does |
|-----------|-------------|
| `github.repos.search` | Search repositories |
| `github.repo.get` | Get repository details |
| `github.issues.list` | List issues (with filters) |
| `github.issues.get` | Get issue details + optional comments |
| `github.prs.list` | List PRs (state, sort, pagination) |
| `github.prs.get` | Get PR details + optional diff/comments/reviews |
| `github.prs.getDiff` | Get raw PR diff |
| `github.prs.listComments` | List PR review comments |
| `github.discussions.list` | List discussions (GraphQL) |
| `github.discussions.get` | Get discussion + comments (GraphQL) |
| `github.repo.getFile` | Get file content (base64 decoded) |
| `github.repo.listFiles` | List files in path (recursive via git tree) |
| `github.search.code` | Search code across repos |
| `github.commits.list` | List commits |
| `github.commits.get` | Get commit details |
| `github.actions.listWorkflows` | List GitHub Actions workflows |
| `github.actions.getWorkflowRun` | Get workflow run + jobs |

### 4.3 DevOps Runtime Tools (packages/tools-devops-runtime) — 12 Docker-Isolated Tools

Execute inside an isolated Docker container via `DockerContainerOrchestrator`:

| Tool Name | Risk | What It Does |
|-----------|------|-------------|
| `devops.git.clone` | low_risk | Clone repo (HTTPS/SSH, shallow, auth) |
| `devops.git.status` | read_only | Git status in workspace |
| `devops.git.diff` | read_only | Git diff (refs, paths, stat mode) |
| `devops.git.log` | read_only | Last 25 commits |
| `devops.git.checkout` | low_risk | Switch branch/ref |
| `devops.git.pull` | low_risk | Pull from remote |
| `devops.git.commit` | low_risk | Stage + commit (selective or all) |
| `devops.git.push` | significant | Push to remote (with force/dry-run) |
| `devops.ssh.exec` | significant | Run command on remote host via SSH |
| `devops.ssh.fileRead` | significant | Read remote file via SSH |
| `devops.ssh.fileWrite` | destructive | Write remote file (with backup) via SSH |
| `devops.shell.run` | destructive | Run arbitrary command in container |

**Container isolation features:**
- Per-task Docker volume (workspace persistence within task)
- Per-task network with explicit egress allowlist (default-deny)
- Credential injection (SSH keys, git tokens) via secure bind mounts
- Output redaction (strips secrets from stdout/stderr)
- Configurable timeout, CPU quota, memory limit
- Automatic cleanup (container, volume, network removed after task)

---

## 5. Current Architecture — How a Message Flows

### 5.1 Telegram Webhook Handler (`apps/api/src/routes/telegram.ts`)

```
Telegram → POST /webhook → Express handler
  1. Validate webhook secret header
  2. Check for duplicate update_id (dedup store)
  3. Parse Telegram update → NormalizedMessage
  4. Check for /approve command → execute pre-approved tool directly
  5. Check for /start, /help commands → return static text
  6. Otherwise → agentService.handleMessage(normalizedMessage)
  7. Send typing indicator every 4 seconds while processing
  8. Sanitize agent response text (strip tool-call artifacts)
  9. Send response via Telegram Bot API
```

### 5.2 Agent Service — The Brain (`packages/agent-core/src/agent/agent-service.ts`)

This is where all the problems are. Here's exactly how it works today:

```
handleMessage(message):
  1. Log incoming message to audit
  2. Build system prompt (identity + tool definitions JSON + few-shot examples)
  3. Load conversation history (in-memory, 12 messages max)
  4. Build working message list: [...history, {role: "user", content: message.text}]
  
  5. AGENTIC LOOP (max 5 iterations):
     a. Call LLM with system prompt + working messages
     b. Try to parse tool call from LLM response text
     c. If no tool call → sanitize text → return as final response
     d. If tool call found:
        - Check for duplicate (same tool + same params = stuck loop, break)
        - First-iteration guards (ambiguous "yes"/"ok" without prior question, invalid command param)
        - Look up tool in registry
        - Policy check (read_only/low_risk → allow, significant/destructive → require_approval)
        - If approval required → return pending_approval status (Telegram handler creates /approve link)
        - Execute tool
        - Auto-retry for AWS "Invalid Choice" errors (asks LLM for corrected command)
        - Auto-retry for command substitution blocks (rewrites Cost Explorer date params)
        - If tool error → return error to user
        - If tool success → append to working messages as [Tool result] and continue loop
  
  6. Loop exhausted → deterministic fallback (summarizeRawOutputFallback)
  7. Save conversation turn to memory
```

### 5.3 System Prompt (`packages/agent-core/src/agent/system-prompt.ts`)

The system prompt tells the LLM:
- **Identity:** "You are Helmsman — a senior DevOps engineer that lives inside chat"
- **Behavior:** Act first, narrate second. Fetch real data before speaking.
- **Tool protocol:** Respond with pure JSON `{"type":"tool_call","toolName":"...","parameters":{...}}` — no text before or after
- **Scope:** Full AWS CLI, GitHub tools, container runtime tools
- **Communication style:** Direct, concise, no corporate speak, never paste raw JSON
- **Safety:** Read before write, warn before destroy, prefer --dry-run
- **7 few-shot examples:** EC2 overview, GitHub issues, security audit, repo inspection, container diagnostics, cost check, casual greeting

### 5.4 LLM Provider (`packages/agent-core/src/llm/`)

- **Interface:** `LLMProvider.generate({systemPrompt, messages, model?, temperature?}) → {text, model}`
- **Production:** `GeminiProvider` — calls `generativelanguage.googleapis.com/v1beta` REST API directly
- **Model:** `gemini-2.0-flash` with temperature 0.2
- **Fallback:** `OpenAIProvider` available but not used in production
- **Critical limitation:** Uses plain text completion, NOT native function calling. The LLM must emit tool calls as raw JSON text, which is then regex-parsed.

### 5.5 Policy Engine (`packages/policy/`)

Simple risk-tier based:
- `read_only` / `low_risk` → auto-allow
- `significant` / `destructive` → require user approval (via Telegram /approve command)

### 5.6 Approval Flow (apps/api/src/telegram/)

1. Agent returns `status: "pending_approval"` with tool name + parameters
2. Telegram handler creates approval record (UUID, 15-minute TTL, in-memory store)
3. User sees: "This request can change infrastructure... Reply with /approve abc123"
4. User sends `/approve abc123`
5. Handler validates approval (correct user, correct chat, not expired)
6. Executes the tool directly
7. Sends LLM-summarized result back to user

### 5.7 Conversation Memory

- `InMemoryConversationMemoryStore` — per-chat-per-user Map
- Max 12 messages per conversation (sliding window)
- **No persistence** — lost on server restart
- Key format: `{platform}:{chatId}:{userId}`

### 5.8 Output Handling

- **Tool output truncation:** 12K chars before feeding back to LLM context
- **Subprocess output cap:** 64KB from Bun.spawn
- **Sanitization:** Strips tool-call JSON, large fenced blocks, `[Tool result]` markers from user-facing text
- **Deterministic fallbacks:** For S3 bucket lists, CloudFront distributions, generic arrays, generic JSON — if LLM can't summarize, these kick in

---

## 6. What's Broken — Current Problems

### 6.1 No Planning Capability
The agent has **zero planning ability**. When a user says "create an S3 bucket, set up CloudFront, and write a bucket policy," the agent:
- Might try to do the first thing and forget the rest
- Might hallucinate a single command that tries to do everything
- Has no concept of "here are the 5 steps I need to do"
- Cannot present a plan to the user before executing

### 6.2 No Intent Decomposition
The agent cannot break down compound requests. "Check my EC2 instances and also look at the S3 buckets" gets treated as a single blob of text, not two separate tasks.

### 6.3 Approval Flow Is Per-Tool, Not Per-Plan
If a multi-step task requires 3 tools that need approval:
- Current: Would need 3 separate /approve interactions (or worse, only asks for the first one)
- Desired: Show the full plan, get one approval, execute all steps autonomously

### 6.4 Raw Text Tool Protocol Instead of Native Function Calling
The LLM must emit tool calls as raw JSON text like:
```json
{"type":"tool_call","toolName":"shell.execute","parameters":{"command":"aws s3 ls"}}
```
This is fragile — the LLM sometimes:
- Wraps it in explanation text (tool call not parsed)
- Emits invalid JSON
- Invents tool names that don't exist
- Gets parameter names wrong
- Adds text before/after the JSON that leaks to users

### 6.5 No Verification Step
After executing a tool, the agent doesn't verify the result makes sense. It just feeds it back to the LLM and hopes for a good summary. No "did this actually work?" check.

### 6.6 Responses Are Often Wrong or Low Quality
- Sometimes gives generic blurbs instead of actually using tools
- Raw JSON leaks through to the user despite sanitization
- Doesn't cite specific numbers or details from tool outputs
- Doesn't flag warnings or anomalies in the data
- Over-explains or under-explains

### 6.7 Conversation Memory Is Primitive
- Only 12 messages (6 turns)
- In-memory only (lost on restart)
- No concept of "task context" — e.g., if the user is in the middle of a multi-step workflow, there's no way to track that
- No persistence between sessions

### 6.8 Single Agent, No Specialization
One monolithic agent handles everything — AWS, GitHub, container ops, general chat. No routing to specialized sub-agents that might handle specific domains better.

### 6.9 Error Recovery Is Weak
- Auto-retry only works for two specific AWS CLI error patterns
- No general retry/fallback strategy
- If a tool fails halfway through a multi-step task, there's no rollback or continuation logic

---

## 7. What I Want — Desired Architecture

### 7.1 Planning Node
When a user sends a message, the system should:
1. **Classify the intent** — is this a question, a single action, a multi-step task, or just chat?
2. **Decompose into steps** — break compound requests into ordered, independent steps
3. **Create an execution plan** with:
   - Step number, description, which tool to use, expected risk level
   - Dependencies between steps (step 3 needs output from step 1)
   - Estimated duration
4. **Present the plan to the user** — "Here's what I'll do: 1) Create S3 bucket... 2) Set up CloudFront... 3) Write bucket policy... Shall I proceed?"
5. **Get single approval** for the whole plan (or per-step for destructive actions)

### 7.2 Autonomous Multi-Step Execution
Once approved, the agent should:
- Execute each step in order
- Pass outputs from one step as inputs to the next (e.g., bucket ARN from step 1 → CloudFront origin in step 2)
- Verify each step succeeded before proceeding
- Report progress: "Step 1/3 done ✓ — bucket created. Moving to CloudFront..."
- If a step fails: stop, report what happened, suggest recovery options

### 7.3 Smart Approval
- **Read-only operations:** No approval needed, ever
- **Single low-risk write:** Auto-proceed with notification
- **Multi-step with writes:** Show plan, get one blanket approval
- **Destructive operations:** Per-step approval with explicit warnings

### 7.4 Agent Nodes / Routing
Instead of one monolithic agent, route to specialized sub-agents:
- **AWS Agent** — deep knowledge of AWS services, CLI patterns, best practices
- **GitHub Agent** — repo analysis, PR reviews, issue management
- **Diagnostics Agent** — server health, container inspection, log analysis
- **Planner Agent** — decomposes complex requests into step plans
- **Router** — classifies intent and dispatches to the right agent

### 7.5 Better LLM Integration
- Use **native function calling** (Gemini supports it) instead of text-based JSON protocol
- Use **structured output** for plans and step definitions
- Use **streaming** for long operations so users see progress
- Better **model selection** — use a smarter model for planning, cheaper model for simple lookups

### 7.6 Persistent Memory
- Store conversation history in the database (not in-memory)
- Track ongoing multi-step tasks across sessions
- Remember user preferences and frequently-used resources
- Context about the user's infrastructure (what regions they use, naming conventions, etc.)

---

## 8. Key Source Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `packages/agent-core/src/agent/agent-service.ts` | 557 | Main agent loop — LLM calls, tool parsing, policy, execution |
| `packages/agent-core/src/agent/system-prompt.ts` | 155 | System prompt + few-shot examples |
| `packages/agent-core/src/agent/conversation-memory.ts` | 36 | In-memory conversation store (12 msg max) |
| `packages/agent-core/src/llm/provider.ts` | 23 | LLM interface definition |
| `packages/agent-core/src/llm/gemini-provider.ts` | 65 | Gemini REST API provider |
| `packages/agent-core/src/llm/provider-factory.ts` | 43 | LLM provider factory (gemini/openai/echo) |
| `packages/tools/src/index.ts` | 73 | ToolRegistry + ToolInstance/TypedTool interfaces |
| `packages/tools/src/shell-execute.ts` | 205 | ShellExecuteTool (Bun.spawn, safety, risk) |
| `packages/tools/src/shell-safety.ts` | 308 | Command allowlisting, blocked patterns, risk classification |
| `packages/tools-github/src/index.ts` | 30 | Creates 17 GitHub tools |
| `packages/tools-github/src/tools/misc-tools.ts` | 237 | All 17 GitHub tool implementations |
| `packages/tools-devops-runtime/src/index.ts` | 30 | Creates 12 runtime tools |
| `packages/tools-devops-runtime/src/tools/git-tools.ts` | 95 | 8 git tools (clone/status/diff/log/checkout/pull/commit/push) |
| `packages/tools-devops-runtime/src/tools/ssh-tools.ts` | 92 | 3 SSH tools (exec/fileRead/fileWrite) |
| `packages/tools-devops-runtime/src/tools/shell-run.ts` | 34 | Generic shell.run in container |
| `packages/tools-devops-runtime/src/orchestrator/container-orchestrator.ts` | 116 | Docker container lifecycle (create/run/attach/timeout/cleanup) |
| `packages/policy/src/index.ts` | 24 | Policy engine (risk-tier → allow/deny/require_approval) |
| `packages/audit/src/index.ts` | 24 | Console-based audit logger |
| `packages/shared/src/index.ts` | 158 | Shared types, AppError, Telegram update validator |
| `apps/api/src/routes/telegram.ts` | 317 | Telegram webhook handler, tool registration, approval flow |
| `apps/api/src/telegram/approval-store.ts` | 62 | In-memory approval store (15min TTL) |
| `apps/api/src/config.ts` | 75 | Environment configuration |

---

## 9. Shared Type Contracts

```typescript
// From packages/shared/src/index.ts

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

interface AgentResponse {
  text: string;
  status: "success" | "error" | "pending_approval";
  correlationId: string;
  plan?: PlanSummary;  // ← EXISTS in types but NEVER populated by agent
  metadata?: Record<string, unknown>;
}

interface PlanSummary {
  id: string;
  summary: string;
  steps: PlanStepSummary[];
  riskTier: RiskTier;
  estimatedDuration?: string;
  estimatedCost?: string;
}

interface PlanStepSummary {
  order: number;
  description: string;
  tool: string;
  risk: string;
}

type RiskTier = "read_only" | "low_risk" | "significant" | "destructive";

interface PolicyDecision {
  action: "allow" | "deny" | "require_approval";
  reason?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskTier: RiskTier;
}

interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

// LLM interface
interface LLMProvider {
  generate(params: {
    systemPrompt: string;
    messages: LLMMessage[];
    model?: string;
    temperature?: number;
  }): Promise<{ text: string; model: string }>;
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

**Note:** `PlanSummary` and `PlanStepSummary` types already exist in the shared package but are **never used** by the agent. The agent always returns `plan: undefined`. These were designed for a planning feature that was never implemented.

---

## 10. Current Tool Call Protocol (Text-Based, Fragile)

The LLM is instructed via system prompt to emit tool calls as raw JSON:

```
User: "How many S3 buckets do I have?"

LLM response (raw text):
{"type":"tool_call","toolName":"shell.execute","parameters":{"command":"aws s3api list-buckets --output json"}}

Agent parses this with regex/JSON.parse, executes the tool, appends result:
[Tool result]:
{"Buckets":[{"Name":"my-bucket","CreationDate":"2024-01-15"},...],"Owner":{...}}

LLM sees the result and generates a natural language summary:
"You've got 12 S3 buckets. Here are the highlights: ..."
```

**Problems with this approach:**
1. LLM sometimes wraps JSON in markdown fences → parser handles this but adds complexity
2. LLM sometimes adds text before/after JSON → that text leaks to user
3. LLM sometimes generates invalid JSON → tool call fails silently
4. LLM sometimes invents tool names → "tool not registered" error
5. No structured way to request multiple tool calls in one response
6. No streaming — user waits for entire loop to complete

---

## 11. Example of What Goes Wrong Today

**User:** "Create an S3 bucket called my-assets and set up CloudFront for it"

**What happens:**
1. LLM generates: `{"type":"tool_call","toolName":"shell.execute","parameters":{"command":"aws s3api create-bucket --bucket my-assets --region us-east-1"}}`
2. Policy engine: `create-bucket` → risk=significant → require_approval
3. Agent returns: "This request can change infrastructure and requires your approval. Reply with /approve abc123"
4. User approves
5. Telegram handler executes the create-bucket command
6. **CloudFront part is completely forgotten** — there's no plan, no continuation, no memory of what else the user wanted

**What should happen:**
1. Agent creates a plan:
   - Step 1: Create S3 bucket `my-assets` (significant risk)
   - Step 2: Create CloudFront distribution with S3 origin (significant risk)
   - Step 3: Update bucket policy for CloudFront OAI access (significant risk)
2. Agent presents plan to user: "Here's what I'll do: [plan]. This involves infrastructure changes. Shall I proceed?"
3. User approves once
4. Agent executes all 3 steps autonomously, passing outputs between steps
5. Agent reports: "Done! Here's your setup: [bucket URL, CloudFront domain, policy summary]"

---

## 12. Constraints and Considerations

- **Telegram message limit:** 4096 characters per message. Plans and responses must be concise.
- **LLM context window:** Gemini 2.0 Flash has 1M tokens, but we cap tool output at 12K chars to control costs and latency.
- **Tool execution timeout:** 30s for shell.execute, 300s for container runtime.
- **Approval TTL:** 15 minutes (in-memory store).
- **No database currently:** Everything is in-memory. Prisma schema exists but DB isn't connected.
- **Single-process deployment:** No job queue, no background workers. Everything happens in the webhook handler.
- **Gemini function calling:** Gemini 2.0 Flash supports native function calling — we should use it instead of text-based JSON protocol.
- **Budget:** Using Gemini Flash (cheap) for everything. Could use a smarter model (Gemini Pro, Claude) for planning and a faster/cheaper one for simple tool calls.

---

## 13. What I Need Help With

1. **Agent architecture redesign** — How to restructure from a simple loop to a planning-based agent with nodes (planner, executor, verifier, router)?
2. **Planning node design** — How should the planner decompose user intent into ordered steps? What LLM prompt/structure produces reliable plans?
3. **Execution engine** — How to execute a plan step-by-step with output passing, verification, progress reporting, and error recovery?
4. **Approval flow redesign** — Single approval for a plan vs per-step, handling mixed risk levels in one plan.
5. **Native function calling** — Should I switch from text-based JSON to Gemini's native function calling? How does that change the architecture?
6. **Memory and state** — How to persist conversation context, ongoing plans, and task state across messages?
7. **Better prompts** — The system prompt works but could be much better. How to prompt for reliable planning + execution?
8. **Error recovery patterns** — Rollback, retry, partial completion handling for multi-step tasks.
