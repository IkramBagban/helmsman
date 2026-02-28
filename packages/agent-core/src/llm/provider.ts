export interface LLMMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface LLMGenerateParams {
  readonly systemPrompt: string;
  readonly messages: readonly LLMMessage[];
  readonly model?: string;
  readonly temperature?: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly model: string;
}

export interface LLMProvider {
  generate(params: LLMGenerateParams): Promise<LLMResponse>;
}
