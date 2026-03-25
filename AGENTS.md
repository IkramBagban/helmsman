# Helmsman — Agent Instructions

> Read this file first. It is the single entrypoint for every AI coding agent working on this codebase.
> After reading this, read the specific feature doc assigned to you (see Feature Routing below).

---

## What Is Helmsman?

A Jarvis-style AI execution agent. First vertical: DevOps — users talk to Helmsman in Telegram and it reasons about, plans, and executes infrastructure operations. Long-term: expands across domains.

Full product context: `apps/docs/README.md`, `apps/docs/PRD.md`

---

## Navigation System

To explore and navigate the codebase, start with `apps/docs/MAP.md` — it has the full monorepo structure with all apps and packages listed with one-line descriptions. Before working on any package, read its `INDEX.md` first (e.g. `packages/agent-core/INDEX.md`) — it gives you the folder structure, key files, exports, dependencies so you can understand context and navigate fast. Keep both files up to date: update `MAP.md` when you add/remove packages or apps, and update the package's `INDEX.md` when you change files, exports inside it.



---


---

## Coding Conventions (Inline Summary)

Full reference: `apps/docs/CONVENTIONS.md`

### TypeScript
- Strict mode everywhere. No `any`. No `@ts-ignore`. No `@ts-nocheck`.
- Prefer `interface` for object shapes, `type` for unions/intersections.
- Use `const` by default. `let` only when mutation is required. Never `var`.
- All functions must have explicit return types (except trivial arrow functions).
- Prefer early returns over deep nesting.
- Use `readonly` on properties that should not be reassigned.

### Zod
- Every external boundary (HTTP input, env vars, webhook payloads, tool params) validated with Zod.
- Derive TypeScript types from Zod schemas: `type Foo = z.infer<typeof FooSchema>`.
- Schemas live in the package that owns the contract, exported for consumers.

### Environment Variables
- Whenever you add or change any env var in a package, update that package's `.env.example` in the same PR.
- `.env` files are local-only and must never be committed with real secrets.
- Package READMEs must document required env vars and conditional requirements (e.g., provider-specific keys).

### Prisma
- Schema lives in `packages/db/prisma/schema.prisma`.
- Never import `@prisma/client` directly — import the typed client from `@helmsman/db`.
- All queries go through repository functions, never raw Prisma calls in route handlers.

### File Organization
- One concept per file. Keep files under 300 LOC; split when larger.
- Keep tests in dedicated test folders, not side-by-side with source files.
- Preferred pattern: `src/foo.ts` → `tests/foo.test.ts` (or `tests/<module>/foo.test.ts`).
- Barrel exports via `index.ts` at package root only. No nested barrel files.
- File naming: `kebab-case.ts` for files, `PascalCase` for types/classes, `camelCase` for functions/variables.

### Error Handling
- Use the shared `AppError` class from `@helmsman/shared` (never throw raw strings).
- Every error has: `code` (machine-readable), `message` (human-readable), `context` (metadata object).
- Errors propagate up; catch at boundaries (route handlers, job processors).
- Never swallow errors silently. Log + rethrow or handle explicitly.

### Imports
- Use workspace package aliases: `@helmsman/shared`, `@helmsman/db`, `@helmsman/agent-core`, etc.
- Never use relative imports across package boundaries.
- Sort imports: external → workspace packages → local (enforced by linter).

### Testing
- Framework: Bun test runner (Vitest-compatible API).
- Naming: `describe("functionName")` → `it("should do X when Y")`.
- Mock external services (AWS SDK, Telegram API, LLM) — never call real APIs in tests.
- Test files live in dedicated test folders: `src/foo.ts` → `tests/foo.test.ts`.
- Minimum: unit tests for all pure logic, integration tests for API routes.

---

## Multi-Agent Safety Rules

Multiple agents may work on this codebase simultaneously. Follow these rules strictly:

1. **Stay in your lane.** Only modify files within your assigned package/feature. If you need a shared type, add it to `@helmsman/shared` and note it in your PR.

