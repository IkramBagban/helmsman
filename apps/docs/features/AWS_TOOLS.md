# Feature: AWS Tools

> **Package:** `packages/tools-aws`
> **Wave:** 2 (depends on: `@helmsman/tools` for ToolInterface)
> **Estimated effort:** 4-5 days

---

## Purpose

Implement the **Layer 1 curated tools** for AWS — the high-frequency, well-understood operations that cover ~80% of daily DevOps tasks. Each tool wraps a specific AWS SDK v3 call, validates parameters with Zod, handles AWS errors gracefully, and returns structured data. These tools implement the `Tool` interface from `@helmsman/tools`.

**Architecture context:** These curated tools are the fast path. For the hundreds of other AWS services and API calls not covered here, the `shell.execute` tool (Layer 2) lets the LLM run AWS CLI commands in a sandbox. See `docs/AGENT_DESIGN.md` for the full hybrid tool architecture.

---

## Requirements

### Must Have (Phase 1 — MVP)

#### EC2 Tools
- [ ] `aws.ec2.describeInstances` — List/describe instances with filters (region, state, type, tags)
- [ ] `aws.ec2.getInstanceMetrics` — Get CloudWatch metrics for a specific instance (CPU, network, disk)
- [ ] `aws.ec2.startInstances` — Start one or more stopped instances
- [ ] `aws.ec2.stopInstances` — Stop one or more running instances

#### S3 Tools
- [ ] `aws.s3.listBuckets` — List all buckets with metadata (region, size estimate, creation date)
- [ ] `aws.s3.describeBucket` — Get bucket details (policy, versioning, encryption, public access)
- [ ] `aws.s3.createBucket` — Create a bucket with best practices (encryption, versioning, block public)

#### CloudWatch Tools
- [ ] `aws.cloudwatch.getMetrics` — Get metric data for any resource

#### Cost Tools
- [ ] `aws.cost.getMonthlySummary` — Current month cost breakdown by service
- [ ] `aws.cost.getServiceCost` — Detailed cost for a specific service

### Nice to Have (Phase 1)
- [ ] `aws.ec2.describeSecurityGroups` — List security group rules
- [ ] `aws.s3.getBucketPolicy` — Get bucket policy document
- [ ] `aws.ec2.createInstance` — Create a new EC2 instance (Tier 3 action)

### Out of Scope (Later Phases)
- **RDS, Lambda, ECS, Route53, IAM, VPC curated tools** — use `shell.execute` with AWS CLI for these until traffic justifies a dedicated tool
- Multi-region parallel queries
- Terraform integration

### When to Promote CLI → Curated Tool
If analytics show >10% of `shell.execute` calls use the same AWS service/action, consider promoting it to a curated tool for better type safety, descriptions, and UX.

---

## Contracts

Every tool implements `Tool` from `@helmsman/tools`:

```typescript
import type { Tool, ToolDefinition, ToolContext, ToolResponse } from "@helmsman/tools";
```

### AWS Credentials in ToolContext
```typescript
// credentials shape for AWS tools
interface AWSCredentials extends ToolCredentials {
  provider: "aws";
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}
```

---

## Tool Specifications

### aws.ec2.describeInstances

```typescript
// Parameters
const params = z.object({
  region: z.string().default("us-east-1"),
  instanceIds: z.array(z.string()).optional(),
  state: z.enum(["running", "stopped", "terminated", "pending", "shutting-down"]).optional(),
  tags: z.record(z.string()).optional(),
  maxResults: z.number().max(100).default(50),
});

// Response data shape
interface EC2Instance {
  instanceId: string;
  state: string;
  type: string;
  publicIp: string | null;
  privateIp: string;
  vpcId: string | null;
  subnetId: string | null;
  launchTime: string;
  platform: string | null; // "windows" | null (Linux)
  tags: Record<string, string>;
  monitoring: "enabled" | "disabled";
}

// Risk tier: read_only
```

### aws.ec2.startInstances

```typescript
const params = z.object({
  region: z.string().default("us-east-1"),
  instanceIds: z.array(z.string()).min(1),
});

// Response data
interface StartResult {
  started: string[];   // instance IDs that were started
  alreadyRunning: string[];
  failed: { instanceId: string; error: string }[];
}

// Risk tier: significant
```

### aws.ec2.stopInstances

```typescript
const params = z.object({
  region: z.string().default("us-east-1"),
  instanceIds: z.array(z.string()).min(1),
  force: z.boolean().default(false),
});

// Risk tier: significant (force=false), destructive (force=true)
```

### aws.s3.listBuckets

```typescript
const params = z.object({
  // No required params — lists all buckets
  prefix: z.string().optional(), // filter by name prefix
});

// Response data
interface S3BucketSummary {
  name: string;
  region: string;
  creationDate: string;
  isPublic: boolean;
  versioning: "Enabled" | "Suspended" | "Disabled";
  encryption: string | null;
}

// Risk tier: read_only
```

### aws.s3.createBucket

```typescript
const params = z.object({
  bucketName: z.string()
    .min(3).max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Invalid S3 bucket name"),
  region: z.string().default("us-east-1"),
  versioning: z.boolean().default(true),
  encryption: z.enum(["AES256", "aws:kms"]).default("AES256"),
  blockPublicAccess: z.boolean().default(true),
  tags: z.record(z.string()).optional(),
});

// Best practices auto-applied:
// - Block all public access ON (unless explicitly false)
// - Versioning enabled
// - SSE-S3 encryption
// - Standard tags (CreatedBy: helmsman, CreatedAt: ISO timestamp)

// Risk tier: low_risk (creating an empty bucket is easily reversible)
```

