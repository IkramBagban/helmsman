import type { ToolDefinition, ToolExecutionRequest, ToolExecutionResult } from "@helmsman/shared";

export interface ToolInstance {
  definition: ToolDefinition;
  execute(params: Record<string, unknown>): Promise<ToolExecutionResult>;
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

// Shell safety & executor
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
