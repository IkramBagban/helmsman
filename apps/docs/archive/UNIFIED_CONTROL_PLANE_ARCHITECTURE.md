# Unified Control Plane Architecture

Status: Draft
Date: March 9, 2026

Related review:
- `docs/OPENCLAW_LESSONS_FOR_HELMSMAN.md`

## Purpose

Define the core architecture Helmsman should converge toward so every current and future feature follows the same execution model.

This is not just a security design. It is the unified operating model for:
- correctness
- approvals
- execution safety
- anti-hallucination behavior
- response truthfulness
- multi-interface support
- concurrency control
- deployment and operation isolation
- long-term maintainability

The core idea is simple:

The LLM is never the authority.
The control plane is the authority.

## Problem

Without a unified architecture, behavior gets scattered across:
- prompts
- individual handlers
- tool wrappers
- chat-interface-specific logic
- ad hoc approval checks
- response formatting rules

That leads to predictable failures:
- hallucinated progress updates
- inconsistent approval behavior
- interface-specific edge cases
- duplicated safety logic
- difficult future expansion to web, mobile, CLI, Slack, WhatsApp, and other channels
- state drift between "what the agent says" and "what the system is actually doing"

## Architectural Goal

Create one major shared component for Helmsman:

`Helmsman Control Plane`

Every user interface talks to the same control plane.
Every plan, approval, execution, and response passes through the same rules.
Every sensitive action is gated by deterministic code, not model judgment.

Important clarification:

Helmsman should not be designed as a shared-instance SaaS where many customer tenants live inside one runtime.
The isolation boundary is the deployment itself.
Each customer gets a separate Helmsman deployment with its own runtime, secrets, state, approvals, logs, and integrations.
Inside that deployment, Helmsman may later support multiple human users and scoped roles, but that is a local authorization concern, not platform multi-tenancy.

## Core Principles

### 1. Transport-agnostic

Telegram is only one client.
The architecture must support:
- Telegram
- Web app
- Mobile app
- CLI
- Slack
- WhatsApp
- future API integrations
- future internal dashboard/operator consoles

Interfaces should only be responsible for:
- authentication / identity mapping
- channel-specific message delivery
- webhook or socket handling
- rendering responses and approval UI

Interfaces must not contain execution or approval logic.

### 2. Deterministic authority

The model can:
- interpret intent
- propose actions
- explain plans
- summarize results

The model cannot:
- approve actions
- downgrade risk
- decide whether approval is optional
- claim execution is running unless state confirms it
- directly execute arbitrary sensitive actions

### 3. Typed actions over free-form execution

Whenever possible, the model should produce typed action objects, not raw shell text.

Example:

```ts
interface ProposedAction {
  kind: "aws.ec2.describeInstances" | "ssh.readMetrics" | "github.listPullRequests";
  intent: "read" | "write" | "destructive";
  target: {
    workspaceId?: string;
    region?: string;
    resourceId?: string;
    host?: string;
    repository?: string;
  };
  parameters: Record<string, unknown>;
}
```

Free-form shell should be the fallback path, not the default.
When it is used, it must still pass through deterministic validation and approval gates.

For write or destructive paths, the execution artifact must be frozen before approval.
That means the exact command or exact typed action payload shown to the user is the same artifact later executed by code.
It must not be regenerated after approval.

### 4. Approval is structural, not advisory

If an action requires approval, that must be enforced by code.
No prompt should be able to bypass it.
No user phrasing should be able to bypass it.
No tool path should be able to bypass it.

### 5. Truthful status only

The system must never imply background work, retries, or progress unless an operation state machine confirms it.

## The Major Unified Component

## Helmsman Control Plane

The control plane is the single backend subsystem responsible for:
- request normalization
- context loading
- intent routing
- plan generation
- policy evaluation
- approval lifecycle
- operation state management
- execution gating
- audit logging
- response composition

All channels call into this same component.

## High-Level Flow

```text
Channel Adapter
  -> Message Normalizer
  -> Control Plane Session Resolver
  -> Intent / Plan Proposal
  -> Deterministic Policy Engine
  -> Approval Service
  -> Execution Gateway
  -> Operation Scheduler / Lanes
  -> Operation State Store
  -> Delivery Dispatcher
  -> Audit Log
  -> Response Composer
  -> Channel Adapter
```

## Runtime Split

