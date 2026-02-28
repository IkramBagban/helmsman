# Best Practices — What the Agent Enforces Automatically

One of Helmsman's core values: **when you do something through the agent, it's done correctly by default.** The agent applies best practices automatically, without the user needing to ask.

This is a significant advantage over using the AWS console or CLI manually, where it's easy to skip steps, forget settings, or not know what best practice even is.

---

## AWS EC2

Every EC2 instance the agent creates gets:

**Compute:**
- Appropriate instance type for the workload (the agent recommends based on context — a web API gets t3.medium, a build machine gets m5.large, etc.)
- Latest-generation instance family (t3 not t2, m6i not m5 where appropriate)
- EBS-optimized enabled
- IMDSv2 required (blocks SSRF attacks that exploit the metadata service)

**Networking:**
- Placed in a private subnet by default — never directly in a public subnet unless it's explicitly a bastion or load balancer
- Security group with minimal ingress: only the ports the application actually uses
- No SSH from 0.0.0.0/0 — if SSH is needed, restrict to VPN CIDR or use AWS Systems Manager Session Manager

**Tagging (always applied):**
- Name
- Environment (production/staging/dev)
- Owner (the requesting user's email or Slack ID)
- CreatedBy: helmsman
- CreatedAt: timestamp
- Project (if specified)

**Cost:**
- The agent mentions if a cheaper instance would meet the workload requirements
- For non-production instances, the agent asks if a scheduled stop/start policy is wanted

---

## AWS S3

Every bucket the agent creates:

**Security:**
- Block Public Access enabled on all four settings (unless explicitly creating a public static website)
- Versioning enabled by default (protects against accidental deletes and overwrites)
- Server-side encryption enabled (SSE-S3 by default, SSE-KMS if the team has a KMS key configured)
- No bucket ACLs (they're deprecated — bucket policies only)
- Bucket policy principle of least privilege — never wildcard `s3:*` unless the team explicitly asks

**Naming:**
- Follows the pattern: `{team}-{purpose}-{environment}` (e.g., `acmecorp-user-uploads-production`)
- All lowercase, hyphens only (S3 naming rules)

**Cost:**
- For log/archive buckets, the agent automatically adds a lifecycle rule to transition to cheaper storage tiers after 30/90/180 days
- Intelligently suggests storage class based on access pattern

---

## CloudFront

Every CloudFront distribution the agent creates:

- HTTPS enforced: HTTP always redirects to HTTPS
- TLS 1.2 minimum (no outdated TLS versions)
- Origin Access Control (OAC) for S3 origins — never public S3 buckets
- Compression enabled (gzip + Brotli) — reduces data transfer costs and improves performance
- Security headers via CloudFront response headers policy:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection`
- Default root object set (the most common misconfiguration that causes 403s)
- Custom error responses for SPAs if the stack includes React/Vue/Angular

---

## Docker & Container Images

Every Dockerfile the agent generates:

**Image size:**
- Multi-stage builds — build tools don't end up in the final image
- Alpine or Distroless base images where possible (smallest attack surface)
- `.dockerignore` always created (excludes `.git`, `node_modules`, test files, dev configs)

**Security:**
- Non-root user: `USER node` or equivalent — never run as root
- No secrets in the image: environment variables are injected at runtime, never baked in
- `COPY --chown` instead of `RUN chown` (more efficient)
- Pinned base image versions: `node:20-alpine` not `node:latest`

**Build efficiency:**
- Dependencies installed before source code copy (Docker layer cache optimization)
- Package manager cache cleaned in the same layer as install (`npm ci --only=production`)

**Health checks:**
- `HEALTHCHECK` instruction included with sensible defaults

---

## Kubernetes

Every Kubernetes manifest the agent creates:

**Resources:**
- CPU and memory requests and limits always set — no pods without resource constraints
- Requests set conservatively, limits set generously (avoids OOMKill for burst traffic)
- HPA considered for any production web-facing service

**Reliability:**
- Minimum 2 replicas for any production workload (single point of failure)
- Pod Disruption Budget for services that need high availability
- Rolling update strategy with maxSurge and maxUnavailable configured
- Readiness and liveness probes always included
- `terminationGracePeriodSeconds` set appropriately for graceful shutdown

**Security:**
- `securityContext` set: `runAsNonRoot: true`, `readOnlyRootFilesystem: true` where possible
- No `privileged: true` unless explicitly required
- Secrets referenced from Kubernetes Secrets (never hardcoded in env vars)
- Images always pinned to a specific tag — never `:latest` in production

**Namespacing:**
- Always deploy to a named namespace, never to `default`
- Resource names include the environment label

---

## RDS / Databases

Every RDS instance the agent creates:

- Automated backups enabled (retention: 7 days for staging, 30 days for production)
- Delete protection enabled for production instances (must be disabled manually before deletion)
- Encryption at rest enabled
- Multi-AZ for production (automatic failover)
- Single-AZ for staging/dev (cost savings)
- Placed in private subnets — never publicly accessible
- Security group: only allows inbound on the DB port from the application's security group (not from 0.0.0.0/0)
- Enhanced monitoring enabled (richer metrics)
- Performance Insights enabled

---

## IAM

When creating IAM roles for applications:

- Principle of least privilege: only grant the specific actions on the specific resources needed
- No `*` on actions unless explicitly justified
- No `*` on resources unless explicitly justified
- No hardcoded credentials in application code — use IAM roles (for EC2/ECS/Lambda) or OIDC (for GitHub Actions)
- When the agent creates a role, it shows the exact policy JSON so the team can review it

When the agent detects bad IAM practice:
```
⚠️  This Lambda function has the AmazonS3FullAccess managed policy attached.
    It only reads from one specific bucket. 
    I can replace this with a least-privilege policy that only allows 
    s3:GetObject on the specific bucket it needs.
    This reduces blast radius if the Lambda is ever compromised.
    
    Would you like me to tighten this up?
```

---

## Networking / VPCs

When creating a VPC:

- Never use 10.0.0.0/16 by default (it's the most commonly used CIDR and creates conflicts in multi-VPC setups) — the agent checks existing VPCs and assigns a non-conflicting CIDR
- Public and private subnet separation: load balancers in public, everything else in private
- One NAT Gateway per AZ for high-availability (agent offers the single-NAT cost trade-off)
- All route tables explicitly configured — the agent doesn't rely on the default route table
- VPC Flow Logs enabled (helps with debugging and security auditing)
- DNS resolution and DNS hostnames enabled

---

## CI/CD Pipelines

Every pipeline the agent generates:

- Tests run on every PR (not just on main)
- Secrets injected from GitHub Secrets / GitLab CI Variables — never hardcoded
- Docker images tagged with git SHA (enables precise rollback)
- Images also tagged with `:staging-latest` and `:production-latest` (useful for quick identification)
- Security scan (Trivy or Snyk) before push to production
- Deployment to staging is automatic, deployment to production requires manual trigger
- Slack/Telegram notification step: success and failure both notify the team
- Timeout limits on each job (prevents hung builds wasting minutes)

---

## General Principles

**Tagging everything:**
The agent applies consistent tags to every resource it creates. This is critical for:
- Cost allocation (which team/project owns this cost?)
- Ownership (who to contact when something breaks?)
- Automated governance (lifecycle policies that clean up untagged resources)

**Not over-engineering:**
The agent recommends the right level of infrastructure for the workload. It won't suggest a Kubernetes cluster for a simple Node.js app. It won't suggest multi-AZ RDS for a dev database. The recommendation fits the context.

**Explaining the why:**
When the agent applies a best practice the user didn't ask for, it briefly explains:
```
✅ Versioning enabled on the bucket. 
   (Protects against accidental overwrites — objects can be restored to any previous version)
```

Users learn while they work. Over time, they understand their infrastructure better.
