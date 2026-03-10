import { AppError } from "@helmsman/shared";

export interface ApiEnv {
  readonly port: number;
  readonly nodeEnv: "development" | "production" | "test";
  readonly telegramBotToken: string;
  readonly telegramWebhookSecret: string;
  readonly llmProvider: "openai" | "gemini" | "echo" | "anthropic";
  readonly openAiApiKey?: string;
  readonly openAiBaseUrl?: string;
  readonly geminiApiKey?: string;
  readonly geminiBaseUrl?: string;
  readonly anthropicApiKey?: string;
  readonly redisUrl?: string;
  readonly awsKnowledgeMcpUrl?: string;
  readonly awsKnowledgeMcpApiKey?: string;
  readonly awsKnowledgeMcpTimeoutMs?: number;
  readonly scheduleDataDir: string;
  readonly dnsProvider?: "namecheap" | "cloudflare";
  readonly namecheapApiUser?: string;
  readonly namecheapApiKey?: string;
  readonly namecheapUsername?: string;
  readonly namecheapClientIp?: string;
  readonly namecheapApiBaseUrl?: string;
  readonly cloudflareApiToken?: string;
  readonly cloudflareZoneMap?: Record<string, string>;
  readonly cloudflareApiBaseUrl?: string;
}

const getRequired = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new AppError(
      "ENV_MISSING",
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
};

const parseCloudflareZoneMap = (): Record<string, string> | undefined => {
  const raw = process.env.CLOUDFLARE_ZONE_MAP;
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(
      "ENV_INVALID",
      "CLOUDFLARE_ZONE_MAP must be valid JSON (object mapping domain to zone ID).",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(
      "ENV_INVALID",
      "CLOUDFLARE_ZONE_MAP must be a JSON object mapping domain to zone ID.",
    );
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [domain, zoneId] of entries) {
    if (typeof zoneId !== "string" || zoneId.trim().length === 0) {
      throw new AppError(
        "ENV_INVALID",
        "CLOUDFLARE_ZONE_MAP values must be non-empty strings.",
        { domain },
      );
    }
  }

  return Object.fromEntries(
    entries.map(([domain, zoneId]) => [domain.toLowerCase(), zoneId as string]),
  );
};

export const getEnv = (): ApiEnv => {
  const providerValue = process.env.LLM_PROVIDER ?? "gemini";
  if (
    providerValue !== "openai" &&
    providerValue !== "gemini" &&
    providerValue !== "echo" &&
    providerValue !== "anthropic"
  ) {
    throw new AppError(
      "ENV_INVALID",
      "LLM_PROVIDER must be one of: gemini, openai, echo, anthropic",
    );
  }

  const nodeEnvValue = process.env.NODE_ENV ?? "development";
  if (
    nodeEnvValue !== "development" &&
    nodeEnvValue !== "production" &&
    nodeEnvValue !== "test"
  ) {
    throw new AppError(
      "ENV_INVALID",
      "NODE_ENV must be development, production, or test",
    );
  }

  const port = Number(process.env.PORT ?? "3500");
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new AppError("ENV_INVALID", "PORT must be a valid TCP port number");
  }

  const telegramWebhookSecret = getRequired("TELEGRAM_WEBHOOK_SECRET");
  if (telegramWebhookSecret.length < 16) {
    throw new AppError(
      "ENV_INVALID",
      "TELEGRAM_WEBHOOK_SECRET must be at least 16 characters",
    );
  }

  const dnsProviderRaw = process.env.DNS_PROVIDER;
  const dnsProvider =
    dnsProviderRaw === "namecheap" || dnsProviderRaw === "cloudflare"
      ? dnsProviderRaw
      : undefined;

  if (dnsProviderRaw && !dnsProvider) {
    throw new AppError(
      "ENV_INVALID",
      "DNS_PROVIDER must be one of: namecheap, cloudflare",
    );
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
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    geminiBaseUrl: process.env.GEMINI_BASE_URL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    redisUrl: process.env.REDIS_URL,
    awsKnowledgeMcpUrl: process.env.AWS_KNOWLEDGE_MCP_URL,
    awsKnowledgeMcpApiKey: process.env.AWS_KNOWLEDGE_MCP_API_KEY,
    awsKnowledgeMcpTimeoutMs: process.env.AWS_KNOWLEDGE_MCP_TIMEOUT_MS
      ? Number(process.env.AWS_KNOWLEDGE_MCP_TIMEOUT_MS)
      : undefined,
    scheduleDataDir: process.env.SCHEDULE_DATA_DIR ?? "data",
    dnsProvider,
    namecheapApiUser: process.env.NAMECHEAP_API_USER,
    namecheapApiKey: process.env.NAMECHEAP_API_KEY,
    namecheapUsername: process.env.NAMECHEAP_USERNAME,
    namecheapClientIp: process.env.NAMECHEAP_CLIENT_IP,
    namecheapApiBaseUrl: process.env.NAMECHEAP_API_BASE_URL,
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
    cloudflareZoneMap: parseCloudflareZoneMap(),
    cloudflareApiBaseUrl: process.env.CLOUDFLARE_API_BASE_URL,
  };

  if (
    env.awsKnowledgeMcpTimeoutMs !== undefined &&
    (Number.isNaN(env.awsKnowledgeMcpTimeoutMs) ||
      env.awsKnowledgeMcpTimeoutMs < 1000)
  ) {
    throw new AppError(
      "ENV_INVALID",
      "AWS_KNOWLEDGE_MCP_TIMEOUT_MS must be a number >= 1000",
    );
  }

  return env;
};

export const hasNamecheapDnsConfig = (env: ApiEnv): boolean =>
  Boolean(
    env.dnsProvider === "namecheap" &&
    env.namecheapApiUser &&
    env.namecheapApiKey &&
    env.namecheapUsername &&
    env.namecheapClientIp,
  );

export const hasCloudflareDnsConfig = (env: ApiEnv): boolean =>
  Boolean(env.dnsProvider === "cloudflare" && env.cloudflareApiToken);
