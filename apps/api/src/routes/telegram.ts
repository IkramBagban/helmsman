import { randomUUID } from "node:crypto";

import {
  createHelmsman,
  type CapabilityStore,
  InMemoryCapabilityStore,
  type HelmsmanOrchestrator,
} from "@helmsman/agent-core";
import { isTelegramUpdate, type AgentResponse, type NormalizedMessage } from "@helmsman/shared";

import type { ApiEnv } from "../config.js";
import { getCommandResponse } from "../telegram/commands.js";
import { type DedupStore } from "../telegram/dedup.js";
import { parseTelegramUpdate } from "../telegram/parser.js";
import { TelegramSender } from "../telegram/sender.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TelegramWebhookHandler {
  handle(request: Request): Promise<Response>;
}

export interface TelegramWebhookDependencies {
  readonly dedupStore?: DedupStore;
  readonly sender?: TelegramMessageSender;
  readonly capabilityStore?: CapabilityStore;
  /**
   * Pre-built orchestrator for testing. If not provided, one is created
   * automatically using createHelmsman().
   */
  readonly orchestrator?: HelmsmanOrchestrator;
}

export interface TelegramMessageSender {
  sendTyping(chatId: string): Promise<void>;
  sendResponse(chatId: string, text: string): Promise<void>;
}

// Keep legacy interface for backward compatibility in tests
export interface TelegramAgentService {
  handleMessage(message: NormalizedMessage): Promise<AgentResponse>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const truncateForTelegram = (text: string, maxLength: number = 3000): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n…(truncated)`;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createTelegramWebhookHandler = async (
  env: ApiEnv,
  dependencies?: TelegramWebhookDependencies,
): Promise<TelegramWebhookHandler> => {
  if (!dependencies?.dedupStore) {
    throw new Error("Telegram dedupStore is required but was not provided in dependencies.");
  }
  const dedupStore = dependencies.dedupStore;
  const sender = dependencies?.sender ?? new TelegramSender(env.telegramBotToken);
  const capabilityStore = dependencies?.capabilityStore ?? new InMemoryCapabilityStore();

  // ── Bootstrap the Mastra orchestrator ───────────────────────────────────
  const orchestrator: HelmsmanOrchestrator =
    dependencies?.orchestrator ??
    (await createHelmsman({
      model: "google/gemini-2.0-flash",
      githubToken: process.env.GITHUB_TOKEN,
      githubBaseUrl: process.env.GITHUB_API_BASE_URL,
      enableDevopsTools: true,
      capabilityStore,
    }));

  return {
    async handle(request: Request): Promise<Response> {
      try {
        // ── Auth ─────────────────────────────────────────────────────────
        const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
        if (secretHeader !== env.telegramWebhookSecret) {
          console.warn("Rejected Telegram request with invalid secret");
          return Response.json({ ok: true });
        }

        // ── Parse update ─────────────────────────────────────────────────
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

        // ── Bot commands (/start, /help) ─────────────────────────────────
        const commandResponse = getCommandResponse(
          body as typeof body & { message: NonNullable<typeof body.message> },
          correlationId,
        );
        if (commandResponse) {
          await sender.sendResponse(chatId, commandResponse.text);
          return Response.json({ ok: true });
        }

        // ── Activation flow (/activate <role> <id>) ──────────────────────
        const activateMatch = incomingText.match(/^\/activate\s+(operator|commander)\s+([A-Z0-9]{6})$/i);
        if (activateMatch?.[1] && activateMatch?.[2]) {
          const role = activateMatch[1].toLowerCase() as "operator" | "commander";
          const activationId = activateMatch[2].toUpperCase();
          const activationResponse = await orchestrator.handleActivation(role, activationId, userId, chatId);
          await sender.sendResponse(chatId, truncateForTelegram(activationResponse.text));
          return Response.json({ ok: true });
        }

        // ── Approval flow (/approve <id>) ────────────────────────────────
        const approveMatch = incomingText.match(/^\/approve\s+([a-zA-Z0-9-]{6,40})$/i);
        if (approveMatch) {
          const approvalId = approveMatch[1];
          if (!approvalId) {
            await sender.sendResponse(chatId, "Invalid approval command. Use /approve <id>.");
            return Response.json({ ok: true });
          }

          const approvalResponse = await orchestrator.handleApproval(
            approvalId,
            userId,
            chatId,
          );

          await sender.sendResponse(chatId, truncateForTelegram(approvalResponse.text));
          return Response.json({ ok: true });
        }

        // ── Commander confirmation (/confirm <resourceId>) ───────────────
        const confirmMatch = incomingText.match(/^\/confirm\s+([^\s]+)$/i);
        if (confirmMatch?.[1]) {
          const confirmationTarget = confirmMatch[1];
          const confirmationResponse = await orchestrator.handleConfirmation(
            confirmationTarget,
            userId,
            chatId,
          );

          await sender.sendResponse(chatId, truncateForTelegram(confirmationResponse.text));
          return Response.json({ ok: true });
        }

        // ── Normal message → Mastra orchestrator ─────────────────────────
        const normalizedMessage = parseTelegramUpdate(body, correlationId);
        if (!normalizedMessage) {
          return Response.json({ ok: true });
        }

        const typingTimer = setInterval(() => {
          void sender.sendTyping(chatId);
        }, 4000);

        try {
          const agentResponse = await orchestrator.handleMessage(normalizedMessage);

          // pending_approval — the orchestrator already embedded the
          // /approve <id> command in the response text
          await sender.sendResponse(chatId, truncateForTelegram(agentResponse.text));
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
