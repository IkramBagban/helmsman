# Helmsman — Codebase Refactoring Guide
> Opinionated, step-by-step. Follow phases in order. Do not skip ahead.
> Each phase is independently shippable — the app works after every phase.

---

## Answering the Two Architecture Questions First

### Q1: `packages/providers/...` vs top-level `tools-aws`, `tools-github`, `tools-dns`?

**Decision: Keep top-level domain packages. Rename convention only.**

Reason: You already have `tools-aws`, `tools-github`, `tools-devops-runtime`.
Introducing a `packages/providers/` subfolder adds zero functional benefit and
costs a rename+reimport across the whole codebase.

The right move is a naming convention, not a folder restructure:

```
Current name          →  New name (rename in package.json only)
tools-aws             →  tools-aws          (keep, restructure internals)
tools-github          →  tools-github       (keep, already clean)
tools-devops-runtime  →  tools-devops-runtime (keep)
(new)                 →  tools-dns
(new)                 →  tools-gcp
(new)                 →  tools-cloudflare
```

**Rule:** Every external provider/platform gets a `tools-{name}` package.
Internal infrastructure (shell execution, container runtime) stays in `tools`
and `tools-devops-runtime`. Transport stays in `transport` (new package).
This is predictable. A new engineer immediately knows where AWS code lives.

### Q2: Standardized Provider Export Shape?

**Decision: Standardized shape. Every `tools-*` provider package exports the same interface.**

This is the one place where uniformity pays dividends. When agent-core registers
tools, it iterates over providers. If every provider has a different export shape,
agent-core needs provider-specific wiring code. That doesn't scale.

```typescript
// packages/shared/src/types/provider.ts

export interface ProviderPackage {
  /** Provider identifier: 'aws' | 'gcp' | 'github' | 'dns' | 'cloudflare' */
  name: string

  /** Display name shown to users */
  displayName: string

  /**
   * Observer tools — agent can call directly, no approval needed.
   * These must ONLY perform read operations. Validated in execute().
   */
  observerTools: MastraTool[]

  /**
   * Operator tools — agent calls request_action(), user approves with /approve TOKEN.
   * These perform create/modify operations. Validated in execute().
   */
  operatorTools: MastraTool[]

  /**
   * Commander tools — agent calls request_action(), user confirms with /confirm RESOURCE_ID.
   * These perform irreversible operations. Validated in execute().
   * The agent CANNOT call these directly — they throw immediately if called without
   * a valid approval token from the action gateway.
   */
  commanderTools: MastraTool[]
}
```

Providers that don't have commander-tier actions (e.g. a read-only metrics provider)
simply export `commanderTools: []`. The shape is always the same.

### Q3: Full Defense-in-Depth for Command Validation

Single-layer regex is not enough. Here is the full defense stack:

```
Layer 1 — Tool selection (structural)
  The agent is given three separate tools: aws_read, aws_write, aws_dangerous.
  Choosing the wrong tool is itself a signal. The tool's execute() validates
  that the command matches the tool's tier before doing anything.

Layer 2 — Verb classifier (fast, deterministic)
  classifyAWSCommand() runs on every command string.
  Returns: 'read' | 'operator' | 'commander' | 'unknown'
  If tier doesn't match the tool being called → reject immediately.

Layer 3 — Blocklist of dangerous flags
  Certain flag combinations escalate tier regardless of verb.
  Examples: --force, --no-dry-run, --delete, --recursive on write commands.
  These are checked separately from the verb.

Layer 4 — Command stored as-is in Redis, executed as-is
  The command the AI generates is stored verbatim in the approval token.
  It is never regenerated, never re-interpreted, never passed through LLM again.
  What the user sees in the approval message = what runs.

Layer 5 — Execution uses array args, never shell string interpolation
  Bun.spawn(['aws', 'ec2', 'describe-instances', '--region', 'us-east-1'])
  NOT: Bun.spawn(`aws ec2 describe-instances --region ${region}`)
  Shell injection through argument manipulation is impossible.

Layer 6 — Credential injection at execution time, never in command string
  AWS credentials injected as environment variables to the subprocess.
  Never appear in the command string. Never logged. Redacted from all output.

Layer 7 — Output redaction before returning to LLM
  Regex redactor strips credential-shaped strings from command output
  before the result is fed back to the agent.
```

