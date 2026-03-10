Yes, absolutely. Auditing and logging are not optional for a product that touches production infrastructure. If something goes wrong — wrong instance terminated, bucket deleted, credentials leaked — you need to know exactly what happened, when, who did it, and what the agent was thinking.

Let me give you the full picture of what you need and why.

---

## The Three Separate Things

People confuse these. They're different:

**Audit Log** — immutable record of every action taken. "At 14:32 UTC, user ikram approved termination of i-0524aa25c11382aa1. Command executed. Exit code 0." This is for accountability and incident investigation. Never deleted, never updated.

**Application Logs** — operational logs for debugging. "Agent received message, router classified as multi_step, planner generated 3-step plan." This is for you as a developer to debug why something broke. Can be rotated and deleted.

**LLM Traces** — full record of every LLM call: system prompt, messages sent, tool calls made, response received, token count, latency. This is for understanding why the agent made a specific decision. Extremely useful when the agent does something unexpected.

You need all three, but they serve different purposes and go to different places.

---

## Audit Log — The Most Important One

Every action that changes infrastructure gets a permanent audit entry. This is a database table, append-only, never updated or deleted.

```typescript
// packages/db/src/schema.ts

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Who
  userId: text('user_id').notNull(),
  teamId: text('team_id').notNull(),
  platform: text('platform').notNull(),        // 'telegram' | 'slack'
  
  // What
  actionType: text('action_type').notNull(),   // see ActionType enum below
  capability: text('capability').notNull(),    // 'observer' | 'operator' | 'commander'
  provider: text('provider').notNull(),        // 'aws' | 'gcp' | 'k8s' | 'github'
  toolName: text('tool_name').notNull(),       // 'aws_create' | 'aws_delete' etc
  command: text('command').notNull(),          // exact command that ran
  resourceType: text('resource_type'),         // 'EC2 Instance' | 'S3 Bucket' etc
  resourceId: text('resource_id'),             // 'i-0524aa25c11382aa1'
  resourceName: text('resource_name'),         // 'web-prod-1'
  
  // Context
  userMessage: text('user_message').notNull(), // what the user originally asked
  plainEnglishSummary: text('plain_english_summary').notNull(), // what agent said it would do
  
  // Approval trail
  activationId: text('activation_id'),         // which /activate triggered this session
  actionTokenId: text('action_token_id'),      // which /approve or /confirm token was used
  confirmationMode: text('confirmation_mode'), // 'code' | 'resource_id'
  confirmationValue: text('confirmation_value'), // what user typed to confirm
  
  // Outcome
  status: text('status').notNull(),            // 'success' | 'failed' | 'cancelled'
  exitCode: integer('exit_code'),
  outputSummary: text('output_summary'),       // first 500 chars of output
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  
  // Timing
  executedAt: timestamptz('executed_at').defaultNow().notNull(),
})

type ActionType = 
  | 'capability_activated'    // user activated operator/commander
  | 'capability_expired'      // role expired automatically
  | 'capability_deactivated'  // user/admin turned it off
  | 'action_requested'        // agent generated approval token
  | 'action_approved'         // user sent /approve or /confirm
  | 'action_executed'         // command actually ran
  | 'action_failed'           // command failed
  | 'action_expired'          // token expired unused
  | 'action_cancelled'        // user cancelled
```

Two things to note:

**The user's original message is stored.** Not just the command — the full context of what they asked. "Delete everything that's costing me money" → that's important context if something gets deleted.

**The confirmation value is stored.** What exact string the user typed to confirm. For Commander actions this is the resource ID they typed. This proves intent.

---

## Application Logs — Structured, Not console.log

Stop using `console.log`. Use structured logging from day one. Structured means every log line is JSON with consistent fields — searchable, filterable, queryable.

```typescript
// packages/config/src/logger.ts

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: process.env.SERVICE_NAME ?? 'helmsman',
    env: process.env.NODE_ENV,
  },
  redact: [
    // Never log these fields even if they appear in objects
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'credentials.accessKeyId',
    'credentials.secretAccessKey',
    'privateKey',
    'token',
    'password',
  ],
})
```

Usage throughout the codebase:

```typescript
// Every meaningful event gets a structured log entry
logger.info({ 
  event: 'message.received',
  correlationId: message.correlationId,
  userId: message.userId,
  platform: message.platform,
  messageLength: message.text.length,
})

logger.info({
  event: 'intent.classified',
  correlationId,
  intent: 'multi_step',
  confidence: 0.92,
  durationMs: 45,
})

logger.warn({
  event: 'approval.expired',
  tokenId: 'B7MN4P',
  userId,
  action: 'aws_create',
  resource: 'memora-prod',
})

logger.error({
  event: 'command.failed',
  correlationId,
  command: 'aws ec2 run-instances ...',
  exitCode: 1,
  error: stderr.slice(0, 200),
})
```

The `event` field is the key. Every event has a dot-namespaced name. Later you can query "show me all `approval.expired` events" or "show me all `command.failed` events for user X."

---

## LLM Traces — Understanding Agent Decisions

This is the one most people skip and then regret. When the agent does something unexpected, you need to see exactly what it was thinking — what the system prompt was, what messages were in context, what tool calls it made.

```typescript
// packages/ai/src/trace.ts

type LLMTrace = {
  id: string
  correlationId: string
  userId: string
  node: 'router' | 'planner' | 'executor' | 'responder'
  model: string
  systemPrompt: string           // exact system prompt used
  messages: LLMMessage[]         // full message history sent
  toolCallsMade: ToolCall[]      // what tools it called
  response: string               // raw response
  inputTokens: number
  outputTokens: number
  durationMs: number
  temperature: number
  createdAt: Date
}

// Store in PostgreSQL for queryability
// But compress the prompt/messages — they can be large
```

In development you want full traces. In production you want traces for:
- Any action that resulted in a Commander execution
- Any action that failed
- Any action where the user sent a security-flagged message
- Sampled 5% of all other interactions

---

## Where Everything Goes

```
PostgreSQL (permanent):
├── audit_log          ← every infrastructure action, forever
└── llm_traces         ← LLM calls for commander actions + failures + samples

Redis (ephemeral):
├── token:activation:* ← activation tokens, TTL 10min
├── token:action:*     ← action tokens, TTL 15min
└── rate:*             ← rate limit counters

Pino → stdout (your deployment platform picks it up):
├── development        → pretty-printed to terminal
└── production         → JSON to stdout → whatever you use (Railway, Fly, etc.)
```

---

## What to Build First

In order of importance:

**1. Audit log table + write on every execution** — one hour of work, protects you forever. Every time `approval-handler.ts` executes a command, write a row. Do this before you have real users.

**2. Structured logger replacing console.log** — half a day. Install pino, replace all console.log calls, add redaction for credentials. Do this in the same sprint.

**3. LLM traces for commander actions** — store the full context whenever a Commander action runs. You want to be able to answer "why did the agent think it should terminate that instance" after an incident.

**4. Trace viewer in the dashboard** — later, when you have the web dashboard. A simple table showing recent actions with expandable details. Not needed on day one.

**Skip for now:** Sentry, Datadog, OpenTelemetry, distributed tracing. Those are for scale. Right now you need the basics working and stored somewhere queryable. PostgreSQL + structured stdout logs is enough for the first 50 users.

---

## The One Question You Should Be Able to Answer

After every incident, you should be able to answer: **"Who asked for what, what did the agent plan, what did the user approve, what command ran, and what was the result?"**

Your audit log gives you that. Everything else is nice to have.