Helmsman should be implemented as two cooperating runtimes.

### 1. Control plane

Owns:
- ingress
- routing
- session resolution
- policy and approvals
- operation scheduling
- operation state
- delivery and event fanout
- audit lineage

This runtime is the system authority.

### 2. Execution plane

Owns:
- agent reasoning
- prompt/context assembly
- tool selection
- plan proposal
- step execution inside approved boundaries
- compaction and run-level recovery

This runtime is not the authority.
It operates inside the boundaries set by the control plane.

## Control Plane Subsystems

### 1. Channel Adapters

Examples:
- Telegram adapter
- Slack adapter
- Web chat adapter
- Mobile app adapter
- CLI adapter
- WhatsApp adapter

Responsibilities:
- verify inbound request authenticity
- map external identity to internal user/session/workspace
- normalize inbound events into one `NormalizedMessage` contract
- send outbound response payloads in interface-native form

Non-responsibilities:
- approval logic
- policy logic
- execution logic
- operation status truth

### 2. Message Normalizer

All channels must produce one internal message/event shape.

Example:

```ts
interface NormalizedMessage {
  channel: "telegram" | "slack" | "web" | "mobile" | "cli" | "whatsapp";
  userId: string;
  sessionId: string;
  messageId: string;
  correlationId: string;
  text: string;
  attachments?: AttachmentRef[];
  metadata?: Record<string, unknown>;
  timestamp: Date;
}
```

This allows one orchestration pipeline regardless of client surface.

### 3. Session Resolver

The control plane must load and maintain:
- conversation history
- active plan
- active approvals
- active operation state
- user role
- workspace settings
- integration references
- execution capabilities available to this user/deployment

This is where cross-turn continuity lives.

## Core Domain Model

Helmsman should make these concepts first-class in code.

### Session
A long-lived conversational identity spanning many user interactions.

### Turn
One user request/assistant response cycle.

### Operation
A durable unit of planned and/or executing work with truth state.

### Plan
A structured proposal for how an operation should proceed.

### ApprovalArtifact
A durable authorization record bound to an exact plan or action hash.

### ToolInvocation
A single tool execution with structured lineage and result.

The most important distinction is that a session is not the same thing as an operation.
Operations should be durable, inspectable, resumable, and auditable.

## Deployment Model

Helmsman should scale by deployment replication, not by shared-instance tenant partitioning.

### Deployment per customer

Each customer environment gets:
- a separate Helmsman deployment
- separate Redis and database state
- separate secrets and provider credentials
- separate audit trail
- separate queues and runtime workers
- separate failure domain

This gives the strongest possible isolation and removes an entire class of shared-tenant mistakes.

### Local authorization inside one deployment

Inside a single customer deployment, Helmsman may later support:
- owner users
- additional users
- scoped roles
- approval policies by role

That role system is an internal feature of one deployment, not a platform tenancy layer.

Near-term assumption:
- one controlling user may have broad access
- approval prompts are still mandatory for significant and destructive actions
- approval enforcement is handled by code, not trust in the model

### 4. Intent and Plan Proposal Layer

This is where the model helps.

Responsibilities:
- classify intent
- extract targets/entities
- propose read actions
- propose plans for write/destructive actions
- propose follow-up clarifications

Important boundary:
The output of this layer is a proposal, not authority.

### 5. Deterministic Policy Engine

This is the most important subsystem.

The policy engine decides:
- action risk tier
- whether the action is allowed for this user/workspace/environment
- whether approval is required
- whether second approval is required
- whether rate/abuse limits block execution
- whether the command/action shape is valid
- whether the request violates hard invariants

The policy engine must be:
- pure code
- deterministic
- testable without LLM involvement
- shared across all execution paths

Inputs:
- normalized request
- proposed action/plan
- workspace configuration
- user role
- environment rules
- approval state
- operation state

Outputs:
- allow
- deny
- requires approval
- requires clarification
- blocked by invariant

### 6. Approval Service

Approval should be a first-class service, not a chat convention.

Responsibilities:
- create approval requests
- bind them to exact action or plan hashes
- bind them to user, chat/session, workspace, role tier, and expiry
- verify approval tokens/commands/buttons deterministically
- record approval audit trail
- consume approvals so they cannot be replayed

