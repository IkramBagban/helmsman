# Helmsman — A Jarvis for Real-World Work, Starting with DevOps

> **Long-term: a full Jarvis-style execution agent across domains. Right now: a world-class DevOps agent you can talk to in Telegram (Slack next).**

---

## What Is Helmsman?

Helmsman is an AI execution agent designed to become a full “Jarvis” for technical teams across domains. It starts with DevOps first: connecting to your infrastructure and helping you manage, debug, deploy, optimize, and understand systems through natural conversation.

There is no new dashboard to learn. No CLI to remember. No docs to dig through.

You describe what you want. The agent reasons through it, investigates your real infrastructure, builds a plan, and asks for your approval. You say go. It executes — following best practices at every step.

It's not an automation script. It's not a chatbot with fixed commands. It's a reasoning agent that understands infrastructure the way a senior DevOps engineer does — and can act on it.

Current interface strategy: **Telegram first**, then Slack.

---

## Vision and Scope

**End-state vision:** Helmsman becomes a general-purpose Jarvis-style agent that can reason, plan, and execute across multiple technical and business workflows.

**Initial focus:** DevOps is the first vertical because it has high pain, clear ROI, and measurable outcomes.

## The Core Idea in One Sentence

**Anything a DevOps engineer can do — investigate, build, deploy, debug, fix, optimize, explain — the agent can do, triggered by a plain English message. This is the first specialization on the path to full Jarvis scope.**

---

## Documentation Index

| File | What's in it |
|------|-------------|
| [PRD.md](./PRD.md) | Product Requirements Document |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, data flow, and architecture |
| [CONVENTIONS.md](./CONVENTIONS.md) | Coding conventions and project standards |
| [DATA_MODEL.md](./DATA_MODEL.md) | Database schema and model design |
| [AGENT_DESIGN.md](./AGENT_DESIGN.md) | Agent reasoning, planning, and execution loop |
| [TRUST_AND_PERMISSIONS.md](./TRUST_AND_PERMISSIONS.md) | Security model and approval gates |
| [guides/](./guides/) | Specialized engineering guides (Memory, Skills, Examples, etc.) |
| [archive/](./archive/) | Research notes, legacy plans, and outdated specs |
| [features/](./features/) | Folder for active/new feature specifications (e.g. Audit Log) |

---

## What the Agent Can Do — At a Glance

The agent can handle **any** of the following, in any combination, in a single conversation:

**AWS / Cloud Infrastructure**
- Query running resources (EC2, RDS, ECS, Lambda, S3, CloudFront, VPCs, etc.)
- Create, modify, start, stop, or terminate any resource
- Set up complex architectures (S3 + CloudFront CDN, VPC + subnets, RDS + read replicas)
- Manage IAM roles, policies, and security groups
- Analyze and reduce costs

**Containers & Deployment**
- Dockerize any GitHub repo from scratch
- Build, tag, and push Docker images
- Deploy to EC2, ECS, EKS, Cloud Run, or a raw VM
- Manage Docker registries (Docker Hub, ECR, GCR)

**Kubernetes**
- Deploy, scale, rollback, restart services
- Read logs and events across pods and namespaces
- Manage ConfigMaps, Secrets, ingress rules
- Debug crashing pods and resource issues
- Right-size resource requests and limits

**GitHub & CI/CD**
- Read repos, understand codebases
- Create Dockerfiles, config files, workflow files
- Open pull requests with changes
- Set up full CI/CD pipelines
- Read and explain failed build logs

**Debugging & Incident Response**
- Investigate why something isn't working
- Read logs, check resource states, trace through configs
- Find misconfigurations, missing permissions, wrong endpoints
- Propose a fix plan and execute it if approved

**Cost & Optimization**
- Full cost breakdown of your cloud account
- Identify waste, idle resources, overprovisioning
- Recommend and implement savings (with approval)
- Suggest architectural improvements for cost or performance

**Anything Else**
- Answer questions about your infra ("how many EC2 instances are running right now?")
- Explain what something does ("what is this Lambda function for?")
- Compare environments ("what's different between staging and prod?")
- Document infrastructure ("generate a diagram of our VPC setup")

---

## The Flow: How Every Interaction Works

```
User sends a message
        │
        ▼
Agent reads the message + full conversation context
        │
        ▼
Agent connects to your infra and investigates current state
(reads logs, queries APIs, checks configs — never guessing)
        │
        ▼
Agent builds a plan (for actions) or composes an answer (for questions)
        │
        ▼
For QUESTIONS → Agent answers directly with real data
For ACTIONS   → Agent presents a clear step-by-step plan
                 with cost/time estimates and risk level
        │
        ▼
User approves, modifies, or cancels
        │
        ▼
Agent executes, streaming live progress back to Slack/Telegram
        │
        ▼
Agent reports completion, surfaces any follow-up recommendations
```

---

## A Simple Example

```
You:    how many ec2 instances do i have running right now?

Agent:  You have 14 EC2 instances running across 2 regions:

        us-east-1 (9 instances)
        ├── prod-api-01      t3.large    running  14 days
        ├── prod-api-02      t3.large    running  14 days
        ├── prod-worker-01   t3.medium   running  6 days
        ├── staging-api      t3.small    running  32 days
        └── ... (5 more)

        eu-west-1 (5 instances)
        └── ... 

        Total estimated cost: ~$580/month
        
        2 instances haven't had traffic in 7+ days (staging-old-1, staging-old-2).
        Want me to investigate if they can be stopped?
```

That's one message. No console. No CLI. No remembering which region things are in.

---

## Another Example: Debugging a Real Problem

```
You:    i set up s3 and cloudfront for my website but it's not loading

Agent:  Let me check your setup...

        I found a CloudFront distribution (E3KX2J1MNPQ4R) pointing to 
        acmecorp-website.s3.amazonaws.com.

        Issues found:

        1. S3 BUCKET POLICY MISSING
           The bucket is private. CloudFront can't read objects.
           Fix: Add a bucket policy granting CloudFront read access via OAC.

        2. CLOUDFRONT DEFAULT ROOT OBJECT NOT SET
           No default root object configured. 
           Navigating to your domain will return a 403 instead of index.html.
           Fix: Set default root object to "index.html".

        3. CLOUDFRONT DISTRIBUTION STILL DEPLOYING
           Status: "In Progress" — this takes 5–15 minutes after creation.
           This may resolve itself. Check back after fixing issues 1 and 2.

        Here's my fix plan:
          Step 1: Add S3 bucket policy for CloudFront OAC
          Step 2: Set CloudFront default root object to index.html
          Step 3: Invalidate CloudFront cache after changes

        Fix now?

You:    yes

Agent:  ✅ Step 1 — S3 bucket policy updated
        ✅ Step 2 — Default root object set to index.html
        ✅ Step 3 — Cache invalidation triggered (takes ~1 min)

        Your site should be live at https://d3abc123.cloudfront.net 
        in about 2 minutes once the invalidation completes.
```

---

## Why Telegram First (Then Slack)?

Because that's where engineering teams already are. The agent doesn't need its own interface. It lives where you work.

**Telegram first benefits (best for v1):**
- Fastest path to MVP with lower integration complexity
- Great for solo founders, small teams, and on-call workflows
- Mobile-first usage makes operational response easy
- Fewer enterprise workflow requirements in early stage

**Slack second benefits (best for team scale):**
- Team channels and threaded context for shared visibility
- Richer approval workflows and enterprise collaboration
- Better fit for larger teams after core agent reliability is proven
