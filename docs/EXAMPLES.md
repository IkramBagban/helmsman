# Examples — Real Conversations

These show how users actually talk to Helmsman and what the agent does in response. Every example uses real data from the user's infrastructure — no mocked responses.

---

## Category 1: Asking Questions About Infrastructure

### Example 1.1 — Simple Inventory Query

```
User:   how many ec2 instances do i have running right now?

Agent:  You have 14 EC2 instances running across 2 regions:

        us-east-1 (9 instances)
        ┌─────────────────────┬────────────┬─────────┬──────────┐
        │ Name                │ Type       │ State   │ Uptime   │
        ├─────────────────────┼────────────┼─────────┼──────────┤
        │ prod-api-01         │ t3.large   │ running │ 14 days  │
        │ prod-api-02         │ t3.large   │ running │ 14 days  │
        │ prod-worker-01      │ t3.medium  │ running │ 6 days   │
        │ prod-worker-02      │ t3.medium  │ running │ 6 days   │
        │ prod-redis          │ t3.small   │ running │ 45 days  │
        │ staging-api         │ t3.small   │ running │ 32 days  │
        │ staging-worker      │ t3.micro   │ running │ 32 days  │
        │ old-staging-1       │ t3.medium  │ running │ 89 days  │
        │ old-staging-2       │ t3.medium  │ running │ 89 days  │
        └─────────────────────┴────────────┴─────────┴──────────┘

        eu-west-1 (5 instances)
        ┌─────────────────────┬────────────┬─────────┬──────────┐
        │ prod-eu-api-01      │ t3.large   │ running │ 14 days  │
        │ prod-eu-api-02      │ t3.large   │ running │ 14 days  │
        │ prod-eu-worker      │ t3.medium  │ running │ 14 days  │
        │ bastion-eu          │ t3.micro   │ running │ 120 days │
        │ monitoring          │ t3.small   │ running │ 67 days  │
        └─────────────────────┴────────────┴─────────┴──────────┘

        Estimated total cost: ~$620/month

        ⚠️  Note: old-staging-1 and old-staging-2 have been running for 89 days 
        with no incoming traffic. They may be safe to stop or terminate.
        Want me to investigate?
```

---

### Example 1.2 — Security Audit Question

```
User:   which security groups allow ssh access from anywhere?

Agent:  I found 4 security groups with port 22 open to 0.0.0.0/0 (anywhere):

        1. sg-0a1b2c3d  "launch-wizard-1"
           Attached to: old-staging-1, old-staging-2
           Rule: 0.0.0.0/0 → port 22

        2. sg-0e4f5g6h  "default"
           Attached to: 0 instances currently (but it's the default VPC SG)
           Rule: 0.0.0.0/0 → port 22

        3. sg-0i7j8k9l  "bastion-sg"
           Attached to: bastion-eu
           Rule: 0.0.0.0/0 → port 22
           (This may be intentional for a bastion host)

        4. sg-0m1n2o3p  "monitoring"
           Attached to: monitoring instance
           Rule: 0.0.0.0/0 → port 22

        Best practice: SSH should only be allowed from known IPs or via 
        AWS Systems Manager Session Manager (no port 22 needed at all).

        Want me to:
          A) Lock down all of these to your current IP only
          B) Remove SSH access and set up SSM Session Manager instead (more secure)
          C) Review each one individually
```

---

### Example 1.3 — Comparing Environments

```
User:   what's different between staging and production right now?

Agent:  Comparing staging vs production across your stack:

        APPLICATION VERSION
        Production:  v2.4.1 (deployed 3 days ago)
        Staging:     v2.5.0-beta (deployed 6 hours ago)
        → Staging is 1 version ahead

        INSTANCE SIZES
        Production:  t3.large (prod-api-01, prod-api-02)
        Staging:     t3.small (staging-api)
        → Staging is undersized — performance tests may not reflect prod behavior

        DATABASE
        Production:  db.r5.large, Multi-AZ, automated backups enabled
        Staging:     db.t3.medium, Single-AZ, no automated backups
        → Expected difference for cost reasons

        ENVIRONMENT VARIABLES
        Production has 3 env vars that staging is missing:
          - STRIPE_WEBHOOK_SECRET
          - ANALYTICS_API_KEY  
          - REDIS_CLUSTER_URL (staging uses standalone Redis)
        → Missing STRIPE_WEBHOOK_SECRET on staging could break payment webhooks in testing

        CLOUDFRONT
        Production:  CloudFront + WAF enabled
        Staging:     No CloudFront (direct EC2 access)
        → Staging doesn't reflect prod network topology for latency testing

        Want me to sync any of these differences?
```

