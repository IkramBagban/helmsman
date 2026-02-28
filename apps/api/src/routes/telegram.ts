import { randomUUID } from "node:crypto";

import { HelmsmanAgentService, createLLMProvider } from "@helmsman/agent-core";
import { isTelegramUpdate, type AgentResponse, type NormalizedMessage } from "@helmsman/shared";
import { ConsoleAuditService } from "@helmsman/audit";
import { DefaultPolicyEngine } from "@helmsman/policy";
import { ShellExecuteTool, ToolRegistry } from "@helmsman/tools";

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

const sanitizeAssistantText = (text: string): string => {
  const cleaned = text
    .replace(/```(?:json|tool_code)?\s*\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}\s*```/gi, "")
    .replace(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi, "")
    .trim();

  if (!cleaned) {
    return "I completed your request and can provide a clean summary. Tell me which detail you want first.";
  }

  return cleaned;
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
  registry.register(new ShellExecuteTool());

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
            humanSummary = truncateForTelegram(sanitizeAssistantText(summary.text));
          } catch {
            humanSummary = truncateForTelegram(sanitizeAssistantText(`Executed ${pending.toolName}\n\n${toolResult.output}`));
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
                `${sanitizeAssistantText(agentResponse.text)}\n\nReply with /approve ${pending.approvalId} to execute this action.`,
              );
              return Response.json({ ok: true });
            }
          }

          await sender.sendResponse(chatId, sanitizeAssistantText(agentResponse.text));
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