No single layer is sufficient. All seven run on every command. Layers 4-7 are
already in your architecture. Layers 1-3 are what this refactor adds.

---

## Package Naming and Ownership Rules

Before writing any code, internalize these rules. Every file placement decision
follows from them.

```
apps/api/              HTTP transport entry. Webhook handlers. Middleware. Routes.
                       NO business logic. NO approval logic. NO scheduling logic.

apps/web/              Next.js dashboard. Frontend only.

packages/agent-core/   LLM orchestration. Router, planner, executor, responder.
                       Prompt construction. Conversation memory. Workflows.
                       NO provider tools. NO transport. NO approval storage.

packages/transport/    All messaging platform integrations.
                       Telegram, Slack, Web socket — each in own subfolder.
                       Normalizes inbound messages. Sends outbound messages.
                       Intercepts /approve, /confirm, /activate commands.

packages/action-gateway/  Token store. Approval handler. Activation handler.
                           Capability store. The request_action tool.
                           This is where approval tokens live and die.

packages/scheduling/   Schedule parsing, storage, and execution logic.
                       Imported by both apps/api and apps/worker (when added).

packages/tools/        Generic shell execution and shell safety.
                       No provider knowledge. No approval logic.

packages/tools-devops-runtime/  Container orchestration, SSH, git execution.
                                 Provider-agnostic runtime infrastructure.

packages/tools-aws/    AWS tools only. Three tools: aws_read, aws_write, aws_dangerous.
                       Exports ProviderPackage shape.

packages/tools-github/ GitHub tools only. Exports ProviderPackage shape.

packages/tools-dns/    DNS tools only. (Create when building DNS feature.)

packages/tools-gcp/    GCP tools only. (Create when building GCP feature.)

packages/audit/        Audit log. Write on every infrastructure action.

packages/policy/       Policy engine. Approval requirements. Safety rules.

packages/shared/       Types shared across packages. Errors. Logger. Constants.
                       If two packages need the same type, it goes here.
```

**The test:** For any file, ask "why does this exist here?" If the answer
references two different rows above, the file is in the wrong place.

---

## Phase 0 — Before You Start

Read this entire document before writing any code.

Run the test suite. Record which tests pass now. Every phase must end with
at least the same tests passing.

```bash
bun turbo test
```

Commit current state with message: `chore: pre-refactor baseline`

---

## Phase 1 — Create `packages/transport/`

**Goal:** Move all Telegram transport code out of `apps/api` into a dedicated package.
After this phase, `apps/api/src/telegram/` is gone and `apps/api/src/routes/telegram.ts`
is 10 lines that delegate to `@helmsman/transport`.

**Why first:** Transport is the cleanest extraction — no circular dependencies,
clear boundary, and it unblocks adding Slack later without touching the API app.

### Step 1.2 — Define the unified message type in `packages/shared`

```typescript
// packages/shared/src/types/transport.ts

export type Platform = 'telegram' | 'slack' | 'web'

export interface NormalizedMessage {
  platform: Platform
  userId: string
  chatId: string
  messageId: string
  text: string
  timestamp: Date
  correlationId: string          // for tracing through the system
}

export interface DeliveryContext {
  platform: Platform
  chatId: string
  userId: string
  replyToMessageId?: string
}

export interface TransportAdapter {
  /** Parse inbound platform event → NormalizedMessage */
  normalize(rawEvent: unknown): NormalizedMessage | null

  /** Send a text message back to the user */
  send(context: DeliveryContext, text: string): Promise<void>

  /** True if this message is an /approve, /confirm, or /activate command */
  isCommandMessage(text: string): boolean
}
```

### Step 1.3 — Move files

Move these files from `apps/api/src/telegram/` to `packages/transport/src/telegram/`:

