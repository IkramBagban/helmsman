# agent-core

LLM orchestration layer. Owns the full intent -> plan -> execute loop.

## Responsibility
Receives a user message, classifies intent, builds a multi-step plan, executes each step using registered tools, manages approvals, and composes final responses.

## Key Files
```
src/
  orchestrator.ts           <- Main runtime entrypoint
  orchestrator/
    intent-handlers.ts      <- Intent-specific execution flows
    approval-flow.ts        <- Approval + pending action lifecycle
    helpers.ts              <- Prompt/context builders and shared helpers
    types.ts                <- Orchestrator internal contracts
  agents/
    devops-agent.ts         <- DevOps-specialized Mastra agent
    planner.ts              <- Multi-step plan generation
    router.ts               <- Intent classification
    responder.ts            <- User-facing response shaping
  skills/
    catalog.ts              <- Skill registry and selection limits
    selector.ts             <- Per-message skill scoring + catalog-first skill context builder
    loader.ts               <- SKILL.md loading + frontmatter parsing
    types.ts                <- Skill module types
  tools/
    shell-execute.ts        <- Shell tool wrapper + risk classification
    skill-read.ts           <- Read a single SKILL.md on demand from catalog
    aws-knowledge.ts        <- AWS knowledge grounding tool wrapper
    github-tools.ts         <- GitHub tool wrappers
  workflows/
    infra-workflow.ts       <- Workflow primitives for execution and approvals
  mastra.ts                 <- Mastra wiring factory
  index.ts                  <- Public package exports
```

## Exports
- `createHelmsman`, `HelmsmanOrchestrator`
- Agents: `createDevOpsAgent`, `classifyIntent`, `generatePlan`, `formatResponse`
- Skills: `buildSkillContext`, `selectSkillsForMessage`, `getSkillCatalog`, `MAX_DYNAMIC_SKILLS`

## Dependencies
`@helmsman/shared`, `@helmsman/audit`, `@helmsman/action-gateway`, `@helmsman/tools`, `@helmsman/tools-aws`, `@helmsman/tools-github`, `@helmsman/transport`

## Env Vars
See `.env.example` in this package.
