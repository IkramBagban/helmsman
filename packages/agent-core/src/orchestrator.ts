/**
 * Helmsman Orchestrator — the main entry point that ties all agents together.
 *
 * This replaces HelmsmanAgentService with a Mastra-based orchestration layer:
 *
 * Router → classify intent
 *   ├─ chat → DevOps agent (no tools, fast response mode)
 *   ├─ query → DevOps agent (tools, maxSteps for multi-hop)
 *   ├─ single_action → DevOps agent (tools, risk check via workflow if needed)
 *   └─ multi_step → Planner → approval workflow → step-by-step execution
 *
 * All tool calls use Mastra's native function calling (no text-based JSON parsing).
 */

import type { Agent } from "@mastra/core/agent";
import type { NormalizedMessage, AgentResponse } from "@helmsman/shared";

import type { IntentClassification } from "./agents/router.js";
import { classifyIntent } from "./agents/router.js";
import type { Plan } from "./agents/planner.js";
import { logTrace, previewText } from "./trace-logger.js";
import { detectPromptInjectionAttempt, PROMPT_INJECTION_REFUSAL } from "./security/prompt-injection.js";
import { ShellExecuteTool } from "@helmsman/tools";
import {
  InMemoryCapabilityStore,
  type CapabilityRole,
  type CapabilityStore,
  type PendingActionRecord,
} from "./capability-store.js";
import { ConversationState } from "./orchestrator/conversation-state.js";
import {
  attemptAutomaticRecoveryAfterFailure as attemptRecoveryFlow,
  generateApprovalMessage as generateApprovalMessageFlow,
  generateElicitationResponse as generateElicitationFlow,
  resumePendingAction as resumePendingActionFlow,
  runWithApproval as runWithApprovalFlow,
} from "./orchestrator/approval-flow.js";
import {
  handleChatIntent,
  handleMultiStepIntent,
  handleQueryIntent,
  handleSingleActionIntent,
} from "./orchestrator/intent-handlers.js";
import type { HelmsmanConfig } from "./orchestrator/types.js";

