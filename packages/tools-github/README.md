# @helmsman/tools-github

Read-only GitHub API tools for Helmsman.

## Environment

See `.env.example`.

## Usage

```ts
import { createGitHubTools } from "@helmsman/tools-github";

const tools = createGitHubTools({ token: process.env.GITHUB_TOKEN });
```

## Testing

```bash
bun test packages/tools-github/tests
```
