import { AppError } from "@helmsman/shared";

export interface ApiEnv {
  readonly port: number;
  readonly nodeEnv: "development" | "production" | "test";
  readonly telegramBotToken: string;
  readonly telegramWebhookSecret: string;
  readonly llmProvider: "openai" | "gemini" | "echo";
  readonly openAiApiKey?: string;
  readonly openAiBaseUrl?: string;
  readonly geminiApiKey?: string;
  readonly geminiBaseUrl?: string;
  readonly redisUrl?: string;
}

const getRequired = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new AppError("ENV_MISSING", `Missing required environment variable: ${name}`);
  }

  return value;
};

export const getEnv = (): ApiEnv => {
  const providerValue = process.env.LLM_PROVIDER ?? "gemini";
  if (providerValue !== "openai" && providerValue !== "gemini" && providerValue !== "echo") {
    throw new AppError("ENV_INVALID", "LLM_PROVIDER must be one of: gemini, openai, echo");
  }

  const nodeEnvValue = process.env.NODE_ENV ?? "development";
  if (nodeEnvValue !== "development" && nodeEnvValue !== "production" && nodeEnvValue !== "test") {
    throw new AppError("ENV_INVALID", "NODE_ENV must be development, production, or test");
  }

  const port = Number(process.env.PORT ?? "3000");
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new AppError("ENV_INVALID", "PORT must be a valid TCP port number");
  }

  const telegramWebhookSecret = getRequired("TELEGRAM_WEBHOOK_SECRET");
  if (telegramWebhookSecret.length < 16) {
    throw new AppError("ENV_INVALID", "TELEGRAM_WEBHOOK_SECRET must be at least 16 characters");
  }

  const env: ApiEnv = {
    port,
    nodeEnv: nodeEnvValue,
    telegramBotToken: getRequired("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret,
    llmProvider: providerValue,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: process.env.OPENAI_BASE_URL,
    geminiApiKey:
      process.env.GEMINI_API_KEY
      ?? process.env.GOOGLE_API_KEY
      ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    geminiBaseUrl: process.env.GEMINI_BASE_URL,
    redisUrl: process.env.REDIS_URL,
  };

  return env;
};
