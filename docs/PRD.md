# Product Requirements Document — Helmsman

> This document defines what Helmsman is, who it's for, and what it must do.
> For how it's built, see `ARCHITECTURE.md`. For coding rules, see `CONVENTIONS.md`.

---

## Product Vision

**Helmsman** (helmsman.chat) is an AI execution agent that operates real infrastructure through natural conversation. Users describe what they want in plain English via Telegram. Helmsman investigates, reasons, builds a plan, asks for approval, and executes.

**Long-term:** A general-purpose Jarvis-style agent across technical and business domains.
**Current focus:** DevOps — the first vertical because it has high pain, clear ROI, and measurable outcomes.

---

## Target Users

### Primary: Solo Developers & Small Teams (2-10 engineers)
- Building on AWS, need to manage infrastructure
- Don't have a dedicated DevOps person
- Comfortable with Telegram as a work tool
- Want to move fast without learning AWS console deeply

### Secondary: DevOps Engineers
- Manage infrastructure across multiple environments
- Want faster incident response and debugging
- Want to reduce context-switching between tools

### Future: Non-Technical Stakeholders
- Want to ask "how much are we spending on AWS?" without learning tools
- Want status updates on infrastructure health

---

## Core User Stories (MVP / Phase 1)

### US-1: Ask About Infrastructure
> As a developer, I send a Telegram message asking about my AWS resources, and Helmsman responds with accurate, real-time data.

Acceptance:
- User sends "how many EC2 instances are running?" → gets count + list with regions, types, costs
- User sends "what's my S3 storage usage?" → gets bucket list with sizes
- Response time < 10 seconds for read queries
- Data is always live (no stale cache)

### US-2: Execute a Safe Action
> As a developer, I ask Helmsman to perform an AWS write action, and it presents a plan for my approval before executing.

Acceptance:
- User sends "stop my staging EC2 instance" → Helmsman identifies the instance, shows plan, waits for approval
- User types "yes" → Helmsman executes and confirms
- User types "no" → Helmsman cancels, no action taken
- Every write action is logged in audit trail

### US-3: Debug a Problem
> As a developer, I describe a symptom and Helmsman investigates my infrastructure to find the root cause.

Acceptance:
- User sends "my S3/CloudFront website isn't loading" → Helmsman checks bucket policy, CloudFront config, DNS, SSL
- Helmsman identifies specific issues with fix plans
- Can propose and execute fixes with approval

### US-4: Cost Visibility
> As a developer, I ask about my AWS spending and Helmsman gives me a clear breakdown.

Acceptance:
- User sends "how much am I spending?" → gets current month breakdown by service
- Identifies obvious waste (idle instances, unattached EIPs)

### US-5: Safe by Default
> As a developer, I trust that Helmsman will never execute a destructive action without my explicit approval, and that all actions are logged.

Acceptance:
- Read operations execute immediately (no approval)
- Write operations show plan + require approval
- Destructive operations require explicit typed confirmation
- Full audit trail of every action

---

## MVP Scope (Phase 1 — 8 Weeks)

### In Scope
| Area | What's Included |
|------|----------------|
| **Chat** | Telegram bot, natural language input/output, basic conversation threading |
| **AWS Read** | EC2 (list, describe, metrics), S3 (list, describe, settings), CloudWatch (basic metrics), Cost Explorer (current month) |
| **AWS Write** | EC2 (start, stop), S3 (create bucket with best practices) |
| **Agent Loop** | Intent classification, investigation, plan building, execution with progress |
| **Approvals** | 4-tier risk classification, approval gate for writes, hard confirmation for destructive |
| **Audit** | Structured logging, action audit trail, correlation IDs |
| **Security** | Encrypted credential storage, least-privilege IAM, no hardcoded secrets |

### Out of Scope (Phase 1)
- Slack integration (Phase 2)
- Kubernetes (Phase 3)
- GitHub integration (Phase 3)
- Docker build/push (Phase 3)
- Multi-cloud (Phase 5+)
- Web dashboard
- Team/org management
- Billing/payments

---

## Non-Functional Requirements

| Requirement | Target |
|------------|--------|
| Response time (read queries) | < 8 seconds end-to-end |
| Response time (write plans) | < 15 seconds to present plan |
| Availability | 99.5% uptime for API |
| Security | Zero credential exposures, all secrets encrypted at rest |
| Audit completeness | 100% of write actions logged with actor + timestamp + result |
| Error handling | Every failure returns a human-readable message, never a stack trace |
| Concurrent users | 50 simultaneous conversations (MVP) |

---

## Key Metrics (Success Criteria)

- **10 real developers** using it for actual work within 8 weeks
- **Core loop reliability:** question → answer and action → plan → approve → execute works > 95% of the time
- **Zero security incidents** (no credential leaks, no unauthorized actions)
- Users report it's **faster than AWS console** for supported operations
- **< 5% hallucination rate** on infrastructure queries (always verify with real API calls)

---

## Future Phases (Reference Only)

| Phase | Focus | Timeline |
|-------|-------|----------|
| Phase 2 | Deep AWS (RDS, VPC, IAM, Lambda, Route53) + Slack | Weeks 9-16 |
| Phase 3 | Deployments (GitHub, Docker, CI/CD) | Weeks 17-24 |
| Phase 4 | Kubernetes | Weeks 25-32 |
| Phase 5 | Multi-cloud (GCP, Azure) | Weeks 33-40 |
| Phase 6 | Enterprise (teams, RBAC, SSO, SOC2) | Weeks 41-48 |
| Phase 7 | Beyond DevOps — Jarvis expansion | 12+ months |

Full roadmap: `docs/ROADMAP.md`
