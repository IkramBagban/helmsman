import { randomUUID } from "node:crypto";

import { HelmsmanAgentService, createLLMProvider } from "@helmsman/agent-core";
import { isTelegramUpdate, type AgentResponse, type NormalizedMessage } from "@helmsman/shared";
import { ConsoleAuditService } from "@helmsman/audit";
import { DefaultPolicyEngine } from "@helmsman/policy";
import { ListS3BucketsTool, GenericEc2Tool } from "@helmsman/tools-aws";
import { ToolRegistry } from "@helmsman/tools";

import type { ApiEnv } from "../config.js";
import { getCommandResponse } from "../telegram/commands.js";
import { InMemoryApprovalStore } from "../telegram/approval-store.js";
import { type DedupStore } from "../telegram/dedup.js";
import { parseTelegramUpdate } from "../telegram/parser.js";
import { TelegramSender } from "../telegram/sender.js";

const truncateForTelegram = (text: string, maxLength: number = 3000): string => {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n\n…(truncated)`;
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
};

const summarizeS3Buckets = (rawOutput: string): string | null => {
  try {
    const parsed = JSON.parse(rawOutput) as Array<{ Name?: string; CreationDate?: string }>;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const buckets = parsed
      .map((bucket) => ({
        name: typeof bucket.Name === "string" ? bucket.Name : "unknown-bucket",
        creationDate: typeof bucket.CreationDate === "string" ? bucket.CreationDate : "unknown",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (buckets.length === 0) {
      return "I checked your account and no S3 buckets were found.";
    }

    const preview = buckets
      .slice(0, 8)
      .map((bucket) => `- ${bucket.name} (created ${formatDate(bucket.creationDate)})`)
      .join("\n");

    const infraCount = buckets.filter((bucket) => /cdk|serverless|deployment|assets/i.test(bucket.name)).length;
    const extra = buckets.length > 8 ? `\n\n…and ${buckets.length - 8} more bucket(s).` : "";
    const infra = infraCount > 0
      ? `\n\nObservation: ${infraCount} bucket(s) appear infra-managed (CDK/Serverless/deployment).`
      : "";

    return [
      `You currently have ${buckets.length} S3 bucket(s).`,
      "",
      "Top buckets:",
      preview,
      infra,
      extra,
      "",
      "Next step: I can run a security and lifecycle review on these buckets if you want.",
    ].join("\n").trim();
  } catch {
    return null;
  }
};

const summarizeKnownToolOutput = (toolName: string, rawOutput: string): string | null => {
  if (toolName === "aws:s3:ListBuckets") {
    return summarizeS3Buckets(rawOutput);
  }

  return null;
};

const fallbackHumanSummary = (toolName: string, rawOutput: string): string => {
  const deterministic = summarizeKnownToolOutput(toolName, rawOutput);
  if (deterministic) {
    return truncateForTelegram(deterministic);
  }

  try {
    const parsed = JSON.parse(rawOutput) as unknown;

    if (Array.isArray(parsed)) {
      const preview = parsed.slice(0, 5).map((item, index) => `- ${index + 1}. ${JSON.stringify(item)}`).join("\n");
      return truncateForTelegram(
        `✅ Executed ${toolName}\n\nFound ${parsed.length} result(s).\n\nTop results:\n${preview}`,
      );
    }

    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed as Record<string, unknown>);
      return truncateForTelegram(
        `✅ Executed ${toolName}\n\nReceived structured data with ${keys.length} field(s): ${keys.slice(0, 8).join(", ")}`,
      );
    }
  } catch {
    // no-op, fallback to raw text below
  }

  return truncateForTelegram(`✅ Executed ${toolName}\n\n${rawOutput}`);
};

export interface TelegramWebhookHandler {
  handle(request: Request): Promise<Response>;
}

export interface TelegramWebhookDependencies {
  readonly dedupStore?: DedupStore;
  readonly sender?: TelegramMessageSender;
  readonly agentService?: TelegramAgentService;
}

export interface TelegramMessageSender {
  sendTyping(chatId: string): Promise<void>;
  sendResponse(chatId: string, text: string): Promise<void>;
}

export interface TelegramAgentService {
  handleMessage(message: NormalizedMessage): Promise<AgentResponse>;
}

export const createTelegramWebhookHandler = (
  env: ApiEnv,
  dependencies?: TelegramWebhookDependencies,
): TelegramWebhookHandler => {
  if (!dependencies?.dedupStore) {
    throw new Error("Telegram dedupStore is required but was not provided in dependencies.");
  }
  const dedupStore = dependencies.dedupStore;
  const sender = dependencies?.sender ?? new TelegramSender(env.telegramBotToken);

  const registry = new ToolRegistry();
  registry.register(new ListS3BucketsTool() as any);
  registry.register(new GenericEc2Tool() as any);

  const approvalStore = new InMemoryApprovalStore();
  const policyEngine = new DefaultPolicyEngine();
  const auditService = new ConsoleAuditService();

  const agentService = dependencies?.agentService ?? new HelmsmanAgentService({
    llmProvider: createLLMProvider({
      provider: env.llmProvider,
      openAiApiKey: env.openAiApiKey,
      openAiBaseUrl: env.openAiBaseUrl,
      geminiApiKey: env.geminiApiKey,
      geminiBaseUrl: env.geminiBaseUrl,
    }),
    policyEngine,
    auditService,
    toolRegistry: registry,
  });

  const approvalSummaryProvider = createLLMProvider({
    provider: env.llmProvider,
    openAiApiKey: env.openAiApiKey,
    openAiBaseUrl: env.openAiBaseUrl,
    geminiApiKey: env.geminiApiKey,
    geminiBaseUrl: env.geminiBaseUrl,
  });

  return {
    async handle(request: Request): Promise<Response> {
      try {
        const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
        if (secretHeader !== env.telegramWebhookSecret) {
          console.warn("Rejected Telegram request with invalid secret");
          return Response.json({ ok: true });
        }

        const body: unknown = await request.json();
        if (!isTelegramUpdate(body)) {
          console.warn("Invalid Telegram update payload");
          return Response.json({ ok: true });
        }

        if (await dedupStore.isDuplicate(body.update_id)) {
          return Response.json({ ok: true, duplicate: true });
        }

        const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();

        if (!body.message?.text) {
          return Response.json({ ok: true });
        }

        const commandResponse = getCommandResponse(body as typeof body & { message: NonNullable<typeof body.message> }, correlationId);
        const chatId = String(body.message.chat.id);
        const incomingText = body.message.text.trim();
        const approveMatch = incomingText.match(/^\/approve\s+([a-zA-Z0-9-]{6,40})$/i);

        await sender.sendTyping(chatId);

        if (approveMatch) {
          const approvalId = approveMatch[1];
          if (!approvalId) {
            await sender.sendResponse(chatId, "Invalid approval command. Use /approve <id>.");
            return Response.json({ ok: true });
          }

          const pending = approvalStore.consume(approvalId, String(body.message.from.id), chatId);
          if (!pending) {
            await sender.sendResponse(chatId, "Approval request not found, expired, or does not belong to this user.");
            return Response.json({ ok: true });
          }

          const tool = registry.getTool(pending.toolName);
          if (!tool) {
            await sender.sendResponse(chatId, `Approved tool '${pending.toolName}' is not available.`);
            return Response.json({ ok: true });
          }

          await auditService.log({
            type: "user_approval",
            userId: pending.userId,
            correlationId: pending.correlationId,
            metadata: {
              approvalId,
              toolName: pending.toolName,
            },
          });

          const toolResult = await tool.execute(pending.parameters);
          await auditService.log({
            type: "tool_execution",
            userId: pending.userId,
            correlationId: pending.correlationId,
            metadata: {
              toolName: pending.toolName,
              success: toolResult.success,
              approved: true,
            },
          });

          if (!toolResult.success) {
            await sender.sendResponse(chatId, `Approved action failed: ${toolResult.error ?? "unknown error"}`);
            return Response.json({ ok: true });
          }

          let humanSummary: string;
          try {
            const deterministic = summarizeKnownToolOutput(pending.toolName, toolResult.output);
            if (deterministic) {
              humanSummary = truncateForTelegram(deterministic);
            } else {
              const summary = await approvalSummaryProvider.generate({
                systemPrompt:
                  "You are Helmsman. Convert tool output into clear operator language. Format as: 1) What I found, 2) Why it matters, 3) Recommended next step. Avoid raw JSON unless requested.",
                messages: [
                  {
                    role: "user",
                    content: `Tool: ${pending.toolName}\n\nRaw output:\n${toolResult.output}`,
                  },
                ],
              });
              humanSummary = truncateForTelegram(summary.text);
            }
          } catch {
            humanSummary = fallbackHumanSummary(pending.toolName, toolResult.output);
          }

          await sender.sendResponse(chatId, humanSummary);
          return Response.json({ ok: true });
        }

        if (commandResponse) {
          await sender.sendResponse(chatId, commandResponse.text);
          return Response.json({ ok: true });
        }

        const normalizedMessage = parseTelegramUpdate(body, correlationId);
        if (!normalizedMessage) {
          return Response.json({ ok: true });
        }

        const typingTimer = setInterval(() => {
          void sender.sendTyping(chatId);
        }, 4000);

        try {
          const agentResponse = await agentService.handleMessage(normalizedMessage);

          if (agentResponse.status === "pending_approval") {
            const toolName = typeof agentResponse.metadata?.toolName === "string"
              ? agentResponse.metadata.toolName
              : undefined;
            const parameters = typeof agentResponse.metadata?.parameters === "object"
              && agentResponse.metadata.parameters !== null
              ? agentResponse.metadata.parameters as Record<string, unknown>
              : undefined;

            if (toolName && parameters) {
              const pending = approvalStore.create({
                userId: normalizedMessage.userId,
                chatId,
                correlationId: normalizedMessage.correlationId,
                toolName,
                parameters,
              });

              await sender.sendResponse(
                chatId,
                `${agentResponse.text}\n\nReply with /approve ${pending.approvalId} to execute this action.`,
              );
              return Response.json({ ok: true });
            }
          }

          await sender.sendResponse(chatId, agentResponse.text);
        } finally {
          clearInterval(typingTimer);
        }

        return Response.json({ ok: true });
      } catch (error) {
        console.error("Telegram webhook processing failed", error);

        return Response.json({ ok: true });
      }
    },
  };
};
