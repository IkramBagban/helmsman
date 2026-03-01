import { AppError } from "@helmsman/shared";
import type { RiskTier } from "@helmsman/shared";
import type { ToolContext, ToolResponse, TypedTool } from "@helmsman/tools";
import { z } from "zod";
import type { DockerContainerOrchestrator } from "../orchestrator/container-orchestrator.js";

interface RuntimeToolOptions<TParams> {
  readonly name: string;
  readonly description: string;
  readonly riskTier: RiskTier;
  readonly paramsSchema: z.ZodType<TParams>;
  readonly execute: (params: TParams, context: ToolContext, orchestrator: DockerContainerOrchestrator) => Promise<unknown>;
}

export const createRuntimeTool = <TParams>(orchestrator: DockerContainerOrchestrator, options: RuntimeToolOptions<TParams>): TypedTool<TParams> => ({
  definition: {
    name: options.name,
    description: options.description,
    parameters: z.toJSONSchema(options.paramsSchema) as Record<string, unknown>,
    riskTier: options.riskTier,
    category: "devops",
  },
  async execute(params: TParams, context: ToolContext): Promise<ToolResponse> {
    const parsed = options.paramsSchema.safeParse(params);
    if (!parsed.success) {
      return { ok: false, error: { code: "DEVOPS.INVALID_PARAMS", message: parsed.error.message, retryable: false } };
    }

    try {
      const data = await options.execute(parsed.data, context, orchestrator);
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
          code: "DEVOPS.EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Execution failed.",
          retryable: false,
        },
      };
    }
  },
});
