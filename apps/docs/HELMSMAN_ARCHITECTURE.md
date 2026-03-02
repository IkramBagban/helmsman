# HELMSMAN — Architecture Redesign
> The definitive guide. What to build, how to build it, and why.

---

## The Honest Problem Statement

Your current agent is a 557-line loop that asks an LLM to emit JSON as plain text, then regex-parses it. Everything wrong with Helmsman today — hallucinations, lost multi-step context, raw JSON leaking through, wrong answers, forgotten instructions — traces back to three root causes:

1. **Text-based tool calling**: The LLM is asked to *write* a JSON object as text. It can accidentally write explanation instead, wrap it in markdown, emit invalid JSON, or invent tool names. Nothing in the architecture prevents this.
2. **No planning layer**: The agent has no concept of "these are the 4 things I need to do." It handles one action and forgets the rest.
3. **Nothing forces the LLM to use tools**: The system prompt says "act first, narrate second" but that's just words. The LLM can — and does — answer from memory. That's where the hallucinated proxlay CDN answer came from.

Fixing the system prompt won't fix these. The code has to change.

---

## The Framework Decision: Use Mastra

**Don't build your own agent loop. Use Mastra.**

Mastra is a TypeScript-native agent framework from the Gatsby team. It gives you agents, durable graph-based workflows with suspend/resume, memory, tool execution, model routing, observability, and a local dev playground — all in one package. It integrates with Express and deploys anywhere Node.js runs.

Your current `agent-service.ts` is a 557-line file that reimplements what Mastra ships for free — and does it worse. The hallucinations, JSON parsing fragility, and broken multi-step flow are all problems Mastra's architecture solves by design.

**Why not LangChain/LangGraph?** Python-first, notoriously unstable API across versions, and the TypeScript port is second-class. Wrong tool for your stack.

**Why not build your own?** You already tried. The result is 557 lines of fragile glue code that still breaks. Mastra's team has solved these problems at scale. Use their work.

**What you keep:** All 30+ tools (`shell.execute`, 17 GitHub tools, 12 DevOps runtime tools). They wrap cleanly into Mastra's `createTool` format. Zero rewrite needed on your tool implementations.

---

## New Architecture Overview

```
Telegram Message
       │
       ▼
  ┌──────────┐
  │  Router  │  Classifies intent in one fast LLM call
  └────┬─────┘
       │
       ├── chat ──────────────────────► Direct reply
       │
       ├── query / single_action ─────► Mastra Agent (tool calling, auto-loop)
       │                                      │
       │                               Native function calling
       │                               Verify → Respond
       │
       └── multi_step ────────────────► Mastra Workflow
                                              │
                                        Plan generation
                                              │
                                        Approval gate (suspend/resume)
                                              │
                                        Step execution (output passing)
                                              │
                                        Progress updates to Telegram
                                              │
                                        Final response
```

---

## The Five Components

### 1. Router

A single, cheap LLM call that classifies every incoming message before anything else happens. Fast, uses the smallest model, costs almost nothing.

```typescript
// packages/agent-core/src/router.ts
import { Agent } from '@mastra/core/agent'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

const RouterOutputSchema = z.object({
  type: z.enum(['chat', 'query', 'single_action', 'multi_step']),
  summary: z.string(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
})

export const router = new Agent({
  name: 'Router',
  model: google('gemini-2.0-flash'),  // cheapest model, fast
  instructions: `
    Classify the user's DevOps request into one of four types:
    - "chat": greetings, casual, no infrastructure action needed
    - "query": wants information — read-only operations only
    - "single_action": exactly one write/change operation
    - "multi_step": two or more operations, or one operation with dependent sub-steps

    Respond ONLY with JSON matching the output schema.

    Set needsClarification only when you genuinely cannot proceed without info you cannot look up.
    If you can look it up (region, resource name, etc), don't ask — look it up.
  `,
})
```

**Why this matters:** Without a router, every message goes through the full planner path, which is slow and expensive. Simple questions like "how many EC2 instances?" should be answered in one tool call, not turned into a 3-step plan.

