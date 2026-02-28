# Feature: Tool System

> **Package:** `packages/tools`
> **Wave:** 1 (no internal dependencies except `@helmsman/shared`)
> **Estimated effort:** 2-3 days

---

## Purpose

Define the universal tool interface that all Helmsman tools implement. Provide a tool registry that the agent-core uses to discover, describe, and invoke tools. This is the abstraction layer between the LLM and external services (AWS, GitHub, Kubernetes, etc.).

**Architecture context:** Helmsman uses a hybrid tool architecture (see `docs/AGENT_DESIGN.md`):
- **Layer 1 — Curated Tools:** Type-safe, Zod-validated tools for high-frequency operations (~15 tools cover 80% of tasks)
- **Layer 2 — Sandboxed CLI Executor:** A special `shell.execute` tool that lets the LLM run CLI commands (aws, kubectl, helm) in a sandbox for the long tail of operations
- **Layer 3 — Knowledge:** System prompts + RAG (no tool execution needed)

This package implements the registry, interfaces, and the `shell.execute` built-in tool.

---

## Requirements

### Must Have
- [ ] `ToolInterface` — base interface every tool class implements
- [ ] `ToolRegistry` — register, discover, and invoke tools by name
- [ ] `ToolRequest` / `ToolResponse` — standardized input/output schemas
- [ ] Tool definitions exportable as LLM function-calling schemas (provider-agnostic format)
- [ ] Error handling: tools return structured errors, never throw unhandled
- [ ] Timeout support: every tool call has a configurable timeout
- [ ] Tool metadata: name, description, parameters schema, risk tier

### Nice to Have
- [ ] Tool input validation via Zod before execution
- [ ] Tool execution timing (duration tracking)
- [ ] Tool dry-run mode (validate params without executing)
- [ ] Tool categories for UI grouping

### Out of Scope
- Cloud-specific tool implementations (those go in `packages/tools-aws`, etc.)
- Docker-based execution containers (Phase 3)
- Dynamic tool loading from external plugins
- MCP (Model Context Protocol) server compatibility (Phase 3)

---

## Contracts

### ToolInterface (Every Tool Implements This)

```typescript
import { z } from "zod";

export interface ToolDefinition {
  /** Unique tool identifier: "aws.ec2.describeInstances" */
  name: string;

  /** Human-readable description for the LLM */
  description: string;

  /** Zod schema for parameters the tool accepts */
  parametersSchema: z.ZodType;

  /** Default risk tier for this tool */
  riskTier: "read_only" | "low_risk" | "significant" | "destructive";

  /** Tool category for grouping */
  category: string;
}

export interface Tool {
  /** Tool metadata */
  definition: ToolDefinition;

  /** Execute the tool with validated parameters */
  execute(params: unknown, context: ToolContext): Promise<ToolResponse>;
}

export interface ToolContext {
  correlationId: string;
  teamId: string;
  userId: string;
  credentials: ToolCredentials; // resolved credentials for this tool's provider
  timeout: number;              // max execution time in ms
}

export interface ToolCredentials {
  provider: "aws" | "gcp" | "github" | "kubernetes";
  [key: string]: unknown; // provider-specific credentials
}
```

### ToolRequest (Agent-Core → Tool)

```typescript
export const ToolRequestSchema = z.object({
  tool: z.string(),                    // "aws.ec2.describeInstances"
  params: z.record(z.unknown()),       // tool-specific params
  correlationId: z.string().uuid(),
  timeout: z.number().positive().default(30_000),
});

export type ToolRequest = z.infer<typeof ToolRequestSchema>;
```

### ToolResponse (Tool → Agent-Core)

```typescript
export const ToolResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),         // tool-specific result
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().default(false),
  }).optional(),
  durationMs: z.number().optional(),
});

export type ToolResponse = z.infer<typeof ToolResponseSchema>;
```

---

## ToolRegistry Design

