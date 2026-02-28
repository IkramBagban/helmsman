# Agent Design — How the AI Reasons and Acts

> This document explains how the AI agent works under the hood: how it interprets intent, investigates infrastructure, builds plans, executes safely, and how its tool/knowledge architecture is designed.

---

## Design Philosophy

The agent is not a command router. It doesn't match keywords to pre-built scripts.

It is a **reasoning system** that:
1. Understands what the user is trying to achieve
2. Investigates the actual current state of their infrastructure
3. Figures out the correct steps to achieve the goal
4. Presents those steps for approval
5. Executes with real tools

The difference is significant. A command router can only do what it was pre-programmed for. A reasoning agent can handle situations it has never seen before, combine tools in novel ways, and explain its thinking.

### Key Principle from Anthropic (Building Effective Agents)

> "The most successful implementations weren't using complex frameworks or specialized libraries. Instead, they were building with simple, composable patterns."

We follow Anthropic's recommendation: **start simple, add complexity only when it demonstrably improves outcomes.** No LangChain. No Vercel AI SDK. No heavy agent frameworks. Just LLM + tools + structured prompts in a loop.

### Engineering Principles (Inspired by OpenClaw, Adapted to Helmsman)

| Principle | What It Means for Us |
|-----------|---------------------|
| **LLM as intelligence, not infrastructure** | The LLM is the reasoning layer. Everything else (session management, tool execution, audit, orchestration) is our code. |
| **No framework lock-in** | Custom `LLMProvider` adapters wrap each SDK directly. ~100 LOC per provider. Full control, zero abstraction debt. |
| **Model-agnostic** | Support Claude, GPT, Gemini, and any OpenAI-compatible endpoint. Swap providers via config. |
| **Provider failover** | If a provider is rate-limited or down, automatically cool down that key and switch to backup. |
| **Tools are capabilities, knowledge is skill** | Tools determine what we *can* do. System prompts + few-shot examples determine how *well* we do it. |
| **Deterministic orchestration** | The agent loop is a simple while-loop with tool calling, not an LLM-driven graph. The LLM reasons; our code orchestrates. |
| **Serial-first execution** | Plan steps execute serially by default. Parallel only for explicitly independent, idempotent read operations. |

---

## The Core Loop

Every user message goes through the same loop:

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│   1. UNDERSTAND                                          │
│      Parse the message + full conversation history       │
│      Identify: What does the user want?                  │
│      Classify: Question, Action, Debug, or Explore?      │
│                                                          │
│   2. INVESTIGATE (for actions and debugging)             │
│      Query relevant parts of the infrastructure          │
│      Gather real data before forming any opinion         │
│      Never guess — always check                          │
│                                                          │
│   3. REASON                                              │
│      What is the correct approach?                       │
│      What are the risks?                                 │
│      What does best practice say?                        │
│      What are the alternatives?                          │
│                                                          │
│   4. RESPOND                                             │
│      Questions → Answer with real data                   │
│      Actions → Present a plan and ask for approval       │
│      Debugging → Show findings + ranked causes + fix plan│
│                                                          │
│   5. EXECUTE (only after approval)                       │
│      Run steps in order                                  │
│      Stream progress back in real time                   │
│      Handle failures gracefully                          │
│      Report completion + any follow-up recommendations   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## Intent Classification

When a message arrives, the agent classifies it before deciding what to do.

| Type | Description | Examples |
|------|-------------|---------|
| **Query** | User wants information about their infra | "How many EC2 instances are running?", "What's our RDS storage usage?" |
| **Action** | User wants something done | "Deploy this app", "Stop this instance", "Create an S3 bucket" |
| **Debug** | Something is broken, user wants root cause | "My website isn't loading", "The API is throwing 500s" |
| **Explain** | User wants something explained | "What does this Lambda do?", "Why is our bill so high this month?" |
| **Optimize** | User wants improvements | "Can we save money somewhere?", "Is this setup efficient?" |
| **Explore** | User is exploring possibilities | "What would it take to add a CDN?", "How would we set up disaster recovery?" |