Approval artifact should be bound to:
- `operationId`
- `planId`
- exact command or typed action hash
- requester user ID
- approver user ID
- chat/session scope
- workspace scope
- expiry timestamp

This makes bypass structurally impossible if implemented correctly.

### Approval flow contract

For significant or destructive actions, the approval service should persist a frozen approval artifact in Redis or equivalent fast state.

That artifact should contain:
- `approvalId`
- `operationId`
- `riskTier`
- `summary`
- `targetSummary`
- `typedAction` or `command`
- `args`
- `metadata`
- `requesterUserId`
- `sessionId`
- `expiresAt`
- `hash`

Important rule:
The exact artifact shown to the user is the artifact later executed.
The executor must load it by `approvalId` after approval and run that exact stored payload.
The model must not regenerate the command after approval.

For typed integrations, code should generate the executable request from typed fields.
For shell-backed integrations, the model may propose a command candidate, but the system must freeze the final validated command before approval and execute only that frozen command later.

This produces the behavior you want:
- the AI knows a destructive capability exists
- the AI can propose using it
- the AI cannot directly execute it
- the user sees the real pending command or step payload before approving
- backend code executes only the stored approved artifact

### 7. Execution Gateway

This is the only component allowed to initiate tool execution for sensitive operations.

Responsibilities:
- accept only validated, policy-cleared actions
- verify approval artifact for significant/destructive operations
- assign an `operationId`
- run steps through approved tool adapters
- update operation state machine
- emit audit events
- enforce retries, timeouts, isolation, and cancellation

Hard rule:
No tool may directly execute sensitive actions without entering through the execution gateway.

Additional hard rule:
The general-purpose agent runtime should not receive credentials or handles that let it bypass the execution gateway for destructive tools.
It may know that those tools exist, but only the gateway may invoke them after policy and approval checks succeed.

### 8. Operation State Store

This is the system of record for truth.

Suggested states:
- `idle`
- `queued`
- `planning`
- `awaiting_approval`
- `approved`
- `running`
- `blocked`
- `retrying`
- `failed`
- `completed`
- `cancelled`

Stored fields:
- `operationId`
- `userId`
- `sessionId`
- `correlationId`
- `requestedAction`
- `currentStep`
- `status`
- `statusReason`
- `startedAt`
- `updatedAt`
- `completedAt`
- `lastToolEvent`
- `approvalId`

Any status response shown to the user must come from this state, not from LLM improvisation.

### 9. Operation Scheduler and Lanes

Helmsman should explicitly separate concurrency concerns instead of relying on ad hoc async orchestration.

Suggested lanes:
- `interactive-read`
- `interactive-write`
- `approval-awaiting`
- `background-cron`
- `subagent`
- `recovery`
- `delivery`

Concurrency rules should be enforceable per:
- deployment
- session
- resource scope
- environment
- provider account

This prevents conflicting writes, interleaved execution, and fragile reply behavior.

### 10. Delivery Dispatcher

Helmsman should serialize outbound delivery per session/channel target so that:
- streamed updates do not interleave incorrectly
- approval prompts are not overwritten by unrelated messages
- progress events arrive in the right order
- channel-specific formatting stays separate from runtime logic

The dispatcher should be the only component that knows how to safely deliver a sequence of responses to a given channel target.

### 11. Response Composer

The response layer should format truth, not invent it.

Modes:
- social response
- technical answer
- approval request
- plan explanation
- execution status update
- failure explanation
- completion summary

Response composition rules should be driven by:
- mode
- operation state
- risk tier
- channel capabilities

### 12. Audit and Event Stream

Everything important must be emitted as events:
- message received
- plan proposed
- approval requested
- approval granted/denied
- operation started
- step running
- step failed
- operation completed
- response sent

This event stream enables:
- debugging
- user-visible status
- replay
- metrics
- compliance
- anomaly detection

## Cross-Interface Design

To support web, mobile, CLI, Slack, WhatsApp, and future interfaces:

### Shared primitives

All interfaces should rely on these shared concepts:
- `NormalizedMessage`
- `Operation`
- `ApprovalRequest`
- `Plan`
- `AgentResponse`
- `AuditEvent`

### Interface-specific rendering only

Examples:
- Telegram: plain text + commands
- Slack: blocks + buttons
- Web: cards + live progress UI
- Mobile: notifications + action sheets
- CLI: terminal output + prompts

The underlying approval and execution state must remain identical.

