/**
 * Mastra tool wrappers for @helmsman/tools-github TypedTools.
 *
 * Bridges all 17 GitHub tools from the existing package into Mastra-compatible
 * createTool() wrappers for native function calling.
 *
 * The adapter reads each tool's name, description, Zod params schema, and execute
 * function, wrapping them into Mastra tools.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import type { ToolContext, TypedTool, ToolResponse } from "@helmsman/tools";
import { logTrace, redactForLog, previewText } from "../trace-logger.js";

/**
 * Given a TypedTool from @helmsman/tools-github, produce a Mastra createTool-compatible tool.
 *
 * The inputSchema is a flat z.object matching the tool's parameter keys.
 * The execute fn delegates to the original tool's execute.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Return any to avoid Mastra Tool contravariance issues
function wrapTypedTool<TParams>(
  tool: TypedTool<TParams>,
): any {
  // Detect if parameters is a JSON Schema object (has 'type' or 'properties')
  // or a flat mapping of parameter names to specs.
  const rawParams = tool.definition.parameters as Record<string, any>;
  const isJsonSchema = rawParams.type === 'object' && rawParams.properties;
  
  const parameters = isJsonSchema 
    ? (rawParams.properties as Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>)
    : (rawParams as Record<string, { type?: string; description?: string; enum?: string[]; default?: unknown }>);

  const paramEntries = Object.entries(parameters);

  const zodShape: Record<string, z.ZodType> = {};
  for (const [key, spec] of paramEntries) {
    let field: z.ZodType;

    switch (spec.type) {
      case "number":
      case "integer":
        field = z.number().describe(spec.description ?? key);
        break;
      case "boolean":
        field = z.boolean().describe(spec.description ?? key);
        break;
      case "array":
        field = z.array(z.string()).describe(spec.description ?? key);
        break;
      default:
        // string is the default
        if (spec.enum) {
          field = z.enum(spec.enum as [string, ...string[]]).describe(spec.description ?? key);
        } else {
          field = z.string().describe(spec.description ?? key);
        }
        break;
    }

    // If the field has a default value, make it optional
    if (spec.default !== undefined) {
      field = field.optional();
    }

    zodShape[key] = field;
  }

  const inputSchema = z.object(zodShape);

  // Sanitize tool name: Mastra id uses underscores, not dots
  const toolId = tool.definition.name.replace(/\./g, "_");

  return createTool({
    id: toolId,
    description: tool.definition.description,
    inputSchema,
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (inputData) => {
      const context: ToolContext = {
        correlationId: randomUUID(),
        userId: "mastra-agent",
        timeout: 60_000,
      };

      const startedAt = Date.now();
      logTrace("tool.typed.started", {
        toolName: tool.definition.name,
        toolId,
        correlationId: context.correlationId,
        params: redactForLog(inputData),
      });

      const result: ToolResponse = await tool.execute(inputData as TParams, context);

      logTrace("tool.typed.completed", {
        toolName: tool.definition.name,
        toolId,
        correlationId: context.correlationId,
        ok: result.ok,
        durationMs: Date.now() - startedAt,
        dataPreview: previewText(typeof result.data === "string" ? result.data : JSON.stringify(redactForLog(result.data))),
        error: result.error,
      }, result.ok ? "info" : "warn");

      if (result.ok) {
        return {
          ok: true,
          data: result.data,
        };
      }

      return {
        ok: false,
        error: result.error
          ? `${result.error.code}: ${result.error.message}`
          : "Tool execution failed",
      };
    },
  });
}

/**
 * Options for creating Mastra-wrapped GitHub tools.
 */
export interface GitHubToolsOptions {
  readonly token?: string;
  readonly baseUrl?: string;
}

/**
 * Create all GitHub tools wrapped for Mastra.
 * Returns a record keyed by sanitized tool name (underscores instead of dots).
 */
export async function createMastraGitHubTools(
  options: GitHubToolsOptions,
): Promise<Record<string, ReturnType<typeof createTool>>> {
  // Dynamic import to avoid hard failure when package is missing
  const { createGitHubTools } = await import("@helmsman/tools-github");

  const typedTools = createGitHubTools({
    token: options.token,
    baseUrl: options.baseUrl,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- widened to avoid Mastra tool type contravariance
  const tools: Record<string, any> = {};

  for (const tool of typedTools) {
    const wrapped = wrapTypedTool(tool);
    // Use the tool id (e.g. "github_search_repos") as the record key
    const key = tool.definition.name.replace(/\./g, "_");
    tools[key] = wrapped;
  }

  return tools;
}

export { wrapTypedTool };
