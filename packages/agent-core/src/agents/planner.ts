/**
 * Helmsman Planner Agent — structured output plan generation.
 *
 * For multi_step intents, this agent generates a structured execution plan
 * with ordered steps, tool references, risk assessment, and estimated duration.
 *
 * The plan is presented to the user for approval before execution begins.
 * Uses Mastra's structured output to guarantee a typed PlanSchema.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Plan schema (matches @helmsman/shared PlanSummary shape)
// ---------------------------------------------------------------------------

export const PlanStepSchema = z.object({
  order: z.number().describe("Step execution order (1-based)"),
  description: z.string().describe("Human-readable description of what this step does"),
  tool: z.string().describe("The tool name to use (e.g., shell_execute, github_repo_get)"),
  command: z.string().optional().describe("The specific command or parameters for the tool"),
  risk: z.enum(["read_only", "low_risk", "significant", "destructive"]).describe("Risk tier of this step"),
  rollback: z.string().optional().describe("How to undo this step if needed"),
});

export const PlanSchema = z.object({
  summary: z.string().describe("One-line summary of the overall plan"),
  steps: z.array(PlanStepSchema).describe("Ordered list of execution steps"),
  overallRisk: z.enum(["read_only", "low_risk", "significant", "destructive"]).describe(
    "Highest risk tier across all steps",
  ),
  estimatedDuration: z.string().optional().describe("Estimated time to complete (e.g., '2-3 minutes')"),
  warnings: z.array(z.string()).optional().describe("Any warnings or caveats about this plan"),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

// ---------------------------------------------------------------------------
// Planner instructions
// ---------------------------------------------------------------------------

const PLANNER_INSTRUCTIONS = `You are Helmsman's planning engine. Your job is to convert complex DevOps requests
into structured, step-by-step execution plans.

## How you plan
1. Break the request into discrete, independently executable steps.
2. Order steps logically — reads before writes, checks before changes.
3. Assign the correct tool to each step (shell_execute for AWS CLI, github_* for GitHub, devops_* for container ops).
4. Classify each step's risk tier accurately:
   - read_only: Describe, list, get, check operations
   - low_risk: Non-destructive writes (tag, clone, create non-critical)
   - significant: Creates, updates, modifications to infrastructure
   - destructive: Deletes, terminates, force operations
5. The overall risk is the HIGHEST risk of any individual step.
6. Include rollback instructions for any significant or destructive steps.

## AWS CLI patterns
- Use --output json for machine-readable data
- Use --region explicitly
- Use --query for JMESPath filtering
- For cost: use aws ce get-cost-and-usage with literal dates
- Never use shell substitution ($() or backticks)
- Check state before modifying (describe before update/delete)

## Plan quality rules
- Each step must be atomic — one tool call, one action
- Never combine multiple operations in a single step
- Always start with a state check (read_only) before any modification
- Include a verification step after destructive operations
- Keep plans concise — 3 to 10 steps typically
- If the request is too vague, include a clarification note in warnings`;

// ---------------------------------------------------------------------------
// Planner agent factory
// ---------------------------------------------------------------------------

export interface PlannerConfig {
  /** Model identifier. Default: "google/gemini-2.0-flash" */
  readonly model?: string;
}

/**
 * Create the planner agent for multi-step plan generation.
 */
export function createPlannerAgent(config?: PlannerConfig): Agent {
  const model = config?.model ?? "google/gemini-2.0-flash";

  return new Agent({
    id: "helmsman-planner",
    name: "Helmsman Planner",
    instructions: PLANNER_INSTRUCTIONS,
    model,
    // No tools — planner only generates structured plans
  });
}

/**
 * Generate an execution plan for a complex user request.
 */
export async function generatePlan(
  plannerAgent: Agent,
  userRequest: string,
  availableTools?: string[],
): Promise<Plan> {
  const toolContext = availableTools
    ? `\n\nAvailable tools: ${availableTools.join(", ")}`
    : "";

  const result = await plannerAgent.generate(
    `Create an execution plan for the following request:\n\n${userRequest}${toolContext}`,
    { structuredOutput: { schema: PlanSchema } },
  );

  return result.object as Plan;
}
