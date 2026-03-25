# tools-devops-runtime

DevOps runtime tools: Docker, Kubernetes, Git, and SSH operations.

## Responsibility
Provides the agent with the ability to execute real DevOps operations in a sandboxed environment — running containers, managing k8s resources, and executing git operations.

## Key Files
```
src/
  index.ts            ← Exports all runtime tools
  types.ts            ← Runtime tool types
  orchestrator/       ← Orchestrates multi-step runtime operations
  tools/              ← Individual tool implementations (docker, k8s, git, ssh)
```

## Exports
- `devopsRuntimeTools` — array of tools to register with the agent

## Dependencies
`@helmsman/shared`, `@helmsman/tools`