```typescript
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool */
  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new AppError(
        "TOOLS.REGISTRY.DUPLICATE",
        `Tool ${tool.definition.name} is already registered`,
      );
    }
    this.tools.set(tool.definition.name, tool);
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** List all registered tool definitions */
  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /** Export tool definitions as LLM function-calling schemas */
  toLLMTools(): LLMToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.definition.name,
      description: tool.definition.description,
      parameters: zodToJsonSchema(tool.definition.parametersSchema),
    }));
  }

  /** Invoke a tool by name with request */
  async invoke(request: ToolRequest, context: ToolContext): Promise<ToolResponse> {
    const tool = this.tools.get(request.tool);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: "TOOLS.NOT_FOUND",
          message: `Tool ${request.tool} is not registered`,
          retryable: false,
        },
      };
    }

    // Validate params
    const parsed = tool.definition.parametersSchema.safeParse(request.params);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "TOOLS.INVALID_PARAMS",
          message: `Invalid parameters: ${parsed.error.message}`,
          retryable: false,
        },
      };
    }

    // Execute with timeout
    const start = performance.now();
    try {
      const result = await withTimeout(
        tool.execute(parsed.data, context),
        context.timeout,
        request.tool,
      );
      return { ...result, durationMs: Math.round(performance.now() - start) };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "TOOLS.EXECUTION_ERROR",
          message: err instanceof Error ? err.message : "Unknown error",
          retryable: true,
        },
        durationMs: Math.round(performance.now() - start),
      };
    }
  }
}
```

---

## Sandboxed CLI Executor — `shell.execute`

A special built-in tool that lets the LLM run CLI commands for operations not covered by curated tools. This is **Layer 2** of the hybrid architecture.

```typescript
import type { Tool, ToolContext, ToolResponse, ToolDefinition } from "./types";
import { z } from "zod";

const shellParamsSchema = z.object({
  command: z.string().describe("The CLI command to execute (e.g., 'aws s3api list-objects --bucket my-bucket')"),
  timeout: z.number().max(30_000).default(15_000).describe("Max execution time in ms"),
});

export class ShellExecuteTool implements Tool {
  definition: ToolDefinition = {
    name: "shell.execute",
    description: `Execute a CLI command in a sandboxed environment.

Use this tool when no built-in tool covers the operation. Supported CLIs:
- aws (AWS CLI for any AWS service)
- kubectl (Kubernetes cluster management)
- helm (Kubernetes package management)
- docker (inspect-only operations)
- jq (JSON processing)

Safety rules:
- Read-only commands are preferred. Write commands require approval.
- Never use rm -rf, pipe to shell, or command substitution.
- Always check state before modifying resources.

Examples:
- List Lambda functions: "aws lambda list-functions --region us-east-1"
- Get pod logs: "kubectl logs deployment/api-server -n production --tail=100"
- Check Helm releases: "helm list -A"`,
    parametersSchema: shellParamsSchema,
    riskTier: "significant", // shell commands are always at least significant
    category: "system",
  };

  async execute(params: z.infer<typeof shellParamsSchema>, context: ToolContext): Promise<ToolResponse> {
    // 1. Parse and validate the command
    const binary = params.command.trim().split(/\s+/)[0];
    if (!ALLOWED_BINARIES.includes(binary!)) {
      return { ok: false, error: { code: "SHELL.BLOCKED_BINARY", message: `Binary '${binary}' is not in the allowlist`, retryable: false } };
    }

    // 2. Check for blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(params.command)) {
        return { ok: false, error: { code: "SHELL.BLOCKED_PATTERN", message: "Command contains a blocked pattern for safety", retryable: false } };
      }
    }

    // 3. Classify risk dynamically
    const dynamicRisk = classifyShellRisk(params.command);

    // 4. Execute in subprocess with timeout
    // Implementation: Bun.spawn() with timeout, captured stdout/stderr
    // ... actual execution handled by runtime

    return { ok: true, data: { stdout: "", stderr: "", exitCode: 0, riskTier: dynamicRisk } };
  }
}

const ALLOWED_BINARIES = ["aws", "kubectl", "helm", "docker", "curl", "jq"];

const BLOCKED_PATTERNS = [
  /rm\s+-rf/,                    // recursive delete
  />\s*\/dev/,                   // write to device
  /\|\s*sh/,                     // pipe to shell
  /\$\(/,                        // command substitution
  /`/,                           // backtick execution
  /;\s*(rm|mv|cp|chmod|chown)/,  // chained destructive ops
  /--force-delete/,              // force delete flags
];