---

## Category 2: Deployments

### Example 2.1 — Full Deploy from GitHub URL

```
User:   deploy https://github.com/acmecorp/checkout-service

Agent:  Analyzing repo...

        Found: Node.js 20, Express framework, listens on port 8080.
        No Dockerfile exists. No deployment config found.

        A few questions before I build the plan:
        1. Where should this be deployed? (AWS, GCP, DigitalOcean, other)
        2. Production or staging?

User:   aws, production

Agent:  Got it. Here's what I'll do:

        PLAN: Deploy checkout-service to AWS Production
        ─────────────────────────────────────────────────────────
        Step 1  Create Dockerfile (multi-stage, Node 20 Alpine)
        Step 2  Create .dockerignore
        Step 3  Build image → acmecorp/checkout-service:v1.0.0
        Step 4  Push to Docker Hub
        Step 5  Provision EC2 t3.medium in us-east-1 (your default region)
                → Estimated cost: $30.37/month
        Step 6  Configure security group (443 inbound, 80 redirect, SSH from VPN only)
        Step 7  Install Docker, pull image, run container
        Step 8  Set up Nginx as reverse proxy
        Step 9  Issue SSL certificate via Let's Encrypt

        Total estimated time: ~10 minutes
        
        What domain should I use for SSL?

User:   checkout-api.acmecorp.com

Agent:  Ready. I'll also commit the Dockerfile to a branch and open a PR 
        so it's tracked in your repo. Proceed?

User:   yes

Agent:  ✅ Step 1/9 — Dockerfile created
        ✅ Step 2/9 — .dockerignore created  
        ✅ Step 3/9 — Image built (acmecorp/checkout-service:v1.0.0)
        ✅ Step 4/9 — Pushed to Docker Hub
        🔄 Step 5/9 — Provisioning EC2 t3.medium...
        ✅ Step 5/9 — EC2 ready: i-0a1b2c3d (54.221.43.12)
        ✅ Step 6/9 — Security group configured
        ✅ Step 7/9 — Container running on port 8080
        ✅ Step 8/9 — Nginx configured
        ✅ Step 9/9 — SSL certificate issued

        ────────────────────────────────────────────
        🎉 Deployment complete!

        URL:       https://checkout-api.acmecorp.com
        IP:        54.221.43.12
        Instance:  i-0a1b2c3d4e5f (t3.medium, us-east-1a)
        Image:     acmecorp/checkout-service:v1.0.0

        ⚠️  DNS action required:
            Add A record: checkout-api.acmecorp.com → 54.221.43.12
            SSL will activate within ~2 minutes of DNS propagation.

        PR opened: github.com/acmecorp/checkout-service/pull/12
        "Add Dockerfile and deployment config"

        Want me to set up a CI/CD pipeline so future pushes to main deploy automatically?
```

---

### Example 2.2 — Redeploying After a Code Change

```
User:   i pushed a fix to main, redeploy checkout-service

Agent:  I can see the latest commit on main:
        abc1234 — "Fix payment calculation rounding error" (3 minutes ago)

        Current production version: v1.0.0 (image: acmecorp/checkout-service:v1.0.0)

        Plan:
          Step 1  Build new image from latest main → tag: v1.0.1 + git:abc1234
          Step 2  Push to Docker Hub
          Step 3  Pull new image on i-0a1b2c3d (54.221.43.12)
          Step 4  Restart container with zero-downtime swap
        
        Proceed?

User:   yes

Agent:  ✅ Built acmecorp/checkout-service:v1.0.1
        ✅ Pushed to Docker Hub
        ✅ Pulled on production instance
        ✅ Container restarted (zero downtime — old container kept alive during swap)

        Production is now running v1.0.1 (commit abc1234).
```