### aws.cost.getMonthlySummary

```typescript
const params = z.object({
  month: z.string().optional(), // "2026-02", defaults to current month
  granularity: z.enum(["DAILY", "MONTHLY"]).default("MONTHLY"),
});

// Response data
interface CostSummary {
  period: { start: string; end: string };
  totalCost: { amount: string; unit: string };
  byService: { service: string; amount: string; unit: string }[];
  currency: string;
}

// Risk tier: read_only
```

---

## File Structure

```
packages/tools-aws/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                          # Export all tools + registration helper
    types.ts                          # AWSCredentials, shared AWS types
    client-factory.ts                 # Create scoped AWS SDK clients
    client-factory.test.ts
    ec2/
      describe-instances.ts           # Tool implementation
      describe-instances.test.ts
      start-instances.ts
      start-instances.test.ts
      stop-instances.ts
      stop-instances.test.ts
      get-instance-metrics.ts
      get-instance-metrics.test.ts
    s3/
      list-buckets.ts
      list-buckets.test.ts
      describe-bucket.ts
      describe-bucket.test.ts
      create-bucket.ts
      create-bucket.test.ts
    cloudwatch/
      get-metrics.ts
      get-metrics.test.ts
    cost/
      get-monthly-summary.ts
      get-monthly-summary.test.ts
      get-service-cost.ts
      get-service-cost.test.ts
```

---

## Implementation Notes

### AWS Client Factory
Create AWS clients scoped per request (never reuse credentials across teams):

```typescript
// src/client-factory.ts
import { EC2Client } from "@aws-sdk/client-ec2";
import { S3Client } from "@aws-sdk/client-s3";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";

export function createEC2Client(credentials: AWSCredentials): EC2Client {
  return new EC2Client({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}
// ... same pattern for S3, CloudWatch, CostExplorer
```

### Error Mapping
Map AWS SDK errors to clean ToolResponse errors:

```typescript
function mapAWSError(err: unknown): ToolResponse {
  if (err instanceof Error && "name" in err) {
    const awsError = err as { name: string; message: string; $retryable?: { throttling: boolean } };

    return {
      ok: false,
      error: {
        code: `AWS.${awsError.name}`,
        message: awsError.message,
        retryable: awsError.$retryable?.throttling ?? false,
      },
    };
  }
  return {
    ok: false,
    error: { code: "AWS.UNKNOWN", message: "Unknown AWS error", retryable: false },
  };
}
```

### Best Practices Auto-Applied
When creating resources (e.g., S3 bucket), automatically apply best practices from `docs/BEST_PRACTICES.md`:

- S3: Block public access, enable versioning, enable encryption, add standard tags
- EC2 (future): IMDSv2, no default VPC for production, standard tags

### Registration Helper
```typescript
// src/index.ts
import type { ToolRegistry } from "@helmsman/tools";

export function registerAWSTools(registry: ToolRegistry): void {
  registry.register(new DescribeInstancesTool());
  registry.register(new StartInstancesTool());
  registry.register(new StopInstancesTool());
  registry.register(new GetInstanceMetricsTool());
  registry.register(new ListBucketsTool());
  registry.register(new DescribeBucketTool());
  registry.register(new CreateBucketTool());
  registry.register(new GetMetricsTool());
  registry.register(new GetMonthlySummaryTool());
  registry.register(new GetServiceCostTool());
}
```

---

## Testing Plan

### Unit Tests (Mock AWS SDK)
| Test | What |
|------|------|
| `describe-instances.test.ts` | Returns formatted instance list from mock SDK response |
| `describe-instances.test.ts` | Handles empty results (no instances) |
| `describe-instances.test.ts` | Handles AWS AccessDenied error → clean error response |
| `start-instances.test.ts` | Starts instances → returns started IDs |
| `start-instances.test.ts` | Already-running instances → noted in response |
| `stop-instances.test.ts` | Stops instances → returns stopped IDs |
| `list-buckets.test.ts` | Returns bucket list with metadata |
| `create-bucket.test.ts` | Creates bucket with all best practices applied |
| `create-bucket.test.ts` | Invalid bucket name → validation error (never hits AWS) |
| `get-monthly-summary.test.ts` | Returns cost breakdown by service |
| `client-factory.test.ts` | Creates client with correct credentials and region |

### Integration Tests (Optional — Real AWS)
Only run with `AWS_LIVE_TEST=1`:
| Test | What |
|------|------|
| Describe instances in a test account | Real AWS call succeeds |
| List buckets in a test account | Real AWS call succeeds |

---

## Acceptance Criteria

1. `aws.ec2.describeInstances` → returns instance list with all expected fields
2. `aws.ec2.stopInstances` → stops instance, returns confirmation
3. `aws.s3.listBuckets` → returns all buckets with public/private status
4. `aws.s3.createBucket` → creates bucket with versioning, encryption, block public access
5. `aws.cost.getMonthlySummary` → returns cost breakdown for current month
6. All tools return `{ ok: false, error: { code, message, retryable } }` on AWS errors
7. Invalid params rejected before any AWS call is made (Zod validation)
8. Every tool response includes `durationMs`
9. No credentials logged anywhere (not in errors, not in debug output)
10. `registerAWSTools()` registers all 10 tools in one call
