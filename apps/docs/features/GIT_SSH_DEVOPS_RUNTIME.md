# Feature: Git, SSH & DevOps Runtime

> **Packages:**
> - `packages/tools-github` — GitHub API tools (read-only, curated, no container needed)
> - `packages/tools-devops-runtime` — Git clone/push/operations + SSH execution (container-isolated)
>
> **Wave:** 3 (depends on: `@helmsman/tools`, `@helmsman/policy`, `@helmsman/audit`, `@helmsman/shared`)
> **Risk surface:** High — involves credential handling, remote code execution, SSH access to production machines. Every design decision here is security-first.

---

## Purpose

Give Helmsman the ability to reason about, explore, and act on real codebases and remote machines — safely. This feature splits into two very distinct halves:

**Half 1 — GitHub Intelligence (Read-Only, API-based)**
Browse any public GitHub repository without touching a machine. Read issues, PRs, discussions, review code, search files, inspect CI runs. This uses the GitHub REST/GraphQL API from within the API server — no container needed, no code execution, no credentials required for public repos.

**Half 2 — DevOps Runtime (Write, Execute, SSH — Container-Isolated)**
Perform operations that touch real systems: clone a repo, push commits, run scripts inside a cloned repo, SSH into a remote machine and execute commands. **These operations NEVER run inside the API server process.** They always run in ephemeral, isolated Docker containers that are spun up, used, and destroyed per task. The API server only orchestrates containers — it never executes user-originated code or opens SSH connections directly.

---

## What the Agent Is Able to Do After This Feature

| User Request | What Happens |
|---|---|
| "Show me open issues on facebook/react" | GitHub API call — no container, instant |
| "Search for how authentication is implemented in that repo" | GitHub code search API + file content fetch |
| "Review PR #422 on our backend repo" | GitHub API: fetch diff, comments, CI status |
| "Clone our backend repo on the staging server and run tests" | Agent asks for SSH credentials → container spins up → SSH → clone → run → report back → container destroyed |
| "Clone this public repo locally and show me the file structure" | Container spins up → git clone (public URL, no creds) → ls -la → destroyed |
| "SSH into 10.0.1.5 and check disk usage" | Agent asks: IP confirmed? Key available? → container spins up → SSH → df -h → output returned → destroyed |
| "Deploy the app: clone repo, copy to server, restart service" | Multi-step plan → approval required → per-step execution via container runtime |

---

## What the Agent Must NOT Assume — Always Ask

The agent must **never assume** credentials, IPs, keys, or repo URLs. If any required piece of information is missing, the agent must ask the user before beginning. These are the mandatory clarification points:

| Required for | Must Ask If Missing |
|---|---|
| SSH access | Host IP/hostname, SSH username, which SSH key to use (from vault or user-provided) |
| Git clone (private repo) | Whether to use a stored deploy key or a user-supplied token |
| Git push | Confirmation of target branch, whether force-push is allowed |
| Running scripts | What the script does (agent should read it first), confirm before execution |
| Any destructive operation on a remote machine | Explicit typed confirmation (e.g., type the hostname) |
| Multi-step workflows | Present full plan, receive explicit approval before first step executes |

---

## Architecture: Why Two Packages

```
packages/tools-github          ← No containers. Calls GitHub API. Always read-only.
                                  Runs inside the API server process safely.

packages/tools-devops-runtime  ← All execution is inside ephemeral Docker containers.
                                  API server only sends commands and reads output.
                                  Never executes user code, git, or SSH directly.
```

This separation is intentional. Mixing read-only GitHub API calls with container-based SSH execution in the same package creates coupling that makes security audits harder and testing more complex.

---

## Architecture: Container Isolation Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        apps/api (Express)                        │
│                                                                   │
│  ContainerOrchestrator ──────────────────────────────────────┐   │
│   • Validates all inputs before container start              │   │
│   • Injects secrets as ephemeral tmpfs files (not env values)│   │
│   • Sets hard CPU / memory / time limits                     │   │
│   • Streams stdout/stderr back as ToolResponse               │   │
│   • Kills container on timeout or error                      │   │
│   • Deletes container + volumes immediately after task       │   │
└──────────────────────────────────────────┬───────────────────┘   │
                                           │ docker run / Docker API│
                                           ▼                        │
