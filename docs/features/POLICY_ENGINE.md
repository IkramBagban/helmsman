# Feature: Policy Engine

> **Package:** `packages/policy`
> **Wave:** 2 (depends on: `@helmsman/shared`, `@helmsman/db`)
> **Estimated effort:** 2-3 days

---

## Purpose

Classify the risk level of every action the agent wants to perform. Determine whether approval is needed, and what kind. This is the safety gate between "agent builds a plan" and "agent executes the plan." Every write operation flows through the policy engine.

Full trust model context: `docs/TRUST_AND_PERMISSIONS.md`

---

## Requirements

### Must Have
- [ ] Classify risk tier for any tool call: `read_only`, `low_risk`, `significant`, `destructive`
- [ ] Determine approval requirement based on risk tier + user role
- [ ] Return an approval decision: `allow`, `require_approval`, `require_confirmation`, `deny`
- [ ] Support user roles: VIEWER, OPERATOR, ADMIN
- [ ] Each tool has a default risk tier; the policy engine can override based on context
- [ ] Context-aware risk escalation (e.g., any action targeting "production" environment is escalated)
- [ ] Approval decisions logged for audit trail

### Nice to Have
- [ ] Configurable team-level policies (JSON-based overrides)
- [ ] Time-based policies (no destructive actions outside business hours)
- [ ] Multi-approver for Tier 4 actions (requires 2 people)
- [ ] Policy dry-run mode for testing rules

### Out of Scope
- Role management UI (CRUD for user roles)
- RBAC with fine-grained resource-level permissions (Phase 6)
- OAuth/SSO integration

---

## Risk Tier Definitions

| Tier | Name | Examples | Behavior |
|------|------|---------|----------|
| 1 | `read_only` | DescribeInstances, ListBuckets, GetMetrics | Execute immediately, no approval |
| 2 | `low_risk` | Create empty S3 bucket, tag a resource | Announce and proceed (user can interrupt) |
| 3 | `significant` | Start/stop EC2, create instances, deploy | Full plan + explicit "yes" required |
| 4 | `destructive` | Terminate instance, delete bucket, drop DB | Full plan + typed confirmation required (e.g., type resource name) |

---

## Contracts

### Input: PolicyRequest (from agent-core → policy engine)

```typescript
export const PolicyRequestSchema = z.object({
  /** The plan to evaluate */
  plan: z.object({
    id: z.string(),
    steps: z.array(z.object({
      tool: z.string(),
      action: z.string(),
      params: z.record(z.unknown()),
      riskTier: z.enum(["read_only", "low_risk", "significant", "destructive"]),
    })),
  }),

  /** Who is requesting */
  actor: z.object({
    userId: z.string(),
    role: z.enum(["VIEWER", "OPERATOR", "ADMIN"]),
  }),

  /** Target environment context */
  environment: z.object({
    name: z.string().optional(),           // "production", "staging", "dev"
    isProduction: z.boolean().default(false),
  }).optional(),
});

export type PolicyRequest = z.infer<typeof PolicyRequestSchema>;
```

### Output: PolicyDecision

```typescript
export const PolicyDecisionSchema = z.object({
  /** The overall decision */
  decision: z.enum(["allow", "require_approval", "require_confirmation", "deny"]),

  /** The highest risk tier found in the plan */
  maxRiskTier: z.enum(["read_only", "low_risk", "significant", "destructive"]),

  /** Why this decision was made */
  reason: z.string(),

  /** Steps that need attention (empty if allow) */
  flaggedSteps: z.array(z.object({
    stepIndex: z.number(),
    tool: z.string(),
    risk: z.string(),
    reason: z.string(),
  })).default([]),

  /** If deny: which rule blocked it */
  deniedBy: z.string().optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
```

---

## Decision Matrix

```
                    read_only  low_risk  significant  destructive
VIEWER              allow      deny      deny         deny
OPERATOR            allow      allow     require_     require_
                                         approval     confirmation
ADMIN               allow      allow     require_     require_
                                         approval     confirmation
```

### Escalation Rules