---

### 2. Mastra Agent (for queries and single actions)

For `query` and `single_action` types, skip planning entirely. Use a Mastra Agent with **native function calling**. The agent runs an autonomous loop — calls tools, gets results, calls more tools if needed, then generates the final response. You don't write this loop. Mastra runs it.

```typescript
// packages/agent-core/src/agents/devops-agent.ts
import { Agent } from '@mastra/core/agent'
import { google } from '@ai-sdk/google'
import { shellExecuteTool, githubTools, devopsTools } from '../tools'

export const devopsAgent = new Agent({
  name: 'Helmsman',
  model: google('gemini-2.0-flash'),
  instructions: HELMSMAN_INSTRUCTIONS,  // see Prompts section
  tools: {
    shell_execute: shellExecuteTool,
    github_repos_list: githubTools.reposList,
    github_issues_list: githubTools.issuesList,
    // ... all 30 tools
  },
})
```

**The critical change:** Mastra uses the Vercel AI SDK under the hood, which uses **native function calling** — not text-based JSON. The model emits a proper `functionCall` object that the SDK extracts structurally. The model cannot "accidentally" write explanation text instead of a tool call, cannot invent tool names, cannot emit invalid JSON. This eliminates the #1 source of hallucinations.

For queries, pass `toolChoice: 'required'` so the model must call a tool before answering. The LLM cannot respond from memory for data questions.

```typescript
const result = await devopsAgent.generate(userMessage, {
  toolChoice: 'required',  // MUST call a tool. Cannot answer from training data.
})
```

---

### 3. Mastra Workflow (for multi-step tasks)

For `multi_step` requests, use a **Mastra Workflow** — a durable, graph-based execution engine with built-in suspend/resume. This is the core fix for everything broken about multi-step task handling today.

Mastra workflows:
- Run steps in order with typed outputs flowing into the next step
- Can suspend at any step and persist state to storage (survives restarts)
- Resume from exactly where they stopped when you call `.resume()`
- Support branching, error handling, and rollback logic

This is your new approval flow. When a workflow hits a step that requires approval, it calls `suspend()`. Execution stops. State is saved. When the user replies "go" in Telegram, you call `workflow.resume()` with `{ approved: true }`. Execution continues from where it left off.

```typescript
// packages/agent-core/src/workflows/infra-workflow.ts
import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'

// Step 1: Plan the task
const planStep = createStep({
  id: 'plan',
  inputSchema: z.object({ userRequest: z.string() }),
  outputSchema: z.object({ plan: PlanSchema }),
  execute: async ({ inputData }) => {
    const plan = await generatePlan(inputData.userRequest)
    return { plan }
  },
})

// Step 2: Show plan to user and wait for approval
const approvalStep = createStep({
  id: 'approval',
  inputSchema: z.object({ plan: PlanSchema }),
  outputSchema: z.object({ plan: PlanSchema }),
  suspendSchema: z.object({ planText: z.string() }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      // First execution — suspend and show plan to user
      await suspend({ planText: formatPlanForTelegram(inputData.plan) })
    }
    if (!resumeData?.approved) {
      return bail({ reason: 'User cancelled' })
    }
    return { plan: inputData.plan }
  },
})

// Step 3: Execute each step in the plan
const executeStep = createStep({
  id: 'execute',
  inputSchema: z.object({ plan: PlanSchema }),
  outputSchema: z.object({ results: z.array(StepResultSchema) }),
  execute: async ({ inputData }) => {
    const results = []
    const outputs: Record<string, string> = {}

    for (const step of inputData.plan.steps) {
      const command = resolveInputVars(step.command, outputs)
      const result = await shellExecute(command)

      if (!result.success) {
        throw new Error(`Step ${step.order} failed: ${result.error}`)
      }

      if (step.outputVar) {
        outputs[step.outputVar] = extractVar(step.outputVar, result.output)
      }

      results.push({ step: step.description, output: result.output })
    }

    return { results }
  },
})

export const infraWorkflow = createWorkflow({
  id: 'infra-workflow',
  inputSchema: z.object({ userRequest: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
})
  .then(planStep)
  .then(approvalStep)
  .then(executeStep)
  .commit()
```