┌─────────────────────────────────────────────────────────────────┐
│              Ephemeral Execution Container                        │
│                                                                   │
│  Base image: helmsman-runtime:latest                             │
│   (debian-slim + git + openssh-client + curl + jq + rsync)      │
│                                                                   │
│  Non-root user: helmsman (uid 10001)                             │
│  Read-only filesystem except:                                     │
│    /workspace  ← task working directory (tmpfs, scoped)          │
│    /tmp        ← ephemeral scratch (tmpfs)                        │
│                                                                   │
│  No outbound internet except approved egress:                     │
│    • github.com:443, api.github.com:443                          │
│    • User-specified SSH host (per-container network policy)      │
│    • User-specified Git remote host                              │
│                                                                   │
│  Secrets injected at runtime as tmpfs files (never baked in):    │
│    /run/helmsman/secrets/ssh_key      (0400)                     │
│    /run/helmsman/secrets/known_hosts  (0444)                     │
│    /run/helmsman/secrets/git_token    (0400, optional)           │
│  Env vars may contain file paths only, never secret values       │
│                                                                   │
│  Lifecycle: spin up → execute → stream output → destroy          │
│  Max lifetime: configurable (default 300s hard kill)             │
└─────────────────────────────────────────────────────────────────┘
```

### Container Rules (Non-Negotiable)

1. **One task per container.** Never reuse a container across tasks or users.
2. **No privileged mode.** `--privileged` is never set.
3. **No host mounts.** Never mount `/var/run/docker.sock` or any host path into the container.
4. **Secrets are file-mounted, never env-injected.** SSH keys and tokens are written to per-task tmpfs secret files with strict permissions, passed by path only, and wiped before container removal.
5. **Time limits are hard limits.** The orchestrator sends `docker kill` (SIGKILL) after the timeout. Not SIGTERM. The container is not given a grace period to do cleanup that could leak data.
6. **Network is enforceably locked.** Tasks without network run with `--network none`. Tasks requiring network run on an isolated runtime network with host firewall or egress gateway rules that default-deny all traffic except explicit `egressAllowlist` destinations.
7. **All output is captured and redacted before being returned.** SSH keys, tokens, and other secrets are scrubbed from stdout/stderr before the response is stored or displayed.

---

## Package 1: `packages/tools-github`

### Overview

Pure GitHub API client wrapped as Helmsman tools. Uses `@octokit/rest` and `@octokit/graphql`. Authenticates with either an unauthenticated client (public repos, 60 req/hr) or a GitHub App token / PAT (5000 req/hr).

### Dependencies

```
@octokit/rest          ← GitHub REST API v3 client
@octokit/graphql       ← GitHub GraphQL API v4 client
@octokit/auth-token    ← Token authentication strategy
zod                    ← Parameter validation
@helmsman/tools        ← ToolInterface, ToolResponse
@helmsman/shared       ← AppError, shared types
```

**Do NOT use:** `@octokit/core`, `probot`, or any Octokit plugin-chain. Use `@octokit/rest` and `@octokit/graphql` directly and explicitly. This avoids hidden plugin behavior that's hard to audit.

### File Structure

```
packages/tools-github/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                    ← barrel export
    github-client.ts            ← creates authenticated/unauthenticated Octokit instance
    tools/
      search-repos.ts           ← github.search.repos
      get-repo.ts               ← github.repo.get
      list-issues.ts            ← github.issues.list
      get-issue.ts              ← github.issues.get
      list-prs.ts               ← github.prs.list
      get-pr.ts                 ← github.prs.get
      get-pr-diff.ts            ← github.prs.getDiff
      list-pr-comments.ts       ← github.prs.listComments
      list-discussions.ts       ← github.discussions.list  (GraphQL)
      get-discussion.ts         ← github.discussions.get   (GraphQL)
      get-file.ts               ← github.repo.getFile
      list-files.ts             ← github.repo.listFiles
      search-code.ts            ← github.search.code
      list-commits.ts           ← github.commits.list
      get-commit.ts             ← github.commits.get
      list-workflows.ts         ← github.actions.listWorkflows
      get-workflow-run.ts       ← github.actions.getWorkflowRun
  tests/
    tools/
      search-repos.test.ts
      list-issues.test.ts
      ... (one test file per tool)
```

### Credentials in ToolContext

```typescript
// packages/tools-github/src/types.ts

import type { ToolCredentials } from "@helmsman/tools";

export interface GitHubCredentials extends ToolCredentials {
  provider: "github";
  /** Optional. If absent, client is unauthenticated (public repos only, 60 req/hr) */
  token?: string;
}
```

The agent must work without credentials for any public repository. If a request targets a private repository or is likely to hit rate limits, the agent asks the user which stored GitHub integration to use.

### Tool Specifications

#### `github.search.repos`

```typescript
const ParamsSchema = z.object({
  query: z.string().min(1).describe("GitHub search query, e.g. 'react hooks language:typescript'"),
  sort: z.enum(["stars", "forks", "help-wanted-issues", "updated"]).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  perPage: z.number().min(1).max(30).default(10),
  page: z.number().min(1).default(1),
});

interface RepoSummary {
  fullName: string;       // "facebook/react"
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  isPrivate: boolean;
  updatedAt: string;      // ISO 8601
  defaultBranch: string;
}

// Risk tier: read_only
// API endpoint: GET /search/repositories
```

#### `github.repo.get`

```typescript
const ParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

interface RepoDetail {
  fullName: string;
  description: string | null;
  url: string;
  cloneUrl: string;        // HTTPS clone URL — safe to pass to container
  sshUrl: string;          // git@github.com:owner/repo.git
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  isPrivate: boolean;
  license: string | null;
  size: number;            // kilobytes
  hasWiki: boolean;
  hasDiscussions: boolean;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
}

// Risk tier: read_only
```

#### `github.issues.list`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  state: z.enum(["open", "closed", "all"]).default("open"),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  sort: z.enum(["created", "updated", "comments"]).default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  perPage: z.number().min(1).max(50).default(20),
  page: z.number().min(1).default(1),
});

interface IssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  labels: string[];
  assignees: string[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  isPullRequest: boolean;  // GitHub issues API returns both issues and PRs
}

// Risk tier: read_only
```

#### `github.issues.get`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  issueNumber: z.number().int().positive(),
  includeComments: z.boolean().default(false), // set true to fetch all comments
});

interface IssueDetail extends IssueSummary {
  body: string | null;
  closedAt: string | null;
  closedBy: string | null;
  reactions: Record<string, number>;
  comments?: IssueComment[];
}

interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  reactions: Record<string, number>;
}

// Risk tier: read_only
```

#### `github.prs.list`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  state: z.enum(["open", "closed", "all"]).default("open"),
  base: z.string().optional(),    // filter by target branch
  sort: z.enum(["created", "updated", "popularity", "long-running"]).default("updated"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  perPage: z.number().min(1).max(50).default(20),
  page: z.number().min(1).default(1),
});

interface PRSummary {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  author: string;
  head: string;          // source branch
  base: string;          // target branch
  draft: boolean;
  reviewState: "APPROVED" | "CHANGES_REQUESTED" | "PENDING" | "DISMISSED" | null;
  commentCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  url: string;
}

// Risk tier: read_only
```

