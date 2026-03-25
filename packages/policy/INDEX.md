# policy

Risk tier evaluation and permission checking for agent actions.

## Responsibility
Classifies every agent action into a risk tier (read / low / medium / high / critical) and enforces whether the action requires approval before execution.

## Key Files
```
src/
  index.ts    ← evaluateRisk(), requiresApproval(), RiskTier enum
```

## Exports
- `evaluateRisk(action)` — returns the risk tier for an action
- `requiresApproval(tier)` — returns whether the tier needs user approval
- `RiskTier` — enum: READ | LOW | MEDIUM | HIGH | CRITICAL

## Dependencies
`@helmsman/shared`