**How Telegram wires into this:**

```typescript
// apps/api/src/routes/telegram.ts

// User sends: "create s3 bucket my-assets and set up cloudfront"
const run = await infraWorkflow.createRun()
await run.start({ inputData: { userRequest: message.text } })

if (run.status === 'suspended') {
  // Workflow is waiting for approval — get the plan text from suspend payload
  const planText = run.steps['approval'].suspendPayload.planText
  await telegram.sendMessage(chatId, planText)
  // Store run.runId in your approval store with TTL
  approvalStore.set(approvalCode, { runId: run.runId, chatId, userId })
}

// User replies "go" or "/approve abc123"
const stored = approvalStore.get(approvalCode)
const run = infraWorkflow.getRunById(stored.runId)
await run.resume({ step: 'approval', resumeData: { approved: true } })
// Workflow continues from the execute step automatically
```

This replaces your entire current approval system. No more per-tool approvals. No more lost context when the user approves. The workflow remembers exactly where it was and what it was doing.

---

### 4. Planner (inside the workflow)

The planner is a focused LLM call inside `planStep` that produces a structured plan using Gemini's structured output mode. It does not execute anything — it only plans.

```typescript
// packages/agent-core/src/planner.ts
async function generatePlan(userRequest: string): Promise<Plan> {
  const result = await plannerAgent.generate(userRequest, {
    output: z.object({
      goal: z.string(),
      steps: z.array(z.object({
        id: z.string(),
        order: z.number(),
        description: z.string(),       // shown to user: "Create S3 bucket 'my-assets'"
        tool: z.string(),
        command: z.string(),           // exact CLI command
        risk: z.enum(['read_only', 'low_risk', 'significant', 'destructive']),
        outputVar: z.string().optional(),
        inputVars: z.record(z.string()).optional(),
      })),
      requiresApproval: z.boolean(),
    }),
  })
  return result.object
}
```

Using **structured output** (not function calling) for the planner is important. You want a guaranteed schema. Structured output mode tells Gemini to emit JSON conforming to your Zod schema — no regex, no parse failures.

**Output variable passing** — this is how multi-step tasks share data:

```
Step 1: aws s3api create-bucket --bucket my-assets
        outputVar: "bucketName"  →  stores "my-assets"

Step 2: aws cloudfront create-distribution --origin ${bucketName}.s3.amazonaws.com
        inputVars: { bucketName: "step1.bucketName" }  →  resolves to "my-assets"

Step 3: aws s3api put-bucket-policy --bucket ${bucketName} --policy '...'
        inputVars: { bucketName: "step1.bucketName" }
```

---

### 5. Responder

A focused LLM call that runs after all execution is complete. Its only job: take raw tool outputs and write the message the user sees.

This is currently the source of a lot of quality problems — the same LLM that decides what tools to call also composes the user response, while still mid-loop. Separating these concerns fixes response quality dramatically.

```typescript
// packages/agent-core/src/responder.ts
export const responder = new Agent({
  name: 'Responder',
  model: google('gemini-2.0-flash'),
  instructions: `
    You write the final message the user sees after infrastructure operations.
    
    Rules:
    - Lead with the key outcome: what was done, or what was found
    - Use tables for lists of resources (name, status, cost, date)
    - Include concrete numbers: counts, costs, sizes, dates
    - Flag anomalies: security issues, idle resources, missing configs
    - For completed multi-step ops: list what was created with key details (ARN, URL, domain)
    - For failures: say exactly what failed, what succeeded before it, and what to do next
    - Max 3000 characters (Telegram limit is 4096, leave margin)
    - NEVER include raw JSON, command strings, or tool names
    - NEVER state facts not present in the tool output you were given
    - NEVER make up URLs, ARNs, or resource identifiers
  `,
})
```