---

## Category 3: Debugging & Problem Solving

### Example 3.1 — Website Not Loading After S3 + CloudFront Setup

```
User:   i set up s3 and cloudfront for my website but it's still not showing anything

Agent:  Let me investigate your setup...

        Found CloudFront distribution: E3KX2J1MNPQ4R
        Origin: acmecorp-website.s3.amazonaws.com
        Domain: d3abc123xyz.cloudfront.net

        Issues found (3):

        ━━━ Issue 1 — CRITICAL: S3 bucket policy missing OAC ━━━
        Your CloudFront distribution uses Origin Access Control (OAC), but
        your S3 bucket policy doesn't grant CloudFront permission to read objects.
        CloudFront is getting a 403 Access Denied from S3.

        Fix: Add this bucket policy to acmecorp-website:
        {
          "Statement": [{
            "Effect": "Allow",
            "Principal": { "Service": "cloudfront.amazonaws.com" },
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::acmecorp-website/*",
            "Condition": {
              "StringEquals": {
                "AWS:SourceArn": "arn:aws:cloudfront::123456789:distribution/E3KX2J1MNPQ4R"
              }
            }
          }]
        }

        ━━━ Issue 2 — HIGH: No default root object ━━━
        CloudFront doesn't know what to serve when someone visits your domain root.
        Fix: Set default root object to "index.html"

        ━━━ Issue 3 — LOW: Distribution still deploying ━━━
        Status: InProgress (started 4 minutes ago)
        This is normal — CloudFront distributions take 5–15 minutes to deploy globally.
        Wait for "Deployed" status before testing.

        Fix plan:
          Step 1  Update S3 bucket policy to allow CloudFront OAC
          Step 2  Set CloudFront default root object to "index.html"
          Step 3  Invalidate CloudFront cache
          (Then wait ~5 more minutes for distribution to finish deploying)

        Fix now?

User:   yes

Agent:  ✅ S3 bucket policy updated
        ✅ Default root object set to index.html
        ✅ Cache invalidation triggered (/* path)

        CloudFront distribution is still deploying (currently at ~6 min).
        Your site should be live at https://d3abc123xyz.cloudfront.net 
        in approximately 5–10 more minutes.

        I'll check back and let you know when it's up. 
        Want me to also add a custom domain with SSL?
```

---

### Example 3.2 — API Returning 500 Errors

```
User:   our payments API has been throwing 500 errors for the last 20 minutes

Agent:  Investigating payments-api now...

        Pod status (k8s, production namespace):
        ✓  payments-api-7f9d-xk2p  Running (restarts: 0)
        ✓  payments-api-7f9d-mn3q  Running (restarts: 0)
        ✓  payments-api-7f9d-rt8w  Running (restarts: 0)
        → Pods look healthy. The issue is likely in the application logic or dependencies.

        Recent logs (last 20 minutes):
        ERROR  [stripe] StripeAuthenticationError: No API key provided
        ERROR  [stripe] StripeAuthenticationError: No API key provided
        ERROR  [stripe] StripeAuthenticationError: No API key provided
        (repeating ~400x)

        Root cause identified:
        The STRIPE_SECRET_KEY environment variable is empty or missing on all pods.

        Checking when this started...
        Your last deployment was 23 minutes ago (commit d4e5f6 — "Update Node version").
        The deployment updated the container image but the Kubernetes secret 
        stripe-api-keys does not exist in the production namespace.

        It exists in staging but was never created in production.

        Fix plan:
          Step 1  Create Kubernetes secret stripe-api-keys in production namespace
                  (I'll need you to provide the Stripe secret key value — I won't store it)
          Step 2  Update deployment to mount the secret as env var STRIPE_SECRET_KEY
          Step 3  Trigger rolling restart to apply changes

        What's the Stripe secret key? (You can DM it to me or paste it here — 
        it will be stored encrypted in Kubernetes Secrets, not in any logs)

User:   [sends key via DM]

Agent:  ✅ Secret created in production namespace (encrypted at rest)
        ✅ Deployment updated to mount STRIPE_SECRET_KEY
        ✅ Rolling restart complete — all 3 pods updated

        Testing endpoint... ✓ HTTP 200 response received.

        The API is healthy. The 500 errors should have stopped.
        
        Note: I noticed the same secret is also missing from the staging deployment 
        (staging was working because it hit a mock Stripe endpoint). 
        Want me to add it to staging too?
```

