# tools-github

GitHub tool implementations exposed to the agent (repos, PRs, issues, workflows).

## Responsibility
Provides the agent with read/write access to GitHub: reading code, creating PRs, managing issues, and triggering workflows.

## Key Files
```
src/
  github-client.ts    ← Authenticated Octokit client factory
  tool-factory.ts     ← Creates typed GitHub tool instances with shared client
  tools/              ← Individual tool implementations (repos, prs, issues, etc.)
  types.ts            ← GitHub tool types
  index.ts            ← Exports
```

## Exports
- `githubTools` — array of GitHub tools to register with the agent

## Env Vars
- `GITHUB_TOKEN` — Personal access token or GitHub App installation token

## Dependencies
`@helmsman/shared`, `@helmsman/tools`, `@octokit/rest`