---

## File Structure After Migration

```
packages/
  agent-core/
    src/
      router.ts              ← Intent classification
      agents/
        devops-agent.ts      ← Mastra Agent (queries + single actions)
        planner-agent.ts     ← Plan generation with structured output
        responder-agent.ts   ← Final response composition
      workflows/
        infra-workflow.ts    ← Multi-step task execution with suspend/resume
      tools/
        shell-execute.ts     ← Your existing shell.execute (wrapped for Mastra)
        github/              ← Your existing 17 GitHub tools (wrapped)
        devops/              ← Your existing 12 runtime tools (wrapped)
      memory/
        store.ts             ← Mastra Memory with LibSQL backend
      index.ts               ← Exports + Mastra instance
```

Your existing tool implementations don't change. You wrap them:

```typescript
// packages/agent-core/src/tools/shell-execute.ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { shellExecuteImpl } from '@helmsman/tools'  // your existing impl

export const shellExecuteTool = createTool({
  id: 'shell_execute',
  description: 'Execute CLI commands: aws, kubectl, helm, docker, curl, jq',
  inputSchema: z.object({
    command: z.string().describe('The full CLI command to execute'),
  }),
  execute: async ({ context }) => {
    return shellExecuteImpl(context.command)  // zero changes to your code
  },
})
```

---

## Memory and Conversation State

Mastra has built-in memory with pluggable backends. Use `@mastra/libsql` for a lightweight SQLite-backed store that persists across restarts without needing a full Postgres setup.

```typescript
import { Memory } from '@mastra/memory'
import { LibSQLStore } from '@mastra/libsql'

const memory = new Memory({
  storage: new LibSQLStore({ url: 'file:./helmsman.db' }),
})

export const devopsAgent = new Agent({
  name: 'Helmsman',
  model: google('gemini-2.0-flash'),
  instructions: HELMSMAN_INSTRUCTIONS,
  tools: { ... },
  memory,  // ← automatic conversation persistence
})
```

For multi-step workflows, Mastra workflow state is also persisted to this storage. When the user says "go" hours later, the workflow resumes from exactly where it was — even if the server restarted in between.

---

## The Prompts

The current system prompt is one 200-line blob trying to cover identity, tools, behavior, safety, and examples. Split it by concern.

### Identity Prompt (always loaded, ~150 words)

```
You are Helmsman — a senior DevOps engineer who lives in Telegram.
You're the person teams ping when something breaks at 2am because you fix things.
You have full access to AWS (all services), GitHub, and container runtime.

Communication:
- Lead with the answer. Context after.
- Use numbers: "$30/month", "14 instances", "47 days idle"
- Tables for structured data, bullets for lists of 3+
- Never paste raw JSON. Never expose tool names or commands.
- Never start with "I'd be happy to..." — just do the thing.
- Flag problems you notice even if not asked.
- Never state a fact you haven't confirmed from a tool call in this session.
```

### Query/Action Agent Prompt (focused on execution)

```
You are executing a specific DevOps task. Use tools to get real data.

Rules:
- Call tools immediately. Do not explain what you're about to do first.
- For data questions: call the tool, read the result, answer from it. Not from memory.
- For AWS: always --output json, use --query for clean extraction.
- CloudFront: use list-distributions, not describe-distribution.
- Cost queries: literal date strings only. Never $(date ...) or shell substitution.
- EC2 creation: IMDSv2, Name tag, not default VPC.
- S3 creation: block public access, versioning, SSE-S3 encryption.
- Read current state before modifying anything.
```

### Planner Prompt (focused on decomposition)

```
Decompose the user's request into an ordered list of CLI steps.

Rules:
- One command per step. Never chain with && or ||.
- Mark dependencies: if step 3 needs bucket name from step 1, set inputVars.
- Risk levels: read_only (list/describe), significant (create/modify), destructive (delete/terminate)
- requiresApproval: true if any step is significant or destructive
- For Lambda code: step 1 is code generation, steps 2+ are deployment
- AWS best practices built into every command (encryption, versioning, etc)
```

