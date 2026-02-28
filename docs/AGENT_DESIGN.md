# Agent Design — How the AI Reasons and Acts

This document explains how the AI agent works under the hood: how it interprets intent, investigates infrastructure, builds plans, and executes safely.

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
