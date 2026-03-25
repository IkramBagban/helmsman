# tools

Base tool infrastructure: the `ToolInterface` contract and the shell execution sandbox.

## Responsibility
Defines how all tools are shaped and provides the safe shell execution layer used by devops-runtime tools.

## Key Files
```
src/
  shell-execute.ts    ← Executes shell commands in a sandboxed, timeout-controlled way
  shell-safety.ts     ← Validates commands against a safety ruleset (no piping, no chaining, etc.)
  index.ts            ← Exports ToolInterface and shell utilities
```

## Exports
- `ToolInterface` — base interface all tools must implement
- `shellExecute(command, options)` — safe shell execution
- `validateCommand(command)` — pre-execution safety check

## Rules
- `shell-safety.ts` rules are authoritative. Never bypass them.
- No tool may use raw `exec`/`spawn` — always go through `shellExecute`

## Dependencies
`@helmsman/shared`
