# Features — Complete Capability Reference

The agent can handle anything a skilled DevOps engineer would do when given access to your infrastructure. This document covers every category.

---

## AWS — Full Coverage

The agent treats AWS as a first-class citizen. Every service the user interacts with, the agent can query, configure, create, modify, or destroy — with approval.

### EC2 & Compute

**Read / Query:**
- List all instances (with filters: region, state, type, tag)
- Get instance details (CPU, memory, uptime, public/private IP, security groups)
- View instance metrics (CPU usage, network in/out, disk IOPS over time)
- List Auto Scaling Groups and their current capacity
- Show Elastic Load Balancers and target health

**Actions:**
- Start, stop, reboot, terminate instances
- Change instance type (stop → resize → start)
- Create new EC2 from scratch (AMI selection, instance type, key pair, security group, user data)
- Attach/detach Elastic IPs
- Create AMI snapshots of running instances
- Manage Auto Scaling policies (scale out/in, change min/max)

**Best practices the agent enforces:**
- Never create EC2 in the default VPC for production workloads
- Always tag resources (Name, Environment, Owner, CostCenter)
- Always use IMDSv2 on new instances
- Recommend instance types based on workload (don't over-provision)

---

### S3

**Read / Query:**
- List all buckets with sizes and last-modified dates
- Check bucket policies, ACLs, and public access settings
- Show bucket versioning, replication, and lifecycle rules
- Check encryption settings

**Actions:**
- Create buckets with correct regional settings
- Set bucket policies (e.g., grant CloudFront OAC access)
- Configure static website hosting
- Set up lifecycle rules (move to Glacier after N days)
- Enable versioning and MFA delete
- Set up cross-region replication

**Best practices:**
- Block all public access unless explicitly needed for website hosting
- Always enable versioning for important buckets
- Encrypt at rest by default (SSE-S3 or SSE-KMS)
- Set lifecycle rules to manage costs on log/archive buckets

---

### CloudFront & CDN

- Create distributions from S3 or custom origins
- Configure cache behaviors, TTLs, and path patterns
- Set up OAC (Origin Access Control) for S3 origins
- Configure custom domains + SSL certificates (ACM)
- Set default root object
- Run cache invalidations
- View distribution metrics and request stats

---

### RDS & Databases

- List all RDS instances and clusters (engine, version, size, status)
- Show connection endpoints, storage usage, CPU/memory metrics
- Create new RDS instances (with parameter group, subnet group, security group)
- Modify instance class, storage, or settings
- Create/restore snapshots
- Set up read replicas
- Configure automated backups and retention
- Schedule stop/start for non-production instances to save cost

---

### Networking (VPC, Security Groups, Route53)

- List VPCs, subnets, route tables, internet gateways
- Show security group rules (inbound and outbound)
- Create VPCs with public/private subnet layouts
- Add/remove security group rules
- Create NAT Gateways
- Manage Route53 hosted zones and DNS records
- Diagnose connectivity issues ("why can't my EC2 reach the RDS instance?")

---

### IAM

- List roles, policies, and users
- Show effective permissions for a role or user
- Identify overly permissive policies (e.g., AdministratorAccess on a Lambda)
- Create roles with least-privilege policies for specific use cases
- Rotate access keys
- Audit unused users/roles

---

### Lambda & Serverless

- List all functions with runtime, memory, last invocation
- View function code and configuration
- Show recent invocation logs and error rates
- Deploy new function versions
- Manage triggers and event source mappings
- Set up environment variables and layers

---

### Cost & Billing

- Current month spend by service, region, or tag
- Month-over-month trend
- Identify top cost drivers
- Spot idle resources (stopped instances still paying for EBS, unused EIPs, idle load balancers)
- Estimate Reserved Instance or Savings Plan ROI
- Suggest right-sizing opportunities based on actual usage metrics
- Schedule start/stop for dev/staging resources

---

## Containers & Docker

### Dockerization of Any Repo
- Clone and analyze any GitHub repo
- Detect language, framework, runtime version, and dependencies
- Generate a production-grade multi-stage Dockerfile
- Add `.dockerignore` to exclude dev artifacts
- Handle non-standard structures (monorepos, custom entrypoints)
- Suggest environment variables needed at runtime

### Image Build & Registry Management
- Build Docker images locally (in ephemeral build containers)
- Tag images semantically (git SHA, semver, latest)
- Push to Docker Hub, AWS ECR, Google GCR, or GitHub Container Registry
- List existing images and tags in a registry
- Clean up old/unused image tags
- Scan images for known vulnerabilities (using Trivy or similar)

### Container Deployment
- Deploy containers to EC2 (Docker + Nginx + SSL)
- Deploy to ECS Fargate (task definitions, services, cluster setup)
- Deploy to Google Cloud Run
- Deploy to raw VMs on any cloud
- Handle environment variables and secrets securely (no plain text in configs)
- Set up health checks and restart policies

---

## Kubernetes

### Workload Management
- Deploy new applications (create Deployment, Service, Ingress)
- Roll out new image versions (zero-downtime rolling update)
- Roll back to any previous version
- Restart a deployment or specific pods
- Scale replicas up or down manually
- Set up and manage Horizontal Pod Autoscaler (HPA)

### Observability
- Show pod status across all namespaces (or filtered)
- Read pod logs (current + previous container)
- Describe pods, deployments, services, ingresses
- Show recent cluster events
- View resource usage (CPU/memory per pod and node)
- Identify pods in CrashLoopBackOff, OOMKilled, Pending, or Error state

### Configuration Management
- Create and update ConfigMaps and Secrets
- Modify resource requests and limits
- Update environment variables in deployments
- Manage ingress rules and TLS certificates
- Manage namespaces

### Debugging
- "This pod keeps crashing" → read logs, events, check resource limits, check image
- "My service isn't reachable" → check service selector, endpoints, ingress, network policies
- "Deployment is stuck" → check rollout status, events, resource availability on nodes
- "Nodes are NotReady" → check node conditions, kubelet status, disk/memory pressure

---

## GitHub & CI/CD

### Repo Analysis
- Clone and read codebases
- Understand project structure, tech stack, dependencies
- Read existing CI/CD configs and explain them
- Read open issues and pull requests

### Code & Config Generation
- Write Dockerfiles, docker-compose.yml, .dockerignore
- Generate Kubernetes manifests (Deployment, Service, Ingress, HPA)
- Write Helm chart templates
- Write Terraform modules
- Write GitHub Actions workflows
- Write GitLab CI pipelines

### Pull Request Workflow
- Create a new branch
- Commit generated files
- Open a pull request with a clear description
- Never push directly to main/master — always PRs

### CI/CD Pipeline Management
- Set up GitHub Actions or GitLab CI from scratch
- Pipelines include: test → build → push → deploy → notify
- Environment-specific deployment jobs (staging first, production on approval)
- Slack/Telegram notifications on success and failure built in
- Read failed pipeline logs and explain the error
- Trigger manual runs

---

## Debugging & Incident Response

This is one of the highest-value features. When something is broken, engineers waste 30–60 minutes just gathering information. The agent does that in 10 seconds.

### How Debugging Works
1. User describes the symptom ("my website isn't loading", "the API is returning 500s")
2. Agent investigates across all relevant systems: logs, resource states, configs, network, IAM
3. Agent presents findings with a ranked list of likely causes
4. Agent proposes a fix plan
5. User approves → agent fixes it

### What the Agent Investigates
- Application logs (CloudWatch, pod logs, systemd journald)
- HTTP response codes and error patterns
- Resource states (is the EC2 running? is the pod healthy?)
- Network path (security groups, NACLs, routing, DNS)
- IAM permissions (does this Lambda have permission to read that S3 bucket?)
- Configuration drift (is the environment variable set? is the correct image version running?)
- Recent changes (what was deployed in the last 2 hours?)

### Common Debugging Scenarios
- Website returning 403/404 after S3/CloudFront setup → check bucket policy, OAC, default root object
- API timing out → check EC2 CPU, memory, connection pool, downstream dependencies
- Container keeps crashing → check logs, OOMKilled status, missing env vars, failed health check
- CI/CD pipeline failing → read logs, identify failing test or misconfigured step
- Database connection refused → check security group, subnet routing, password, connection limits
- Deployment stuck → check Kubernetes events, node resources, image pull errors

---

## Cost Optimization

### Analysis
- Pull real billing data from AWS Cost Explorer / GCP Billing
- Break down by service, region, team tag, or time period
- Identify top 10 cost drivers
- Trend analysis: "we spent 23% more this month — why?"

### Waste Detection
- EC2 instances with <5% average CPU for 7+ days
- Stopped instances still paying for attached EBS volumes
- Elastic IPs not attached to running instances ($0.005/hr each)
- Idle load balancers with no targets or traffic
- Unused NAT Gateways
- S3 buckets with lifecycle policies that could move data to cheaper tiers
- RDS instances in dev/staging running 24/7 instead of scheduled
- Oversized Lambda memory allocations
- Orphaned EBS volumes, snapshots older than X days

### Recommendations
- Reserved Instances vs On-Demand ROI calculation
- Savings Plans analysis
- Spot instance candidates for fault-tolerant workloads
- Right-sizing recommendations based on actual CloudWatch metrics (not guesses)
- Architectural suggestions (e.g., "this API has 2 requests/day — a Lambda would cost $0.01/month vs $30 for EC2")

---

## General Infrastructure Questions

The agent answers any question about your infrastructure using real data — not guesses.

Examples:
- "How many EC2 instances are running right now?"
- "What's our RDS storage usage?"
- "Is there a WAF in front of our API?"
- "What security groups allow inbound traffic on port 22?"
- "Which Lambda functions haven't been invoked in 30 days?"
- "What version of our API is deployed in production right now?"
- "How many pods are running in the production namespace?"
- "What changed in our infra in the last 24 hours?"
- "Is our production database encrypted?"
- "What's the uptime of our main EC2 instance?"
- "Which S3 buckets are publicly accessible?"

The agent queries your actual infrastructure for every answer — never relies on stale internal records.
