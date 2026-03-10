# Helmsman Current State Docs

Snapshot date: March 10, 2026 (UTC)

This folder is a code-first snapshot of Helmsman's actual implementation and runtime behavior. It intentionally diverges from product vision docs; if code and older docs conflict, this pack treats code as the source of truth.

## Files

| File | Purpose |
| --- | --- |
| `CODE_AND_FEATURES.md` | Implemented package map and feature inventory |
| `ARCHITECTURE_CURRENT.md` | Runtime architecture and message/tool flow |
| `SECURITY_POSTURE.md` | Implemented security controls and residual risks |
| `GAPS_AND_NEXT_STEPS.md` | Mismatches, risks, and prioritized implementation backlog |

## Scope

- Included packages/apps:
	- `apps/api`, `packages/agent-core`, `packages/tools`, `packages/tools-github`, `packages/tools-devops-runtime`, `packages/tools-aws`, `packages/policy`, `packages/shared`, `packages/audit`
- Included docs for comparison:
	- `apps/docs/*`, `apps/docs/features/*`, `AGENTS.md`, root `README.md`
- Excluded:
	- future architecture not implemented in code paths above

## Refresh Process

1. Re-read runtime entrypoints:
	 - `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/telegram.ts`
2. Re-read orchestrator and tool wiring:
	 - `packages/agent-core/src/mastra.ts`, `packages/agent-core/src/orchestrator.ts`
3. Re-check security guardrails:
	 - `packages/tools/src/shell-safety.ts`, `packages/agent-core/src/security/prompt-injection.ts`, `packages/tools-devops-runtime/src/orchestrator/*`, `apps/api/src/middleware/*`
4. Update the 4 detailed docs and snapshot date.