Each type triggers a different response mode.

---

## Investigation — "Look Before You Act"

The most important design decision: **the agent never acts on assumptions about the current state of infrastructure. It always checks first.**

This matters because:
- Infrastructure changes constantly (other team members deploy things, auto-scaling fires, instances fail)
- Assumptions lead to wrong plans
- Wrong plans lead to mistakes that can be expensive or irreversible

**Example of why this matters:**

User says: "restart the payments service"

Wrong approach (assumption-based):
→ Agent immediately sends `kubectl rollout restart deployment/payments-service` and hopes it exists

Right approach (investigation-based):
→ Agent first queries: Does this deployment exist? In which namespace? What's its current state? Are there any active alerts on it?
→ Only then forms and presents a plan

**Investigation is fast.** API calls to AWS, GCP, or Kubernetes return in 1–3 seconds. The user experience impact is minimal, but the safety impact is massive.

---

## Plan Building

For any action, the agent builds an explicit, human-readable plan before executing anything.

A good plan includes:
- **Steps in order**, with what each step does
- **Estimated time** for the full operation
- **Cost impact** (if any resources are being created or destroyed)
- **Risk level** of each step (read-only / reversible / irreversible)
- **What happens if a step fails** (and how to roll back)
- **Any information the agent needs from the user** before starting

Plans are written for a non-expert to understand. Jargon is explained. Tradeoffs are surfaced.

### Plan Example (Internal Structure)

```json
{
  "goal": "Deploy checkout-service to production",
  "steps": [
    {
      "id": 1,
      "action": "create_dockerfile",
      "description": "Generate a multi-stage Dockerfile for Node.js 20",
      "risk": "low",
      "reversible": true,
      "estimated_seconds": 5
    },
    {
      "id": 2,
      "action": "build_docker_image",
      "description": "Build image acmecorp/checkout-service:v1.0.0",
      "risk": "low",
      "reversible": true,
      "estimated_seconds": 120
    },
    {
      "id": 3,
      "action": "provision_ec2",
      "description": "Create EC2 t3.medium in us-east-1",
      "risk": "medium",
      "reversible": true,
      "cost_delta_monthly": 30.37,
      "estimated_seconds": 60
    }
  ],
  "total_estimated_seconds": 600,
  "total_cost_delta_monthly": 30.37
}
```

This structure is converted to a readable plan for the user, but the internal representation allows the executor to be precise.

---

## The Approval Gate

**Nothing executes without passing through the approval gate.**

The gate has four modes:

### Auto-approve
For read-only operations (querying, reading logs, describing resources). These never change anything, so no approval is needed.

```
User:   show me the logs for the payments pod
Agent:  [reads logs immediately without asking for approval]
        Here are the last 100 lines...
```

### Soft confirm
For low-risk write operations (creating a Dockerfile, opening a PR). The agent states what it will do and proceeds unless the user objects.

```
Agent:  I'll create a Dockerfile and push a PR. Proceeding...
```

### Explicit approve
For significant infrastructure changes (creating VMs, modifying deployments, changing configs). The user must actively say "yes", "go", "approve", "do it", etc.

```
Agent:  [presents plan]
        Ready to proceed. Type "approve" to start.
```

### Hard confirm
For irreversible destructive actions (deleting databases, terminating instances, dropping data). The user must type the resource name or a confirmation string to prove they read the warning.

```
Agent:  ⚠️  This will PERMANENTLY DELETE the RDS instance "prod-payments-db"
             and all data in it. This cannot be undone.
             
             To confirm, type the database name exactly:
             
User:   prod-payments-db

Agent:  Understood. Deleting...
```

---

## Execution & Error Handling

Once approved, the executor runs steps in order and streams status updates.

**Happy path:**
```
✅ Step 1/5 — S3 bucket created
✅ Step 2/5 — Bucket policy applied
🔄 Step 3/5 — Creating CloudFront distribution... (may take up to 15 minutes)
```