---

### Example 3.3 — Kubernetes Pod Crashing

```
User:   the image processor service keeps restarting, figure out what's wrong

Agent:  Checking image-processor in production namespace...

        Pod status:
        ✗  image-processor-6b8d-pk3r  CrashLoopBackOff  (restarts: 24)
        ✗  image-processor-6b8d-mq7s  CrashLoopBackOff  (restarts: 22)

        Reason for crashes: OOMKilled (Out of Memory)

        Current memory limit: 256Mi
        Last known memory usage before crash: 248Mi–254Mi (consistently hitting the limit)

        Last 10 lines of logs before most recent crash:
        Processing image: product_hero_4k_v2.jpg (8MB raw)
        Resizing to 4 variants...
        Variant 1/4 complete (2048x2048)
        Variant 2/4 complete (1024x1024)
        Killed

        Analysis:
        The service processes large images (some 8–15MB). The current 256Mi memory limit 
        is too low for concurrent processing. The node has 1.2GB available.

        Fix options:
          A) Increase memory limit to 512Mi (recommended — covers current workload)
          B) Increase to 1024Mi (gives more headroom for growth)
          C) Keep 256Mi but add a queue to process one image at a time (architectural change)

        Which do you prefer?

User:   go with 512, also why was it fine before?

Agent:  Increasing memory limit to 512Mi...

        ✅ Deployment updated (memory limit: 256Mi → 512Mi)
        ✅ Rolling restart — both pods Running (no more crashes)

        Why it broke now:
        Looking at your recent deployments — 2 days ago (commit b3c4d5) 
        you updated the image resizing library from sharp@0.30 to sharp@0.32.
        
        sharp@0.32 introduced a new libvips version with higher memory usage 
        for large image processing. Your old 256Mi limit was sufficient for 
        the previous version but not the new one.

        The fix I applied is correct. If you want, I can also set up a memory 
        usage alert so you get notified before it hits the limit next time.
```

---

## Category 4: Infrastructure Creation

### Example 4.1 — S3 + CloudFront from Scratch

```
User:   create an s3 bucket and cloudfront distribution to host my static website. 
        domain is app.acmecorp.com

Agent:  Plan: Static website hosting on S3 + CloudFront

          Step 1  Create S3 bucket: acmecorp-app-website (us-east-1)
                  → Private, static website hosting enabled, versioning on
          Step 2  Configure bucket policy for CloudFront OAC
          Step 3  Create CloudFront distribution
                  → Origin: S3 bucket via OAC (secure, no public bucket needed)
                  → HTTP → HTTPS redirect
                  → Compression enabled (gzip + br)
                  → Default root object: index.html
                  → Cache TTL: 24h for assets, 5min for HTML
          Step 4  Request SSL certificate via ACM for app.acmecorp.com
          Step 5  Attach certificate to CloudFront distribution
          Step 6  Set up custom 404 → /index.html redirect (for SPA routing)

          After completion you'll need to:
          → Add CNAME record: app.acmecorp.com → [cloudfront-domain]
          → Upload your build files to the S3 bucket

          Estimated monthly cost: ~$1–5/month depending on traffic
          (S3 storage + CloudFront data transfer)

        Proceed?

User:   yes, and i'm using react so add spa routing support

Agent:  Added SPA routing to the plan (all 404s → /index.html with 200 status).

        ✅ Step 1/6 — S3 bucket created: acmecorp-app-website
        ✅ Step 2/6 — Bucket policy configured (OAC only, no public access)
        ✅ Step 3/6 — CloudFront distribution created (deploying globally, ~10 min)
        ✅ Step 4/6 — SSL certificate requested for app.acmecorp.com
        ⚠️  Step 5/6 — Waiting for certificate validation...
                        Add this DNS record to validate:
                        CNAME: _abc123.app.acmecorp.com → _xyz456.acm-validations.aws.
        ✅ Step 6/6 — SPA error pages configured (404 → /index.html, HTTP 200)

        Waiting for your DNS validation record...

        [3 minutes later]

        ✅ Step 5/6 — Certificate validated and attached to CloudFront

        ─────────────────────────────────────────────────────
        Setup complete!

        CloudFront domain:  https://d3abc123xyz.cloudfront.net
        Custom domain:      https://app.acmecorp.com (once DNS added)
        S3 bucket:          acmecorp-app-website

        Next steps:
        1. Add CNAME: app.acmecorp.com → d3abc123xyz.cloudfront.net
        2. Upload your React build: aws s3 sync ./build s3://acmecorp-app-website
        3. After uploading, run a cache invalidation (I can do this for you anytime)
```

