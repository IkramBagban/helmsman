import type { LLMGenerateParams, LLMProvider, LLMResponse } from "./provider.js";

interface OpenAIResponse {
  readonly choices: readonly {
    readonly message?: {
      readonly content?: string;
    };
  }[];
}

export class OpenAIProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  public async generate(params: LLMGenerateParams): Promise<LLMResponse> {
    const model = params.model ?? "gpt-4o-mini";
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: params.temperature ?? 0.2,
        messages: [
          { role: "system", content: params.systemPrompt },
          ...params.messages.map((message: { readonly role: "system" | "user" | "assistant"; readonly content: string }) => ({ role: message.role, content: message.content })),
        ],
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${responseBody}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const text = data.choices[0]?.message?.content?.trim();

    if (!text) {
      throw new Error("OpenAI returned an empty response.");
    }

    return {
      text,
      model,
    };
  }
}
