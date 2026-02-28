import { describe, expect, it } from "bun:test";

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
});