**When a step fails:**
The executor stops immediately and reports:
```
❌ Step 3/5 — Failed to create CloudFront distribution

Error: "InvalidViewerCertificate: The specified SSL certificate doesn't exist"

Root cause: The ACM certificate for app.acmecorp.com is in us-east-1, 
but CloudFront requires certificates in us-east-1. 
Wait — your certificate is in eu-west-1, which is why CloudFront can't find it.

Options:
  A) Request a new certificate in us-east-1 and continue (takes ~5 min)
  B) Cancel and investigate further

Steps 1 and 2 have already been completed (S3 bucket + policy are fine).
```

The agent never silently swallows errors or retries without telling the user.

---

## Context and Memory

The agent maintains state across the full conversation. This enables multi-turn workflows.

**Within a conversation:**
- Remembers what was deployed and where
- Remembers what the user approved and what they declined
- Connects follow-up messages to earlier context ("that instance" refers to the one discussed 5 messages ago)

**Across conversations (persistent memory):**
- Known infrastructure inventory per team (updated after each action)
- User preferences (preferred cloud provider, regions, deployment targets)
- Team permission settings (who can approve what)
- Audit log of all past actions

---

## Best Practices Layer

The agent doesn't just do what the user asks — it does it *correctly*.

When the agent generates infrastructure, it automatically applies best practices without the user needing to ask:

- New EC2 instances: tagged, in a VPC (not default), IMDSv2 enabled, security group locked down
- New S3 buckets: private by default, versioning on, encryption enabled
- Docker images: multi-stage builds, non-root user, no secrets in the image
- Kubernetes deployments: resource limits set, health checks defined, rolling update strategy
- IAM roles: least-privilege policies, no hardcoded credentials
- RDS: automated backups enabled, deletion protection on for production, encrypted storage

If the user explicitly asks for something that violates best practices, the agent does it but flags it:

```
User:   create an s3 bucket and make it fully public

Agent:  Creating acmecorp-public-assets with public read access...

        ⚠️  Note: This bucket will be publicly readable by anyone on the internet.
        This is appropriate for CDN-style static asset serving, but be careful 
        never to upload sensitive files to this bucket.
        
        For hosting a website with more control, CloudFront + private S3 + OAC 
        is generally a better pattern. Let me know if you'd like that instead.

        ✅ Bucket created with public read ACL
```

The agent never silently does the wrong thing. But it also doesn't block the user from doing what they want — it informs and executes.

---

## Tool Architecture — The Hybrid Approach

### The Problem: You Can't Create a Tool for Everything

AWS alone has 300+ services, each with dozens of API calls. Kubernetes has hundreds of resources. You cannot (and should not) create a separate tool for each.

Three approaches exist, each with trade-offs:

| Approach | Pros | Cons |
|----------|------|------|
| **Static tools only** — one tool per API call | Type-safe, testable, auditable, controlled scope | Doesn't scale (thousands of tools needed), brittle, slow to add support |
| **Raw CLI/shell only** — let the AI run any command | Infinite flexibility, covers every service instantly | Dangerous, hard to audit, prompt injection risk, error-prone |
| **Hybrid** — curated tools + sandboxed CLI + knowledge | Best of both — safe defaults for common ops, flexibility for the long tail | More complex architecture, need good sandboxing |

**We use the Hybrid approach.** This is what Anthropic, AWS Bedrock Agents, and every serious production agent uses.

### Our Three-Layer Tool Architecture

