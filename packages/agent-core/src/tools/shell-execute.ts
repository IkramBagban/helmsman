/**
 * Mastra tool wrapper for the ShellExecuteTool.
 *
 * Bridges the existing @helmsman/tools ShellExecuteTool into a Mastra-compatible
 * createTool() wrapper so Gemini can call it via native function calling.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { ShellExecuteTool, classifyCommandRisk } from "@helmsman/tools";
import { logTrace, previewText } from "../trace-logger.js";

const shellTool = new ShellExecuteTool();

export const shellExecuteTool = createTool({
  id: "shell_execute",
  description: `Execute a CLI command in a sandboxed environment.

Use this tool when you need to interact with cloud infrastructure or Kubernetes.
The command runs in a restricted sandbox: only allowed binaries, no shell chaining,
30-second timeout, captured output.

Supported CLIs:
- aws (AWS CLI — covers ALL 300+ AWS services and their operations)
- kubectl (Kubernetes cluster management)
- helm (Kubernetes package management)
- docker (inspect-only operations)
- curl (HTTP calls)

Safety rules enforced automatically:
- Only allowlisted binaries can run
- No shell chaining (&&, ||, ;), no pipes to shell, no command substitution
- Destructive commands require human approval
- 30-second timeout on all commands
- Output truncated to 64 KB

When generating commands:
- NEVER use pipes (e.g. '| jq'), shell substitution (\$() or backticks), or chaining. Commands are passed directly to exec, not a shell.
- For AWS CLI, you MUST use '--query' for filtering instead of piping to jq.
- Use --output json (or --output table) for AWS CLI for structured data
- Use --region to be explicit about which region
- Prefer describe/list before modify/delete (check state first)
- For large result sets, use --max-items or --page-size

Examples:
- "aws ec2 describe-instances --region us-east-1 --output json"
- "aws s3api list-buckets --output json"
- "kubectl get pods -n production -o json"
- "helm list -A"`,
  inputSchema: z.object({
    command: z
      .string()
      .describe("The full CLI command to execute, including all flags and arguments"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    output: z.string(),
    error: z.string().optional(),
    riskTier: z.string().optional(),
  }),
  execute: async (inputData) => {
    const { command } = inputData;
    const startedAt = Date.now();

    const riskTier = classifyCommandRisk({ binary: command.split(" ")[0] ?? "", raw: command, args: command.split(" ").slice(1) });
    logTrace("tool.shell_execute.started", {
      command,
      riskTier,
    }, riskTier === "destructive" || riskTier === "significant" ? "warn" : "info");

    const result = await shellTool.execute({ command });

    logTrace("tool.shell_execute.completed", {
      command,
      riskTier,
      success: result.success,
      durationMs: Date.now() - startedAt,
      outputPreview: previewText(result.output),
      error: result.error,
    }, result.success ? "info" : "warn");

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      riskTier,
    };
  },
});

/**
 * Classify risk for a command string. Used by the approval workflow
 * to decide whether to suspend for human approval.
 */
export const classifyShellCommandRisk = (command: string): string => {
  return classifyCommandRisk({
    binary: command.split(" ")[0] ?? "",
    raw: command,
    args: command.split(" ").slice(1),
  });
};
