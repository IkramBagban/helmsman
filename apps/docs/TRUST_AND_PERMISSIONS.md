# Trust & Permissions Model

The permission system is the backbone of Helmsman's safety. Get this right and users trust the agent deeply. Get it wrong and one bad command destroys something important — or worse, someone on the team does something they shouldn't be able to.

---

## The Core Principle

**The agent can only do what the human explicitly allows, on the resources the human has defined.**

No action happens without:
1. The team having connected the relevant integration (AWS account, GitHub org, etc.)
2. The user having permission to perform that action
3. The user explicitly approving the plan

---

## Action Risk Tiers

Every possible action the agent can take is classified into one of four tiers.

### Tier 1 — Read Only
Operations that only read state. Zero infrastructure impact.

Examples:
- List EC2 instances
- Read logs
- Show cost report
- Describe security groups
- Check S3 bucket settings
- Get Kubernetes pod status

**Behavior:** Execute immediately, no approval needed. Report results inline.

---

### Tier 2 — Low-Risk Write
Operations that create things but are easy to reverse or have no blast radius.

Examples:
- Create a Dockerfile (just a file)
- Open a pull request (can be closed)
- Add a tag to an EC2 instance
- Create an S3 bucket with no data
- Update a non-production environment variable
- Commit to a non-default branch

**Behavior:** The agent states what it's about to do in one line and proceeds. User can interrupt if they want.

```
Agent: I'll create a Dockerfile and open a PR for review. Proceeding...
```

---

### Tier 3 — Significant Action
Operations that change running infrastructure, have cost implications, or affect availability.

Examples:
- Provision a new EC2 instance, RDS, or NAT Gateway
- Deploy a new version of an application
- Scale a Kubernetes deployment
- Modify security group rules
- Create a CloudFront distribution
- Change an instance type

**Behavior:** Full plan presented. User must explicitly type "yes", "approve", "go", "do it", etc. The agent waits.

```
Agent: [presents full step-by-step plan with cost and time estimates]
       Ready to proceed. Approve?

User:  yes

Agent: Starting execution...
```

---

### Tier 4 — Destructive / Irreversible
Operations that permanently destroy data or resources. Cannot be undone.

Examples:
- Terminate an EC2 instance (data on ephemeral storage is gone)
- Delete an RDS instance (data gone unless backup exists)
- Empty or delete an S3 bucket
- Delete a Kubernetes namespace
- Remove a production CloudFront distribution
- Delete a VPC

**Behavior:** Explicit confirmation by typing the resource name or a specific phrase. The agent shows a hard warning.

```
Agent: ⚠️  DESTRUCTIVE ACTION — THIS CANNOT BE UNDONE

       You are about to permanently delete:
       RDS Instance: prod-payments-db
       Region: us-east-1
       Last backup: 2 hours ago (2024-01-15 14:30 UTC)

       If you proceed, ALL DATA IN THIS INSTANCE WILL BE LOST
       unless you restore from the backup.

       To confirm, type the database identifier exactly:
       prod-payments-db

User:  prod-payments-db

Agent: Confirmed. Deleting prod-payments-db...
```

---

## Team Permission Roles

Teams can assign roles to members that control what they can do via the agent.

### Viewer
- Can ask questions and get information about any infrastructure
- Cannot initiate any write actions
- Useful for: managers, on-call engineers who need visibility but not write access

### Operator
- All Viewer permissions
- Can trigger Tier 1, 2, and 3 actions in non-production environments
- Requires a second approval from an Admin for Tier 3+ in production
- Useful for: most developers

### Deployer
- All Operator permissions
- Can trigger Tier 3 actions in production without second approval
- Cannot perform Tier 4 (destructive) actions alone
- Useful for: senior developers, release engineers

### Admin
- Full access to all tiers including Tier 4
- Can configure team settings, manage integrations, modify other users' roles
- Can approve pending requests from Operators
- Useful for: DevOps leads, infrastructure engineers, CTOs

### Read-Only Integration
- A special mode where the agent is connected to cloud accounts but can only read
- Useful for: onboarding, auditing, or teams not yet ready to give write access

---

## Environment-Based Restrictions

In addition to role-based permissions, teams can define environment-level restrictions.

Example config:
```
environments:
  staging:
    operators_can_deploy: true
    destructive_requires: deployer
    
  production:
    operators_can_deploy: false
    deployments_require_role: deployer
    destructive_requires: admin
    destructive_requires_second_approver: true
```

With `destructive_requires_second_approver: true`, even an Admin cannot destroy production resources alone. A second Admin must approve in the same conversation thread.

---

## Approval Workflows in Chat (Telegram first, Slack next)

When an action requires elevated approval, the agent posts a structured approval request in the active chat/channel.

```
🔐 Deployment Approval Required

Sarah wants to deploy checkout-service v2.5.0 to production.

  Service:    checkout-service
  Version:    v2.5.0 (commit: abc1234)
  Target:     production (ECS us-east-1)
  Requested:  2 minutes ago

  [ Approve ] [ Reject ] [ View Details ]

Approved by 0/1 required admins.
```

Approvals are recorded with timestamp and approver identity.

---

## Scoped Cloud Credentials

The agent should never have root/admin credentials to a cloud account. When a team connects their AWS account, the agent guides them to create a scoped IAM role.

**Recommended AWS IAM permissions for Helmsman:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EC2ReadWrite",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances",
        "ec2:RunInstances", "ec2:TerminateInstances",
        "ec2:CreateSecurityGroup", "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateTags", "ec2:AllocateAddress", "ec2:ReleaseAddress"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3ReadWrite",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketPolicy", "s3:PutBucketPolicy",
        "s3:GetBucketWebsite", "s3:PutBucketWebsite",
        "s3:ListBucket", "s3:GetObject", "s3:PutObject",
        "s3:CreateBucket", "s3:PutBucketVersioning",
        "s3:PutBucketEncryption", "s3:PutLifecycleConfiguration"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudFrontReadWrite",
      "Effect": "Allow",
      "Action": [
        "cloudfront:GetDistribution*", "cloudfront:ListDistributions",
        "cloudfront:CreateDistribution", "cloudfront:UpdateDistribution",
        "cloudfront:CreateInvalidation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CostExplorerRead",
      "Effect": "Allow",
      "Action": ["ce:GetCostAndUsage", "ce:GetRightsizingRecommendation"],
      "Resource": "*"
    },
    {
      "Sid": "IAMReadOnly",
      "Effect": "Allow",
      "Action": ["iam:Get*", "iam:List*"],
      "Resource": "*"
    }
  ]
}
```

The agent never needs full `AdministratorAccess`. If a user pastes AdministratorAccess credentials, the agent warns them and suggests creating a scoped role.

---

## Audit Log

Every action the agent takes is recorded and queryable.

**Logged for every action:**
- Timestamp
- User who requested it
- Exact plan that was presented
- Approval details (who approved, when, what they typed)
- Steps executed and their outcomes
- Any errors encountered
- Resources created, modified, or deleted

**Queryable via the agent:**
```
User:   who deployed last week and what did they do?

Agent:  Deployment activity last 7 days:

        Monday  10:23  Sarah → deployed checkout-service v2.4.1 to production (EC2)
        Tuesday 14:07  James → scaled payments-api from 3 to 6 replicas (K8s)
        Thursday 09:55 Sarah → deployed api-gateway v1.8.0 to staging
        Friday  16:30  James → terminated old-staging-1 and old-staging-2

        4 actions total. All actions were approved before execution.
```

The audit log is append-only and cannot be deleted through the agent.