#### `github.prs.get`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int().positive(),
  includeDiff: z.boolean().default(false),
  includeComments: z.boolean().default(false),
  includeReviews: z.boolean().default(false),
});

interface PRDetail extends PRSummary {
  body: string | null;
  mergeable: boolean | null;
  mergeableState: string | null;     // "clean" | "dirty" | "behind" | "blocked" etc.
  ciStatus: "pending" | "success" | "failure" | "error" | null;
  diff?: string;                     // raw unified diff (only if includeDiff: true)
  comments?: PRComment[];
  reviews?: PRReview[];
}

// Risk tier: read_only
// NOTE: diff can be large. Agent should warn user if diff > 50KB before fetching.
```

#### `github.search.code`

```typescript
const ParamsSchema = z.object({
  query: z.string().min(1).describe(
    "GitHub code search query. Example: 'useAuth filename:auth.ts repo:owner/repo'"
  ),
  perPage: z.number().min(1).max(30).default(10),
  page: z.number().min(1).default(1),
});

interface CodeSearchResult {
  totalCount: number;
  items: CodeMatch[];
}

interface CodeMatch {
  path: string;           // "src/auth/useAuth.ts"
  repoFullName: string;   // "owner/repo"
  url: string;            // GitHub URL to file
  htmlUrl: string;
  score: number;
  textMatches?: { fragment: string; matches: { text: string }[] }[];
}

// Risk tier: read_only
// IMPORTANT: GitHub code search is only available for authenticated requests.
// If no GitHub token is configured, the agent must ask the user to provide one
// or inform them that code search requires authentication.
```

#### `github.repo.getFile`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string().describe("File path within the repo, e.g. 'src/index.ts'"),
  ref: z.string().optional().describe("Branch, tag, or commit SHA. Defaults to default branch."),
});

interface FileContent {
  path: string;
  name: string;
  size: number;           // bytes
  sha: string;
  encoding: "base64";
  content: string;        // base64-encoded content — ALWAYS decode before showing
  contentDecoded: string; // decoded string
  url: string;
}

// Risk tier: read_only
// IMPORTANT: This tool decodes the base64 content and returns both.
// Agent should not show raw base64 to the user.
// For files > 100KB, agent should warn the user before fetching.
```

#### `github.repo.listFiles`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string().default("").describe("Directory path. Empty string = repo root."),
  ref: z.string().optional(),
  recursive: z.boolean().default(false).describe(
    "If true, uses git tree API to list all files recursively. " +
    "WARNING: can return hundreds of entries for large repos."
  ),
});

interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number | null;    // null for dirs
  sha: string;
  url: string;
}

// Risk tier: read_only
```

#### `github.discussions.list` + `github.discussions.get`

These use the GitHub GraphQL API (`@octokit/graphql`) because discussions are not fully available on the REST API.

```typescript
// github.discussions.list
const ListParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  first: z.number().min(1).max(50).default(20),
  after: z.string().optional(),      // cursor for pagination
  categoryId: z.string().optional(), // filter by category
});

interface DiscussionSummary {
  id: string;                        // GraphQL node ID
  number: number;
  title: string;
  author: string;
  category: string;
  answerCount: number;
  commentCount: number;
  isAnswered: boolean;
  createdAt: string;
  url: string;
}

// github.discussions.get
const GetParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  discussionNumber: z.number().int().positive(),
});

// Risk tier: read_only
// NOTE: requires 'discussions' scope. Inform user if token lacks scope.
```

#### `github.actions.getWorkflowRun`

```typescript
const ParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  runId: z.number().int().positive(),
  includeJobs: z.boolean().default(true),
  includeAnnotations: z.boolean().default(false),
});

interface WorkflowRunDetail {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | null;
  branch: string;
  commitSha: string;
  commitMessage: string;
  triggerEvent: string;   // "push" | "pull_request" | "workflow_dispatch" etc.
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  url: string;
  logsUrl: string;
  jobs?: WorkflowJob[];
}

// Risk tier: read_only
```

---

## Package 2: `packages/tools-devops-runtime`

### Overview

All tools in this package execute inside ephemeral Docker containers managed by the `ContainerOrchestrator`. The API server never runs `git`, `ssh`, or user-supplied scripts directly. This package exposes typed tools that describe what to do; the orchestrator decides how to do it safely inside a container.

### Dependencies

```
dockerode               ← Docker Engine API client for Node.js/Bun
zod                     ← Parameter validation
@helmsman/tools         ← ToolInterface, ToolResponse
@helmsman/shared        ← AppError, shared types
@helmsman/audit         ← Audit log events
```

**Do NOT use:** `child_process.exec`, `child_process.spawn`, `Bun.spawn`, `shelljs`, or any mechanism that runs commands directly in the API server process. All execution must go through `ContainerOrchestrator`.

**Do NOT use:** the Docker CLI (`docker` binary via shell). Use the `dockerode` library exclusively so Docker interactions are typed, auditable, and cannot be confused with user-supplied shell.

### File Structure

```
packages/tools-devops-runtime/
  package.json
  tsconfig.json
  README.md
  .env.example
  docker/
    Dockerfile.runtime          ← The ephemeral container base image definition
    entrypoint.sh               ← Container entrypoint (sets up SSH key, runs command)
  src/
    index.ts                    ← barrel export
    orchestrator/
      container-orchestrator.ts ← creates, runs, streams, destroys containers
      container-config.ts       ← builds Docker container config from task params
      network-policy.ts         ← per-container network rules (egress allowlist)
      credential-injector.ts    ← writes secrets to tmpfs files, injects file paths only
      output-redactor.ts        ← scrubs secrets from stdout/stderr before return
    tools/
      git-clone.ts              ← devops.git.clone
      git-status.ts             ← devops.git.status
      git-diff.ts               ← devops.git.diff
      git-log.ts                ← devops.git.log
      git-checkout.ts           ← devops.git.checkout
      git-pull.ts               ← devops.git.pull
      git-push.ts               ← devops.git.push
      git-commit.ts             ← devops.git.commit
      ssh-exec.ts               ← devops.ssh.exec
      ssh-file-read.ts          ← devops.ssh.fileRead
      ssh-file-write.ts         ← devops.ssh.fileWrite
      shell-run.ts              ← devops.shell.run  (runs arbitrary command in container)
  tests/
    orchestrator/
      container-orchestrator.test.ts
      output-redactor.test.ts
    tools/
      git-clone.test.ts
      ssh-exec.test.ts