2. **Never switch branches** unless explicitly told to. Work on your feature branch only.

3. **Never create/drop git stashes.** Other agents may have work in progress.

4. **Commit scoped.** Only stage and commit files you changed. Never `git add .` across the whole repo.

5. **Interface contracts are sacred.** If a feature doc defines an input/output contract, implement it exactly. Other agents depend on those types.

6. **When you see unfamiliar files,** ignore them and continue your work. Other agents are working on other features.

7. **No global state mutations.** Don't modify `turbo.json`, root `package.json`, or shared configs without explicit instructions.

8. **Communicate via contracts.** If you need something from another package that doesn't exist yet, create a typed interface in `@helmsman/shared` and use it. The other agent will implement it.

---

## Feature Routing Table

When assigned a feature, read `AGENTS.md` (this file) + the feature doc below:

| Feature | Doc | Package(s) | Phase |
|---------|-----|------------|-------|
| Telegram Gateway | `apps/docs/features/TELEGRAM_GATEWAY.md` | `apps/api` | Wave 1 |
| Data Layer | `apps/docs/features/DATA_LAYER.md` | `packages/db`, `packages/shared` | Wave 1 |
| Tool System | `apps/docs/features/TOOL_SYSTEM.md` | `packages/tools` | Wave 1 |
| Audit & Observability | `apps/docs/features/AUDIT_LOG.md` | `packages/audit` | Wave 1 |
| Agent Core | `apps/docs/features/AGENT_CORE.md` | `packages/agent-core` | Wave 2 |
| Policy Engine | `apps/docs/features/POLICY_ENGINE.md` | `packages/policy` | Wave 2 |
| AWS Tools | `apps/docs/features/AWS_TOOLS.md` | `packages/tools-aws` | Wave 2 |

**Wave 1** features have no internal dependencies — build in parallel.
**Wave 2** features depend on Wave 1 contracts — build after Wave 1 merges.

---

## Shared Documentation (Read as Needed)

| Doc | When to read |
|-----|-------------|
| `apps/docs/MAP.md` | When orienting in the codebase or locating a file |
| `<pkg>/INDEX.md` | Before touching any package — always |
| `apps/docs/CONVENTIONS.md` | Before writing any code |
| `apps/docs/DATA_MODEL.md` | When touching the database or any model |
| `apps/docs/PRD.md` | When you need product context for a decision |
| `apps/docs/ARCHITECTURE.md` | When you need system-level understanding |
| `apps/docs/TRUST_AND_PERMISSIONS.md` | When implementing anything security-related |
| `apps/docs/AGENT_DESIGN.md` | When implementing the agent reasoning loop |

---

## Agent Skills (Recommended)

Install these skills for consistent, high-quality output:

```bash

# Find more skills
npx skills find "typescript strict patterns"
npx skills find "prisma schema design"
npx skills find "telegram bot grammy"
npx skills find "aws sdk v3 typescript"
npx skills find "zod validation patterns"
npx skills find "express typescript api"
```

Skill policy: `apps/docs/AGENT_SKILLS.md`

---

## Definition of Done (Every Feature)

- [ ] All acceptance criteria from the feature doc are met
- [ ] Types exported and match the documented contracts
- [ ] Tests pass (`bun test` in the package)
- [ ] No TypeScript errors (`bun run check-types`)
- [ ] No lint errors (`bun run lint`)
- [ ] Code follows `apps/docs/CONVENTIONS.md`
- [ ] README exists in the package with setup + usage
- [ ] No secrets, credentials, or hardcoded config values in code

---

## Symlinks for Other Agents

If using Claude Code or Claude-based agents, create a symlink:
```bash
# Unix/macOS
ln -s AGENTS.md CLAUDE.md

# Windows (PowerShell, run as admin)
New-Item -ItemType SymbolicLink -Path CLAUDE.md -Target AGENTS.md
```

Copilot reads `AGENTS.md` natively. Codex reads `AGENTS.md` natively.
