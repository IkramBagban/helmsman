import { randomUUID } from "node:crypto";
import { interceptActionCommand } from "@helmsman/action-gateway";
import {
  getCommandResponse,
  parseTelegramUpdate,
  TelegramSender,
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

        const chatId = String(body.message.chat.id);
        const userId = String(body.message.from.id);
        const incomingText = body.message.text.trim();

        await sender.sendTyping(chatId);

        const commandResponse = getCommandResponse(
          body as any,
          correlationId,
        );
        if (commandResponse) {
          await sender.sendResponse(chatId, commandResponse.text);
          return Response.json({ ok: true });
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
