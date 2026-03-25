import { randomUUID } from "node:crypto";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import type { UserFromGetMe } from "grammy/types";
import { interceptActionCommand } from "@helmsman/action-gateway";
import {
  getCommandResponse,
  parseTelegramUpdate,
  TelegramSender,
  type SupportedTelegramUpdate,
  type DedupStore,
} from "@helmsman/transport";
import {
  isTelegramUpdate,
} from "@helmsman/shared";
import { type AgentService } from "../services/agent-service.js";
import { type ApiEnv } from "../config.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TelegramWebhookHandler {
  handle(request: Request): Promise<Response>;
}

export interface TelegramWebhookDependencies {
  readonly dedupStore: DedupStore;
  readonly agentService: AgentService;
  readonly sender?: TelegramMessageSender;
}

export interface TelegramMessageSender {
  sendTyping(chatId: string): Promise<void>;
  sendResponse(chatId: string, text: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createTelegramWebhookHandler = async (
  env: ApiEnv,
  dependencies: TelegramWebhookDependencies,
): Promise<TelegramWebhookHandler> => {
  const { dedupStore, agentService } = dependencies;
  const sender = dependencies.sender ?? new TelegramSender(env.telegramBotToken);
  const botId = Number.parseInt(env.telegramBotToken.split(":")[0] ?? "0", 10);
  const botInfo: UserFromGetMe = {
    id: Number.isFinite(botId) ? botId : 0,
    is_bot: true,
    first_name: "Helmsman",
    username: "helmsman_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
  };
  const bot = new Bot(env.telegramBotToken, { botInfo });
  const correlationIdsByUpdate = new WeakMap<object, string>();

  bot.on("message:text", async (context) => {
    const update = context.update as SupportedTelegramUpdate;
    const correlationId = correlationIdsByUpdate.get(update as object) ?? randomUUID();
    const chatId = String(context.chat.id);
    const userId = String(context.from.id);
    const incomingText = context.message.text.trim();

    await sender.sendTyping(chatId);

    const commandResponse = getCommandResponse(update, correlationId);
    if (commandResponse) {
      await sender.sendResponse(chatId, commandResponse.text);
      return;
    }

    // Action Command Interception
    const resolvedOrchestrator = agentService.getOrchestrator();
    const schedulingService = agentService.getSchedulingService();

    const interceptResult = await interceptActionCommand({
      text: incomingText,
      userId,
      chatId,
      handleActivation: (role, id, uid, cid) => resolvedOrchestrator.handleActivation(role, id, uid, cid),
      handleApprovalByCode: (id, uid, cid) => resolvedOrchestrator.handleApproval(id, uid, cid),
      handleConfirmationByTarget: (t, uid, cid) => resolvedOrchestrator.handleConfirmation(t, uid, cid),
      handleScheduleApproval: (id, uid, cid) => schedulingService.handleApproval(id, uid, cid),
    });

    if (interceptResult.handled) {
      await sender.sendResponse(chatId, interceptResult.responseText);
      return;
    }

    const normalizedMessage = parseTelegramUpdate(update, correlationId);
    if (!normalizedMessage) {
      return;
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
        correlationIdsByUpdate.set(body as object, correlationId);
        try {
          await bot.handleUpdate(body as unknown as Update);
        } finally {
          correlationIdsByUpdate.delete(body as object);
        }

        return Response.json({ ok: true });
      } catch (error) {
        console.error("Telegram webhook processing failed", error);
        return Response.json({ ok: true });
      }
    },
  };
};
