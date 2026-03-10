
Updated: March 9, 2026

This file describes the current Helmsman repository layout from the workspace.
It focuses on project-owned files and folders. Internal/generated internals under `.git/`, `node_modules/`, and `.turbo/` are intentionally not expanded.

## Tree

```text
Helmsman/
├── .agents/
│   └── skills/
│       └── mastra/
│           ├── SKILL.md
│           └── references/
│               ├── common-errors.md
│               ├── create-mastra.md
│               ├── embedded-docs.md
│               ├── migration-guide.md
│               └── remote-docs.md
├── .gitignore
├── .npmrc
├── AGENTS.md
├── HELMSMAN_FULL_CONTEXT.md
├── README.md
├── REPO_STRUCTURE.md
├── SOUL.md
├── bun.lock
├── package.json
├── skills-lock.json
├── turbo.json
├── apps/
│   ├── api/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── data/
│   │   │   ├── schedule-runs.json
│   │   │   └── schedules.json
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── config.ts
│   │   │   ├── index.ts
│   │   │   ├── middleware/
│   │   │   │   ├── correlation-id.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── request-logging.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   └── telegram.ts
│   │   │   ├── scheduling/
│   │   │   │   ├── engine.ts
│   │   │   │   ├── risk.ts
│   │   │   │   ├── service.ts
│   │   │   │   ├── store.ts
│   │   │   │   ├── tools.ts
│   │   │   │   └── types.ts
│   │   │   └── telegram/
│   │   │       ├── approval-store.ts
# Helmsman Repository Structure

Updated: March 10, 2026

This file describes the current Helmsman repository layout from the workspace.
It focuses on project-owned files and folders. Internal/generated internals under `.git/`, `node_modules/`, and `.turbo/` are intentionally not expanded.

## Tree

```text
Helmsman/
├── .agents/
│   └── skills/
│       └── mastra/
│           ├── SKILL.md
│           └── references/
│               ├── common-errors.md
│               ├── create-mastra.md
│               ├── embedded-docs.md
│               ├── migration-guide.md
│               └── remote-docs.md
├── .gitignore
├── .npmrc
├── AGENTS.md
├── HELMSMAN_FULL_CONTEXT.md
├── README.md
├── REPO_STRUCTURE.md
├── SOUL.md
├── bun.lock
├── package.json
├── skills-lock.json
├── turbo.json
├── apps/
│   ├── api/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── data/
│   │   │   ├── schedule-runs.json
│   │   │   └── schedules.json
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── config.ts
│   │   │   ├── index.ts
│   │   │   ├── middleware/
│   │   │   │   ├── correlation-id.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── request-logging.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   └── telegram.ts
│   │   │   ├── scheduling/
│   │   │   │   ├── engine.ts
│   │   │   │   ├── risk.ts
│   │   │   │   ├── service.ts
│   │   │   │   ├── store.ts
│   │   │   │   ├── tools.ts
│   │   │   │   └── types.ts
│   │   │   └── telegram/
│   │   │       ├── approval-store.ts
│   │   │       ├── capability-store.ts
│   │   │       ├── commands.ts
│   │   │       ├── dedup.ts
│   │   │       ├── parser.ts
│   │   │       ├── sender.ts
│   │   │       └── types.ts
│   │   ├── tests/
│   │   │   ├── tsconfig.json
│   │   │   ├── routes/
│   │   │   │   └── telegram-webhook.test.ts
│   │   │   ├── scheduling/
│   │   │   │   ├── engine.test.ts
│   │   │   │   └── service.test.ts
│   │   │   └── telegram/
│   │   │       ├── commands.test.ts
│   │   │       ├── dedup.test.ts
│   │   │       ├── parser.test.ts
│   │   │       └── sender.test.ts
│   ├── docs/
│   │   ├── AGENT_DESIGN.md
│   │   ├── AGENT_SKILLS.md
│   │   ├── ARCHITECTURE.md
│   │   ├── BEST_PRACTICES.md
│   │   ├── CHALLENGES.md
│   │   ├── COMPETITIVE_LANDSCAPE.md
│   │   ├── CONVENTIONS.md
│   │   ├── DATA_MODEL.md
│   │   ├── EXAMPLES.md
│   │   ├── FEATURES.md
│   │   ├── HELMSMAN_ARCHITECTURE.md
│   │   ├── MAP.md
│   │   ├── PRD.md
│   │   ├── README.md
│   │   ├── ROADMAP.md
│   │   ├── STACK.md
│   │   ├── TRUST_AND_PERMISSIONS.md
│   │   ├── UI_FRONTEND_SPEC.md
│   │   ├── current-state/
│   │   │   ├── ARCHITECTURE_CURRENT.md
│   │   │   ├── CODE_AND_FEATURES.md
│   │   │   ├── GAPS_AND_NEXT_STEPS.md
│   │   │   ├── README.md
│   │   │   └── SECURITY_POSTURE.md
│   │   ├── features/
│   │   │   ├── AGENT_CORE.md
│   │   │   ├── AUDIT_LOG.md
│   │   │   ├── AWS_TOOLS.md
│   │   │   ├── CAPABILITY_GATES.md
│   │   │   ├── DATA_LAYER.md
│   │   │   ├── GIT_SSH_DEVOPS_RUNTIME.md
│   │   │   ├── PARALLEL_AGENT_EXECUTION_PLAN.md
│   │   │   ├── POLICY_ENGINE.md
│   │   │   ├── README.md
│   │   │   ├── SECURITY_HARDENING_PROGRAM.md
│   │   │   ├── TELEGRAM_GATEWAY.md
│   │   │   └── TOOL_SYSTEM.md
│   │   └── plans/
│   │       ├── 2026-03-04-memory-foundation.md
│   │       ├── 2026-03-04-scheduling-foundation.md
│   │       ├── AI_PERSISTENT_MEMORY_PLAN.md
│   │       ├── INDEX.md
│   │       └── templates/
│   └── web/
│       ├── README.md
│       ├── eslint.config.js
│       ├── next.config.js
│       ├── package.json
│       ├── tsconfig.json
│       ├── app/
│       │   ├── favicon.ico
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── page.module.css
│       │   ├── page.tsx
│       │   └── fonts/
│       │       ├── GeistMonoVF.woff
│       │       └── GeistVF.woff
│       └── public/
│           ├── file-text.svg
│           ├── globe.svg
│           ├── next.svg
│           ├── turborepo-dark.svg
│           ├── turborepo-light.svg
│           ├── vercel.svg
│           └── window.svg
├── docs/
│   ├── AWS_MCP_PROMPT.md
│   ├── CLAUDE_GIVEN_AUDIT_PLAN.md
│   ├── DNS_DOMAIN_PLATFORM_ARCHITECTURE.md
│   ├── GCP_MCP_IMPLEMENTATION.md
│   ├── HELMSMAN_ROAD.md
│   ├── LATER_CONSIDERATIONS.md
│   ├── OPENCLAW_LESSONS_FOR_HELMSMAN.md
│   ├── UNIFIED_CONTROL_PLANE_ARCHITECTURE.md
│   └── adr/
│       └── 002-redis-deduplication.md
├── logs/
├── packages/
│   ├── agent-core/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── capability-store.ts
│   │   │   ├── index.ts
│   │   │   ├── mastra.ts
│   │   │   ├── orchestrator.ts
│   │   │   ├── trace-logger.ts
│   │   │   ├── agent/
│   │   │   │   ├── agent-service.test.ts
│   │   │   │   ├── agent-service.ts
│   │   │   │   ├── conversation-memory.ts
│   │   │   │   └── system-prompt.ts
│   │   │   ├── agents/
│   │   │   │   ├── devops-agent.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── planner.ts
│   │   │   │   ├── responder.ts
│   │   │   │   └── router.ts
│   │   │   ├── llm/
│   │   │   │   ├── echo-provider.ts
│   │   │   │   ├── gemini-provider.ts
│   │   │   │   ├── openai-provider.ts
│   │   │   │   ├── provider-factory.ts
│   │   │   │   └── provider.ts
│   │   │   ├── orchestrator/
│   │   │   │   ├── approval-flow.ts
│   │   │   │   ├── constants.ts
│   │   │   │   ├── conversation-state.ts
│   │   │   │   ├── helpers.ts
│   │   │   │   ├── intent-handlers.ts
│   │   │   │   └── types.ts
│   │   │   ├── security/
│   │   │   │   └── prompt-injection.ts
│   │   │   ├── tools/
│   │   │   │   ├── aws-knowledge.ts
│   │   │   │   ├── devops-tools.ts
│   │   │   │   ├── github-tools.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── shell-execute.ts
│   │   │   └── workflows/
│   │   │       └── infra-workflow.ts
│   │   ├── tests/
│   │   │   ├── aws-knowledge.test.ts
│   │   │   ├── orchestrator.test.ts
│   │   │   ├── prompt-injection.test.ts
│   │   │   ├── router.test.ts
│   │   │   └── shell-execute-tool.test.ts
│   ├── audit/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── eslint-config/
│   │   ├── README.md
│   │   ├── base.js
│   │   ├── next.js
│   │   ├── package.json
│   │   └── react-internal.js
│   ├── policy/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── tests/
│   │       └── index.test.ts
│   ├── shared/
│   │   ├── README.md
│   │   ├── eslint.config.mjs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── file-logger.ts
│   │       └── index.ts
│   ├── tools/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── shell-execute.ts
│   │   │   └── shell-safety.ts
│   │   └── tests/
│   │       ├── shell-execute.test.ts
│   │       └── shell-safety.test.ts
│   ├── tools-aws/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── base.ts
│   │       ├── ec2-tools.ts
│   │       ├── index.ts
│   │       └── s3-tools.ts
│   ├── tools-devops-runtime/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── docker/
│   │   │   ├── Dockerfile.runtime
│   │   │   └── entrypoint.sh
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── orchestrator/
│   │   │   │   ├── container-config.ts
│   │   │   │   ├── container-orchestrator.ts
│   │   │   │   ├── credential-injector.ts
│   │   │   │   ├── network-policy.ts
│   │   │   │   └── output-redactor.ts
│   │   │   └── tools/
│   │   │       ├── command-utils.ts
│   │   │       ├── git-tools.ts
│   │   │       ├── shared.ts
│   │   │       ├── shell-run.ts
│   │   │       └── ssh-tools.ts
│   │   └── tests/
│   │       ├── orchestrator/
│   │       │   ├── container-orchestrator.test.ts
│   │       │   └── output-redactor.test.ts
│   │       └── tools/
│   │           ├── git-clone.test.ts
│   │           └── ssh-exec.test.ts
│   ├── tools-github/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── github-client.ts
│   │   │   ├── index.ts
│   │   │   ├── tool-factory.ts
│   │   │   ├── types.ts
│   │   │   └── tools/
│   │   │       ├── list-issues.ts
│   │   │       ├── misc-tools.ts
│   │   │       └── search-repos.ts
│   │   └── tests/
│   │       └── tools/
│   │           └── search-repos.test.ts
│   ├── typescript-config/
│   │   ├── base.json
│   │   ├── nextjs.json
│   │   ├── package.json
│   │   └── react-library.json
│   └── ui/
│       ├── eslint.config.mjs
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── button.tsx
│           ├── card.tsx
│           └── code.tsx
└── logs/
```
│   │   │       ├── capability-store.ts
│   │   │       ├── commands.ts
│   │   │       ├── dedup.ts
│   │   │       ├── parser.ts
│   │   │       ├── sender.ts
│   │   │       └── types.ts
│   │   └── tests/
│   │       ├── tsconfig.json
│   │       ├── routes/
│   │       │   └── telegram-webhook.test.ts
│   │       ├── scheduling/
│   │       │   ├── engine.test.ts
│   │       │   └── service.test.ts
│   │       └── telegram/
│   │           ├── commands.test.ts
│   │           ├── dedup.test.ts
│   │           ├── parser.test.ts
│   │           └── sender.test.ts
│   ├── docs/
│   │   ├── AGENT_DESIGN.md
│   │   ├── AGENT_SKILLS.md
│   │   ├── ARCHITECTURE.md
│   │   ├── BEST_PRACTICES.md
│   │   ├── CHALLENGES.md
│   │   ├── COMPETITIVE_LANDSCAPE.md
│   │   ├── CONVENTIONS.md
│   │   ├── DATA_MODEL.md
│   │   ├── EXAMPLES.md
│   │   ├── FEATURES.md
│   │   ├── HELMSMAN_ARCHITECTURE.md
│   │   ├── MAP.md
│   │   ├── PRD.md
│   │   ├── README.md
│   │   ├── ROADMAP.md
│   │   ├── STACK.md
│   │   ├── TRUST_AND_PERMISSIONS.md
│   │   ├── UI_FRONTEND_SPEC.md
│   │   ├── current-state/
│   │   │   ├── ARCHITECTURE_CURRENT.md
│   │   │   ├── CODE_AND_FEATURES.md
│   │   │   ├── GAPS_AND_NEXT_STEPS.md
│   │   │   ├── README.md
│   │   │   └── SECURITY_POSTURE.md
│   │   ├── features/
│   │   │   ├── AGENT_CORE.md
│   │   │   ├── AUDIT_LOG.md
│   │   │   ├── AWS_TOOLS.md
│   │   │   ├── CAPABILITY_GATES.md
│   │   │   ├── DATA_LAYER.md
│   │   │   ├── GIT_SSH_DEVOPS_RUNTIME.md
│   │   │   ├── PARALLEL_AGENT_EXECUTION_PLAN.md
│   │   │   ├── POLICY_ENGINE.md
│   │   │   ├── README.md
│   │   │   ├── SECURITY_HARDENING_PROGRAM.md
│   │   │   ├── TELEGRAM_GATEWAY.md
│   │   │   └── TOOL_SYSTEM.md
│   │   └── plans/
│   │       ├── 2026-03-04-memory-foundation.md
│   │       ├── 2026-03-04-scheduling-foundation.md
│   │       ├── AI_PERSISTENT_MEMORY_PLAN.md
│   │       ├── INDEX.md
│   │       └── templates/
│   └── web/
│       ├── README.md
│       ├── eslint.config.js
│       ├── next.config.js
│       ├── package.json
│       ├── tsconfig.json
│       ├── app/
│       │   ├── favicon.ico
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── page.module.css
│       │   ├── page.tsx
│       │   └── fonts/
│       │       ├── GeistMonoVF.woff
│       │       └── GeistVF.woff
│       └── public/
│           ├── file-text.svg
│           ├── globe.svg
│           ├── next.svg
│           ├── turborepo-dark.svg
│           ├── turborepo-light.svg
│           ├── vercel.svg
│           └── window.svg
├── docs/
│   ├── AWS_MCP_PROMPT.md
│   ├── CLAUDE_GIVEN_AUDIT_PLAN.md
│   ├── DNS_DOMAIN_PLATFORM_ARCHITECTURE.md
│   ├── GCP_MCP_IMPLEMENTATION.md
│   ├── HELMSMAN_ROAD.md
│   ├── LATER_CONSIDERATIONS.md
│   ├── OPENCLAW_LESSONS_FOR_HELMSMAN.md
│   ├── UNIFIED_CONTROL_PLANE_ARCHITECTURE.md
│   └── adr/
│       └── 002-redis-deduplication.md
├── logs/
├── packages/
│   ├── agent-core/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── capability-store.ts
│   │   │   ├── index.ts
│   │   │   ├── mastra.ts
│   │   │   ├── orchestrator.ts
│   │   │   ├── trace-logger.ts
│   │   │   ├── agent/
│   │   │   │   ├── agent-service.test.ts
│   │   │   │   ├── agent-service.ts
│   │   │   │   ├── conversation-memory.ts
│   │   │   │   └── system-prompt.ts
│   │   │   ├── agents/
│   │   │   │   ├── devops-agent.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── planner.ts
│   │   │   │   ├── responder.ts
│   │   │   │   └── router.ts
│   │   │   ├── llm/
│   │   │   │   ├── echo-provider.ts
│   │   │   │   ├── gemini-provider.ts
│   │   │   │   ├── openai-provider.ts
│   │   │   │   ├── provider-factory.ts
│   │   │   │   └── provider.ts
│   │   │   ├── orchestrator/
│   │   │   │   ├── approval-flow.ts
│   │   │   │   ├── constants.ts
│   │   │   │   ├── conversation-state.ts
│   │   │   │   ├── helpers.ts
│   │   │   │   ├── intent-handlers.ts
│   │   │   │   └── types.ts
│   │   │   ├── security/
│   │   │   │   └── prompt-injection.ts
│   │   │   ├── tools/
│   │   │   │   ├── aws-knowledge.ts
│   │   │   │   ├── devops-tools.ts
│   │   │   │   ├── github-tools.ts
│   │   │   │   ├── index.ts
│   │   │   │   └── shell-execute.ts
│   │   │   └── workflows/
│   │   │       └── infra-workflow.ts
│   │   └── tests/
│   │       ├── aws-knowledge.test.ts
│   │       ├── orchestrator.test.ts
│   │       ├── prompt-injection.test.ts
│   │       ├── router.test.ts
│   │       └── shell-execute-tool.test.ts
│   ├── audit/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── eslint-config/
│   │   ├── README.md
│   │   ├── base.js
│   │   ├── next.js
│   │   ├── package.json
│   │   └── react-internal.js
│   ├── policy/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── tests/
│   │       └── index.test.ts
│   ├── shared/
│   │   ├── README.md
│   │   ├── eslint.config.mjs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── file-logger.ts
│   │       └── index.ts
│   ├── tools/
│   │   ├── README.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── shell-execute.ts
│   │   │   └── shell-safety.ts
│   │   └── tests/
│   │       ├── shell-execute.test.ts
│   │       └── shell-safety.test.ts
│   ├── tools-aws/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── base.ts
│   │       ├── ec2-tools.ts
│   │       ├── index.ts
│   │       └── s3-tools.ts
│   ├── tools-devops-runtime/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── docker/
│   │   │   ├── Dockerfile.runtime
│   │   │   └── entrypoint.sh
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── orchestrator/
│   │   │   │   ├── container-config.ts
│   │   │   │   ├── container-orchestrator.ts
│   │   │   │   ├── credential-injector.ts
│   │   │   │   ├── network-policy.ts
│   │   │   │   └── output-redactor.ts
│   │   │   └── tools/
│   │   │       ├── command-utils.ts
│   │   │       ├── git-tools.ts
│   │   │       ├── shared.ts
│   │   │       ├── shell-run.ts
│   │   │       └── ssh-tools.ts
│   │   └── tests/
│   │       ├── orchestrator/
│   │       │   ├── container-orchestrator.test.ts
│   │       │   └── output-redactor.test.ts
│   │       └── tools/
│   │           ├── git-clone.test.ts
│   │           └── ssh-exec.test.ts
│   ├── tools-github/
│   │   ├── README.md
│   │   ├── index.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── github-client.ts
│   │   │   ├── index.ts
│   │   │   ├── tool-factory.ts
│   │   │   ├── types.ts
│   │   │   └── tools/
│   │   │       ├── list-issues.ts
│   │   │       ├── misc-tools.ts
│   │   │       └── search-repos.ts
│   │   └── tests/
│   │       └── tools/
│   │           └── search-repos.test.ts
│   ├── typescript-config/
│   │   ├── base.json
│   │   ├── nextjs.json
│   │   ├── package.json
│   │   └── react-library.json
│   └── ui/
│       ├── eslint.config.mjs
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── button.tsx
│           ├── card.tsx
│           └── code.tsx
└── logs/
```

