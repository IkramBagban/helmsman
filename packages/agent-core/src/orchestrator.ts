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
import type { NormalizedMessage, AgentResponse, RiskTier } from "@helmsman/shared";

import type { IntentClassification } from "./agents/router.js";
import { classifyIntent } from "./agents/router.js";
import { generatePlan, type Plan } from "./agents/planner.js";
import { formatResponse } from "./agents/responder.js";
import { logTrace, previewText } from "./trace-logger.js";
import { detectPromptInjectionAttempt, PROMPT_INJECTION_REFUSAL } from "./security/prompt-injection.js";
import { ShellExecuteTool, parseCommand, validateCommand } from "@helmsman/tools";
import {
  InMemoryCapabilityStore,
  type CapabilityRole,
  type CapabilityStore,
  type PendingActionRecord,
} from "./capability-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HelmsmanConfig {
  readonly routerAgent: Agent;
  readonly devopsAgent: Agent;
  readonly plannerAgent: Agent;
  readonly responderAgent: Agent;
  readonly capabilityStore?: CapabilityStore;
}

interface ConversationTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

interface PendingActivationContinuation {
  readonly role: CapabilityRole;
  readonly activationId: string;
  readonly userId: string;
  readonly chatId: string;
  readonly command: string;
  readonly riskTier: string;
  readonly description: string;
  readonly correlationId: string;
  readonly createdAtMs: number;
}

/** Max characters in a final response — Telegram-safe. */
const MAX_RESPONSE_LENGTH = 3000;
/** Max tool iterations for the DevOps agent. */
const MAX_STEPS = 8;
/** Max short-term conversation turns retained in-memory per chat. */
const MAX_HISTORY_TURNS = 8;
/** Max age for in-memory activation continuations. */
const PENDING_CONTEXT_TTL_MS = 15 * 60 * 1000;

const shellTool = new ShellExecuteTool();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateForTelegram(text: string): string {
  if (text.length <= MAX_RESPONSE_LENGTH) return text;
  return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n…(truncated)`;
}

function summarizeAgentRun(result: unknown): Record<string, unknown> {
  const parsed = result as {
    text?: string;
    toolCalls?: Array<{ toolName?: string }>;
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
  };

  const toolNames = [
    ...(parsed.toolCalls ?? []).map((entry) => entry.toolName).filter(Boolean),
    ...(parsed.toolResults ?? []).map((entry) => entry.toolName).filter(Boolean),
  ];

  return {
    textPreview: previewText(parsed.text),
    toolCallsCount: parsed.toolCalls?.length ?? 0,
    toolResultsCount: parsed.toolResults?.length ?? 0,
    toolNames: Array.from(new Set(toolNames)),
  };
}

function buildClarificationPromptFromPlan(plan: Plan): string {
  const warnings = (plan.warnings ?? []).filter((warning) => warning.trim().length > 0);
  const warningSection = warnings.length > 0
    ? `\n\nWhat I still need from you:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "\n\nPlease share the missing parameters and I’ll continue.";

  return `I can continue with this request, but I need a bit more detail before running any risky command.${warningSection}`;
}

function validateApprovalCommand(command: string): { valid: true } | { valid: false; reason: string; missingValues?: string[] } {
  const hasTemplatePlaceholder = /<[a-z_][a-z0-9_]*>/i.test(command);
  if (hasTemplatePlaceholder) {
    const placeholders = command.match(/<[a-z_][a-z0-9_]*>/gi) ?? [];
    const missing = placeholders.map((p) => p.replace(/[<>]/g, "").replace(/_/g, " "));
    return {
      valid: false,
      reason: "placeholder",
      missingValues: missing,
    };
  }

  const parsed = parseCommand(command);
  const validation = validateCommand(parsed);
  if (!validation.valid) {
    return {
      valid: false,
      reason: validation.reason ?? "command failed safety validation",
    };
  }

  return { valid: true };
}