```
approval-store.ts    → STOP. This goes to packages/action-gateway/ in Phase 2.
                       Leave it in apps/api for now.
capability-store.ts  → STOP. Same — Phase 2.
commands.ts          → packages/transport/src/telegram/interceptor.ts
dedup.ts             → packages/transport/src/telegram/dedup.ts
parser.ts            → packages/transport/src/telegram/webhook.ts
sender.ts            → packages/transport/src/telegram/sender.ts
types.ts             → merge into packages/shared/types/transport.ts
```

### Step 1.4 — Create the package entry point

```typescript
// packages/transport/src/index.ts

export * from './telegram/webhook'
export * from './telegram/sender'
export * from './telegram/interceptor'
export * from './telegram/dedup'
```

### Verification

```bash
bun turbo build
bun turbo test
# App still receives Telegram messages correctly
# All existing tests pass
```

Commit: `feat: extract transport package, move telegram adapter`

---

## Phase 2 — Create `packages/action-gateway/`

**Goal:** All approval and capability logic in one package with a clear API.
After this phase, nothing in `apps/api` or `packages/agent-core` knows how
tokens work internally.

**Why second:** The action gateway is referenced by transport (interceptor),
agent-core (request_action tool), and scheduling. Getting it into its own
package before Phase 3 and 4 prevents circular dependencies.

### Step 2.1 — Create the package

```bash
mkdir -p packages/action-gateway/src
```



### Step 2.3 — Define the token types in `packages/shared`

```typescript
// packages/shared/src/types/actions.ts

export type ActionTier = 'observer' | 'operator' | 'commander'

export type Capability = 'observer' | 'operator' | 'commander'

export interface ActionToken {
  id: string                        // 6-char uppercase: "A3K9X2"
  tier: ActionTier
  userId: string
  chatId: string
  platform: string
  provider: string                  // 'aws' | 'gcp' | 'github' etc.
  command: string                   // exact command that will run — generated once, stored
  plainEnglish: string              // what this does in plain language
  resourceIdentifier?: string       // for commander: what user must type
  resourceName?: string             // human name of resource
  createdAt: string
  expiresAt: string
  consumed: boolean
}

export interface ActivationToken {
  id: string
  capability: Capability
  userId: string
  chatId: string
  createdAt: string
  expiresAt: string
}
```

### Step 2.4 — Create the `request_action` tool

This is the ONLY write tool the agent can call directly.

```typescript
// packages/action-gateway/src/request-action-tool.ts

import { createTool } from '@mastra/core'
import { z } from 'zod'
import { tokenStore } from './token-store'

export const requestActionTool = createTool({
  id: 'request_action',
  description: `Request user approval before executing any write or destructive operation.
    Call this instead of calling write tools directly.
    Returns a token the user must send to approve.`,
  inputSchema: z.object({
    tier: z.enum(['operator', 'commander']),
    provider: z.string(),
    command: z.string().describe('Exact command that will execute on approval'),
    plainEnglish: z.string().describe('Plain English explanation for non-technical users'),
    resourceIdentifier: z.string().optional()
      .describe('For commander tier: the resource ID the user must type to confirm'),
    resourceName: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const token = await tokenStore.createActionToken(context)
    const confirmInstruction = context.tier === 'commander'
      ? `To confirm, type exactly:\n/confirm ${context.resourceIdentifier}`
      : `To approve, type exactly:\n/approve ${token.id}`

    return {
      token: token.id,
      expiresInMinutes: 15,
      message: confirmInstruction,
    }
  },
})
```

### Step 2.5 — Create approval and activation handlers

```typescript
// packages/action-gateway/src/approval-handler.ts

export async function handleApproval(
  userId: string,
  chatId: string,
  tokenId: string
): Promise<ApprovalResult> {
  const token = await tokenStore.getActionToken(tokenId)

  if (!token) return { status: 'not_found' }
  if (token.consumed) return { status: 'already_used' }
  if (new Date(token.expiresAt) < new Date()) return { status: 'expired' }
  if (token.userId !== userId || token.chatId !== chatId) return { status: 'wrong_user' }

  // Check capability is still active
  const hasCapability = await capabilityStore.check(userId, chatId, token.tier)
  if (!hasCapability) return { status: 'capability_expired' }

  // Mark consumed BEFORE executing — prevents double execution on retry
  await tokenStore.markConsumed(tokenId)

  // Execute — command comes from Redis, NOT regenerated
  const result = await executeCommand(token.command, token.provider, userId)

  // Write audit log
  await audit.write({ ...token, result, executedAt: new Date() })

  return { status: 'executed', result, token }
}
```