1. **Production environment:** Any `low_risk` in production → escalate to `significant`
2. **Multiple write steps:** If a plan has 3+ write steps → escalate highest by 1 tier
3. **VIEWER role:** Can never execute write operations (always `deny` for non-read)
4. **Force flag:** If tool params include `force: true` → escalate to `destructive`

---

## File Structure

```
packages/policy/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                        # Public API: evaluatePolicy()
    types.ts                        # PolicyRequest, PolicyDecision, etc.
    evaluator.ts                    # Main policy evaluation logic
    evaluator.test.ts
    risk-classifier.ts              # Classify/escalate risk tiers
    risk-classifier.test.ts
    role-permissions.ts             # Role → permission matrix
    role-permissions.test.ts
    rules/
      production-escalation.ts      # Production environment escalation rule
      multi-step-escalation.ts      # Multi-step plan escalation rule
      force-flag-escalation.ts      # Force flag escalation rule
    rules/
      production-escalation.test.ts
      multi-step-escalation.test.ts
      force-flag-escalation.test.ts
```

---

## Implementation Notes

### Policy Evaluation Flow

```typescript
// src/evaluator.ts
export function evaluatePolicy(request: PolicyRequest): PolicyDecision {
  // 1. Get base risk tier for each step (from tool definition)
  const stepRisks = request.plan.steps.map(step => ({
    ...step,
    effectiveRisk: step.riskTier,
  }));

  // 2. Apply escalation rules
  for (const step of stepRisks) {
    step.effectiveRisk = applyEscalationRules(step, request.environment);
  }

  // 3. Find maximum risk tier
  const maxRisk = getMaxRiskTier(stepRisks.map(s => s.effectiveRisk));

  // 4. Check role permissions
  const decision = checkRolePermission(request.actor.role, maxRisk);

  // 5. Build flagged steps list
  const flaggedSteps = stepRisks
    .filter(s => s.effectiveRisk !== "read_only")
    .map((s, i) => ({
      stepIndex: i,
      tool: s.tool,
      risk: s.effectiveRisk,
      reason: `${s.tool} is classified as ${s.effectiveRisk}`,
    }));

  return {
    decision,
    maxRiskTier: maxRisk,
    reason: buildReasonString(decision, maxRisk, request.actor.role),
    flaggedSteps,
  };
}
```

### Confirmation Formatting
For `require_confirmation` (Tier 4), the agent should ask the user to type the resource name:
```
⚠️ DESTRUCTIVE ACTION: This will terminate EC2 instance i-0abc123def456.
Type the instance ID to confirm: i-0abc123def456
```

The policy engine provides the `reason` string; the response formatter in agent-core formats it for chat.

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `evaluator.test.ts` | Read-only plan for OPERATOR → `allow` |
| `evaluator.test.ts` | Read-only plan for VIEWER → `allow` |
| `evaluator.test.ts` | Write plan for VIEWER → `deny` |
| `evaluator.test.ts` | Significant plan for OPERATOR → `require_approval` |
| `evaluator.test.ts` | Destructive plan for OPERATOR → `require_confirmation` |
| `evaluator.test.ts` | Destructive plan for ADMIN → `require_confirmation` |
| `risk-classifier.test.ts` | Low risk + production → escalated to significant |
| `risk-classifier.test.ts` | 3+ write steps → highest tier escalated |
| `risk-classifier.test.ts` | force=true param → escalated to destructive |
| `role-permissions.test.ts` | Full decision matrix coverage |

---

## Acceptance Criteria

1. Read-only tools for any role → `allow` (no approval needed)
2. Write tools for VIEWER → `deny` with clear reason
3. Significant action for OPERATOR → `require_approval` with flagged steps
4. Destructive action → `require_confirmation` with resource name in response
5. Production environment escalation: `low_risk` → `significant`
6. Multi-step escalation: 3+ write steps escalates highest
7. Force flag escalation: `force: true` → `destructive`
8. Every decision includes `reason` string and `flaggedSteps` array
9. Pure function: no side effects, no DB calls, no external dependencies