```
Layer 1: Curated Tools (high-frequency, well-understood operations)
┌──────────────────────────────────────────────────────────┐
│  aws.ec2.describeInstances     aws.s3.createBucket       │
│  aws.ec2.stopInstances         aws.cost.getMonthlySummary │
│  aws.cloudwatch.getMetrics     ...                        │
│                                                           │
│  These are type-safe, Zod-validated, tested tools.       │
│  The LLM gets rich parameter descriptions.                │
│  Policy engine classifies risk at the tool level.         │
│  ~10-20 tools cover 80% of daily DevOps tasks.            │
└──────────────────────────────────────────────────────────┘

Layer 2: Sandboxed CLI Executor (the long tail)
┌──────────────────────────────────────────────────────────┐
│  tool: "shell.execute"                                    │
│                                                           │
│  The LLM generates a CLI command (aws cli, kubectl, etc.) │
│  Command is validated against an allowlist of binaries.    │
│  Execution happens in a restricted sandbox:                │
│    - Network: only AWS/K8s API endpoints                  │
│    - Filesystem: read-only, no write access               │
│    - Timeout: 30 seconds max                              │
│    - Output: captured and post-processed                  │
│                                                           │
│  Risk tier: ALWAYS requires at least "significant" level. │
│  For destructive CLI commands: "destructive" tier.         │
│  Every invocation logged to audit trail.                  │
└──────────────────────────────────────────────────────────┘

Layer 3: Knowledge + Reasoning (no execution needed)
┌──────────────────────────────────────────────────────────┐
│  The LLM answers using embedded knowledge:                │
│    - System prompts with AWS/K8s/DevOps best practices   │
│    - RAG over documentation (future)                     │
│    - Few-shot examples of successful operations          │
│                                                           │
│  For "explain", "compare", "recommend" intents,          │
│  no tool call is needed — the LLM reasons directly.       │
└──────────────────────────────────────────────────────────┘
```

### Why This Works

1. **80% of requests** hit Layer 1 (curated tools). Fast, safe, well-tested.
2. **15% of requests** use Layer 2 (CLI executor). Covers edge cases and obscure AWS/K8s operations without building 500 individual tools.
3. **5% of requests** are answered via Layer 3 (knowledge). Explaining concepts, comparing approaches, recommending architectures.

### Curated Tool Selection Criteria

Only create a dedicated tool when the operation:
- Is used frequently (top 20 DevOps tasks)
- Has safety implications (write operations that need risk classification)
- Benefits from structured output (instance lists, cost breakdowns)
- Needs parameter validation beyond what the CLI provides

Everything else goes through the sandboxed CLI executor.

### Shell Executor Safety

```typescript
// Allowlisted binaries (nothing else can run)
const ALLOWED_BINARIES = [
  "aws",       // AWS CLI
  "kubectl",   // Kubernetes
  "helm",      // Helm charts
  "docker",    // Docker (inspect only)
  "curl",      // HTTP calls (restricted endpoints)
  "jq",        // JSON processing
];

// Blocked patterns (even if binary is allowed)
const BLOCKED_PATTERNS = [
  /rm\s+-rf/,                    // recursive delete
  />\s*\/dev/,                   // write to device
  /\|\s*sh/,                     // pipe to shell
  /\$\(/,                        // command substitution
  /`/,                           // backtick execution
  /;\s*(rm|mv|cp|chmod|chown)/,  // chained destructive ops
  /--force-delete/,              // force delete flags
];