function classifyShellRisk(command: string): string {
  if (/delete|remove|destroy|terminate|purge/.test(command)) return "destructive";
  if (/create|update|modify|put|apply|deploy|stop|start/.test(command)) return "significant";
  if (/describe|list|get|show|log|status/.test(command)) return "low_risk";
  return "significant";
}
```

---

## File Structure

```
packages/tools/
  package.json
  tsconfig.json
  README.md
  src/
    index.ts                     # Public API: ToolRegistry, ToolInterface, types
    types.ts                     # ToolDefinition, Tool, ToolRequest, ToolResponse, etc.
    registry.ts                  # ToolRegistry class
    registry.test.ts
    timeout.ts                   # withTimeout utility
    timeout.test.ts
    shell-execute.ts             # ShellExecuteTool — sandboxed CLI executor
    shell-execute.test.ts
    shell-safety.ts              # Allowlists, blocked patterns, risk classification
    shell-safety.test.ts
    llm-tool-adapter.ts             # Convert ToolDefinitions to LLM function-calling format
    llm-tool-adapter.test.ts
```

---

## How Tool Implementors Use This

Example: implementing an AWS EC2 tool

```typescript
// packages/tools-aws/src/ec2/describe-instances.ts
import type { Tool, ToolContext, ToolResponse, ToolDefinition } from "@helmsman/tools";
import { z } from "zod";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";

const paramsSchema = z.object({
  region: z.string().default("us-east-1"),
  filters: z.array(z.object({
    name: z.string(),
    values: z.array(z.string()),
  })).optional(),
  instanceIds: z.array(z.string()).optional(),
});

export class DescribeInstancesTool implements Tool {
  definition: ToolDefinition = {
    name: "aws.ec2.describeInstances",
    description: "List and describe EC2 instances with optional filters by region, state, type, or tag",
    parametersSchema: paramsSchema,
    riskTier: "read_only",
    category: "aws.ec2",
  };

  async execute(params: z.infer<typeof paramsSchema>, context: ToolContext): Promise<ToolResponse> {
    const client = new EC2Client({
      region: params.region,
      credentials: {
        accessKeyId: context.credentials.accessKeyId as string,
        secretAccessKey: context.credentials.secretAccessKey as string,
      },
    });

    const response = await client.send(new DescribeInstancesCommand({
      InstanceIds: params.instanceIds,
      Filters: params.filters?.map(f => ({ Name: f.name, Values: f.values })),
    }));

    const instances = response.Reservations?.flatMap(r => r.Instances ?? []) ?? [];

    return {
      ok: true,
      data: instances.map(i => ({
        instanceId: i.InstanceId,
        state: i.State?.Name,
        type: i.InstanceType,
        publicIp: i.PublicIpAddress,
        privateIp: i.PrivateIpAddress,
        launchTime: i.LaunchTime?.toISOString(),
        tags: Object.fromEntries((i.Tags ?? []).map(t => [t.Key, t.Value])),
      })),
    };
  }
}
```

---

## Testing Plan

### Unit Tests
| Test | What |
|------|------|
| `registry.test.ts` | Register a tool → retrievable by name |
| `registry.test.ts` | Duplicate registration throws error |
| `registry.test.ts` | `listDefinitions()` returns all tool metadata |
| `registry.test.ts` | `invoke()` with invalid tool name → error response |
| `registry.test.ts` | `invoke()` with invalid params → validation error |
| `registry.test.ts` | `invoke()` with valid params → calls tool.execute() |
| `timeout.test.ts` | Fast promise resolves normally |
| `timeout.test.ts` | Slow promise rejects with timeout error |
| `llm-tool-adapter.test.ts` | Converts definitions to LLM function-calling JSON Schema format |

---

## Acceptance Criteria

1. Register 3+ tools → `listDefinitions()` returns all 3 with complete metadata
2. Invoke a registered tool with valid params → returns `{ ok: true, data: ... }`
3. Invoke with invalid params → returns `{ ok: false, error: { code: "TOOLS.INVALID_PARAMS" } }`
4. Invoke with unknown tool name → returns `{ ok: false, error: { code: "TOOLS.NOT_FOUND" } }`
5. Tool exceeds timeout → returns `{ ok: false, error: { code: "TIMEOUT" } }`
6. Tool throws → returns `{ ok: false, error: { code: "TOOLS.EXECUTION_ERROR" } }`
7. `toLLMTools()` produces valid LLM function-calling schemas (JSON Schema format)
8. All responses include `durationMs`
9. `shell.execute` rejects commands with blocked binaries → `SHELL.BLOCKED_BINARY`
10. `shell.execute` rejects commands with blocked patterns → `SHELL.BLOCKED_PATTERN`
11. `shell.execute` classifies risk dynamically (read commands = low_risk, write = significant, delete = destructive)
12. `shell.execute` is pre-registered in the registry as a built-in tool
