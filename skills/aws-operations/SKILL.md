---
name: aws-operations
description: AWS operational workflow skill. Use this whenever the user asks about AWS services, cloud costs, IAM, EC2, S3, EKS, Kubernetes-on-AWS, or account/resource state and changes or anythign related to aws.
helmsman:
  id: aws-operations
  priority: 90
  keywords:
    - aws
    - ec2
    - s3
    - rds
    - cloudfront
    - cloudwatch
    - iam
    - route53
    - billing
    - cost
    - eks
    - kubernetes
---

# AWS Operations

## Workflow

1. For live account state (resources, status, IDs, spend), use runtime tools first.
2. For AWS behavior/defaults/limits/compatibility, use `aws_knowledge_lookup` when uncertain.
3. Keep CLI calls explicit (`--region`, `--output json`) and avoid shell substitution.
4. For write/destructive actions, inspect current state first and summarize blast radius.
5. If risk is significant/destructive, require approval before execution.
