/**
 * Unit tests for the HelmsmanOrchestrator.
 *
 * All agents are mocked — these tests verify orchestration logic
 * (intent routing, approval flow, response formatting) without LLM calls.
 */

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { HelmsmanOrchestrator, getPendingApproval } from "../src/orchestrator.js";
import type { NormalizedMessage } from "@helmsman/shared";

// ---------------------------------------------------------------------------
// Mock agent factory — creates a fake Agent whose generate() returns
// canned values.
// ---------------------------------------------------------------------------

function createMockAgent(
  generateFn: (prompt: string, options?: Record<string, unknown>) => unknown,
): any {
  return {
    generate: mock(async (prompt: string, options?: Record<string, unknown>) => {
      return generateFn(prompt, options);
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseMessage: NormalizedMessage = {
  correlationId: "test-corr-1",
  userId: "user-42",
  chatId: "chat-42",
  text: "hello",
  platform: "telegram",
  timestamp: new Date().toISOString(),
  messageId: "msg-1",
  userName: "Test User",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HelmsmanOrchestrator", () => {
  let routerAgent: any;
  let devopsAgent: any;
  let plannerAgent: any;
  let responderAgent: any;
  let orchestrator: HelmsmanOrchestrator;

  beforeEach(() => {
    // Default: router classifies as "chat" intent
    routerAgent = createMockAgent(() => ({
      object: {
        intent: "chat",
        confidence: 0.95,
        reasoning: "Casual greeting",
      },
    }));

    devopsAgent = createMockAgent(() => ({
      text: "Hey there! How can I help with your infrastructure today?",
      toolResults: [],
    }));

    plannerAgent = createMockAgent(() => ({
      object: {
        summary: "Test plan",
        steps: [{ order: 1, description: "Check state", tool: "shell_execute", risk: "read_only" }],
        overallRisk: "read_only",
      },
    }));

    responderAgent = createMockAgent((_prompt: string) => ({
      text: "Formatted response",
    }));

    orchestrator = new HelmsmanOrchestrator({
      routerAgent,
      devopsAgent,
      plannerAgent,
      responderAgent,
    });
  });

  describe("handleMessage", () => {
    it("should route chat intents to devops agent without tools", async () => {
      const response = await orchestrator.handleMessage(baseMessage);

      expect(response.status).toBe("success");
      expect(response.text).toContain("Hey there");
      expect(response.correlationId).toBe("test-corr-1");

      // Router should have been called once
      expect(routerAgent.generate).toHaveBeenCalledTimes(1);
      // DevOps agent called for the chat response
      expect(devopsAgent.generate).toHaveBeenCalledTimes(1);
    });

    it("should route query intents with maxSteps", async () => {
      routerAgent = createMockAgent(() => ({
        object: {
          intent: "query",
          confidence: 0.9,
          reasoning: "User is asking about state",
        },
      }));

      devopsAgent = createMockAgent((_prompt: string, options?: Record<string, unknown>) => ({
        text: "You have 3 EC2 instances running.",
        toolResults: [{ toolName: "shell_execute", result: { success: true } }],
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage({
        ...baseMessage,
        text: "how many EC2 instances do I have?",
      });

      expect(response.status).toBe("success");
      expect(response.text).toContain("3 EC2 instances");
      // DevOps agent should have been called with maxSteps
      const generateCall = devopsAgent.generate.mock.calls[0];
      expect(generateCall?.[1]?.maxSteps).toBe(8);
    });

    it("should route multi_step intents through planner", async () => {
      routerAgent = createMockAgent(() => ({
        object: {
          intent: "multi_step",
          confidence: 0.85,
          reasoning: "Complex multi-step operation",
        },
      }));

      plannerAgent = createMockAgent(() => ({
        object: {
          summary: "Deploy new staging environment",
          steps: [
            { order: 1, description: "Create VPC", tool: "shell_execute", risk: "significant" },
            { order: 2, description: "Create subnets", tool: "shell_execute", risk: "significant" },
          ],
          overallRisk: "significant",
          estimatedDuration: "5-10 minutes",
        },
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage({
        ...baseMessage,
        text: "set up a new staging environment",
      });

      // Significant plan should require approval
      expect(response.status).toBe("pending_approval");
      expect(response.text).toContain("/approve");
      expect(response.text).toContain("Deploy new staging environment");
    });

    it("should execute low-risk multi_step plans immediately", async () => {
      routerAgent = createMockAgent(() => ({
        object: {
          intent: "multi_step",
          confidence: 0.85,
          reasoning: "Multi-step read operation",
        },
      }));

      plannerAgent = createMockAgent(() => ({
        object: {
          summary: "Audit S3 buckets",
          steps: [
            { order: 1, description: "List all buckets", tool: "shell_execute", risk: "read_only" },
            { order: 2, description: "Check public access", tool: "shell_execute", risk: "read_only" },
          ],
          overallRisk: "read_only",
        },
      }));

      devopsAgent = createMockAgent(() => ({
        text: "Found 5 S3 buckets. All have public access blocked.",
        toolResults: [],
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage({
        ...baseMessage,
        text: "audit all my S3 buckets",
      });

      // Low risk should execute immediately
      expect(response.status).toBe("success");
      expect(response.text).toContain("5 S3 buckets");
    });

    it("should handle orchestrator errors gracefully", async () => {
      routerAgent = createMockAgent(() => {
        throw new Error("LLM API failure");
      });

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage(baseMessage);

      expect(response.status).toBe("error");
      expect(response.text).toContain("went wrong");
    });

    it("should default unknown intents to query handler", async () => {
      routerAgent = createMockAgent(() => ({
        object: {
          intent: "unknown_future_intent",
          confidence: 0.5,
          reasoning: "Not sure",
        },
      }));

      devopsAgent = createMockAgent(() => ({
        text: "Query result",
        toolResults: [],
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage({
        ...baseMessage,
        text: "some ambiguous request",
      });

      expect(response.status).toBe("success");
    });
  });

  describe("handleApproval", () => {
    it("should reject non-existent approval IDs", async () => {
      const response = await orchestrator.handleApproval("nonexistent-id", "user-42", "chat-42");

      expect(response.status).toBe("error");
      expect(response.text).toContain("not found");
    });

    it("should reject approvals from wrong user", async () => {
      // First, create a pending approval via a multi_step flow
      routerAgent = createMockAgent(() => ({
        object: { intent: "multi_step", confidence: 0.9, reasoning: "Multi-step" },
      }));

      plannerAgent = createMockAgent(() => ({
        object: {
          summary: "Scale ASG",
          steps: [{ order: 1, description: "Scale", tool: "shell_execute", command: "aws autoscaling update-auto-scaling-group", risk: "significant" }],
          overallRisk: "significant",
        },
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const planResponse = await orchestrator.handleMessage({
        ...baseMessage,
        text: "scale the ASG to 5",
      });

      expect(planResponse.status).toBe("pending_approval");
      const approvalId = planResponse.text.match(/\/approve\s+(\S+)/)?.[1];
      expect(approvalId).toBeDefined();

      // Wrong user attempt
      const wrongUserResponse = await orchestrator.handleApproval(
        approvalId!,
        "wrong-user-99",
        "chat-42",
      );

      expect(wrongUserResponse.status).toBe("error");
      expect(wrongUserResponse.text).toContain("doesn't belong");
    });
  });

  describe("truncation", () => {
    it("should truncate long responses for Telegram", async () => {
      const longText = "A".repeat(5000);
      devopsAgent = createMockAgent(() => ({
        text: longText,
        toolResults: [],
      }));

      orchestrator = new HelmsmanOrchestrator({
        routerAgent,
        devopsAgent,
        plannerAgent,
        responderAgent,
      });

      const response = await orchestrator.handleMessage(baseMessage);

      expect(response.text.length).toBeLessThanOrEqual(3020); // 3000 + truncation notice
      expect(response.text).toContain("…(truncated)");
    });
  });
});