---

### Example 4.2 — VPC Setup

```
User:   create a proper vpc setup for our new microservices project

Agent:  I'll design a production-grade VPC. A few quick questions:

        1. Which region?
        2. How many availability zones? (2 = standard, 3 = high availability)
        3. Do your services need to access the internet outbound? (e.g., call external APIs)

User:   us-east-1, 3 AZs, yes they need outbound internet

Agent:  Plan: Production VPC for microservices (us-east-1, 3 AZs)

        Architecture:
        ┌─────────────────────────────────────────────────────────┐
        │ VPC: 10.0.0.0/16                                        │
        │                                                          │
        │  Public Subnets (for load balancers + NAT Gateways)     │
        │  ├── 10.0.1.0/24  (us-east-1a)                         │
        │  ├── 10.0.2.0/24  (us-east-1b)                         │
        │  └── 10.0.3.0/24  (us-east-1c)                         │
        │                                                          │
        │  Private Subnets (for your services + databases)        │
        │  ├── 10.0.10.0/24 (us-east-1a)                         │
        │  ├── 10.0.11.0/24 (us-east-1b)                         │
        │  └── 10.0.12.0/24 (us-east-1c)                         │
        │                                                          │
        │  Internet Gateway (inbound traffic)                     │
        │  NAT Gateways x3 (one per AZ — outbound from private)  │
        └─────────────────────────────────────────────────────────┘

        Components created:
          - 1 VPC with DNS hostnames enabled
          - 6 subnets (3 public + 3 private across 3 AZs)
          - 1 Internet Gateway
          - 3 NAT Gateways (one per AZ for redundancy)
          - Route tables with correct routing for each subnet type
          - 3 Elastic IPs for NAT Gateways

        Estimated cost: ~$100/month (NAT Gateways are the main cost)

        Note: If cost is a concern, I can use 1 NAT Gateway instead of 3.
        That saves ~$65/month but loses AZ-level redundancy for outbound traffic.

        Proceed with 3 NAT Gateways (full HA)?

User:   yes

Agent:  ✅ VPC created: vpc-0a1b2c3d (10.0.0.0/16)
        ✅ 6 subnets created and tagged
        ✅ Internet Gateway created and attached
        ✅ 3 NAT Gateways provisioned (one per AZ)
        ✅ Route tables configured
        ✅ All resources tagged with: Environment=production, Project=microservices

        Your VPC is ready. Want me to also create:
          - A default security group for internal service-to-service communication?
          - An EKS cluster in this VPC?
          - An Application Load Balancer in the public subnets?
```

---

## Category 5: Cost Optimization

### Example 5.1 — Full Cost Audit

