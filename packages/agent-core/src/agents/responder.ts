/**
 * Helmsman Responder Agent — response composition for final output.
 *
 * Takes raw tool output / plan results and transforms them into clear,
 * concise, human-friendly messages suitable for Telegram.
 *
 * This separates the "tool calling" concern from the "human communication"
 * concern, allowing each to be tuned independently.
 */

import { Agent } from "@mastra/core/agent";

// ---------------------------------------------------------------------------
// Responder instructions
// ---------------------------------------------------------------------------

const RESPONDER_INSTRUCTIONS = `You are Helmsman's communication layer. Your job is to transform raw tool output
into clear, concise messages for a DevOps engineer reading on Telegram.

## Rules
1. NEVER include raw JSON in your response unless the user explicitly asked for it.
2. Lead with the answer, then provide context.
3. Use bullet points for lists. Use short tables for comparison data.
4. Include the numbers that matter: counts, costs, sizes, dates.
5. Flag problems proactively: security risks, waste, misconfigurations, anomalies.
6. Keep it under 2000 characters (Telegram limit-safe).
7. End with a suggested next action when it makes sense.
8. If the tool errored, explain what went wrong in plain English and suggest a fix.
9. If there are many results, show a meaningful summary + top items, note the total.
10. NEVER mention tool names, internal systems, or implementation details.
11. NEVER start with "I'd be happy to…" or "Sure" — just report the findings.
12. Be direct and technical — your audience is an engineer, not a consumer.`;

// ---------------------------------------------------------------------------
// Responder agent factory
// ---------------------------------------------------------------------------

export interface ResponderConfig {
  /** Model identifier. Default: "google/gemini-2.0-flash" */
  readonly model?: string;
}

/**
 * Create the responder agent for human-friendly response composition.
 */
export function createResponderAgent(config?: ResponderConfig): Agent {
  const model = config?.model ?? "google/gemini-2.0-flash";

  return new Agent({
    id: "helmsman-responder",
    name: "Helmsman Responder",
    instructions: RESPONDER_INSTRUCTIONS,
    model,
    // No tools — responder only formats text output
  });
}

/**
 * Format raw tool output into a human-friendly response.
 */
export async function formatResponse(
  responderAgent: Agent,
  rawOutput: string,
  originalQuery?: string,
): Promise<string> {
  const context = originalQuery
    ? `User's original question: ${originalQuery}\n\nTool output:\n${rawOutput}`
    : `Tool output:\n${rawOutput}`;

  const result = await responderAgent.generate(context);
  return result.text;
}

export { RESPONDER_INSTRUCTIONS };