```

### Credentials in ToolContext

```typescript
// packages/tools-devops-runtime/src/types.ts

import type { ToolCredentials } from "@helmsman/tools";

export interface SSHCredentials extends ToolCredentials {
  provider: "ssh";
  host: string;
  port: number;           // default 22
  username: string;
  /** Base64-encoded private key (PEM format). Never a file path. */
  privateKeyBase64: string;
  /** Optional passphrase for the private key */
  passphrase?: string;
  /** Full known_hosts line, e.g. "host ssh-ed25519 AAAAC3..." */
  knownHostLine: string;
}

export interface GitCredentials extends ToolCredentials {
  provider: "git";
  /** For HTTPS clones of private repos only. Not needed for public repos. */
  token?: string;
  /** Username to use with token (GitHub: use "x-access-token") */
  username?: string;
}
```

### ContainerOrchestrator

This is the most critical piece of this feature. Implement carefully.

```typescript
// packages/tools-devops-runtime/src/orchestrator/container-orchestrator.ts

export interface ContainerTaskSpec {
  /** Unique ID for this task — used as container name suffix */
  taskId: string;
  /** The shell commands to run inside the container, in order */
  commands: readonly string[];
  /** Credentials resolved in memory; injector writes secret files and passes paths only */
  credentials?: ContainerCredentials;
  /** Max time in milliseconds before hard kill (default: 300_000 = 5 minutes) */
  timeoutMs?: number;
  /** CPU quota: fraction of one core (default: 0.5) */
  cpuQuota?: number;
  /** Memory limit in bytes (default: 256MB) */
  memoryBytes?: number;
  /** Approved egress destinations (host:port pairs). Empty means no network. */
  egressAllowlist?: readonly EgressRule[];
}

export interface EgressRule {
  host: string;           // "github.com" or "10.0.1.5"
  port: number;           // 443, 22, etc.
  protocol: "tcp" | "udp";
}

export interface ContainerCredentials {
  sshKeyPemBase64?: string;   // resolved from vault; written to /run/helmsman/secrets/ssh_key
  gitToken?: string;          // resolved from vault; written to /run/helmsman/secrets/git_token
  knownHostLine?: string;     // written to /run/helmsman/secrets/known_hosts
  sshHost?: string;           // non-secret metadata
  sshUser?: string;           // non-secret metadata
  sshPort?: string;           // non-secret metadata
}

export interface ContainerResult {
  exitCode: number;
  stdout: string;         // already redacted
  stderr: string;         // already redacted
  durationMs: number;
  killed: boolean;        // true if killed due to timeout
}

export interface ContainerOrchestrator {
  run(spec: ContainerTaskSpec): Promise<ContainerResult>;
}
```

**Implementation notes for the coding agent:**

1. Use `dockerode`'s `docker.createContainer()` + `container.start()` + `container.attach()` pattern. Do NOT use `docker.run()` — it obscures error handling.
2. Attach to stdout + stderr as separate streams before starting the container.
3. Use `container.wait()` with a Promise race against a `setTimeout(timeoutMs)` that calls `container.kill({ signal: 'SIGKILL' })`.
4. Always call `container.remove({ force: true })` in a `finally` block — this MUST run even if an exception is thrown.
5. Never log the raw `credentials` object, raw command strings, or env values. Log `{ taskId, commandSummary, commandFingerprint, egressAllowlist }` only.
6. The container name must be `helmsman-task-{taskId}` so orphan containers can be identified.

### Dockerfile.runtime

The coding agent must create this file at `packages/tools-devops-runtime/docker/Dockerfile.runtime`.

```dockerfile
# packages/tools-devops-runtime/docker/Dockerfile.runtime
FROM debian:bookworm-slim

# Install exactly what's needed — nothing more
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    jq \
    rsync \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 10001 helmsman && \
    useradd -u 10001 -g helmsman -m -d /home/helmsman -s /bin/bash helmsman

# Working directory
RUN mkdir -p /workspace && chown helmsman:helmsman /workspace

WORKDIR /workspace
USER helmsman

# Entrypoint: reads secret file paths, configures SSH/git, then runs commands
COPY --chown=helmsman:helmsman entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