## Notes

### Root

- `AGENTS.md` is the main agent instruction entrypoint for this repository.
- `HELMSMAN_FULL_CONTEXT.md`, `SOUL.md`, and `README.md` hold product and repo-level context outside the formal docs sets.

### `apps/api`

- This is the live backend entrypoint. It owns Express bootstrapping, Telegram webhook handling, middleware, and the current scheduling runtime.
- `src/telegram/` and `src/scheduling/` currently contain important business logic, not just transport glue, so this area is a candidate for future control-plane refactoring.

### `apps/docs`

- This is the larger product and engineering documentation set: conventions, feature specs, roadmap, data model, trust model, and planning docs.
- `features/` is the most useful subfolder when implementing or reviewing a specific subsystem.

### `apps/web`

- This is the Next.js frontend app. Right now it looks like a light scaffold rather than the main product surface.
- If the dashboard becomes first-class later, this app will likely consume the same control-plane contracts as Telegram.

### Root `docs`

- This folder currently holds active architecture working docs and ADR-style design notes outside the original `apps/docs` doc set.
- It is functioning as an evolving architecture lab for newer Helmsman design decisions.

### `packages/agent-core`

- This is the main LLM orchestration package: router, planner, responder, devops agent, approval flow, and orchestrator state.
- Today it also contains important approval and capability logic that may later move behind a more explicit control-plane boundary.

### `packages/tools`

- This package currently provides the generic shell execution and shell safety layer.
- The current runtime is still heavily shell-first, so this package is more central than its simple name suggests.

### `packages/tools-aws`

- This package exists, but it does not appear to be the main AWS execution path yet.
- It is closer to a typed-provider direction that can be expanded later as Helmsman moves away from shell-first infrastructure actions.

### `packages/tools-github`

- This is one of the cleaner provider-style packages in the repo.
- Its tool factory and package-local structure are a useful reference for how future provider/domain packages can be organized.

### `packages/tools-devops-runtime`

- This package contains isolated runtime execution helpers for shell, git, and SSH-style operations plus container orchestration support.
- It is closer to execution infrastructure than business/domain logic.

### `packages/policy`

- This package contains a simple policy engine today.
- It is a good place to centralize approval requirements and deterministic safety rules as the architecture matures.

### `packages/shared`

- This is the contract package for shared types, errors, and logging primitives.
- If multiple packages need to agree on approval artifacts, operations, or provider action types, this is where those contracts should live.

### `logs/`

- This is an operational output folder, not a source folder.
- It should generally stay out of architecture ownership decisions unless specific log artifacts are intentionally checked in.