### Channel Plugin Contract

Each interface should implement a common adapter contract covering:
- inbound normalization
- identity mapping
- outbound delivery
- threading/reply semantics
- approval UI capabilities
- file/media support
- channel-specific auth verification

This makes adding new interfaces a bounded integration task, not a rewrite of core orchestration.

## Concurrency Model

Concurrency must be deliberate.

### Per-session rules

Default rule:
- one active mutating operation per session
- multiple read operations may be allowed if isolated and safe

### Per-deployment rules

Guard against overlapping high-risk actions that touch the same resources.

Examples:
- do not allow two deployments to the same service at once
- do not allow concurrent destructive actions in the same environment without explicit orchestration
- use locks keyed by resource scope

### Locking scopes

Possible lock keys:
- `deployment:<deploymentId>`
- `session:<sessionId>`
- `resource:aws:ec2:i-123`
- `resource:k8s:prod:deployment/api`
- `repo:org/name:branch`

### Cancellation and interruption

The control plane should support:
- cancel active operation
- retry failed step
- resume blocked operation
- reject stale approvals

## Isolation Model

Isolation is required at multiple layers.

### Deployment isolation

The primary security boundary is the deployment.
One customer deployment must never share:
- credentials
- Redis state
- database state
- approvals
- conversations
- audit logs
- worker runtime
- provider integrations

This is why Helmsman should scale by separate deployments instead of shared-instance logical tenants.

Important principle:
Session identifiers are routing handles, not sufficient security boundaries on their own.
Deployment, user, operation, approval, and credential scope must all be enforced independently in code.

### User isolation

User permissions must be resolved per request.
No approval artifact should be reusable across users.

### Operation isolation

Each operation should have its own:
- correlation ID
- execution scope
- credential scope
- audit trail
- temporary files / execution workspace

### Runtime isolation

Execution environments must be isolated with:
- ephemeral containers or jobs
- least-privilege credentials
- no secret persistence after completion
- network egress limits
- bounded CPU/memory/time

## State Model

Helmsman needs multiple kinds of state.

### Durable state

Store in database:
- users
- integrations
- roles
- approvals
- plans
- operations
- conversation history
- audit log

### Ephemeral state

Store in Redis or equivalent:
- locks
- hot conversation context
- in-flight operation state cache
- pending approval artifacts
- dedup keys
- rate limiting
- websocket/live update fanout

### Derived state

Computed from events:
- latest operation status
- approval status
- recent failures
- reliability metrics
- user-visible progress summary

## Hallucination Containment

This architecture must assume the model will sometimes be wrong.

### What the model may hallucinate
- status
- missing parameters
- approvals
- risk level
- command correctness
- tool capability
- resource references

### How architecture contains that

1. The model proposes, code verifies.
2. Progress text reads from operation state.
3. Approval is validated against stored approval artifacts.
4. Sensitive execution only happens through the execution gateway.
5. Risk is determined by policy code, not prose.
6. Secret detection happens before model reasoning where possible.
7. Tool outputs are treated as untrusted input.

## Agent Harness Quality

Helmsman should treat the agent harness as a major architectural subsystem, not incidental glue.

The harness should own:
- prompt assembly
- tool exposure and filtering
- compacted memory summaries
- retry and recovery policies
- structured run diagnostics
- context budgeting
- agent quality instrumentation

This is how agent quality improves without turning business logic into prompt spaghetti.

## Evaluation and Regression Harness

Helmsman should have a first-class evaluation harness for:
- intent routing quality
- clarification quality
- approval-gated behavior
- truthful progress behavior
- tool selection quality
- recovery behavior
- multi-turn operation continuity
- multi-channel consistency

The product will degrade over time without this.

## Security Invariants

These must be true system-wide.

1. No significant or destructive action executes without a valid approval artifact when policy requires it.
2. No approval artifact is reusable after consumption or expiry.
3. No sensitive command executes directly from free-form model output without validation.
4. No response may claim active execution unless an operation state confirms it.
5. No private key, token, or password should be requested in raw chat content.
6. No tool path should bypass audit logging.
7. No interface should implement its own approval semantics.
8. No user phrasing or prompt injection attempt should bypass policy or approvals.
9. No destructive tool credentials are exposed directly to the general-purpose LLM runtime.
10. Approval display payload and execution payload must be the same frozen artifact.