```bash
#!/bin/bash
# packages/tools-devops-runtime/docker/entrypoint.sh
set -euo pipefail

# Set up SSH key from mounted secret file path if provided
if [ -n "${HELMSMAN_SSH_KEY_FILE:-}" ]; then
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  cp "$HELMSMAN_SSH_KEY_FILE" ~/.ssh/helmsman_task_key
  chmod 600 ~/.ssh/helmsman_task_key

  # Add host key verification data if provided
  if [ -n "${HELMSMAN_KNOWN_HOSTS_FILE:-}" ]; then
    cp "$HELMSMAN_KNOWN_HOSTS_FILE" ~/.ssh/known_hosts
    chmod 644 ~/.ssh/known_hosts
  elif [ -n "${HELMSMAN_SSH_HOST:-}" ]; then
    # Strict host key checking ON by default — do not skip
    # The orchestrator must always provide a valid known_hosts line for real SSH
    echo "ERROR: HELMSMAN_KNOWN_HOSTS_FILE is required when HELMSMAN_SSH_HOST is set." >&2
    exit 1
  fi

  # Configure git to use this key for git operations over SSH
  export GIT_SSH_COMMAND="ssh -i ~/.ssh/helmsman_task_key -o BatchMode=yes -o StrictHostKeyChecking=yes"
fi

# Configure git HTTP token from mounted secret file if provided
if [ -n "${HELMSMAN_GIT_TOKEN_FILE:-}" ]; then
  HELMSMAN_GIT_TOKEN="$(cat "$HELMSMAN_GIT_TOKEN_FILE")"
  git config --global credential.helper store
  echo "https://x-access-token:${HELMSMAN_GIT_TOKEN}@github.com" > ~/.git-credentials
  chmod 600 ~/.git-credentials
fi

# Set safe git config
git config --global init.defaultBranch main
git config --global safe.directory /workspace

# Execute the passed command
exec "$@"
```

### Tool Specifications

#### `devops.git.clone`

```typescript
const ParamsSchema = z.object({
  repoUrl: z
    .string()
    .url()
    .describe(
      "HTTPS or SSH clone URL. For public repos use HTTPS. " +
      "Example: 'https://github.com/owner/repo.git'"
    ),
  branch: z.string().optional().describe("Branch to clone. Defaults to repo default branch."),
  depth: z.number().int().min(1).optional().describe(
    "Shallow clone depth. Use 1 for just the latest commit, which is faster."
  ),
  /**
   * Whether to use a stored git credential.
   * If repoUrl is a private repo and no credential is provided,
   * the agent MUST ask the user before calling this tool.
   */
  requiresAuth: z.boolean().default(false),
});

interface CloneResult {
  clonedPath: string;          // "/workspace/<repo-name>"
  branch: string;
  headCommit: string;          // SHA of HEAD
  headMessage: string;         // commit message
  fileCount: number;           // total tracked files
  directoryListing: string[];  // top-level entries (ls -la output lines)
}

// Risk tier: low_risk (cloning is read-only but uses network + disk)
// Approval: announce and proceed
// Container required: YES
```

#### `devops.git.status`

```typescript
const ParamsSchema = z.object({
  workdir: z.string().describe("Absolute path inside the container workspace"),
});

interface GitStatusResult {
  branch: string;
  headCommit: string;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
  clean: boolean;
}

// Risk tier: read_only
// Container required: YES (operates on a workspace created in a previous task)
// NOTE: For stateful operations (status/diff/push on a previously cloned repo),
// the container must be able to access the workspace from the clone step.
// The orchestrator handles workspace persistence across tool calls within a single
// agent task via a named Docker volume scoped to the correlationId.
```

#### `devops.git.diff`

```typescript
const ParamsSchema = z.object({
  workdir: z.string(),
  from: z.string().optional().describe("Base ref (commit SHA, branch, tag)"),
  to: z.string().optional().describe("Target ref. Defaults to HEAD."),
  paths: z.array(z.string()).optional().describe("Limit diff to specific paths"),
  stat: z.boolean().default(false).describe("Only show diff --stat, not full diff"),
  maxLines: z.number().max(2000).default(500),
});

// Risk tier: read_only
```

#### `devops.git.push`

```typescript
const ParamsSchema = z.object({
  workdir: z.string(),
  remote: z.string().default("origin"),
  branch: z.string(),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

// Risk tier: significant (force: false), destructive (force: true)
// Approval: ALWAYS requires explicit approval before pushing
// The agent MUST present what commits will be pushed and ask for confirmation.
```

#### `devops.git.commit`

```typescript
const ParamsSchema = z.object({
  workdir: z.string(),
  message: z.string().min(1).max(500),
  authorName: z.string().optional(),
  authorEmail: z.string().email().optional(),
  addAll: z.boolean().default(false).describe(
    "If true, runs 'git add -A' before committing. " +
    "Agent should show the user what will be staged before setting this."
  ),
  paths: z.array(z.string()).optional().describe(
    "Specific paths to stage. Used when addAll is false."
  ),
});

// Risk tier: low_risk
// The agent MUST show the user a diff of what will be committed before calling this tool.
```

#### `devops.ssh.exec`

This is the most sensitive tool in the entire system.

```typescript
const ParamsSchema = z.object({
  /**
   * The command to run on the remote host.
   * CRITICAL: Agent must show this to the user and get approval before executing.
   * Agent must NOT construct shell pipelines that could exfiltrate data silently.
   * Agent must NOT use commands that modify system state without explicit approval.
   */
  command: z.string().min(1).max(4000),

  /**
   * Host info — agent MUST ask user if not already in context.
   * Never assume an IP or hostname.
   */
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),

  /**
   * SSH key source — one of these must be provided.
   * The agent should ask the user: "Which SSH key should I use for this machine?"
   * If the user provides a key directly, it goes through the credential vault.
   */
  sshKeyVaultId: z.string().optional().describe(
    "ID of a stored SSH key in the credential vault"
  ),

  /**
   * Full known_hosts entry for the remote host public key.
   * REQUIRED for real SSH connections. Never proceed with StrictHostKeyChecking=no.
   * `ssh-keyscan` output alone is not sufficient trust — user must verify fingerprint
   * from an out-of-band trusted source before approval.
   */
  knownHostLine: z.string().min(1).describe(
    "known_hosts line for the target host, preferably ssh-ed25519 only. " +
    "Require out-of-band fingerprint verification before use."
  ),

  timeout: z.number().int().min(1).max(300).default(60).describe(
    "Command timeout in seconds"
  ),

  /** If true, return only exit code and stderr — not stdout. Reduces output. */
  quietMode: z.boolean().default(false),
});

interface SSHExecResult {
  exitCode: number;
  stdout: string;     // redacted
  stderr: string;     // redacted
  durationMs: number;
  host: string;       // confirmed host  (never includes the key or token)
  command: string;    // the command that was run (not the credentials)
}

// Risk tier: significant (read commands), destructive (any command modifying state)
// MANDATORY approval: agent MUST present the exact command to the user and wait
// for "yes" before executing. This is enforced at the policy layer.
// Container required: YES — SSH is run from inside the container, not the API server.
```

