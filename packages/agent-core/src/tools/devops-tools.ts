/**
 * Mastra tool wrappers for @helmsman/tools-devops-runtime TypedTools.
 *
 * Bridges all 12 DevOps runtime tools (git, ssh, shell) from the existing package
 * into Mastra-compatible createTool() wrappers for native function calling.
 */

import { wrapTypedTool } from "./github-tools.js";

/**
 * Options for creating Mastra-wrapped DevOps runtime tools.
 */
export interface DevopsToolsOptions {
  readonly docker?: unknown;
  readonly auditService?: unknown;
  readonly image?: string;
}

/**
 * Create all DevOps runtime tools wrapped for Mastra.
 * Returns a record keyed by sanitized tool name (underscores instead of dots).
 */
export async function createMastraDevopsTools(
  options?: DevopsToolsOptions,
): Promise<Record<string, any>> {
  // Dynamic import to avoid hard failure when package is missing
  const { createDevopsRuntimeTools } = await import("@helmsman/tools-devops-runtime");

  const typedTools = createDevopsRuntimeTools(options as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widened to avoid Mastra tool type contravariance
  const tools: Record<string, any> = {};

  for (const tool of typedTools) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool union type needs widening
    const wrapped = wrapTypedTool(tool as any);
    const key = tool.definition.name.replace(/\./g, "_");
    tools[key] = wrapped;
  }

  return tools;
}
