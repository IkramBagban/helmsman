import { randomUUID } from "node:crypto";

import { HelmsmanAgentService, createLLMProvider } from "@helmsman/agent-core";
import { isTelegramUpdate, type AgentResponse, type NormalizedMessage } from "@helmsman/shared";
import { ConsoleAuditService } from "@helmsman/audit";
import { DefaultPolicyEngine } from "@helmsman/policy";

import type { ApiEnv } from "../config.js";
import { getCommandResponse } from "../telegram/commands.js";
import { type DedupStore } from "../telegram/dedup.js";
import { parseTelegramUpdate } from "../telegram/parser.js";
import { TelegramSender } from "../telegram/sender.js";

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
  handleMessage(message: NormalizedMessage): Promise<Pick<AgentResponse, "text">>;
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
  const agentService = dependencies?.agentService ?? new HelmsmanAgentService({
    llmProvider: createLLMProvider({
      provider: env.llmProvider,
      openAiApiKey: env.openAiApiKey,
      openAiBaseUrl: env.openAiBaseUrl,
      geminiApiKey: env.geminiApiKey,
      geminiBaseUrl: env.geminiBaseUrl,
    }),
    policyEngine: new DefaultPolicyEngine(),
    auditService: new ConsoleAuditService(),
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

        await sender.sendTyping(chatId);

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