// Risk escalation for shell commands
function classifyShellRisk(command: string): RiskTier {
  if (BLOCKED_PATTERNS.some(p => p.test(command))) return "destructive";
  if (/delete|remove|destroy|terminate|purge/.test(command)) return "destructive";
  if (/create|update|modify|put|apply|deploy|stop|start/.test(command)) return "significant";
  if (/describe|list|get|show|log|status/.test(command)) return "low_risk";
  return "significant"; // default to significant for unknown
}
```

---

## Making the Agent Smarter — Knowledge Architecture

### The Problem

Creating 500 tools is the wrong approach. Instead, **make the LLM smarter** so it needs fewer tools but uses them better. This is done through:

1. **Rich system prompts** (knowledge baked into context)
2. **Few-shot examples** (successful past interactions)
3. **RAG / retrieval** (dynamic knowledge lookup)
4. **Prompt engineering on tools** (Anthropic's "ACI" concept)

### 1. System Prompt Engineering (MVP — Phase 1)

The most impactful, lowest-effort approach. Embed domain knowledge directly into system prompts.

```typescript
const SYSTEM_PROMPT = `
You are Helmsman, a DevOps AI agent. You help teams manage AWS infrastructure
through natural conversation.

## Your Capabilities
- Query and manage EC2 instances, S3 buckets, CloudWatch metrics, and AWS costs
- Execute AWS CLI commands for operations not covered by built-in tools
- Debug infrastructure issues by investigating logs, metrics, and configs
- Build and execute step-by-step plans for infrastructure changes

## AWS Best Practices You Always Apply
- EC2: Use IMDSv2, tag everything, prefer VPC over default, set termination protection for prod
- S3: Block public access by default, enable versioning, enable encryption (SSE-S3)
- IAM: Least privilege, no root keys, use roles over users
- RDS: Automated backups, encryption at rest, deletion protection for prod
- CloudWatch: Set alarms for CPU >80%, StatusCheckFailed, and billing thresholds
- Cost: Spot for stateless workloads, Reserved for steady-state, Savings Plans for compute
- General: Everything in a VPC, security groups with minimal ingress, use Parameter Store for secrets

## When You Don't Know
- If you're unsure about a specific AWS service or feature, say so honestly
- Use the shell.execute tool to run 'aws <service> help' to discover available commands
- Check current state before making changes (describe before modify)

## How You Respond
- For questions: answer directly with real data from tool calls
- For actions: present a plan, classify risk, ask for approval
- For debugging: investigate systematically, present ranked root causes
- Always show your reasoning, never just state conclusions
`;
```

This alone makes the agent significantly smarter without a single extra tool.

### 2. Tool Description Engineering (MVP — Phase 1)

Anthropic's research shows: **more time should be spent on tool descriptions than on the overall prompt.** Well-described tools perform 2x better than poorly described ones.

```typescript
// ❌ Bad tool description
{
  name: "aws.ec2.describeInstances",
  description: "Describe EC2 instances",
}

// ✅ Good tool description (Anthropic ACI best practice)
{
  name: "aws.ec2.describeInstances",
  description: `List and describe EC2 instances in a specific AWS region.

Use this tool when the user asks about:
- How many instances they have
- Instance status, IPs, types, or launch times
- Finding instances by tag, state, or type

Parameters:
- region: AWS region (default: us-east-1). Try the user's default region first.
- state: Filter by state. Common: "running" for active, "stopped" for idle.
- tags: Filter by tags like {"Environment": "production"}.

Returns a list of instances with: instanceId, state, type, publicIp, privateIp, 
launchTime, tags, and monitoring status.

Common patterns:
- "How many instances?" → call with no filters, count results
- "What's running in production?" → state="running", tags={"Environment":"production"}
- "Find the staging server" → tags={"Environment":"staging"} or tags={"Name":"*staging*"}

Tips:
- If user doesn't specify region, try their team's default region
- If no results, suggest trying other regions
- Always show instance IDs in responses (users need them for follow-up actions)`,
}
```

### 3. Few-Shot Examples in System Prompt (MVP — Phase 1)

Seed the system prompt with 3-5 successful interaction examples:

```typescript
const FEW_SHOT_EXAMPLES = `
## Example Interactions

### Example 1: Query
User: "How many EC2 instances do we have running?"
Agent thinking: Use aws.ec2.describeInstances with state=running
Agent response: "You have 7 running EC2 instances in us-east-1:
- 3x t3.medium (web servers: web-1, web-2, web-3)
- 2x t3.large (API servers: api-1, api-2)  
- 1x r5.xlarge (database replica)
- 1x t3.small (bastion host)
Monthly cost estimate: ~$285"

### Example 2: Action
User: "Stop the staging server to save money"
→ Investigate: describeInstances(tags={"Environment":"staging"})
→ Found: i-0abc123 (t3.large, running, "staging-api")
→ Plan: Stop instance i-0abc123 | Risk: significant | Saves ~$60/month
→ Ask for approval → Execute on "yes"

### Example 3: Debug  
User: "My website is showing 503 errors"
→ Investigate: describeInstances(tags={"Name":"*web*"}, state="running")
→ Investigate: getMetrics(instanceId, metric="CPUUtilization")
→ Investigate: getMetrics(instanceId, metric="StatusCheckFailed")
→ Finding: web-2 has failing status checks since 10:32 AM
→ Present: "Instance web-2 is failing health checks. Likely causes:
  1. Instance hardware issue (reboot should fix)
  2. Application crashed (check logs)
  Recommended: Reboot web-2. Shall I proceed?"
`;
```

### 4. RAG / Vector Search (Phase 2+)

For deeper knowledge beyond what fits in system prompts:

```
┌────────────────────────────┐
│   Knowledge Sources        │
│                            │
│  • AWS documentation       │
│  • Kubernetes docs         │
│  • Team runbooks           │
│  • Past successful plans   │
│  • Error resolution history│
└─────────┬──────────────────┘
          │ indexed
          ▼