export type { HelmsmanConfig } from "./orchestrator/types.js";
const shellTool = new ShellExecuteTool();

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class HelmsmanOrchestrator {
  private readonly routerAgent: Agent;
  private readonly devopsAgent: Agent;
  private readonly plannerAgent: Agent;
  private readonly responderAgent: Agent;
  private readonly capabilityStore: CapabilityStore;
  private readonly state = new ConversationState();

  constructor(config: HelmsmanConfig) {
    this.routerAgent = config.routerAgent;
    this.devopsAgent = config.devopsAgent;
    this.plannerAgent = config.plannerAgent;
    this.responderAgent = config.responderAgent;
    this.capabilityStore = config.capabilityStore ?? new InMemoryCapabilityStore();
  }

  /**
   * Compose concise user-facing text using the responder agent.
   * Useful for non-tooling communication flows that still need Helmsman tone.
   */
  public async composeAssistantReply(input: string): Promise<string> {
    const result = await this.responderAgent.generate(input);
    return result.text;
  }

  /**
   * Handle an incoming user message. Returns an AgentResponse.
   *
   * This is the main entry point — equivalent to HelmsmanAgentService.handleMessage
   * but using Mastra agents underneath.
   */
  async handleMessage(message: NormalizedMessage): Promise<AgentResponse> {
    try {
      const startedAt = Date.now();
      logTrace("message.received", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        userId: message.userId,
        platform: message.platform,
        textPreview: previewText(message.text),
      });

      this.state.recordTurn(message.chatId, "user", message.text);
      const conversationContext = this.state.getConversationContext(message.chatId);

      const isScheduledExecution = message.metadata?.scheduled === true;

      if (isScheduledExecution) {
        logTrace("intent.classified", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          intent: "query",
          confidence: 1,
          reasoning: "override: scheduled_execution_no_rescheduling",
        });

        const scheduledPrompt = [
          message.text,
          "",
          "Scheduled execution policy:",
          "- This request is already running from a scheduler job.",
          "- Do NOT create, modify, list, pause, resume, or cancel schedules.",
          "- Execute the requested task immediately using non-scheduling tools.",
        ].join("\n");

        const response = await this.handleQuery(
          {
            ...message,
            text: scheduledPrompt,
          },
          {
            intent: "query",
            confidence: 1,
            reasoning: "override: scheduled_execution_no_rescheduling",
          },
          undefined,
        );

        this.state.recordTurn(message.chatId, "assistant", response.text);
        logTrace("message.completed", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          status: response.status,
          durationMs: Date.now() - startedAt,
          responsePreview: previewText(response.text),
          mode: "scheduled_execution",
        });
        return response;
      }

      const injectionCheck = detectPromptInjectionAttempt(message.text);
      if (injectionCheck.blocked) {
        logTrace("security.prompt_injection.blocked", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          userId: message.userId,
          reason: injectionCheck.reason ?? "matched_known_pattern",
          textPreview: previewText(message.text),
        }, "warn");

        const blockedResponse: AgentResponse = {
          correlationId: message.correlationId,
          status: "error",
          text: PROMPT_INJECTION_REFUSAL,
        };

        this.state.recordTurn(message.chatId, "assistant", blockedResponse.text);
        return blockedResponse;
      }

      // 1. Classify intent
      const intent = await classifyIntent(this.routerAgent, message.text, conversationContext);
      const effectiveIntent = intent;

      logTrace("intent.classified", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        intent: effectiveIntent.intent,
        confidence: effectiveIntent.confidence,
        reasoning: effectiveIntent.reasoning,
      });

      // 2. Route to appropriate handler
      let response: AgentResponse;
      switch (effectiveIntent.intent) {
        case "chat":
          response = await this.handleChat(message, effectiveIntent, conversationContext);
          break;
        case "query":
          response = await this.handleQuery(message, effectiveIntent, conversationContext);
          break;
        case "single_action":
          response = await this.handleSingleAction(message, effectiveIntent, conversationContext);
          break;
        case "multi_step":
          response = await this.handleMultiStep(message, effectiveIntent, conversationContext);
          break;
        default:
          response = await this.handleQuery(message, effectiveIntent, conversationContext);
          break;
      }

      this.state.recordTurn(message.chatId, "assistant", response.text);
      logTrace("message.completed", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        status: response.status,
        durationMs: Date.now() - startedAt,
        responsePreview: previewText(response.text),
      });
      return response;
    } catch (error) {
      logTrace("message.failed", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        error: error instanceof Error ? error.message : String(error),
      }, "error");
      const response: AgentResponse = {
        correlationId: message.correlationId,
        status: "error",
        text: "Something went wrong on my end. Please try again.",
      };
      this.state.recordTurn(message.chatId, "assistant", response.text);
      return response;
    }
  }

  /**
   * Resume a pending approval workflow.
   */
  async handleApproval(approvalId: string, userId: string, chatId: string): Promise<AgentResponse> {
    logTrace("approval.received", {
      approvalId,
      userId,
      chatId,
    });

    const pendingAction = await this.capabilityStore.consumePendingActionByCode({
      userId,
      chatId,
      value: approvalId,
    });

    if (!pendingAction) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Approval request not found, expired, or already used.",
      };
    }

    return await this.resumePendingAction(pendingAction, true);
  }

  async handleConfirmation(target: string, userId: string, chatId: string): Promise<AgentResponse> {
    const pendingAction = await this.capabilityStore.consumePendingActionByTarget({
      userId,
      chatId,
      value: target.trim(),
    });

    if (!pendingAction) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Confirmation target not found, expired, or already used.",
      };
    }

    return await this.resumePendingAction(pendingAction, true);
  }

  async handleActivation(
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ): Promise<AgentResponse> {
    const activation = await this.capabilityStore.consumeActivation({
      role,
      activationId: activationId.toUpperCase(),
      userId,
      chatId,
    });

    if (!activation) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Activation request not found, expired, already used, or not owned by you.",
      };
    }

    const state = await this.capabilityStore.activateRole({ role, userId, chatId });
    const expiryMs = role === "operator" ? state.operator.expiresAtMs : state.commander.expiresAtMs;
    const expiryText = expiryMs
      ? new Date(expiryMs).toISOString().replace("T", " ").replace(".000Z", " UTC")
      : "(unknown)";

    const continuation = this.state.consumeActivationContinuation(role, activationId.toUpperCase(), userId, chatId);
    if (!continuation) {
      return {
        correlationId: crypto.randomUUID(),
        status: "success",
        text: `${role === "operator" ? "Operator" : "Commander"} access is active until ${expiryText}.`,
      };
    }

    const continuationMessage: NormalizedMessage = {
      platform: "telegram",
      chatId,
      messageId: `activation-${activationId.toUpperCase()}`,
      userId,
      text: continuation.description,
      timestamp: new Date(),
      correlationId: continuation.correlationId,
    };

    const nextStep = await this.runWithApproval(
      continuationMessage,
      continuation.command,
      continuation.riskTier,
      continuation.description,
    );

    return {
      correlationId: nextStep.correlationId,
      status: nextStep.status,
      text: nextStep.text,
      metadata: nextStep.metadata,
    };
  }

  private async resumePendingAction(
    pendingAction: PendingActionRecord,
    approved: boolean,
  ): Promise<AgentResponse> {
    return await resumePendingActionFlow(
      {
        state: this.state,
        capabilityStore: this.capabilityStore,
        devopsAgent: this.devopsAgent,
        responderAgent: this.responderAgent,
        executeShell: async (command: string) => await shellTool.execute({ command }),
      },
      pendingAction,
      approved,
    );
  }

  private async attemptAutomaticRecoveryAfterFailure(
    pendingAction: PendingActionRecord,
    failureReason: string,
  ): Promise<AgentResponse | null> {
    return await attemptRecoveryFlow(
      {
        state: this.state,
        capabilityStore: this.capabilityStore,
        devopsAgent: this.devopsAgent,
        responderAgent: this.responderAgent,
        executeShell: async (command: string) => await shellTool.execute({ command }),
      },
      pendingAction,
      failureReason,
    );
  }

  private async generateApprovalMessage(input: {
    role: CapabilityRole;
    riskTier: string;
    description: string;
    command: string;
    confirmInstruction: string;
  }): Promise<string> {
    return await generateApprovalMessageFlow(
      { responderAgent: this.responderAgent },
      input,
    );
  }

  private async generateElicitationResponse(input: {
    message: NormalizedMessage;
    plan: Plan;
    conversationContext?: string;
    validation?: { valid: false; reason: string; missingValues?: string[] };
  }): Promise<AgentResponse> {
    return await generateElicitationFlow(
      { responderAgent: this.responderAgent },
      input,
    );
  }

  // -------------------------------------------------------------------------
  // Intent handlers
  // -------------------------------------------------------------------------

  /**
   * Handle casual conversation — no tools needed.
   */
  private async handleChat(
    message: NormalizedMessage,
    intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    return await handleChatIntent(
      {
        devopsAgent: this.devopsAgent,
        plannerAgent: this.plannerAgent,
        runWithApproval: this.runWithApproval.bind(this),
        generateElicitationResponse: this.generateElicitationResponse.bind(this),
      },
      message,
      intent,
      conversationContext,
    );
  }

  /**
   * Handle read-only queries — DevOps agent with tools, multi-hop allowed.
   */
  private async handleQuery(
    message: NormalizedMessage,
    intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    return await handleQueryIntent(
      {
        devopsAgent: this.devopsAgent,
        plannerAgent: this.plannerAgent,
        runWithApproval: this.runWithApproval.bind(this),
        generateElicitationResponse: this.generateElicitationResponse.bind(this),
      },
      message,
      intent,
      conversationContext,
    );
  }

  /**
   * Handle single actions — may require approval for risky commands.
   *
   * The DevOps agent generates tool calls natively. We inspect the result:
   * - If it made tool calls and they succeeded → return the formatted result
   * - If the tool call involves a risky command → run through approval workflow
   */
  private async handleSingleAction(
    message: NormalizedMessage,
    intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    return await handleSingleActionIntent(
      {
        devopsAgent: this.devopsAgent,
        plannerAgent: this.plannerAgent,
        runWithApproval: this.runWithApproval.bind(this),
        generateElicitationResponse: this.generateElicitationResponse.bind(this),
      },
      message,
      intent,
      conversationContext,
    );
  }

  /**
   * Handle multi-step requests — generate plan, get approval, execute.
   */
  private async handleMultiStep(
    message: NormalizedMessage,
    intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    return await handleMultiStepIntent(
      {
        devopsAgent: this.devopsAgent,
        plannerAgent: this.plannerAgent,
        runWithApproval: this.runWithApproval.bind(this),
        generateElicitationResponse: this.generateElicitationResponse.bind(this),
      },
      message,
      intent,
      conversationContext,
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Run a command through the approval workflow (suspend/resume).
   */
  private async runWithApproval(
    message: NormalizedMessage,
    command: string,
    riskTier: string,
    description: string,
  ): Promise<AgentResponse> {
    return await runWithApprovalFlow(
      {
        state: this.state,
        capabilityStore: this.capabilityStore,
        devopsAgent: this.devopsAgent,
        responderAgent: this.responderAgent,
        executeShell: async (runCommand: string) => await shellTool.execute({ command: runCommand }),
        generateApprovalMessageFn: this.generateApprovalMessage.bind(this),
      },
      message,
      command,
      riskTier,
      description,
    );
  }

}