#### `devops.ssh.fileRead`

```typescript
const ParamsSchema = z.object({
  host: z.string(),
  port: z.number().default(22),
  username: z.string(),
  sshKeyVaultId: z.string(),
  knownHostLine: z.string(),
  remotePath: z.string().describe("Absolute path on the remote machine"),
  maxSizeBytes: z.number().max(1_048_576).default(102_400).describe(
    "Max file size to transfer. Tool fails if file is larger. Default 100KB."
  ),
});

// Risk tier: significant (reads potentially sensitive files)
// Approval: require_approval
```

#### `devops.ssh.fileWrite`

```typescript
const ParamsSchema = z.object({
  host: z.string(),
  port: z.number().default(22),
  username: z.string(),
  sshKeyVaultId: z.string(),
  knownHostLine: z.string(),
  remotePath: z.string().describe("Absolute path on the remote machine to write to"),
  content: z.string().describe("File content to write"),
  mode: z.string().regex(/^[0-7]{3,4}$/).default("644"),
  backup: z.boolean().default(true).describe(
    "If true, backs up existing file to <path>.helmsman.bak before writing"
  ),
});

// Risk tier: destructive
// Approval: require_confirmation (typed confirmation)
```

#### `devops.shell.run`

Used for running arbitrary scripts inside the container workspace — for example, running `npm test` or `./deploy.sh` after cloning a repo.

```typescript
const ParamsSchema = z.object({
  workdir: z.string(),
  /**
   * Command to run. Shell is /bin/bash.
   * Agent MUST:
   * 1. Read the script/command first and summarize it to the user.
   * 2. Ask for confirmation before running.
   * 3. Never run a command it hasn't shown to the user.
   */
  command: z.string().min(1).max(4000),
  env: z.record(z.string()).optional().describe(
    "Additional environment variables. Values are redacted in logs."
  ),
  timeout: z.number().int().min(1).max(600).default(120),
});

// Risk tier: significant (read-only intent), destructive (any mutation)
// The policy engine classifies this as destructive by default because
// the content of arbitrary shell commands cannot be statically analyzed.
// Agent MUST show the command and get explicit approval.
```

---

## Credential Vault — How SSH Keys and Tokens Are Stored

SSH keys and tokens are NEVER stored as raw values in the database. They are stored encrypted-at-rest via the credential vault in `packages/db`.

```
User uploads SSH key via one-time secure vault upload URL (not chat body)
         │
         ▼
API receives key over HTTPS upload endpoint
         │
         ▼  Encrypt with team's vault key (AES-256-GCM)
         ▼
CredentialVault.store(teamId, name, encryptedValue, type: "ssh_key")
         │  → saves to Credential table in DB (stores ciphertext only)
         │  → returns vaultId
         ▼
Agent uses vaultId to reference key in tool calls (never the raw key)
         │
         ▼
ContainerOrchestrator calls CredentialVault.resolve(vaultId)
         │  → decrypts in memory
         │  → writes key to per-task tmpfs secret file with 0400 perms
         │  → passes file path into container env
         │  → after container is destroyed, decrypted value goes out of scope
         ▼
Container uses key, is destroyed
Raw key never written to disk on the API server
```

The `CredentialVault` interface is in `@helmsman/shared`. The implementation is in `packages/db`.

---

## Agent Clarification Protocol

This describes exactly when and how the agent must ask clarifying questions. The coding agent implementing `packages/agent-core` (when wiring these tools) must follow this exactly.

### For SSH Operations

The agent must ask (if not already in conversation context):

```
Before I can SSH into a machine, I need a few things:

1. **Host**: What is the IP address or hostname of the machine?
2. **Username**: What SSH username should I use? (e.g., ubuntu, ec2-user, root)
3. **SSH Key**: Which SSH key should I use?
   - If you have a key already stored with Helmsman, tell me its name.
  - If not, use the secure upload flow (one-time link). Do not paste secrets in chat.
4. **Host Key Verification**: Please provide a verified known_hosts entry (ed25519 preferred).
  - You can collect candidate data by running:
     `ssh-keyscan -t ed25519 <your-host>`
  - Then verify that fingerprint out-of-band (provider console / CMDB / trusted runbook) before use.
```

### For Git Clone (Private Repos)

```
To clone a private repository, I need:

1. **Repo URL**: The HTTPS or SSH URL of the repository.
2. **Authentication**: Should I use:
   - A GitHub Personal Access Token (PAT)?
   - A Deploy Key stored with Helmsman?
   - Your organization's stored GitHub integration?
```

### For Running Scripts

```
Before I run this script, let me read it first and show you what it does.
[agent reads script/command]
Here's what will run:
  <script content or summary>

Should I proceed? (yes / no)
```

### For Destructive Operations (File Write, Force Push, rm commands)

The agent must use the policy engine's `require_confirmation` flow, which means the user must type the name of the resource being modified before the action is executed.

---

## Workspace Persistence Across Tool Calls

When a user says "clone the repo, then run tests, then show me the test output," this is a multi-step task that spans three tool calls. Each tool call creates a container. The cloned repo must be accessible in each subsequent container.