```
User:   we're spending too much on aws, find the waste

Agent:  Running full cost audit... (pulling CloudWatch metrics + Cost Explorer data)

        ── AWS COST REPORT — acmecorp ──────────────────────────────
        Current month: $5,840 (+18% vs last month)
        Projected this month: $6,100

        TOP COST DRIVERS:
        EC2 instances:          $2,340  (40%)
        RDS:                    $1,120  (19%)
        NAT Gateways:           $480    (8%)
        Data Transfer:          $430    (7%)
        CloudFront:             $290    (5%)
        Other:                  $1,180  (20%)

        ── WASTE IDENTIFIED ────────────────────────────────────────

        🔴 SAVE $380/month — RDS dev instance running 24/7
           "dev-postgres" (db.r5.large) — zero connections between 7pm–9am
           Fix: Schedule stop (evenings + weekends) → from $280 to $80/month

        🔴 SAVE $240/month — 4 orphaned EC2 instances
           old-staging-1, old-staging-2, old-staging-3, old-staging-4
           Zero HTTP traffic for 47 days. Last SSH access: 12 days ago.
           Risk: Terminating removes data. 
           Recommend: Stop first, terminate after 30 days if unused.

        🟡 SAVE $180/month — 6 EC2 instances overprovisioned
           worker-pool-01 through 06: t3.large, avg CPU 6%, max 22%
           Recommendation: Downsize to t3.medium
           (Run for 1 week to verify, then downsize)

        🟡 SAVE $130/month — NAT Gateway in eu-central-1
           Your services moved to us-east-1 but this NAT Gateway was never deleted
           Likely orphaned. Confirm nothing uses it, then delete.

        🟡 SAVE $95/month — S3 storage class optimization
           acmecorp-logs-archive (1.8TB): 94% of objects untouched >180 days
           Move to S3 Glacier Instant Retrieval

        🟢 SAVE $60/month — Elastic IPs not attached
           3 Elastic IPs with no associated instance ($0.005/hr each)

        ─────────────────────────────────────────────────────────────
        Total identified savings: ~$1,085/month (18% reduction)

        Which items should I act on?

User:   do the s3 one, the elastic ips, and the eu nat gateway. 
        stop the orphaned instances but don't terminate yet. 
        check with the team before touching the rds or ec2 sizes

Agent:  On it.

        ✅ S3 lifecycle rule created — objects >180 days old move to Glacier (monthly savings: ~$95)
        ✅ 3 unused Elastic IPs released (monthly savings: $60)
        ✅ eu-central-1 NAT Gateway deleted after confirming no active routes (monthly savings: $130)
        ✅ old-staging-1, 2, 3, 4 stopped (not terminated — instances preserved)
           → These will auto-appear in a "stopped instances" review reminder in 30 days

        For RDS and EC2 right-sizing, I've posted a summary in #infrastructure 
        with the data and recommendations. I tagged @devops-team for review.

        Total savings activated today: $525/month
        Remaining if team approves the rest: +$560/month
```

---

## Category 6: CI/CD Setup

### Example 6.1 — Full Pipeline Setup

```
User:   set up ci/cd for github.com/acmecorp/checkout-service
        build on every commit, deploy to staging on merge to main, 
        deploy to prod manually

Agent:  Plan: GitHub Actions CI/CD for checkout-service

        I'll create 2 workflow files:

        1. ci.yml — runs on every push / PR
           → Install dependencies
           → Run tests (npm test)
           → Build Docker image (don't push — just verify it builds)
           → Post status to PR

        2. deploy.yml — runs on merge to main
           → Build Docker image
           → Push to ECR: acmecorp/checkout-service:{git-sha} + :staging-latest
           → Deploy to ECS staging cluster (auto)
           → Post deployment status to #deployments Slack channel
           → Manual approval gate (GitHub Environments) → deploy to production

        GitHub Secrets I'll need (I'll list them, you add them):
          AWS_ACCESS_KEY_ID
          AWS_SECRET_ACCESS_KEY
          AWS_REGION
          ECR_REGISTRY
          SLACK_WEBHOOK_URL

        I'll open a PR with both workflow files. Proceed?

User:   yes, and also run a security scan on the docker image before pushing

Agent:  Added: Trivy vulnerability scan step between build and push.
        If critical CVEs are found, the pipeline will fail and block deployment.

        ✅ Branch created: add-cicd-pipeline
        ✅ .github/workflows/ci.yml committed
        ✅ .github/workflows/deploy.yml committed (includes Trivy scan)
        ✅ PR opened: github.com/acmecorp/checkout-service/pull/15
           "Add CI/CD pipeline with staging + production deployment"

        Add these secrets in GitHub before merging:
        Settings → Secrets and variables → Actions

          AWS_ACCESS_KEY_ID      = [your AWS key]
          AWS_SECRET_ACCESS_KEY  = [your AWS secret]
          AWS_REGION             = us-east-1
          ECR_REGISTRY           = 123456789.dkr.ecr.us-east-1.amazonaws.com
          SLACK_WEBHOOK_URL      = [your Slack webhook]
```
