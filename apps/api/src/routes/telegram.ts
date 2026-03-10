import { randomUUID } from "node:crypto";

import {
  createHelmsman,
  type CapabilityStore,
  InMemoryCapabilityStore,
  type HelmsmanOrchestrator,
} from "@helmsman/agent-core";
import { interceptActionCommand } from "@helmsman/action-gateway";
import {
  getCommandResponse,
  parseTelegramUpdate,
  TelegramSender,
  type DedupStore,
} from "@helmsman/transport";
import { isTelegramUpdate, type AgentResponse, type NormalizedMessage } from "@helmsman/shared";
import { SchedulingService, createSchedulingTools } from "@helmsman/scheduling";

import type { ApiEnv } from "../config.js";


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
  readonly schedulingService?: SchedulingService;
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

  // ── Bootstrap scheduling service ────────────────────────────────────────
  // We need a temporary orchestrator reference for the scheduling engine's
  // run-time execution (it calls orchestrator.handleMessage for agent_task
  // schedules). We'll create the real orchestrator with scheduling tools
  // injected, then wire it up.
  let resolvedOrchestrator: HelmsmanOrchestrator;

  // Create scheduling service first (needs orchestrator for engine execution)
  const schedulingService = dependencies?.schedulingService ?? new SchedulingService({
    dataDir: env.scheduleDataDir,
    sender,
    // The orchestrator is set via a lazy proxy — it gets resolved after
    // createHelmsman returns. This handles the circular dependency:
    // scheduling tools → service, service engine → orchestrator, orchestrator → tools.
    orchestrator: new Proxy({} as HelmsmanOrchestrator, {
      get(_target, prop, receiver) {
        if (!resolvedOrchestrator) {
          throw new Error("Orchestrator not yet initialized");
        }
        return Reflect.get(resolvedOrchestrator, prop, receiver);
      },
    }),
  });

  // Create scheduling Mastra tools that delegate to the service
  const schedulingTools = createSchedulingTools({ schedulingService });

  // ── Determine LLM Model ─────────────────────────────────────────────────
  let model = "google/gemini-2.0-flash";
  if (env.llmProvider === "anthropic") {
    model = "anthropic/claude-sonnet-4-6";
  } else if (env.llmProvider === "openai") {
    model = "openai/gpt-4o";
  }

  // ── Bootstrap the Mastra orchestrator with scheduling tools ─────────────
  resolvedOrchestrator =
    dependencies?.orchestrator ??
    (await createHelmsman({
      model,
      githubToken: process.env.GITHUB_TOKEN,
      githubBaseUrl: process.env.GITHUB_API_BASE_URL,
      enableDevopsTools: true,
      awsKnowledgeMcpUrl: env.awsKnowledgeMcpUrl,
      awsKnowledgeMcpApiKey: env.awsKnowledgeMcpApiKey,
      awsKnowledgeMcpTimeoutMs: env.awsKnowledgeMcpTimeoutMs,
      capabilityStore,
      extraTools: schedulingTools,
    }));

  await schedulingService.start();

  // ── Graceful shutdown: clear all armed timers ───────────────────────────
  const handleShutdown = (): void => {
    schedulingService.stop();
  };
  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

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

        const interceptResult = await interceptActionCommand({
          text: incomingText,
          userId,
          chatId,
          handleActivation: async (role, activationId, runUserId, runChatId) =>
            await resolvedOrchestrator.handleActivation(role, activationId, runUserId, runChatId),
          handleApprovalByCode: async (approvalId, runUserId, runChatId) =>
            await resolvedOrchestrator.handleApproval(approvalId, runUserId, runChatId),
          handleConfirmationByTarget: async (target, runUserId, runChatId) =>
            await resolvedOrchestrator.handleConfirmation(target, runUserId, runChatId),
          handleScheduleApproval: async (approvalId, runUserId, runChatId) =>
            await schedulingService.handleApproval(approvalId, runUserId, runChatId),
        });

        if (interceptResult.handled) {
          await sender.sendResponse(chatId, interceptResult.responseText);
          return Response.json({ ok: true });
        }

        // ── Normal message → Mastra orchestrator ─────────────────────────
        // All messages (including scheduling) go through the agent.
        // The agent calls scheduling tools when it detects schedule intent.
        const normalizedMessage = parseTelegramUpdate(body, correlationId);
        if (!normalizedMessage) {
          return Response.json({ ok: true });
        }

        const typingTimer = setInterval(() => {
          void sender.sendTyping(chatId);
        }, 4000);

        try {
          const agentResponse = await resolvedOrchestrator.handleMessage(normalizedMessage);
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