**Solution: Named Docker Volumes scoped to `correlationId`**

```
Task begins (correlationId: "abc-123")
    │
    ▼
devops.git.clone → container uses volume "helmsman-ws-abc-123"
    │               mounts at /workspace
    │               clones repo into /workspace/repo
    │               container destroyed
    ▼
devops.shell.run → container uses volume "helmsman-ws-abc-123"
    │               mounts at /workspace (repo is still there)
    │               runs `cd /workspace/repo && npm test`
    │               container destroyed
    ▼
Task ends → ContainerOrchestrator deletes volume "helmsman-ws-abc-123"
```

**Rules:**
- Volume name: `helmsman-ws-{correlationId}` — always scoped to a single task.
- Volume is created when the first container in a task starts.
- Volume is deleted when the task completes, errors out, or times out.
- The orchestrator must call `docker.getVolume('helmsman-ws-{correlationId}').remove()` in a `finally` block.
- Maximum volume size: 500MB (enforced via Docker volume driver options if available, otherwise checked beforehand via `df`).

---

## Network Policy Per Container

Each container gets an isolated network posture with enforceable default-deny egress. DNS-only restrictions are not considered security controls.

```typescript
// packages/tools-devops-runtime/src/orchestrator/network-policy.ts

export async function createTaskNetwork(
  docker: Docker,
  taskId: string,
  egressRules: readonly EgressRule[],
): Promise<string> {
  // Enforceable MVP model:
  // 1) If egressRules is empty, run container with --network none.
  // 2) If egressRules is non-empty, attach to dedicated runtime network.
  // 3) Apply host-level firewall or egress gateway policy that blocks all outbound
  //    traffic except explicit destination IP:port from egressRules.
  // 4) Deny task startup if allowlist enforcement cannot be applied.
  const network = await docker.createNetwork({
    Name: `helmsman-net-${taskId}`,
    Driver: "bridge",
    Options: {
      "com.docker.network.bridge.enable_icc": "false",
    },
  });
  return network.id;
}

export async function removeTaskNetwork(docker: Docker, taskId: string): Promise<void> {
  const network = docker.getNetwork(`helmsman-net-${taskId}`);
  await network.remove();
}
```

---

## Output Redaction

Before any stdout/stderr leaves the container orchestrator, it must be scrubbed for secrets.

```typescript
// packages/tools-devops-runtime/src/orchestrator/output-redactor.ts

const REDACTION_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----[\s\S]*?-----END \S+ PRIVATE KEY-----/g,
  /ghp_[A-Za-z0-9]{36}/g,           // GitHub PAT (classic)
  /github_pat_[A-Za-z0-9_]{82}/g,   // GitHub PAT (fine-grained)
  /gho_[A-Za-z0-9]{36}/g,           // GitHub OAuth token
  /ghs_[A-Za-z0-9]{36}/g,           // GitHub App token
  /AKIA[0-9A-Z]{16}/g,               // AWS Access Key ID
  /(?:aws_secret_access_key|x-amz-security-token|authorization)\s*[:=]\s*[^\s"']+/gi,
];

export function redactOutput(raw: string): string {
  let result = raw;
  for (const pattern of REDACTION_PATTERNS) {
    result = result.replaceAll(pattern, "[REDACTED]");
  }
  return result;
}
```

This function must be called on ALL stdout and stderr before they are stored in the audit log, sent to the LLM, or returned in a `ToolResponse`.

For MVP, redaction must combine regex rules above with context-aware key/value masking and unit tests for false positives. Avoid broad generic token-length regexes that can corrupt normal output.

---

## Policy Engine Mapping

Every tool in this feature maps to a risk tier. The policy engine uses these as defaults.

| Tool | Default Risk Tier | Approval Required |
|------|------------------|-------------------|
| `github.*` (all) | `read_only` | Never |
| `devops.git.clone` (public) | `low_risk` | Announce and proceed |
| `devops.git.clone` (private) | `low_risk` | Announce and proceed (must have auth) |
| `devops.git.status` | `read_only` | Never |
| `devops.git.diff` | `read_only` | Never |
| `devops.git.log` | `read_only` | Never |
| `devops.git.checkout` | `low_risk` | Announce and proceed |
| `devops.git.pull` | `low_risk` | Announce and proceed |
| `devops.git.commit` | `low_risk` | Show diff, proceed |
| `devops.git.push` | `significant` | **Explicit yes required** |
| `devops.git.push` (force) | `destructive` | **Typed confirmation** |
| `devops.ssh.exec` (read commands) | `significant` | **Explicit yes required** |
| `devops.ssh.exec` (write/mutation) | `destructive` | **Typed confirmation** |
| `devops.ssh.fileRead` | `significant` | **Explicit yes required** |
| `devops.ssh.fileWrite` | `destructive` | **Typed confirmation** |
| `devops.shell.run` | `destructive` | **Typed confirmation** |

---

## Error Codes

All errors use `AppError` from `@helmsman/shared`. Error codes for this feature:

