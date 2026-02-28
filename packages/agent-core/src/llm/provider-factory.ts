import { AppError } from "@helmsman/shared";

import { EchoProvider } from "./echo-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import type { LLMProvider } from "./provider.js";

export interface LLMFactoryConfig {
  readonly provider: "openai" | "gemini" | "echo";
  readonly openAiApiKey?: string;
  readonly openAiBaseUrl?: string;
  readonly geminiApiKey?: string;
  readonly geminiBaseUrl?: string;
}

export const createLLMProvider = (config: LLMFactoryConfig): LLMProvider => {
  if (config.provider === "echo") {
    return new EchoProvider();
  }

  if (config.provider === "gemini") {
    if (!config.geminiApiKey) {
      throw new AppError("LLM_CONFIG_ERROR", "GEMINI_API_KEY (or GOOGLE_API_KEY) is required when provider is gemini.");
    }

    return new GeminiProvider({
      apiKey: config.geminiApiKey,
      baseUrl: config.geminiBaseUrl,
    });
  }

  if (!config.openAiApiKey) {
    throw new AppError("LLM_CONFIG_ERROR", "OPENAI_API_KEY is required when provider is openai.");
  }

  return new OpenAIProvider({
    apiKey: config.openAiApiKey,
    baseUrl: config.openAiBaseUrl,
  });
};
