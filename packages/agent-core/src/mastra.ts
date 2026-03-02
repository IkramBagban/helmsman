/**
 * Mastra instance — registers all agents and workflows.
 *
 * This is the central Mastra registration point. All agents and workflows
 * must be registered here to be available for use.
 *
 * The factory function creates and returns a fully configured Helmsman
 * orchestrator ready to handle messages.
 */

import { createDevOpsAgent } from "./agents/devops-agent.js";
import { createRouterAgent } from "./agents/router.js";
import { createPlannerAgent } from "./agents/planner.js";
import { createResponderAgent } from "./agents/responder.js";
import { shellExecuteTool } from "./tools/shell-execute.js";
import { createAwsKnowledgeTool } from "./tools/aws-knowledge.js";
import { createMastraGitHubTools } from "./tools/github-tools.js";
import { createMastraDevopsTools } from "./tools/devops-tools.js";
import { HelmsmanOrchestrator } from "./orchestrator.js";
import type { CapabilityStore } from "./capability-store.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HelmsmanFactoryConfig {
  /** LLM model to use. Default: "google/gemini-2.0-flash" */
  readonly model?: string;
  /** GitHub personal access token for GitHub tools */
  readonly githubToken?: string;
  /** GitHub API base URL (for enterprise) */
  readonly githubBaseUrl?: string;
  /** Whether to include DevOps runtime tools (requires Docker) */
  readonly enableDevopsTools?: boolean;
  /** Optional AWS Knowledge MCP endpoint for canonical AWS behavior lookups */
  readonly awsKnowledgeMcpUrl?: string;
  /** Optional bearer token for AWS Knowledge MCP endpoint */
  readonly awsKnowledgeMcpApiKey?: string;
  /** Optional timeout in milliseconds for AWS Knowledge MCP requests */
  readonly awsKnowledgeMcpTimeoutMs?: number;
  /** Optional capability store for activation/approval state */
  readonly capabilityStore?: CapabilityStore;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully configured Helmsman orchestrator.
 *
 * This is the main entry point for bootstrapping the agent system.
 * Returns a HelmsmanOrchestrator that can handle NormalizedMessage inputs.
 */
export async function createHelmsman(
  config?: HelmsmanFactoryConfig,
): Promise<HelmsmanOrchestrator> {
  const model = config?.model ?? "google/gemini-2.0-flash";

  // ── Assemble tools ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra tool types are covariant; safe to widen here
  const tools: Record<string, any> = {
    shell_execute: shellExecuteTool,
  };

  if (config?.awsKnowledgeMcpUrl) {
    tools.aws_knowledge_lookup = createAwsKnowledgeTool({
      endpointUrl: config.awsKnowledgeMcpUrl,
      apiKey: config?.awsKnowledgeMcpApiKey,
      timeoutMs: config?.awsKnowledgeMcpTimeoutMs,
    });
  }

  // Add GitHub tools
  if (config?.githubToken) {
    try {
      const githubTools = await createMastraGitHubTools({
        token: config.githubToken,
        baseUrl: config.githubBaseUrl,
      });
      Object.assign(tools, githubTools);
    } catch (error) {
      console.warn("[Helmsman] Failed to load GitHub tools:", error);
    }
  }

  // Add DevOps runtime tools
  if (config?.enableDevopsTools !== false) {
    try {
      const devopsTools = await createMastraDevopsTools();
      Object.assign(tools, devopsTools);
    } catch (error) {
      console.warn("[Helmsman] Failed to load DevOps runtime tools:", error);
    }
  }

  // ── Create agents ─────────────────────────────────────────────────────────
  const routerAgent = createRouterAgent({ model });
  const devopsAgent = createDevOpsAgent({ model, tools });
  const plannerAgent = createPlannerAgent({ model });
  const responderAgent = createResponderAgent({ model });

  // ── Create orchestrator ──────────────────────────────────────────────────
  return new HelmsmanOrchestrator({
    routerAgent,
    devopsAgent,
    plannerAgent,
    responderAgent,
    capabilityStore: config?.capabilityStore,
  });
}
