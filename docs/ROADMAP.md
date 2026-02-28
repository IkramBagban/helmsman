# Roadmap — What to Build and When

Building everything at once is how projects fail. This roadmap is sequenced to get you to real users fast, validate the core idea, and layer in complexity once the foundation is solid.

---

## Phase 1 — The MVP (Weeks 1–8)

**Goal:** Prove that the core loop works. Get 10 developers using it daily for real work.

The MVP does one thing extremely well: **answer questions about AWS and perform simple AWS actions through Telegram.**

### What's in Phase 1

**Telegram integration only** (Slack can wait)
- Telegram bot with command and reply-based interactions
- Basic conversation threading and context tracking

**AWS — Read operations (no approval needed):**
- List and describe EC2 instances
- List S3 buckets with basic metadata
- Show CloudWatch metrics for a specific instance
- Get basic cost report (current month by service)

**AWS — Write operations (with approval):**
- Start / stop EC2 instances
- Create S3 bucket (with best practices applied)
- Create simple EC2 instance

**One debugging flow:**
- "Why isn't my S3/CloudFront website loading?" — the highest-frequency beginner problem

**Basic agent UX:**
- Typing indicator
- Plan presentation before any write action
- Simple yes/no approval
- Step-by-step execution progress
- Error messages that explain what went wrong

### What's NOT in Phase 1
- Kubernetes (complex, specialized)
- Multi-cloud (distraction)
- GitHub integration (adds scope)
- Docker build (requires execution containers)
- Cost optimization (needs 2–3 months of data to be useful)

### Success criteria for Phase 1
- 10 real developers use it for actual work tasks
- The core loop (question → investigation → answer, or action → plan → approve → execute) works reliably
- Zero security incidents
- Users report it faster/easier than the AWS console for the supported operations

---

## Phase 2 — Depth on AWS (Weeks 9–16)

**Goal:** Make Helmsman genuinely more capable than the AWS console for daily operations.

### What's in Phase 2

**Expand AWS coverage:**
- RDS (list, describe, create, stop/start, resize)
- Security Groups (list, describe, add/remove rules)
- VPC and networking (list, describe, create VPC + subnets)
- IAM (read-only: list roles, show permissions, identify overpermissioned policies)
- Lambda (list, describe, view logs)
- Route53 (list zones, manage DNS records)
- ECS (list services, view task status, redeploy)

**Expand debugging:**
- "My EC2 instance can't reach the RDS database" → network path analysis
- "My Lambda is failing" → read CloudWatch logs, identify error
- "Why is my bill higher this month?" → diff cost drivers vs last month

**Cost optimization — first pass:**
- Identify idle EC2 instances (low CPU, no traffic)
- Identify unattached Elastic IPs
- Identify RDS instances with no connections

**Multi-environment support:**
- Teams define environments (dev/staging/prod)
- Actions are environment-aware ("stop all dev instances")

**Approval improvements:**
- Tier-based approvals (read-only vs write vs destructive)
- Multi-approver for production destructive actions

---

## Phase 3 — Deployments (Weeks 17–24)

**Goal:** The agent can take a GitHub URL and get an application running in the cloud.

This is where the product becomes meaningfully different from anything else on the market.

### What's in Phase 3

**Execution containers:**
- Spin up ephemeral containers for build tasks
- Credential injection and cleanup
- Log streaming back to Slack

**GitHub integration:**
- Read repos (detect stack, understand structure)
- Create branches, commit files, open PRs
- Read Actions workflow files and run results

**Dockerization:**
- Analyze any GitHub repo and generate a Dockerfile
- Support: Node.js, Python, Go, Ruby, Java, Rust, PHP
- Multi-stage builds, best practices applied

**Docker registry:**
- Build images in execution containers
- Push to Docker Hub or AWS ECR

**Deployment targets:**
- EC2 (with Docker + Nginx + SSL)
- ECS Fargate (full task definition management)

**CI/CD generation:**
- GitHub Actions workflows (test + build + push + deploy)
- Environment-specific deployment pipelines

---

## Phase 4 — Kubernetes (Weeks 25–32)

**Goal:** Make Kubernetes usable for the engineers on your team who aren't K8s experts.

