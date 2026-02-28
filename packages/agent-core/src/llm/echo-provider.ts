import type { LLMGenerateParams, LLMProvider, LLMResponse } from "./provider.js";

export class EchoProvider implements LLMProvider {
  public async generate(params: LLMGenerateParams): Promise<LLMResponse> {
    const latestUserMessage = [...params.messages].reverse().find((message) => message.role === "user");
    const content = latestUserMessage?.content ?? "I did not receive a user message.";

    return {
      model: "echo-v1",
      text: `Echo: ${content}`,
    };
  }
}
