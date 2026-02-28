# Architecture — System Design

How InfraChat is built, from message in to infrastructure action out.

---

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                        │
│         Telegram Bot (Phase 1)      Slack App (Phase 2)       │
└───────────────────────┬──────────────────────────────────────┘
                        │  Webhook (message received)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     MESSAGE GATEWAY                           │
│  • Validates webhook signatures (Slack/Telegram security)     │
│  • Normalizes message format (text, files, reactions)         │
│  • Deduplicates (Slack retries on timeout)                    │
│  • Routes to correct workspace/team context                   │
│  • Sends typing indicator immediately (user feedback)         │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                       AGENT CORE                              │
│                                                               │
│   Context Manager ──────────────────────────────────┐        │
│   • Loads conversation history                      │        │
│   • Loads team's known infra state                  │        │
│   • Loads user permissions                          │        │
│                                                     ▼        │
│   Intent Engine ◄───────────────────────── LLM (Claude)      │
│   • Classifies intent                               │        │
│   • Extracts entities (repos, resource IDs, etc.)   │        │
│   • Determines what to investigate first            │        │
│                                                     │        │
│   Investigation Engine ─────────────────────────────┤        │
│   • Queries real infra before forming plan          │        │
│   • Parallel API calls when possible                │        │
│   • Caches results for duration of conversation     │        │
│                                                     │        │
│   Plan Builder ◄────────────────────────── LLM      │        │
│   • Generates step-by-step execution plan           │        │
│   • Calculates cost/time estimates                  │        │
│   • Assigns risk levels to each step                │        │
│                                                     │        │
│   Approval Gate                                     │        │
│   • Routes to correct approval mode                 │        │
│   • Waits for user response                         │        │
│   • Validates confirmation (for destructive actions)│        │
│                                                     │        │
│   Executor                                          │        │
│   • Runs approved steps via tool calls              │        │
│   • Streams progress to user                        │        │
│   • Handles errors, stops cleanly on failure        │        │
│   • Logs all actions to audit trail                 │        │
└───────────────────────┬──────────────────────────────────────┘
                        │  Tool calls
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                       TOOLS LAYER                             │
│                                                               │
│  Each tool is a sandboxed module wrapping an external API     │
│                                                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  │   AWS     │ │  GitHub   │ │  Docker   │ │    K8s    │    │
│  │  Tool     │ │  Tool     │ │  Tool     │ │   Tool    │    │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                   │
│  │    GCP    │ │  DO/VMs   │ │  Terraform│                   │
│  │  Tool     │ │  Tool     │ │  Tool     │                   │
│  └───────────┘ └───────────┘ └───────────┘                   │
└───────────────────────┬──────────────────────────────────────┘
                        │  For tasks requiring code execution
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                   EXECUTION CONTAINERS                        │
│                                                               │
│  Ephemeral Docker containers for tasks like:                  │
│  • Building Docker images                                     │
│  • Cloning and analyzing repos                               │
│  • Running Terraform plans                                    │
│                                                               │
│  Lifecycle:                                                   │
│  Spin up → Mount scoped credentials → Execute → Destroy       │
│                                                               │
│  Never share credentials across containers                    │
│  Never keep containers alive after task completes             │
└──────────────────────────────────────────────────────────────┘
```

---

## Component Deep Dives

### Message Gateway

Thin, fast, stateless. Deployed as a serverless function (Lambda or Cloud Run).

Key responsibilities:
- Verify Telegram bot token
- Verify Slack request signatures (HMAC-SHA256) when Slack is enabled
- Respond quickly and process async (Slack-specific 3-second ack requirement applies when Slack is enabled)
- Parse message format: text, attachments, thread replies, reactions
- Map Telegram chat / Slack workspace → team context in your database
- Handle platform-specific webhook verification and retries

---

### Agent Core

The stateful, reasoning component. This is where the product lives.

**Context Manager:**
Loads everything relevant before the LLM sees the message:
- Last N messages in the conversation (typically 20–50)
- Known infrastructure state for this team (cached, refreshed on queries)
- User's permission level (read-only, operator, admin)
- Team configuration (preferred cloud, regions, approval settings)
- Relevant past actions (what was deployed recently?)

**LLM Integration:**
The agent uses an LLM (Claude Sonnet recommended) with a carefully designed system prompt that:
- Defines the agent's capabilities and constraints
- Establishes the plan-before-act behavior
- Defines the output format for plans, confirmations, and progress updates
- Sets the tone (professional, clear, never condescending)
- Defines when to ask clarifying questions vs. make a reasonable assumption

The LLM uses function/tool calling to invoke the tools layer. This is structured (JSON), not freeform text parsing.

**Tool Call Pattern:**
```json
{
  "tool": "aws",
  "action": "describe_instances",
  "params": {
    "region": "us-east-1",
    "filters": [{"Name": "instance-state-name", "Values": ["running"]}]
  }
}
```

The LLM decides which tools to call, in what order, and how to interpret the results. This is the reasoning layer.

---

### Tools Layer

Each tool is a typed, documented module that the LLM can call. Tools have:
- A description the LLM uses to decide when to call it
- Typed input parameters with validation
- Structured output the LLM can reason about
- Read vs. write permission separation
- Error handling that returns structured errors (not raw exceptions)

**AWS Tool — Key Actions:**

```
read:
  list_instances, describe_instance, get_metrics
  list_buckets, get_bucket_policy, get_bucket_website_config
  list_distributions, describe_distribution
  list_rds_instances, describe_rds_instance
  get_security_groups, describe_vpc, describe_subnets
  get_cost_and_usage, list_lambda_functions
  list_iam_roles, get_role_policy

