/**
 * Sandboxed CLI Executor — the single tool that covers all 300+ AWS services.
 *
 * Instead of writing one class per AWS API, the LLM generates a CLI command and
 * this tool executes it in a restricted subprocess with timeout, output capture,
 * and full audit trail.
 *
 * The raw CLI output goes back to the LLM, which formats it into human-readable
 * responses naturally — no formatter registry needed.
 */

import type { RiskTier, ToolDefinition, ToolExecutionResult } from "@helmsman/shared";

import type { ToolInstance } from "./index.js";
import {
  parseCommand,
  validateCommand,
  classifyCommandRisk,
  type ParsedCommand,
} from "./shell-safety.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB — prevent context explosion

// ---------------------------------------------------------------------------
// ShellExecuteTool
// ---------------------------------------------------------------------------

export class ShellExecuteTool implements ToolInstance {
  public readonly definition: ToolDefinition = {
    name: "shell.execute",
    description: `Execute a CLI command in a sandboxed environment.

Use this tool when you need to interact with cloud infrastructure or Kubernetes.
The command runs in a restricted sandbox: only allowed binaries, no shell chaining,
30-second timeout, captured output.

Supported CLIs (to be passed in the 'command' parameter):
- aws (AWS CLI — covers ALL 300+ AWS services and their operations)
- kubectl (Kubernetes cluster management)
- helm (Kubernetes package management)
- docker (inspect-only operations)
- curl (HTTP calls)
- jq (JSON processing)

Safety rules enforced automatically:
- Only allowlisted binaries can run
- No shell chaining (&&, ||, ;), no pipes to shell, no command substitution
- Destructive commands require human approval
- 30-second timeout on all commands
- Output truncated to 64 KB

When generating commands:
- Use --output json (or --output table) for AWS CLI for structured data
- Use --region to be explicit about which region
- Use --query for JMESPath filtering to reduce noise
- Prefer describe/list before modify/delete (check state first)
- For large result sets, use --max-items or --page-size

Examples:
- "aws ec2 describe-instances --region us-east-1 --output json"
- "aws s3api list-buckets --output json"
- "aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --period 300 --statistics Average --start-time 2024-01-01T00:00:00Z --end-time 2024-01-02T00:00:00Z"
- "kubectl get pods -n production -o json"
- "helm list -A"`,
    parameters: {
      command: {
        type: "string",
        description:
          "The full CLI command to execute, including all flags and arguments",
      },
    },
    riskTier: "significant" as RiskTier, // base risk; dynamically elevated per command
  };

  /**
   * Compute risk tier dynamically based on the actual command.
   * This is called by the agent service before policy evaluation.
   */
  public classifyRisk(command: string): RiskTier {
    const parsed = parseCommand(command);
    return classifyCommandRisk(parsed);
  }

  /**
   * Execute a CLI command in a subprocess.
   */
  public async execute(
    params: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const command =
      typeof params.command === "string" ? params.command : undefined;

    if (!command) {
      return {
        success: false,
        output: "",
        error: "Missing required parameter: command (string)",
      };
    }

    // 1. Parse & validate
    const parsed: ParsedCommand = parseCommand(command);
    const validation = validateCommand(parsed);

    if (!validation.valid) {
      return {
        success: false,
        output: "",
        error: `Command blocked: ${validation.reason}`,
      };
    }

    // 2. Execute in subprocess with timeout
    try {
      const result = await this.spawnCommand(parsed, DEFAULT_TIMEOUT_MS);
      return result;
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Spawn the command as a subprocess with timeout and output capture.
   */
  private async spawnCommand(
    cmd: ParsedCommand,
    timeoutMs: number,
  ): Promise<ToolExecutionResult> {
    // Use Bun.spawn for subprocess execution
    const proc = Bun.spawn([cmd.binary, ...cmd.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Force non-interactive mode for AWS CLI
        AWS_PAGER: "",
      },
    });

    // Race between completion and timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Allow the process to keep the timer from blocking node exit
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    });

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      const stdoutRaw = await new Response(proc.stdout).text();
      const stderrRaw = await new Response(proc.stderr).text();

      const stdout = truncateOutput(stdoutRaw);
      const stderr = truncateOutput(stderrRaw);

      if (exitCode !== 0) {
        return {
          success: false,
          output: stdout,
          error: stderr || `Process exited with code ${exitCode}`,
        };
      }

      return {
        success: true,
        output: stdout || "(no output)",
      };
    } catch (error) {
      // Ensure process is killed on timeout
      try {
        proc.kill();
      } catch {
        // process may already be dead
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_BYTES) {
    return text;
  }

  return `${text.slice(0, MAX_OUTPUT_BYTES)}\n\n...(output truncated at ${MAX_OUTPUT_BYTES} bytes)`;
}