Kubernetes has a massive learning curve. Most developers know what they want (deploy this, scale that, why is this crashing?) but struggle with the YAML and kubectl commands. The agent abstracts all of that.

### What's in Phase 4

**Full kubectl coverage via agent:**
- Deploy applications (create Deployment + Service + Ingress)
- Scale deployments
- Roll back to previous versions
- Read logs across pods
- Show events and describe resources

**Kubernetes debugging:**
- CrashLoopBackOff analysis
- OOMKill detection and right-sizing recommendation
- Service connectivity debugging
- Ingress and TLS certificate issues

**Manifest generation:**
- Kubernetes Deployment, Service, Ingress, ConfigMap, Secret
- HPA with sensible defaults
- Resource requests and limits recommended based on the application

**Helm support (basic):**
- Install, upgrade, and roll back Helm releases
- Show values diff between releases

---

## Phase 5 — Intelligence Layer (Weeks 33–40)

**Goal:** Move from reactive (user asks, agent does) to proactive (agent spots issues and opportunities unprompted).

### What's in Phase 5

**Proactive alerts:**
- "One of your EC2 instances has been at 95% CPU for 30 minutes. Want me to investigate?"
- "Your staging RDS has been running for 7 days with no connections. Want to stop it to save money?"
- "3 pods in the payments service have restarted more than 10 times today."

**Cost intelligence:**
- Monthly cost summary posted to Slack automatically
- "Your bill is 20% higher than last month — here's why"
- Savings Plan / Reserved Instance recommendations with ROI calculations

**Infrastructure drift detection:**
- "Your staging environment is running a Docker image that's 3 versions behind production"
- "Your security groups have changed since last week — here's what changed"

**Scheduled operations:**
- "Stop all dev instances at 8pm weekdays, start them at 9am" — agent sets this up and executes it
- Automated cleanup: tag and flag resources older than N days with no activity

---

## Phase 6 — Multi-Cloud and Enterprise (Months 10–12)

**Goal:** Sell to larger teams with more complex environments.

### What's in Phase 6

**GCP support:**
- Compute Engine, GKE, Cloud Run, Cloud SQL, Cloud Storage, BigQuery

**Terraform integration:**
- Read existing Terraform state
- Generate Terraform modules
- Run `terraform plan`, show output, execute with approval

**Enterprise features:**
- SSO (SAML/OIDC)
- Self-hosted deployment option (for companies that won't use SaaS)
- Advanced RBAC with custom roles
- SOC 2 Type II certification

**GitOps workflow:**
- Agent generates infrastructure changes as PRs against a GitOps repo
- Changes go through code review before execution
- Full audit trail through git history

---

## Telegram vs Slack

**Recommendation:** Start with Telegram for speed to market, then add Slack for team-scale workflows.

Why Telegram first:
- Faster implementation and lower integration overhead
- Better for solo builders and small teams in early adoption
- Excellent mobile/on-call experience for rapid issue handling

Why Slack second:
- Stronger enterprise/team collaboration model
- Better channel-centric approvals and cross-team visibility
- Natural fit once reliability, permissions, and audit workflows are mature

Target sequence:
- Phase 1: Telegram
- Phase 2: Add Slack parity for core workflows

---

## Technical Milestones Before Anything Else

Before launching to any real users:
1. Credential encryption and secrets management — non-negotiable from day 1
2. Audit log — every action recorded, immutable
3. Approval gate — no action without a plan presented and approved
4. Rate limiting — prevents runaway executions
5. Error handling — graceful failures with clear explanations

These are not features to add later. They're the foundation.

---

## Phase 7 — Beyond DevOps (Jarvis Expansion)

**Goal:** Expand from DevOps specialist to a broader execution agent across technical business workflows.

Potential expansion tracks:
- Product & engineering operations (issue triage, release coordination, status synthesis)
- Data operations (scheduled analysis tasks, data quality checks, reporting workflows)
- Security operations (access reviews, policy drift checks, incident playbooks)
- Internal knowledge operations (docs synthesis, decision memory, action follow-ups)

Principle: keep the same trust model (plan → approval → execution) as new domains are added.
