import type { RiskTier, ToolDefinition, ToolExecutionResult } from "@helmsman/shared";

export interface ToolCredentials {
  readonly provider: string;
  readonly [key: string]: unknown;
}

export interface ToolContext {
  readonly correlationId: string;
  readonly teamId?: string;
  readonly userId: string;
  readonly timeout: number;
  readonly credentials?: ToolCredentials;
}

export interface ToolResponse {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly durationMs?: number;
}

export interface ToolInstance {
  readonly definition: ToolDefinition;
  execute(params: Record<string, unknown>): Promise<ToolExecutionResult>;
}

export interface TypedTool<TParams> {
  readonly definition: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly riskTier: RiskTier;
    readonly category: string;
  };
  execute(params: TParams, context: ToolContext): Promise<ToolResponse>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolInstance>();

  public register(tool: ToolInstance): void {
    this.tools.set(tool.definition.name, tool);
  }

  public getTool(name: string): ToolInstance | undefined {
    return this.tools.get(name);
  }

  public getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }
}

export { ShellExecuteTool } from "./shell-execute.js";
export {
  parseCommand,
  validateCommand,
  classifyCommandRisk,
  ALLOWED_BINARIES,
  BLOCKED_PATTERNS,
  type ParsedCommand,
  type CommandValidationResult,
} from "./shell-safety.js";