---

## The Approval Flow (Definitive)

| Scenario | Behavior |
|---|---|
| Read-only query | No approval. Execute immediately. |
| Single low-risk write | Execute immediately, notify what was done. |
| Multi-step with any significant step | Show plan → suspend → user says "go" → execute all steps → progress updates |
| Destructive action | Show plan with explicit warning → require typing resource name to confirm |

The user types "go" (or any affirmative). No `/approve abc123` codes required. The Telegram handler maps the reply to the pending workflow run by `chatId + userId`.

```typescript
// When user replies "go" to a pending plan
const pendingRun = approvalStore.getByChat(chatId, userId)
if (pendingRun) {
  const workflow = mastra.getWorkflow('infra-workflow')
  await workflow.resume({
    runId: pendingRun.runId,
    step: 'approval',
    resumeData: { approved: true },
  })
}
```

---

## Verifier (Lightweight, No LLM)

After each tool call, check the output deterministically before feeding it to the responder. This is pattern matching, not another LLM call.

```typescript
function verify(command: string, output: string): { ok: boolean; issue?: string } {
  const lower = output.toLowerCase()

  const errorPatterns = [
    'accessdenied', 'access denied',
    'nosuchbucket', 'no such file',
    'error:', 'exception:',
    'invalid parameter',
  ]

  for (const p of errorPatterns) {
    if (lower.includes(p)) return { ok: false, issue: `Error keyword found: "${p}"` }
  }

  // Tool-specific checks
  if (command.includes('create-bucket') && !lower.includes('location')) {
    return { ok: false, issue: 'create-bucket missing expected location in response' }
  }

  if (command.includes('create-distribution') && !lower.includes('domainname')) {
    return { ok: false, issue: 'create-distribution missing expected domainName in response' }
  }

  return { ok: true }
}
```

---

## Lambda Code Generation Flow

When the user asks "create a Lambda that does X":

```
Plan:
  Step 1: [internal] Generate function code           (no tool call — planner writes code inline)
  Step 2: Write code to container: devops.shell.run   (echo '...' > /tmp/fn.js)
  Step 3: Zip it: devops.shell.run                    (cd /tmp && zip function.zip fn.js)
  Step 4: Create IAM role if needed: shell.execute    (aws iam create-role ...)
  Step 5: Create Lambda: shell.execute                (aws lambda create-function --zip-file fileb:///tmp/function.zip)
  Step 6: Create function URL: shell.execute          (aws lambda create-function-url-config --auth-type NONE)

Output: Function ARN + live URL
```

The planner LLM generates the code as a string in the plan step. The `devops.shell.run` tool writes it to the container. No new tools needed — `devops.shell.run` and `shell.execute` cover the whole flow.

---

## Understanding Your Tools (Practical Guide)

This is what the tools are actually for. The agent needs clear examples of when to reach for each one.

**`shell.execute`** — 90% of AWS work. Every `aws <service> <command>` call.
```
aws ec2 describe-instances
aws s3api list-buckets
aws cloudfront list-distributions
aws lambda create-function
aws iam create-role
aws ce get-cost-and-usage
```

**`github.*` tools** — Use when the user pastes a GitHub URL or asks about a repo.
- Someone pastes `github.com/acme/platform` → `github.repo.get` + `github.prs.list`
- "Is CI passing?" → `github.actions.getWorkflowRun`
- "What issues are open?" → `github.issues.list`
- "What's in this file?" → `github.repo.getFile`

**`devops.ssh.exec`** — Run a command on a remote server.
- "Check disk on prod-01" → `devops.ssh.exec` with `df -h`
- "What's running on the api server?" → `devops.ssh.exec` with `ps aux`

**`devops.ssh.fileRead` / `devops.ssh.fileWrite`** — Read/write config files on servers.
- "Show me the nginx config on prod" → `devops.ssh.fileRead`
- "Update the env file on staging" → `devops.ssh.fileWrite` (destructive, needs approval)

