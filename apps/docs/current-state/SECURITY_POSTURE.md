# Security Posture (Implemented Controls)

Snapshot date: March 2, 2026 (UTC)

## Security Boundary Summary

- Public entrypoint:
Telegram webhook endpoint
- Trust checks before execution:
webhook secret, dedup, command safety validation, risk/capability gate, approval confirmation for risky actions
- Primary high-risk surface:
LLM-to-tool command execution

## Implemented Controls

## 1. Transport And Request Integrity

- Webhook secret header validation in Telegram route.
- Minimum secret length check at config load (`>=16`).
- Dedup store prevents replay of Telegram `update_id` in processing window.
- Correlation ID middleware assigns request trace IDs.

## 2. Input Validation And Error Boundaries

- Shared Telegram payload type guard validates inbound update shape.
- Parser returns `null` for unsupported payloads and normalizes message payload safely.
- `AppError` used for typed error propagation.
- Webhook error boundary responds with generic success object (prevents retry amplification).

## 3. Prompt Safety

- Prompt injection detector blocks known bypass patterns before intent routing.
- Refusal message explicitly denies policy/safety bypass requests.
- Limitation:
pattern-based checks only; no semantic or model-side prompt firewall.

## 4. Command Execution Safety (`shell.execute`)

- Allowlisted binaries only:
`aws`, `kubectl`, `helm`, `docker`, `curl`, `jq`
- Blocked constructs include:
`&&`, `||`, semicolon chaining, command substitution `$()`, unquoted backticks, pipe-to-shell, `rm -rf`, `eval`, `source`
- Max command length:
2000 chars
- Timeout:
30 seconds
- Output cap:
64KB
- Dynamic risk classification:
`read_only`, `significant`, `destructive` (unknown defaults to significant)

## 5. Human-in-the-loop Controls

- Capability activation required for risky actions:
`operator` for significant, `commander` for destructive
- Pending action flow enforces user/chat ownership on consume.
- Explicit command confirmation modes:
`/approve <code>` or `/confirm <target>`
- TTL-based expiry for activation and pending action records.

## 6. Container Runtime Isolation (`tools-devops-runtime`)

- Commands execute in Docker container, not host shell.
- Per-task workspace volume and cleanup on finish.
- Network mode defaults to `none` if no allowlist requested.
- If allowlist requested and enforcement env flag is not set, task fails closed.
- Credentials injected per-task and cleaned up.
- Stdout/stderr secret redaction pass before return.

## 7. Logging And Sensitive Data Handling

- Request logger sanitizes sensitive key names in headers/body/query.
- Agent trace logger redacts sensitive key names and truncates long values.
- Output redactor in runtime masks common key/token patterns.
- File logger writes structured JSON lines to local log file.

## 8. Audit Controls

- `AuditService` interface exists.
- Current implementation:
console-only audit logger with no persistent query backend.

## Residual Risks And Gaps

| Risk | Current state | Impact |
| --- | --- | --- |
| Prompt injection bypass via unseen phrasing | Regex detection only | Medium to high |
| Policy centralization drift | `packages/policy` exists but main flow uses orchestrator capability logic | Medium |
| Runtime egress allowlist semantics | Network object created, but host-level destination enforcement is not explicit in code path | Medium |
| Single-command approval for risky multi-step intent | Risky multi-step approval path currently stores and executes one command | High |
| In-memory mode durability | Activation, context, dedup reset on process restart when Redis absent | Medium |
| Root docs drift | Top-level docs describe architecture not matching runtime | Medium |

## Immediate Security Hardening Priorities

1. Unify approval/risk policy into one authoritative engine used by orchestrator and tools.
2. Extend prompt injection controls beyond regex (model/tool context classification and high-risk intent checks).
3. Implement explicit, testable egress destination enforcement for runtime containers.
4. Move audit trail from console logger to durable append-only storage with query support.
5. Add end-to-end tests for approval abuse cases (wrong user, expired code, replay attempts).

## Source Files Consulted

- `apps/api/src/config.ts`
- `apps/api/src/routes/telegram.ts`
- `apps/api/src/middleware/request-logging.ts`
- `apps/api/src/middleware/error-handler.ts`
- `apps/api/src/telegram/dedup.ts`
- `apps/api/src/telegram/capability-store.ts`
- `packages/agent-core/src/security/prompt-injection.ts`
- `packages/agent-core/src/orchestrator.ts`
- `packages/agent-core/src/trace-logger.ts`
- `packages/tools/src/shell-safety.ts`
- `packages/tools/src/shell-execute.ts`
- `packages/tools-devops-runtime/src/orchestrator/container-orchestrator.ts`
- `packages/tools-devops-runtime/src/orchestrator/network-policy.ts`
- `packages/tools-devops-runtime/src/orchestrator/output-redactor.ts`
- `packages/audit/src/index.ts`
