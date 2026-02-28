import type { AgentResponse, NormalizedMessage } from "@helmsman/shared";

import type { LLMProvider } from "../llm/provider.js";

export interface AgentService {
  handleMessage(message: NormalizedMessage): Promise<AgentResponse>;
}

export class HelmsmanAgentService implements AgentService {
  private readonly llmProvider: LLMProvider;

  public constructor(config: { llmProvider: LLMProvider }) {
    this.llmProvider = config.llmProvider;
  }

  public async handleMessage(message: NormalizedMessage): Promise<AgentResponse> {
    const llmResult = await this.llmProvider.generate({
      systemPrompt:
        "You are Helmsman, a helpful DevOps assistant. Keep responses concise, safe, and actionable.",
      messages: [{ role: "user", content: message.text }],
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: llmResult.text,
      metadata: {
        model: llmResult.model,
      },
    };
  }
}
