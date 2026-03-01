import { AppError } from "@helmsman/shared";
import type { RiskTier } from "@helmsman/shared";
import type { ToolContext, ToolResponse } from "@helmsman/tools";
import { z } from "zod";
import type { GitHubTool } from "./types.js";

interface ToolFactoryOptions<TParams> {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly riskTier: RiskTier;
  readonly paramsSchema: z.ZodType<TParams>;
  readonly execute: (params: TParams, context: ToolContext) => Promise<unknown>;
}

export const createGitHubTool = <TParams>(options: ToolFactoryOptions<TParams>): GitHubTool<TParams> => ({
  definition: {
    name: options.name,
    description: options.description,
    parameters: z.toJSONSchema(options.paramsSchema) as Record<string, unknown>,
    riskTier: options.riskTier,
    category: options.category,
  },
  paramsSchema: options.paramsSchema,
  async execute(params: TParams, context: ToolContext): Promise<ToolResponse> {
    const parsed = options.paramsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "GITHUB.INVALID_PARAMS",
          message: parsed.error.message,
          retryable: false,
        },
      };
    }

    try {
      const data = await options.execute(parsed.data, context);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
          },
        };
      }

      return {
        ok: false,
        error: {
          code: "GITHUB.API_ERROR",
          message: "GitHub tool execution failed.",
          retryable: true,
        },
      };
    }
  },
});