function buildClarificationFromInvalidCommand(
  plan: Plan,
  validation: { valid: false; reason: string; missingValues?: string[] },
): string {
  // Merge plan warnings with placeholder-derived missing values
  const planWarnings = (plan.warnings ?? []).filter((w) => w.trim().length > 0);
  const placeholderWarnings = (validation.missingValues ?? []).map((v) => `What ${v} should I use?`);

  // Deduplicate: prefer plan warnings if they exist, otherwise use placeholder-derived ones
  const warnings = planWarnings.length > 0 ? planWarnings : placeholderWarnings;

  const warningSection = warnings.length > 0
    ? `\n\nWhat I still need from you:\n${warnings.map((w) => `- ${w}`).join("\n")}`
    : "\n\nPlease share the missing parameters and I'll continue.";

  return `I can set this up, but I need a few details first.${warningSection}`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class HelmsmanOrchestrator {
  private readonly routerAgent: Agent;
  private readonly devopsAgent: Agent;
  private readonly plannerAgent: Agent;
  private readonly responderAgent: Agent;
  private readonly capabilityStore: CapabilityStore;
  private readonly conversationHistory = new Map<string, ConversationTurn[]>();
  private readonly pendingActivationContinuations = new Map<string, PendingActivationContinuation>();

  constructor(config: HelmsmanConfig) {
    this.routerAgent = config.routerAgent;
    this.devopsAgent = config.devopsAgent;
    this.plannerAgent = config.plannerAgent;
    this.responderAgent = config.responderAgent;
    this.capabilityStore = config.capabilityStore ?? new InMemoryCapabilityStore();
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

      this.recordTurn(message.chatId, "user", message.text);
      const conversationContext = this.getConversationContext(message.chatId);

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

        this.recordTurn(message.chatId, "assistant", blockedResponse.text);
        return blockedResponse;
      }

      // 1. Classify intent
      const intent = await classifyIntent(this.routerAgent, message.text, conversationContext);
      logTrace("intent.classified", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        intent: intent.intent,
        confidence: intent.confidence,
        reasoning: intent.reasoning,
      });

      // 2. Route to appropriate handler
      let response: AgentResponse;
      switch (intent.intent) {
        case "chat":
          response = await this.handleChat(message, intent, conversationContext);
          break;
        case "query":
          response = await this.handleQuery(message, intent, conversationContext);
          break;
        case "single_action":
          response = await this.handleSingleAction(message, intent, conversationContext);
          break;
        case "multi_step":
          response = await this.handleMultiStep(message, intent, conversationContext);
          break;
        default:
          response = await this.handleQuery(message, intent, conversationContext);
          break;
      }

      this.recordTurn(message.chatId, "assistant", response.text);
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
      this.recordTurn(message.chatId, "assistant", response.text);
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

    const continuation = this.consumeActivationContinuation(role, activationId.toUpperCase(), userId, chatId);
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
    if (!approved) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Action was not approved.",
      };
    }

    try {
      logTrace("approval.resume.started", {
        approvalId: pendingAction.id,
        runId: pendingAction.runId,
        riskTier: pendingAction.riskTier,
        userId: pendingAction.userId,
        chatId: pendingAction.chatId,
        executionMode: "direct-shell",
      });

      const execution = await shellTool.execute({ command: pendingAction.command });

      if (!execution.success) {
        const response: AgentResponse = {
          correlationId: crypto.randomUUID(),
          status: "error",
          text: `Approved action failed: ${execution.error ?? execution.output ?? "unknown error"}`,
        };
        logTrace("approval.resume.completed", {
          approvalId: pendingAction.id,
          runId: pendingAction.runId,
          status: response.status,
          error: execution.error ?? "unknown error",
        }, "warn");
        this.recordTurn(pendingAction.chatId, "assistant", response.text);
        return response;
      }

      const formatted = await formatResponse(
        this.responderAgent,
        execution.output,
        pendingAction.description ?? pendingAction.command,
      );
      const response: AgentResponse = {
        correlationId: crypto.randomUUID(),
        status: "success",
        text: truncateForTelegram(formatted),
      };
      logTrace("approval.resume.completed", {
        approvalId: pendingAction.id,
        runId: pendingAction.runId,
        status: response.status,
        responsePreview: previewText(response.text),
      });
      this.recordTurn(pendingAction.chatId, "assistant", response.text);
      return response;
    } catch (error) {
      logTrace("approval.resume.failed", {
        approvalId: pendingAction.id,
        userId: pendingAction.userId,
        chatId: pendingAction.chatId,
        error: error instanceof Error ? error.message : String(error),
      }, "error");

      const response: AgentResponse = {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Failed to execute the approved action. Please try again.",
      };
      this.recordTurn(pendingAction.chatId, "assistant", response.text);
      return response;
    }
  }

  // -------------------------------------------------------------------------
  // Intent handlers
  // -------------------------------------------------------------------------

  /**
   * Handle casual conversation — no tools needed.
   */
  private async handleChat(
    message: NormalizedMessage,
    _intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    logTrace("handler.chat.started", {
      correlationId: message.correlationId,
      chatId: message.chatId,
    });

    const prompt = this.buildPrompt(message.text, conversationContext);
    const result = await this.devopsAgent.generate(prompt);

    logTrace("handler.chat.completed", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      ...summarizeAgentRun(result),
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: truncateForTelegram(result.text),
    };
  }

  /**
   * Handle read-only queries — DevOps agent with tools, multi-hop allowed.
   */
  private async handleQuery(
    message: NormalizedMessage,
    _intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    logTrace("handler.query.started", {
      correlationId: message.correlationId,
      chatId: message.chatId,
    });

    const prompt = this.buildPrompt(message.text, conversationContext);
    const result = await this.devopsAgent.generate(prompt, {
      maxSteps: MAX_STEPS,
    });

    logTrace("handler.query.completed", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      ...summarizeAgentRun(result),
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: truncateForTelegram(result.text),
    };
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
    _intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    logTrace("handler.single_action.started", {
      correlationId: message.correlationId,
      chatId: message.chatId,
    });

    const plannerPrompt = this.buildPrompt(message.text, conversationContext);
    const plan = await generatePlan(this.plannerAgent, plannerPrompt);

    const isRiskyPlan = plan.overallRisk === "significant" || plan.overallRisk === "destructive";

    const riskyStep = plan.steps.find(
      (step) => (step.risk === "significant" || step.risk === "destructive") && typeof step.command === "string" && step.command.trim().length > 0,
    );

    if (isRiskyPlan && !riskyStep) {
      return {
        correlationId: message.correlationId,
        status: "success",
        text: buildClarificationPromptFromPlan(plan),
      };
    }

    if (riskyStep?.command) {
      // Validate before routing to approval — placeholders → clarification, not dead-end
      const validation = validateApprovalCommand(riskyStep.command);
      if (!validation.valid) {
        logTrace("handler.single_action.incomplete_command", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          command: riskyStep.command,
          reason: validation.reason,
          missingValues: validation.missingValues,
        }, "info");

        return {
          correlationId: message.correlationId,
          status: "success",
          text: buildClarificationFromInvalidCommand(plan, validation),
        };
      }

      logTrace("handler.single_action.approval_required", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        command: riskyStep.command,
        risk: riskyStep.risk,
      }, "warn");

      return await this.runWithApproval(
        message,
        riskyStep.command,
        riskyStep.risk,
        `${plan.summary}\nStep: ${riskyStep.description}`,
      );
    }

    // For non-risky actions, execute with tools.
    const prompt = this.buildPrompt(message.text, conversationContext);
    const result = await this.devopsAgent.generate(prompt, {
      maxSteps: MAX_STEPS,
    });

    logTrace("handler.single_action.completed", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      ...summarizeAgentRun(result),
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: truncateForTelegram(result.text),
    };
  }

  /**
   * Handle multi-step requests — generate plan, get approval, execute.
   */
  private async handleMultiStep(
    message: NormalizedMessage,
    _intent: IntentClassification,
    conversationContext?: string,
  ): Promise<AgentResponse> {
    logTrace("handler.multi_step.started", {
      correlationId: message.correlationId,
      chatId: message.chatId,
    });

    // Generate a structured plan
    const plannerPrompt = this.buildPrompt(message.text, conversationContext);
    const plan = await generatePlan(this.plannerAgent, plannerPrompt);

    logTrace("handler.multi_step.plan_generated", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      summary: plan.summary,
      stepCount: plan.steps.length,
      overallRisk: plan.overallRisk,
    });

    // Format the plan for the user
    const planText = this.formatPlan(plan);

    // If the plan has significant or destructive steps, require approval before execution.
    if (plan.overallRisk === "significant" || plan.overallRisk === "destructive") {
      const firstRiskyStep = plan.steps.find(
        (step) => (step.risk === "significant" || step.risk === "destructive") && typeof step.command === "string" && step.command.trim().length > 0,
      );

      if (!firstRiskyStep?.command) {
        return {
          correlationId: message.correlationId,
          status: "success",
          text: buildClarificationPromptFromPlan(plan),
        };
      }

      // Validate before routing to approval — placeholders → clarification, not dead-end
      const validation = validateApprovalCommand(firstRiskyStep.command);
      if (!validation.valid) {
        logTrace("handler.multi_step.incomplete_command", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          command: firstRiskyStep.command,
          reason: validation.reason,
          missingValues: validation.missingValues,
        }, "info");

        return {
          correlationId: message.correlationId,
          status: "success",
          text: buildClarificationFromInvalidCommand(plan, validation),
        };
      }

      return await this.runWithApproval(
        message,
        firstRiskyStep.command,
        firstRiskyStep.risk,
        `${plan.summary}\nStep ${firstRiskyStep.order}: ${firstRiskyStep.description}\n\n${planText}`,
      );
    }

    // Low risk plan — execute immediately via DevOps agent
    const executionResult = await this.devopsAgent.generate(
      `Execute the following plan step by step:\n\n${plan.steps.map((s) => `${s.order}. ${s.description}${s.command ? `\n   Command: ${s.command}` : ""}`).join("\n")}`,
      { maxSteps: MAX_STEPS },
    );

    logTrace("handler.multi_step.executed", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      ...summarizeAgentRun(executionResult),
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: truncateForTelegram(executionResult.text),
    };
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
    this.cleanupEphemeralState();

    // Defense-in-depth: command should already be validated upstream.
    // If we still reach here with an invalid command, log a warning and clarify.
    const commandValidation = validateApprovalCommand(command);
    if (!commandValidation.valid) {
      logTrace("workflow.approval.invalid_command_reached", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        userId: message.userId,
        command,
        reason: commandValidation.reason,
      }, "warn");
      return {
        correlationId: message.correlationId,
        status: "success",
        text: `I need a few more details before I can run this safely.\n\nThe command has issues: ${commandValidation.reason}.\nPlease provide the missing values and I'll continue.`,
      };
    }

    const requiredRole: CapabilityRole = riskTier === "destructive" ? "commander" : "operator";
    const roleState = await this.capabilityStore.getRoleState(message.userId, message.chatId);

    const operatorActive = roleState.operator.active;
    const commanderActive = roleState.commander.active;

    if (!operatorActive && (requiredRole === "operator" || requiredRole === "commander")) {
      const activation = await this.capabilityStore.createActivation({
        role: "operator",
        userId: message.userId,
        chatId: message.chatId,
      });

      this.rememberActivationContinuation({
        role: "operator",
        activationId: activation.id,
        userId: message.userId,
        chatId: message.chatId,
        command,
        riskTier,
        description,
        correlationId: message.correlationId,
      });

      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: `Before I can run this safely, I need Operator access enabled for you.\n\nPlease send:\n/activate operator ${activation.id}\n\nI’ll continue automatically after that.`,
      };
    }

    if (requiredRole === "commander" && !commanderActive) {
      const activation = await this.capabilityStore.createActivation({
        role: "commander",
        userId: message.userId,
        chatId: message.chatId,
      });

      this.rememberActivationContinuation({
        role: "commander",
        activationId: activation.id,
        userId: message.userId,
        chatId: message.chatId,
        command,
        riskTier,
        description,
        correlationId: message.correlationId,
      });

      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: `This is a destructive action, so Commander access is required first.\n\nPlease send:\n/activate commander ${activation.id}\n\nI’ll continue automatically after that.`,
      };
    }

    logTrace("workflow.approval.start", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      userId: message.userId,
      riskTier,
      command,
      description,
    }, "warn");

    const confirmationMode = requiredRole === "commander" ? "confirm_target" : "approve_code";
    const confirmationTarget = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();

    const pendingAction = await this.capabilityStore.createPendingAction({
      role: requiredRole,
      userId: message.userId,
      chatId: message.chatId,
      runId: crypto.randomUUID(),
      riskTier,
      description,
      command,
      confirmationMode,
      confirmationTarget,
    });

    logTrace("workflow.approval.suspended", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      approvalId: pendingAction.id,
      runId: pendingAction.runId,
      riskTier,
      suspendedStep: "approval-gate",
    }, "warn");

    const riskLabel = riskTier === "destructive" ? "🔴 DESTRUCTIVE" : "🟡 Significant";
    const confirmInstruction = requiredRole === "commander"
      ? `/confirm ${pendingAction.confirmationTarget}`
      : `/approve ${pendingAction.id}`;

    return {
      correlationId: message.correlationId,
      status: "pending_approval",
      text: `${riskLabel} action detected.\n\n${description}\n\nCommand: \`${command}\`\n\nTo proceed, type exactly:\n${confirmInstruction}`,
      metadata: {
        approvalId: pendingAction.id,
        confirmationMode,
        confirmationTarget: pendingAction.confirmationTarget,
        suspendedStep: "approval-gate",
      },
    };
  }

  /**
   * Format a plan into a human-readable string.
   */
  private formatPlan(plan: Plan): string {
    const lines: string[] = [
      `📋 **Plan: ${plan.summary}**`,
      "",
    ];

    for (const step of plan.steps) {
      const riskEmoji =
        step.risk === "destructive" ? "🔴" :
        step.risk === "significant" ? "🟡" :
        step.risk === "low_risk" ? "🟢" : "⚪";

      lines.push(`${step.order}. ${riskEmoji} ${step.description}`);
      if (step.command) {
        lines.push(`   \`${step.command}\``);
      }
    }

    lines.push("");
    lines.push(`Overall risk: **${plan.overallRisk}**`);

    if (plan.estimatedDuration) {
      lines.push(`Estimated time: ${plan.estimatedDuration}`);
    }

    if (plan.warnings?.length) {
      lines.push("");
      lines.push("⚠️ Warnings:");
      for (const warning of plan.warnings) {
        lines.push(`  • ${warning}`);
      }
    }

    return lines.join("\n");
  }

  private buildPrompt(userMessage: string, conversationContext?: string): string {
    if (!conversationContext) {
      return userMessage;
    }

    return `Conversation context:\n${conversationContext}\n\nLatest user message: ${userMessage}`;
  }

  private getConversationContext(chatId: string): string | undefined {
    const turns = this.conversationHistory.get(chatId);
    if (!turns || turns.length === 0) {
      return undefined;
    }

    return turns
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
      .join("\n");
  }

  private recordTurn(chatId: string, role: "user" | "assistant", text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const history = this.conversationHistory.get(chatId) ?? [];
    const next = [...history, { role, text: trimmed }].slice(-MAX_HISTORY_TURNS);
    this.conversationHistory.set(chatId, next);
  }

  private rememberActivationContinuation(input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
    command: string;
    riskTier: string;
    description: string;
    correlationId: string;
  }): void {
    this.pendingActivationContinuations.set(`${input.role}:${input.activationId.toUpperCase()}`, {
      role: input.role,
      activationId: input.activationId.toUpperCase(),
      userId: input.userId,
      chatId: input.chatId,
      command: input.command,
      riskTier: input.riskTier,
      description: input.description,
      correlationId: input.correlationId,
      createdAtMs: Date.now(),
    });
  }

  private consumeActivationContinuation(
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ): PendingActivationContinuation | null {
    this.cleanupEphemeralState();
    const key = `${role}:${activationId.toUpperCase()}`;
    const entry = this.pendingActivationContinuations.get(key);
    if (!entry) {
      return null;
    }

    if (entry.userId !== userId || entry.chatId !== chatId || entry.role !== role) {
      return null;
    }

    this.pendingActivationContinuations.delete(key);
    return entry;
  }

  private cleanupEphemeralState(nowMs: number = Date.now()): void {
    for (const [key, entry] of this.pendingActivationContinuations.entries()) {
      if (nowMs - entry.createdAtMs > PENDING_CONTEXT_TTL_MS) {
        this.pendingActivationContinuations.delete(key);
      }
    }
  }
}