┌────────────────────────────┐
│   Vector Store             │
│   (Postgres pgvector)      │
│                            │
│   Embedding model:         │
│   text-embedding-3-small   │
└─────────┬──────────────────┘
          │ similarity search
          ▼
┌────────────────────────────┐
│   Retrieval Tool           │
│                            │
│   tool: "knowledge.search" │
│   The LLM calls this tool  │
│   to look up documentation │
│   or past solutions        │
└────────────────────────────┘
```

The key insight: **RAG is just another tool.** The LLM decides when it needs more knowledge and calls a search tool. No separate RAG pipeline needed.

### 5. Learning from History (Phase 2+)

Store successful plans and their outcomes. When a similar request comes in, the agent can reference what worked before:

```typescript
// When a plan succeeds
await storeSuccessfulPattern({
  intent: "stop staging instance",
  tools_used: ["aws.ec2.describeInstances", "aws.ec2.stopInstances"],
  steps: [...],
  outcome: "success",
  duration_ms: 3400,
  user_satisfaction: "positive", // inferred from user response
});

// When building a new plan
const similarPatterns = await findSimilarPatterns(userMessage); // vector similarity
// Include in system prompt: "Similar operations that worked before: ..."
```

---

## Agent Intelligence Summary

| Layer | Phase | Effort | Impact | Description |
|-------|-------|--------|--------|-------------|
| System prompts with domain knowledge | 1 (MVP) | Low | **High** | Bake AWS/K8s best practices into system prompt |
| Tool description engineering (ACI) | 1 (MVP) | Low | **High** | Rich descriptions, examples, tips on every tool |
| Few-shot examples | 1 (MVP) | Low | **Medium** | 3-5 example interactions in system prompt |
| Curated high-frequency tools | 1 (MVP) | Medium | **High** | ~15 type-safe tools for common operations |
| Sandboxed CLI executor | 1 (MVP) | Medium | **High** | Covers the long tail safely |
| RAG over docs + runbooks | 2 | Medium | **Medium** | Vector search for deep knowledge |
| Learning from history | 2 | High | **Medium** | Store and recall successful patterns |
| MCP tool compatibility | 3 | Low | **Medium** | Plug into MCP ecosystem for pre-built tools |
| Agent skills / plugins | 3 | Medium | **Medium** | Modular knowledge packs per domain |

**MVP strategy: Rich prompts + ~15 curated tools + CLI executor = covers 95%+ of DevOps tasks.** No need for hundreds of tools. No need for RAG on day one. The LLM is already trained on all AWS/K8s documentation — you just need to prompt it well and give it safe execution access.

---

## Anthropic's Agent Patterns Applied to Helmsman

From ["Building Effective Agents"](https://www.anthropic.com/engineering/building-effective-agents):

| Pattern | How We Use It |
|---------|---------------|
| **Augmented LLM** | Base building block: Claude + tools + conversation memory |
| **Routing** | Intent classifier routes to specialized handlers (Query, Action, Debug) |
| **Prompt chaining** | Intent → investigate → plan → approve → execute (sequential) |
| **Orchestrator-workers** | For complex debug flows: orchestrator spawns parallel investigation calls |
| **Evaluator-optimizer** | Plan review: LLM generates plan → evaluator checks for issues → refine |

We do NOT use:
- **Full autonomous agents** — too risky for production infra. Human stays in the loop.
- **Heavy frameworks** (LangChain, CrewAI) — unnecessary abstraction over simple patterns.
