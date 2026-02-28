import { describe, expect, it } from "bun:test";
import { ToolRegistry } from "@helmsman/tools";
import type { RiskTier, ToolExecutionResult } from "@helmsman/shared";

import { HelmsmanAgentService } from "./agent-service";

describe("HelmsmanAgentService", () => {
  it("should return llm output with correlation id", async () => {
    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: "hello from llm",
        }),
      },
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "hey",
      timestamp: new Date(),
      correlationId: "corr-1",
    });

    expect(response.correlationId).toBe("corr-1");
    expect(response.text).toBe("hello from llm");
    expect(response.status).toBe("success");
  });

  it("should return pending_approval for significant tool calls", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: "aws:ec2:Execute",
        description: "EC2 command executor",
        parameters: { action: "string", params: "object" },
        riskTier: "significant" satisfies RiskTier,
      },
      execute: async (): Promise<ToolExecutionResult> => ({
        success: true,
        output: "ok",
      }),
    });

    const service = new HelmsmanAgentService({
      llmProvider: {
        generate: async () => ({
          model: "test-model",
          text: JSON.stringify({
            type: "tool_call",
            toolName: "aws:ec2:Execute",
            parameters: { action: "TerminateInstances", params: { instanceIds: ["i-123"] } },
          }),
        }),
      },
      policyEngine: {
        evaluate: async () => ({
          action: "require_approval",
          reason: "Approval required for significant action",
        }),
      },
      auditService: {
        log: async () => undefined,
      },
      toolRegistry: registry,
    });

    const response = await service.handleMessage({
      platform: "telegram",
      chatId: "1",
      messageId: "2",
      userId: "3",
      text: "terminate the instance",
      timestamp: new Date(),
      correlationId: "corr-2",
    });

    expect(response.status).toBe("pending_approval");
    expect(response.text).toContain("Approval required");
  });
});
