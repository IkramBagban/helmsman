/**
 * Helmsman Router — Intent classification via Mastra Agent with structured output.
 *
 * Takes user messages and classifies them into one of:
 * - chat: casual conversation (greetings, thanks, off-topic)
 * - query: information retrieval (read-only tool calls)
 * - single_action: one infrastructure action (may need approval)
 * - multi_step: complex operations requiring a plan (multiple tools, sequenced)
 *
 * This replaces the old approach where the LLM would immediately attempt tool calls
 * for every input, including "hi" and "thanks".
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Classification schema
// ---------------------------------------------------------------------------

export const IntentClassificationSchema = z.object({
  intent: z.enum(["chat", "query", "single_action", "multi_step"]).describe(
    "The type of user intent: 'chat' for casual conversation, 'query' for read-only lookups, 'single_action' for a single infrastructure action, 'multi_step' for complex operations requiring a plan",
  ),
  confidence: z.number().min(0).max(1).describe("Confidence score from 0 to 1"),
  reasoning: z.string().describe("Brief explanation of why this classification was chosen"),
});

export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

// ---------------------------------------------------------------------------
// Router instructions
// ---------------------------------------------------------------------------

const ROUTER_INSTRUCTIONS = `You are an intent classifier for a DevOps AI assistant called Helmsman.

Your job: given a user message and optional conversation history, classify the user's intent.

## Classification Rules

### chat
Greetings, thanks, compliments, off-topic questions, meta-questions about capabilities.
Examples: "hi", "thanks!", "what can you do?", "good morning", "bye"

### query
User wants to look up information. This will require tool calls but only read-only ones.
No infrastructure changes, just inspecting/describing/listing/getting.
Examples: "how many EC2 instances do I have?", "show me open PRs on the repo",
"what's my AWS bill?", "list S3 buckets", "check security groups"

### single_action
User wants ONE infrastructure operation performed. May involve a single tool call that
modifies something (create, update, delete, scale, deploy, etc.).
Examples: "tag that instance as production", "create an S3 bucket named logs-2024",
"stop the bastion instance", "scale the ASG to 3"

### multi_step
User wants a complex operation that involves multiple sequential steps, potentially
across different tools. Needs a plan before execution.
Examples: "set up a new staging environment with VPC, subnets, and security groups",
"migrate the database from t3.medium to r5.large with minimal downtime",
"audit all security groups and fix any open to 0.0.0.0/0",
"deploy the new version: pull latest, build, push to ECR, update ECS service"

## Important
- When in doubt between query and single_action, prefer query (safer).
- When in doubt between single_action and multi_step, prefer single_action.
- Short imperative commands that target one resource are single_action, not multi_step.
- Questions about state/status are always query, even if they mention specific resources.`;

// ---------------------------------------------------------------------------
// Router agent factory
// ---------------------------------------------------------------------------

export interface RouterConfig {
  /** Model identifier. Default: "google/gemini-2.0-flash" */
  readonly model?: string;
}

/**
 * Create the router agent for intent classification.
 * Uses structured output to produce a typed IntentClassification.
 */
export function createRouterAgent(config?: RouterConfig): Agent {
  const model = config?.model ?? "google/gemini-2.0-flash";

  return new Agent({
    id: "helmsman-router",
    name: "Helmsman Router",
    instructions: ROUTER_INSTRUCTIONS,
    model,
    // No tools — this agent only classifies intent
  });
}

/**
 * Classify user intent using the router agent.
 * Returns structured IntentClassification with intent type, confidence, and reasoning.
 */
export async function classifyIntent(
  routerAgent: Agent,
  userMessage: string,
  conversationContext?: string,
): Promise<IntentClassification> {
  const prompt = conversationContext
    ? `Conversation context:\n${conversationContext}\n\nLatest user message: ${userMessage}`
    : userMessage;

  const result = await routerAgent.generate(prompt, {
    structuredOutput: { schema: IntentClassificationSchema },
  });

  return result.object as IntentClassification;
}

export { ROUTER_INSTRUCTIONS };