**`devops.git.*`** — Full git workflow in an isolated container.
- "Clone this repo and tell me what the Dockerfile does" → `devops.git.clone` + `devops.shell.run`
- "Make a commit with these changes" → `devops.git.commit` + `devops.git.push`

**`devops.shell.run`** — Arbitrary command in the Docker container.
- "Run the tests for this repo" → `devops.shell.run` with `npm test`
- Writing Lambda code to disk before zipping and deploying

---

## Phased Implementation Plan

### Phase 1 — Foundation (2-3 days, highest impact)
1. Install Mastra: `npm install @mastra/core @mastra/libsql @ai-sdk/google`
2. Wrap your 3 most-used tools in Mastra's `createTool` format (`shell.execute`, 2-3 GitHub tools)
3. Replace `GeminiProvider` + text-based loop with a Mastra Agent
4. Test: native function calling, no more regex parsing, `toolChoice: 'required'` for queries
5. Verify hallucinations are gone for basic queries

**This alone fixes the proxlay CDN problem and most wrong answers.**

### Phase 2 — Multi-Step (3-4 days)
1. Add the Router node
2. Add the Planner with structured output
3. Wire the Mastra Workflow with suspend/resume
4. Replace per-tool approval with plan-level approval
5. Add output variable passing between steps

**This fixes "create S3 + CloudFront" forgetting the CloudFront part.**

### Phase 3 — Quality (2-3 days)
1. Add the Responder as a separate final LLM call
2. Add the deterministic Verifier
3. Split and improve the system prompt
4. Add few-shot examples for GitHub and SSH tools
5. Add progress streaming to Telegram during multi-step execution

### Phase 4 — Memory and Persistence (1-2 days)
1. Add Mastra Memory with LibSQL
2. Conversations now persist across restarts
3. Add session-scoped infrastructure context (region, known resources)
4. Connect Prisma DB for longer-term history

---

## What NOT to Do

**Don't** migrate all 30 tools at once. Start with `shell.execute`. Add others iteratively.

**Don't** use `toolChoice: 'required'` for the chat type. Casual greetings shouldn't force a tool call.

**Don't** add more system prompt text to fix hallucinations. Switch to native function calling — that's the actual fix.

**Don't** build a custom supervisor loop. Mastra's agent loop handles retries, multi-turn tool use, and max iterations. Trust the framework.

**Don't** use Gemini's text-based function calling emulation. Use the Vercel AI SDK's Google provider (`@ai-sdk/google`) which maps to Gemini's real native function calling API.

---

## Success Criteria

You'll know Phase 1 is done when:
- A question like "how many S3 buckets?" always results in a tool call, never a made-up answer
- Tool names in the code are `shell_execute` not raw JSON strings
- No more regex parsing anywhere in the agent

You'll know Phase 2 is done when:
- "Create S3 bucket my-assets and set up CloudFront" produces a 3-step plan, shows it to the user, waits for "go", and executes all 3 steps automatically
- The approval is stored in Mastra's workflow state, not an in-memory TTL store

You'll know Phase 3 is done when:
- User responses never contain raw JSON, command strings, or error stack traces
- The agent mentions security issues and cost anomalies it notices, unprompted
- GitHub tool use is demonstrated in at least 2 conversation flows

---

## One More Thing: Model Strategy
(Late I can use different model. so write modular and maintainable code.)
You're using Gemini Flash for everything. That's fine to start but consider:

| Task | Recommended | Why |
|---|---|---|
| Router | `gemini-2.0-flash` | Simple classification, needs to be fast |
| Devops Agent | `gemini-2.0-flash` | Tool calling, structured tasks |
| Planner | `gemini-2.5-pro` | Complex decomposition benefits from smarter reasoning |
| Responder | `gemini-2.0-flash` | Summarization, fast is fine |

Using a smarter model just for planning costs a few extra cents per multi-step request but dramatically improves plan quality. The planner runs once per task, not per step. Worth it.

Mastra's model routing makes swapping models per-agent trivial — one line change.