## Suggested Major Internal Modules

```text
packages/
  shared/                        # shared types, schemas, errors, constants
  audit/                         # audit event model and emitters
  policy/                        # deterministic policy engine and approval rules
  tools/                         # cross-provider tool contracts and registries
  tools-aws/                     # AWS typed actions and adapters
  tools-github/                  # GitHub typed actions and adapters
  tools-devops-runtime/          # shell/container/runtime adapters
  <future tools-gcp>/            # new provider packages follow same pattern
  <future tools-dns>/            # DNS provider packages follow same pattern
  <future tools-observability>/  # Prometheus, Grafana, and similar systems
  agent-core/                    # planning, reasoning, response composition

apps/
  api/
    src/
      channel-adapters/
      control-plane/
        normalize/
        sessions/
        routing/
        planning/
        approvals/
        execution/
        operations/
        responses/
        delivery/
        locks/
        scheduling/
```

If `control-plane` does not become its own package immediately, the repo should still be reorganized toward these boundaries inside `apps/api/src/control-plane`.

## Package and Folder Conventions

This must be explicit so future features do not get placed arbitrarily.

### Rule 1: Provider or domain capability lives in a package

If a capability can exist independently of one transport or one route, it belongs in `packages/`.

Examples:
- AWS support -> `packages/tools-aws`
- GitHub support -> `packages/tools-github`
- future GCP support -> `packages/tools-gcp`
- future DNS support -> `packages/tools-dns`
- future Terraform support -> `packages/tools-terraform`

These packages should own:
- typed action definitions
- zod schemas
- validators
- adapters/clients
- command builders
- execution helpers
- tests

They should not own:
- Telegram-specific logic
- approval UI wording
- route handler glue
- session orchestration

### Rule 2: Transport and orchestration glue lives in apps

`apps/api` should own:
- webhook/http ingress
- channel adapters
- session resolution
- approval command intake
- execution gateway wiring
- delivery formatting by channel
- scheduler entrypoints

It should compose packages rather than re-implement domain logic inline.

### Rule 3: Shared contracts live in one place

Cross-package contracts belong in `packages/shared`.
Do not redefine similar action shapes or approval payloads in multiple packages.

### Rule 4: One feature follows one predictable structure

Every new feature should answer these questions the same way:
- what are the typed actions?
- which package owns them?
- what risk tier rules apply?
- does it need approval artifacts?
- how does it execute through the gateway?
- how is it audited?

If a feature cannot answer those questions cleanly, the design is not ready.

### Rule 5: No direct feature logic inside random handlers

Route handlers and chat handlers should not contain provider-specific command construction or approval logic.
They should call well-defined package APIs and the shared control-plane services.

## Recommended Near-Term Implementation Plan

### Phase 1: Establish control boundaries
- centralize sensitive execution behind one execution gateway
- centralize approval verification in deterministic code
- add operation state store
- make status responses read from operation state

### Phase 2: Normalize feature architecture
- refactor current handlers to produce typed action proposals
- move risk classification fully into deterministic policy code
- remove scattered approval checks from feature-specific handlers
- unify chat, query, and status-response semantics
- stop placing provider-specific execution logic directly in app handlers
- define package ownership rules for every new integration before implementation

### Phase 3: Prepare for new interfaces
- define stable transport-agnostic contracts
- add channel adapter abstraction
- add live update/event streaming API for web/mobile
- keep CLI and messaging clients as thin adapters

### Phase 4: Hardening
- adversarial tests for prompt injection and approval bypass
- concurrency and locking tests
- approval replay prevention tests
- truthful-progress regression tests
- multi-channel session consistency tests

## Open Questions

1. Which destructive flows can be converted to typed actions first, and which must remain shell-backed temporarily?
2. Should approval artifacts live only in Redis, or in Redis plus durable database persistence for audit and recovery?
3. Do we allow more than one active read-only operation per session?
4. When roles arrive later, which policy decisions stay global and which become role-scoped?
5. Which future integrations should be first-class packages next after AWS: GCP, DNS, Terraform, GitHub, or observability?

## Decision Summary

Helmsman should converge on one unified control-plane architecture.

The major shared component is not "the agent" alone.
It is the system around the agent that makes the agent safe, truthful, reusable, and scalable across every interface.

Prompts improve quality.
The control plane guarantees behavior.
