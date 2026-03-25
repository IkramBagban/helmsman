# agent-core

LLM orchestration layer. Owns the full intent → plan → execute loop.

## Responsibility
Receives a user message, classifies intent, builds a multi-step plan, executes each step using registered tools, and manages the approval gate.

## Key Files
```
src/
  orchestrator.ts           ← Main entry point: processes messages end-to-end
  orchestrator/
    intent-handlers.ts      ← Routes intent types to execution logic
    approval-flow.ts        ← Manages pending approval state
    helpers.ts              ← Shared orchestration utilities
    types.ts                ← Orchestrator-internal types
  agents/
    devops-agent.ts         ← DevOps-specialized Mastra agent
    planner.ts              ← Multi-step plan generator
    router.ts               ← Intent router / classifier
  agent/
    system-prompt.ts        ← System prompt construction
  tools/
    github-tools.ts         ← GitHub tools registered with the agent
  llm/                      ← Provider abstraction (Anthropic / OpenAI / Gemini)
  workflows/                ← Mastra workflow definitions
  mastra.ts                 ← Mastra instance setup
```

## Exports
- `processMessage(message, context)` — main entrypoint
- `OrchestratorContext` — shared context type

## Dependencies
`@helmsman/shared`, `@helmsman/audit`, `@helmsman/action-gateway`, `@helmsman/tools`, `@helmsman/tools-aws`, `@helmsman/tools-github`, `@helmsman/transport`

## Env Vars
See `.env.example` in this package.
