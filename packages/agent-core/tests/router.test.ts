/**
 * Unit tests for the router agent's classifyIntent function.
 *
 * Tests that structured output is correctly requested and parsed.
 */

import { describe, expect, it, mock } from "bun:test";
import { classifyIntent, IntentClassificationSchema } from "../src/agents/router.js";

function createMockRouterAgent(intentResult: unknown): any {
  return {
    generate: mock(async (_prompt: string, options?: Record<string, unknown>) => ({
      object: intentResult,
    })),
  };
}

describe("classifyIntent", () => {
  it("should pass message to agent and return structured intent", async () => {
    const agent = createMockRouterAgent({
      intent: "query",
      confidence: 0.9,
      reasoning: "User wants to know about instances",
    });

    const result = await classifyIntent(agent, "how many EC2 instances?");

    expect(result.intent).toBe("query");
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBeDefined();

    // Verify structuredOutput was passed
    const call = agent.generate.mock.calls[0];
    expect(call?.[1]?.structuredOutput).toBeDefined();
  });

  it("should include conversation context when provided", async () => {
    const agent = createMockRouterAgent({
      intent: "single_action",
      confidence: 0.8,
      reasoning: "Follow-up action",
    });

    await classifyIntent(agent, "do it", "Previous: user asked about stopping instance");

    const prompt = agent.generate.mock.calls[0]?.[0];
    expect(prompt).toContain("Conversation context:");
    expect(prompt).toContain("Previous: user asked about stopping instance");
    expect(prompt).toContain("do it");
  });

  it("should handle all valid intent types", () => {
    const validIntents = ["chat", "query", "single_action", "multi_step"];
    for (const intent of validIntents) {
      const result = IntentClassificationSchema.safeParse({
        intent,
        confidence: 0.85,
        reasoning: "test",
      });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid intent types", () => {
    const result = IntentClassificationSchema.safeParse({
      intent: "invalid_type",
      confidence: 0.85,
      reasoning: "test",
    });
    expect(result.success).toBe(false);
  });
});
