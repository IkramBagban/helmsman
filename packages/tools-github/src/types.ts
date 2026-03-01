import type { ToolCredentials, ToolContext, ToolResponse, TypedTool } from "@helmsman/tools";
import type { z } from "zod";

export interface GitHubCredentials extends ToolCredentials {
  readonly provider: "github";
  readonly token?: string;
}

export interface GitHubTool<TParams> extends TypedTool<TParams> {
  readonly paramsSchema: z.ZodType<TParams>;
}

export interface GitHubExecutionContext extends ToolContext {
  readonly credentials?: GitHubCredentials;
}

export interface GitHubToolResult extends ToolResponse {}