### Step 2.6 — Update transport interceptor

```typescript
// packages/transport/src/telegram/interceptor.ts

import { handleApproval, handleActivation, handleCommanderConfirm }
  from '@helmsman/action-gateway'

export async function interceptCommand(
  message: NormalizedMessage
): Promise<boolean> {
  const text = message.text.trim()

  if (/^\/activate (operator|commander) [A-Z0-9]{6}$/.test(text)) {
    await handleActivation(message.userId, message.chatId, text)
    return true   // intercepted, do not pass to agent
  }

  if (/^\/approve [A-Z0-9]{6}$/.test(text)) {
    const tokenId = text.split(' ')[1]
    await handleApproval(message.userId, message.chatId, tokenId)
    return true
  }

  // Commander confirmation — check against pending store
  const pending = await findPendingCommanderAction(message.userId, message.chatId, text)
  if (pending) {
    await handleCommanderConfirm(message.userId, message.chatId, pending)
    return true
  }

  return false  // not intercepted, pass to agent
}
```

### Verification

```bash
bun turbo build
bun turbo test
# /approve and /activate still work end to end
```

Commit: `feat: extract action-gateway package, centralize approval logic`

---

## Phase 3 — Restructure `packages/tools-aws/`

**Goal:** AWS package exports three tools using the command classifier.
After this phase, `tools-aws` is actually wired into the live system
(currently it's unused — confirmed by your AI).

### Step 3.1 — Add command classifier

```typescript
// packages/tools-aws/src/classifier.ts

const READ_ONLY_VERBS = [
  'describe', 'list', 'get', 'check', 'preview',
  'estimate', 'simulate', 'validate', 'test',
  'scan', 'search', 'query', 'show', 'view',
]

const DESTRUCTIVE_VERBS = [
  'delete', 'terminate', 'destroy', 'remove', 'purge',
  'wipe', 'drop', 'empty', 'deregister',
]

const DESTRUCTIVE_SPECIAL_CASES = [
  'aws s3 rb ',
  'aws s3 rm ',
  'aws ec2 cancel-spot-instance-requests',
]

const DESTRUCTIVE_FLAGS = [
  '--force',
  '--delete',
]

export type CommandTier = 'read' | 'operator' | 'commander' | 'unknown'

export function classifyAWSCommand(command: string): CommandTier {
  const normalized = command.trim().toLowerCase()

  if (!normalized.startsWith('aws ')) return 'unknown'

  // Layer 1: special case exact matches
  if (DESTRUCTIVE_SPECIAL_CASES.some(s => normalized.startsWith(s))) {
    return 'commander'
  }

  // Layer 2: destructive flags
  if (DESTRUCTIVE_FLAGS.some(f => normalized.includes(f))) {
    return 'commander'
  }

  // Layer 3: verb from subcommand (third token)
  const parts = normalized.split(/\s+/)
  const subcommand = parts[2] ?? ''
  const verb = subcommand.split('-')[0]

  if (READ_ONLY_VERBS.includes(verb)) return 'read'
  if (DESTRUCTIVE_VERBS.includes(verb)) return 'commander'

  return 'operator'
}
```

### Step 3.2 — Create the three AWS tools

```typescript
// packages/tools-aws/src/tools.ts

import { createTool } from '@mastra/core'
import { z } from 'zod'
import { classifyAWSCommand } from './classifier'
import { executeAWSCommand } from './executor'
import { requestActionTool } from '@helmsman/action-gateway'

export const awsReadTool = createTool({
  id: 'aws_read',
  description: `Run any read-only AWS CLI command to inspect, list, or describe resources.
    Examples: list EC2 instances, describe S3 buckets, get CloudWatch metrics,
    check IAM policies, view RDS configuration, query Cost Explorer.
    Do NOT use for commands that create, modify, or delete anything.`,
  inputSchema: z.object({
    command: z.string().describe('Full AWS CLI command starting with "aws"'),
    reasoning: z.string().describe('Why you need this information'),
  }),
  execute: async ({ context }) => {
    const tier = classifyAWSCommand(context.command)

    // Layer 1: tool-level validation
    if (tier !== 'read') {
      throw new Error(
        `This command is classified as "${tier}", not read-only. ` +
        `Use aws_write or aws_dangerous instead.`
      )
    }

    return await executeAWSCommand(context.command)
  },
})

export const awsWriteTool = createTool({
  id: 'aws_write',
  description: `Request approval to run a create or modify AWS CLI command.
    Use for: creating resources, updating configurations, starting/stopping instances,
    modifying security groups, uploading to S3, updating Lambda functions.
    Do NOT use for destructive operations (delete, terminate, destroy).
    Returns an approval token — tell the user to send /approve TOKEN.`,
  inputSchema: z.object({
    command: z.string().describe('Full AWS CLI command starting with "aws"'),
    plainEnglish: z.string().describe('Plain English: what will this do?'),
    resourceName: z.string().describe('Name of the resource being affected'),
  }),
  execute: async ({ context }) => {
    const tier = classifyAWSCommand(context.command)

    if (tier === 'read') {
      throw new Error('This is a read-only command. Use aws_read instead.')
    }
    if (tier === 'commander') {
      throw new Error('This is a destructive command. Use aws_dangerous instead.')
    }

    // Does not execute — stores in Redis via request_action
    return await requestActionTool.execute({
      context: {
        tier: 'operator',
        provider: 'aws',
        command: context.command,
        plainEnglish: context.plainEnglish,
        resourceName: context.resourceName,
      }
    })
  },
})

export const awsDangerousTool = createTool({
  id: 'aws_dangerous',
  description: `Request confirmation to run a DESTRUCTIVE AWS CLI command.
    Use ONLY for: terminate instances, delete S3 buckets, delete RDS databases,
    delete Lambda functions, remove IAM roles, purge SQS queues, delete CloudFormation stacks.
    These actions are IRREVERSIBLE. User must confirm by typing the resource identifier.
    Returns a confirmation token — tell the user to send /confirm RESOURCE_IDENTIFIER.`,
  inputSchema: z.object({
    command: z.string().describe('Full AWS CLI command starting with "aws"'),
    plainEnglish: z.string().describe('Plain English: what will be permanently destroyed?'),
    resourceIdentifier: z.string().describe('The exact resource ID or name user must type'),
    resourceName: z.string().describe('Human-readable name of the resource'),
  }),
  execute: async ({ context }) => {
    const tier = classifyAWSCommand(context.command)

    // Defense in depth: validate this IS actually destructive
    if (tier !== 'commander') {
      throw new Error(
        `This command is classified as "${tier}", not destructive. ` +
        `Use aws_read or aws_write instead.`
      )
    }

    return await requestActionTool.execute({
      context: {
        tier: 'commander',
        provider: 'aws',
        command: context.command,
        plainEnglish: context.plainEnglish,
        resourceIdentifier: context.resourceIdentifier,
        resourceName: context.resourceName,
      }
    })
  },
})
```

### Step 3.3 — Create the standardized export

```typescript
// packages/tools-aws/src/index.ts

import { awsReadTool, awsWriteTool, awsDangerousTool } from './tools'
import type { ProviderPackage } from '@helmsman/shared'

export const awsProvider: ProviderPackage = {
  name: 'aws',
  displayName: 'Amazon Web Services',
  observerTools: [awsReadTool],
  operatorTools: [awsWriteTool],
  commanderTools: [awsDangerousTool],
}

export { classifyAWSCommand } from './classifier'
export type { CommandTier } from './classifier'
```

### Step 3.4 — Wire into `packages/agent-core`

```typescript
// packages/agent-core/src/mastra.ts

import { awsProvider } from '@helmsman/tools-aws'
import { requestActionTool } from '@helmsman/action-gateway'

const allTools = [
  // The one agent-facing gateway tool
  requestActionTool,

  // Provider tools — agent calls these directly for observer tier
  // For operator/commander, agent calls requestActionTool instead
  ...awsProvider.observerTools,
  ...awsProvider.operatorTools,
  ...awsProvider.commanderTools,
]
```

### Step 3.5 — Write tests for classifier

```typescript
// packages/tools-aws/tests/classifier.test.ts

import { classifyAWSCommand } from '../src/classifier'

describe('classifyAWSCommand', () => {
  // Read-only
  it('classifies describe as read', () =>
    expect(classifyAWSCommand('aws ec2 describe-instances')).toBe('read'))
  it('classifies list as read', () =>
    expect(classifyAWSCommand('aws s3api list-buckets')).toBe('read'))
  it('classifies get as read', () =>
    expect(classifyAWSCommand('aws iam get-role --role-name MyRole')).toBe('read'))

  // Operator
  it('classifies create as operator', () =>
    expect(classifyAWSCommand('aws ec2 run-instances --image-id ami-123')).toBe('operator'))
  it('classifies start as operator', () =>
    expect(classifyAWSCommand('aws ec2 start-instances --instance-ids i-abc')).toBe('operator'))

  // Commander
  it('classifies delete as commander', () =>
    expect(classifyAWSCommand('aws s3api delete-bucket --bucket my-bucket')).toBe('commander'))
  it('classifies terminate as commander', () =>
    expect(classifyAWSCommand('aws ec2 terminate-instances --instance-ids i-abc')).toBe('commander'))
  it('classifies s3 rb as commander', () =>
    expect(classifyAWSCommand('aws s3 rb s3://my-bucket --force')).toBe('commander'))
  it('classifies s3 rm as commander', () =>
    expect(classifyAWSCommand('aws s3 rm s3://my-bucket --recursive')).toBe('commander'))

  // Unknown
  it('rejects non-aws commands', () =>
    expect(classifyAWSCommand('gcloud compute instances list')).toBe('unknown'))
  it('rejects empty string', () =>
    expect(classifyAWSCommand('')).toBe('unknown'))
})
```

### Verification

```bash
bun turbo test --filter=tools-aws
# Classifier tests pass
# tools-aws is now imported and used in agent-core
# /approve still works end to end for AWS commands
```

Commit: `feat: restructure tools-aws with classifier and three-tool model`

---

## Phase 4 — Create `packages/scheduling/`

**Goal:** Move scheduling logic out of `apps/api/src/scheduling/` into a package.
After this phase, `apps/api` imports scheduling from the package — no logic in the app.

### Step 4.1 — Create the package

```bash
mkdir -p packages/scheduling/src
```


### Step 4.2 — Move files

```
apps/api/src/scheduling/engine.ts  → packages/scheduling/src/engine.ts
apps/api/src/scheduling/service.ts → packages/scheduling/src/service.ts
apps/api/src/scheduling/store.ts   → packages/scheduling/src/store.ts
apps/api/src/scheduling/types.ts   → packages/scheduling/src/types.ts
apps/api/src/scheduling/risk.ts    → packages/scheduling/src/risk.ts
apps/api/src/scheduling/tools.ts   → packages/scheduling/src/tools.ts
```

The `data/` folder (`schedule-runs.json`, `schedules.json`) stays in `apps/api/data/`
for now — it's runtime data, not source code.

### Step 4.3 — Export from package

```typescript
// packages/scheduling/src/index.ts
export * from './service'
export * from './engine'
export * from './types'
export * from './tools'
```

### Step 4.4 — Update `apps/api` imports

```typescript
// apps/api/src/routes/... wherever scheduling is used

import { SchedulingService, SchedulingEngine } from '@helmsman/scheduling'
```

`apps/api/src/scheduling/` directory is now deleted.

### Verification

```bash
bun turbo build
bun turbo test
# Scheduling still works
# apps/api/src/ now contains only: app.ts, config.ts, index.ts, middleware/, routes/
```

Commit: `feat: extract scheduling package`

---

## Phase 5 — Wire `packages/audit/` and `packages/policy/`

**Goal:** These packages exist but are unused. Wire them properly.
After this phase, every infrastructure action writes an audit row.

### Step 5.1 — Audit: call on every execution

In `packages/action-gateway/src/approval-handler.ts`, after executing a command:

```typescript
import { audit } from '@helmsman/audit'

// After successful execution:
await audit.write({
  userId: token.userId,
  chatId: token.chatId,
  platform: token.platform,
  actionType: 'action_executed',
  tier: token.tier,
  provider: token.provider,
  command: token.command,
  resourceIdentifier: token.resourceIdentifier,
  plainEnglish: token.plainEnglish,
  status: result.exitCode === 0 ? 'success' : 'failed',
  exitCode: result.exitCode,
  outputSummary: result.stdout.slice(0, 500),
  errorMessage: result.stderr.slice(0, 500),
  durationMs: result.durationMs,
  executedAt: new Date(),
})
```

### Step 5.2 — Policy: call before tool execution

In `packages/action-gateway/src/approval-handler.ts`, before executing:

```typescript
import { policy } from '@helmsman/policy'

const decision = await policy.evaluate({
  userId: token.userId,
  tier: token.tier,
  provider: token.provider,
  command: token.command,
})

if (decision.blocked) {
  return { status: 'blocked', reason: decision.reason }
}
```

### Verification

```bash
bun turbo test
# Audit writes on every /approve execution
# Policy evaluates before every execution
```

Commit: `feat: wire audit and policy packages into action-gateway`

---

## Phase 6 — Clean Up Dead Code

**Goal:** Remove unused files identified by your AI.

### Step 6.1 — Remove `packages/agent-core/src/agent/agent-service.ts`
This is the legacy pre-Mastra path. Confirm nothing imports it, then delete.

```bash
grep -r "agent-service" packages/agent-core/src --include="*.ts" | grep -v "agent-service.ts"
# If no results: safe to delete
```

### Step 6.2 — Remove `packages/agent-core/src/tools/`
AWS and GitHub tools now live in their own packages. Remove the copies in agent-core.

```
packages/agent-core/src/tools/aws-knowledge.ts   → DELETE (replaced by tools-aws)
packages/agent-core/src/tools/github-tools.ts    → DELETE (moved to tools-github)
packages/agent-core/src/tools/devops-tools.ts    → REVIEW (may have useful logic to move)
packages/agent-core/src/tools/shell-execute.ts   → DELETE (use packages/tools)
```

### Step 6.3 — Consolidate docs

```
apps/docs/   → merge important files into docs/ at repo root, then delete apps/docs/
```

### Verification

```bash
bun turbo build    # no build errors
bun turbo test     # all tests pass
```

Commit: `chore: remove dead code and legacy paths`

---

## Adding New Providers (Future Reference)

When you add GCP, DNS, Cloudflare, or any new provider:

1. Create `packages/tools-{name}/`
2. Add `package.json` with name `@helmsman/tools-{name}`
3. Implement classifier: `classify{Name}Command(command): CommandTier`
4. Implement three tools: `{name}ReadTool`, `{name}WriteTool`, `{name}DangerousTool`
5. Export `{name}Provider: ProviderPackage` from `src/index.ts`
6. Import in `packages/agent-core/src/mastra.ts` and add tools to the agent

Nothing else in the codebase changes. The new provider slots in automatically.

---

## Final State After All Phases

```
apps/api/src/
  app.ts, config.ts, index.ts
  middleware/           ← unchanged
  routes/
    health.ts           ← unchanged
    telegram.ts         ← 10 lines, delegates to @helmsman/transport

packages/
  agent-core/           ← LLM orchestration only, no tools folder
  transport/            ← NEW: telegram/, slack/ (future), web/ (future)
  action-gateway/       ← NEW: tokens, approvals, capabilities
  scheduling/           ← NEW: moved from apps/api
  tools/                ← unchanged: generic shell execution
  tools-devops-runtime/ ← unchanged: container/SSH/git
  tools-aws/            ← restructured: 3 tools + classifier
  tools-github/         ← unchanged: already clean
  tools-dns/            ← (future)
  tools-gcp/            ← (future)
  audit/                ← now wired
  policy/               ← now wired
  shared/               ← expanded with new types
```

Every file has one clear reason to be where it is.
Every new provider is one new package following the same pattern.
Every agent that works on this codebase knows exactly where to find and put things.