write:
  start_instance, stop_instance, reboot_instance
  create_instance, terminate_instance, modify_instance_type
  create_bucket, put_bucket_policy, put_bucket_website
  create_distribution, update_distribution, create_invalidation
  create_rds_instance, modify_rds_instance, create_rds_snapshot
  create_security_group, authorize_ingress, revoke_ingress
  create_vpc, create_subnet, create_nat_gateway
  release_elastic_ip, delete_elastic_ip
```

**Kubernetes Tool:**
Wraps kubectl and the K8s API. Supports all standard resource types.

**GitHub Tool:**
Uses GitHub API + git CLI in execution containers. Can read files, understand repo structure, commit, and open PRs.

**Docker Tool:**
Runs in execution containers. Can build, tag, push, pull, and inspect images.

---

### Execution Containers

For operations that require running actual code (not just API calls), the agent spawns ephemeral containers.

Use cases:
- Building Docker images (requires Docker daemon)
- Cloning and analyzing repositories (requires git + language runtimes)
- Running `terraform plan` or `terraform apply`
- Generating Kubernetes manifests with Helm

Container properties:
- Base image: lightweight Linux + required tools installed
- Lifetime: one task, then destroyed
- Credentials: injected at runtime, never baked into image, revoked on container destroy
- Networking: outbound only (can pull from registries, clone repos), no inbound
- Resource limits: CPU + memory caps to prevent runaway builds

Container orchestration: ECS Fargate Tasks or Kubernetes Jobs work well. Fargate is simpler to operate; K8s Jobs give more control.

---

## Data Architecture

### Databases

**PostgreSQL (primary store):**
- `teams` — team configs, connected integrations, permission settings
- `users` — user accounts, Slack/Telegram identity mapping
- `conversations` — message history per channel/chat
- `audit_log` — every action the agent has ever taken (immutable, append-only)
- `credentials` — encrypted cloud provider credentials per team

**Redis:**
- Active conversation context (fast reads for the agent)
- Rate limiting state
- Session tokens
- Job queue for execution containers

**Object Storage (S3/GCS):**
- Execution container logs
- Generated files (Dockerfiles, workflow YAMLs, etc.) before they're committed to repos
- Audit log archives

---

## Credential Management

This is critical for security. User credentials (AWS keys, GitHub tokens, etc.) must be handled carefully.

**Storage:**
- Encrypted at rest using AES-256
- Encryption key in AWS KMS (or equivalent) — never in application code
- Credentials never logged, never returned in API responses, never shown in chat

**Access:**
- Credentials fetched from secrets store at execution time only
- Injected into execution containers via environment variables (not files)
- Revoked/cleaned from container environment after task completes

**Rotation reminders:**
- Agent tracks credential age and reminds users to rotate after 90 days
- Agent detects and warns about overly permissive credentials (e.g., AdministratorAccess)

**Least privilege guidance:**
- When a user connects their AWS account, the agent shows them a minimal IAM policy for their use case
- Agent can create a scoped IAM role specifically for InfraChat access

---

## Reliability & Scaling

**Message Gateway:** Stateless → scales horizontally with zero config. Serverless is ideal.

**Agent Core:** Stateful (needs conversation context) → deploy with sticky sessions or Redis-backed state. Scale based on active conversation count.

**Execution Containers:** Queue-based → SQS + ECS Fargate Spot, or Kubernetes Jobs. Scale down to zero when idle.

**LLM calls:** High latency (2–10 seconds per call) → never block the user thread. Always async with streaming.

**Failure modes:**
- LLM timeout → return graceful error, don't lose the user's message
- AWS API rate limit → back off and retry, inform user of delay
- Execution container failure → report exact error, preserve partial state
- Agent mid-execution crash → execution log allows resuming from last successful step

---

## Security Architecture

```
Internet
    │
    ▼
Cloudflare (DDoS protection + WAF)
    │
    ▼
Load Balancer (TLS termination)
    │
    ▼
Message Gateway (verifies webhook signatures)
    │
    ▼
Internal VPC only:
  Agent Core ←→ Redis
  Agent Core ←→ PostgreSQL
  Agent Core ←→ Secrets Manager
  Agent Core ←→ Execution Container Orchestrator
  Execution Containers ←→ External APIs (AWS, GCP, GitHub, Docker)
```

All internal communication is within a private VPC. The only public-facing component is the Message Gateway (load balancer endpoint for Slack/Telegram webhooks).