```typescript
// GitHub tools
"GITHUB.RATE_LIMITED"               // 429 from GitHub API
"GITHUB.NOT_FOUND"                  // 404 — repo/issue/PR doesn't exist
"GITHUB.AUTH_REQUIRED"              // Unauthenticated request to private resource
"GITHUB.SCOPE_MISSING"              // Token lacks required scope
"GITHUB.API_ERROR"                  // Other GitHub API error

// Container orchestrator
"RUNTIME.DOCKER_NOT_AVAILABLE"      // Docker daemon not reachable
"RUNTIME.CONTAINER_TIMEOUT"         // Task exceeded timeoutMs
"RUNTIME.CONTAINER_START_FAILED"    // Container could not start
"RUNTIME.NON_ZERO_EXIT"             // Container exited with non-zero code
"RUNTIME.VOLUME_LIMIT_EXCEEDED"     // Workspace volume exceeds max size
"RUNTIME.NETWORK_CREATE_FAILED"     // Could not create task network

// SSH tools
"SSH.HOST_KEY_MISMATCH"             // Remote host fingerprint doesn't match known
"SSH.AUTH_FAILED"                   // SSH key rejected
"SSH.CONNECTION_REFUSED"            // Connection to host refused
"SSH.COMMAND_TIMEOUT"               // SSH command timed out

// Git tools
"GIT.CLONE_FAILED"                  // git clone exited non-zero
"GIT.AUTH_FAILED"                   // Authentication failure during git operation
"GIT.PUSH_REJECTED"                 // Remote rejected push (not fast-forward, etc.)
"GIT.MERGE_CONFLICT"                // Pull failed due to conflict
```

---

## Audit Events

Every tool invocation emits structured audit events via `@helmsman/audit`.

```typescript
// packages/tools-devops-runtime fires these events:

{ event: "devops.container.start",   taskId, correlationId, commands: commandsSummary }
{ event: "devops.container.end",     taskId, correlationId, exitCode, durationMs, killed }
{ event: "devops.container.timeout", taskId, correlationId, timeoutMs }
{ event: "devops.git.clone",         taskId, correlationId, repoUrl, branch }
{ event: "devops.ssh.exec",          taskId, correlationId, host, commandSummary, commandFingerprint }
{ event: "devops.ssh.fileWrite",     taskId, correlationId, host, remotePath }
// NEVER log: credentials, tokens, private keys, raw command strings, stdout content (raw)

// packages/tools-github fires these events:
{ event: "github.api.call", tool, owner, repo, correlationId }
{ event: "github.api.rateLimit", remaining, resetAt, correlationId }
```

---

## Environment Variables

### `packages/tools-github/.env.example`

```env
# Optional: GitHub Personal Access Token or GitHub App token.
# If not set, the client operates unauthenticated (public repos only, 60 req/hr).
# Required for: private repos, code search, discussions, higher rate limits.
# Scopes needed: repo (private), public_repo (public), read:discussion
GITHUB_TOKEN=

# GitHub API base URL (override for GitHub Enterprise)
# Default: https://api.github.com
GITHUB_API_BASE_URL=
```

### `packages/tools-devops-runtime/.env.example`

```env
# Docker socket path. Default: /var/run/docker.sock
# On Windows with Docker Desktop: npipe:////./pipe/docker_engine
DOCKER_SOCKET_PATH=/var/run/docker.sock

# Security note:
# If the API server runs in a container, do NOT mount docker.sock into that container.
# Run the orchestrator on a dedicated trusted worker host/service that has Docker access.
# Runtime task containers still follow the "no host mounts" rule.

# Name of the pre-built helmsman runtime image
# Build with: docker build -f docker/Dockerfile.runtime -t helmsman-runtime:latest .
HELMSMAN_RUNTIME_IMAGE=helmsman-runtime:latest

# Default container resource limits
CONTAINER_DEFAULT_TIMEOUT_MS=300000
CONTAINER_DEFAULT_MEMORY_BYTES=268435456
CONTAINER_DEFAULT_CPU_QUOTA=0.5

# Maximum workspace volume size in bytes (500MB)
CONTAINER_MAX_WORKSPACE_BYTES=524288000
```

---

## Dependency Map Update

```
packages/tools-github
  └── depends on: @helmsman/tools, @helmsman/shared

packages/tools-devops-runtime
  └── depends on: @helmsman/tools, @helmsman/shared, @helmsman/audit

Both feed into:
packages/agent-core
  └── (via ToolRegistry)
```

Add both packages to the feature routing table in `apps/docs/features/README.md`.

---

## Out of Scope (This Feature)

- **Terraform / Pulumi execution** — separate feature, similar container model
- **Kubernetes `kubectl` tool** — separate curated tools package
- **Docker image building inside container** — requires privileged or rootless buildah, deferred
- **GitHub Apps / Webhooks** — GitHub App authentication is an enhancement; PAT is enough for MVP
- **GitLab / Bitbucket** — GitHub only for Phase 1; the `GitCredentials` interface is designed for extension
- **Parallel git operations across multiple repos** — single sequential operations only in Phase 1
- **SSH tunneling / port forwarding** — high risk, deferred
- **Interactive SSH sessions** — only non-interactive command execution for now (no PTY)
- **SSH key paste in chat UX** — disallowed for production mode; secure upload flow only

---

## Definition of Done

- [ ] `packages/tools-github` builds and type-checks with zero errors
- [ ] `packages/tools-devops-runtime` builds and type-checks with zero errors
- [ ] Unit tests pass for all GitHub API tool wrapper logic (mock Octokit)
- [ ] Unit test for `output-redactor.ts` covers all secret patterns
- [ ] Unit test for `container-orchestrator.ts` mocks `dockerode` — no real Docker required
- [ ] `Dockerfile.runtime` builds successfully (`docker build` passes)
- [ ] `entrypoint.sh` has shellcheck passing with zero warnings
- [ ] All tools registered in `ToolRegistry` with correct `riskTier`
- [ ] All tools have Zod parameter schemas with `.describe()` on every field
- [ ] No `any` types, no `@ts-ignore`, strict mode clean
- [ ] No credentials or secrets appear in any log line, audit event, or `ToolResponse`
- [ ] README exists in each package with: setup instructions, env vars, how to build the runtime image, how to run tests
- [ ] `.env.example` present and up-to-date in each package
- [ ] `apps/docs/features/README.md` updated to include both new packages in the feature table
