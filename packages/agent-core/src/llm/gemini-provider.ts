import type { LLMGenerateParams, LLMProvider, LLMResponse } from "./provider.js";

interface GeminiGenerateContentResponse {
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly {
        readonly text?: string;
      }[];
    };
  }[];
}

export class GeminiProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  public async generate(params: LLMGenerateParams): Promise<LLMResponse> {
    const model = params.model ?? "gemini-2.0-flash";
    const response = await fetch(`${this.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        generationConfig: {
          temperature: params.temperature ?? 0.2,
        },
        contents: params.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      }),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Gemini request failed: ${response.status} ${responseBody}`);
    }

    const data = (await response.json()) as GeminiGenerateContentResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    return {
      text,
      model,
    };
  }
}
