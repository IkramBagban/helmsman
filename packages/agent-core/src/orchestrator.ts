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

function summarizeDescription(description: string): string {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Step ") && !line.startsWith("📋") && !line.startsWith("Overall risk"));

  return lines[0] ?? description.trim();
}

function formatApprovalMessage(input: {
  role: CapabilityRole;
  riskTier: string;
  description: string;
  command: string;
  confirmInstruction: string;
}): string {
  const title = input.role === "commander"
    ? "⚙️ Commander Action — Confirmation Required"
    : "⚙️ Operator Action — Confirmation Required";

  const riskLabel = input.riskTier === "destructive" ? "Destructive" : "Significant";
  const whatThisDoes = summarizeDescription(input.description);

  return [
    title,
    "",
    "What this does:",
    `- ${whatThisDoes}`,
    `- Risk level: ${riskLabel}`,
    "",
    "Command (audit trail):",
    `\`${input.command}\``,
    "",
    "To confirm, type:",
    input.confirmInstruction,
  ].join("\n");
}

function evaluateRecoveryResult(result: unknown): "success" | "error" | "unknown" {
  const parsed = result as {
    toolResults?: Array<{ toolName?: string; result?: { success?: boolean; error?: string; output?: string } }>;
  };

  const shellResults = (parsed.toolResults ?? []).filter((entry) => entry.toolName === "shell_execute");
  if (shellResults.length === 0) {
    return "unknown";
  }

  const lastShell = shellResults[shellResults.length - 1]?.result;
  if (lastShell?.success === true) {
    return "success";
  }
  if (lastShell?.success === false) {
    return "error";
  }
  return "unknown";
}

function extractRecoveryErrors(result: unknown): string[] {
  const parsed = result as {
    toolResults?: Array<{ toolName?: string; result?: { success?: boolean; error?: string; output?: string } }>;
  };

  const shellResults = (parsed.toolResults ?? []).filter((entry) => entry.toolName === "shell_execute");
  return shellResults
    .filter((entry) => entry.result?.success === false)
    .map((entry) => entry.result?.error ?? entry.result?.output ?? "unknown shell execution error")
    .filter((error): error is string => typeof error === "string" && error.trim().length > 0);
}

function isLikelyQuestionForUser(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("?")
    || /\b(can you|could you|would you|please provide|please confirm|should i proceed|proceed\?)\b/.test(normalized);
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
        const recovered = await this.attemptAutomaticRecoveryAfterFailure(
          pendingAction,
          execution.error ?? execution.output ?? "unknown error",
        );
        if (recovered) {
          this.recordTurn(pendingAction.chatId, "assistant", recovered.text);
          return recovered;
        }

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

  private async attemptAutomaticRecoveryAfterFailure(
    pendingAction: PendingActionRecord,
    failureReason: string,
  ): Promise<AgentResponse | null> {
    try {
      let latestFailure = failureReason;
      let lastAssistantText: string | null = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const recoveryPrompt = [
          "An approved infrastructure action failed. Enter self-recovery mode.",
          "",
          `Attempt: ${attempt}/2`,
          `Original approved intent: ${pendingAction.description}`,
          `Original command: ${pendingAction.command}`,
          `Current failure: ${latestFailure}`,
          "",
          "Rules:",
          "1) Diagnose root cause from the error.",
          "2) If recoverable, do read-only discovery first, then execute a corrected command.",
          "3) Do not ask the user for values you can discover yourself.",
          "4) If the only safe next move requires user judgment, ask exactly one concise question with one proposed next action.",
          "5) Never request secrets (private keys/tokens/passwords).",
          "6) Be transparent: briefly mention what failed and what you changed.",
        ].join("\n");

        const recoveryResult = await this.devopsAgent.generate(
          this.buildPrompt(recoveryPrompt, this.getConversationContext(pendingAction.chatId)),
          { maxSteps: MAX_STEPS },
        );

        lastAssistantText = recoveryResult.text;
        const outcome = evaluateRecoveryResult(recoveryResult);
        const observedErrors = extractRecoveryErrors(recoveryResult);

        if (outcome === "success") {
          return {
            correlationId: crypto.randomUUID(),
            status: "success",
            text: truncateForTelegram(recoveryResult.text),
          };
        }

        if (observedErrors.length > 0) {
          latestFailure = observedErrors.join(" | ");
        }
      }

      const finalText = (lastAssistantText ?? `Approved action failed: ${latestFailure}`).trim();
      const finalStatus: AgentResponse["status"] = isLikelyQuestionForUser(finalText) ? "success" : "error";

      return {
        correlationId: crypto.randomUUID(),
        status: finalStatus,
        text: truncateForTelegram(finalText),
      };
    } catch (error) {
      logTrace("approval.recovery.failed", {
        approvalId: pendingAction.id,
        runId: pendingAction.runId,
        error: error instanceof Error ? error.message : String(error),
      }, "warn");
      return null;
    }
  }

  private async generateApprovalMessage(input: {
    role: CapabilityRole;
    riskTier: string;
    description: string;
    command: string;
    confirmInstruction: string;
  }): Promise<string> {
    const fallback = formatApprovalMessage(input);

    const prompt = [
      "Compose a concise approval/confirmation briefing for an infrastructure action.",
      "",
      `Role required: ${input.role}`,
      `Risk tier: ${input.riskTier}`,
      `Action description: ${input.description}`,
      `Command (audit trail): ${input.command}`,
      `Confirmation instruction: ${input.confirmInstruction}`,
      "",
      "Output requirements:",
      "1) Explain what the action does in plain English.",
      "2) Add context-aware consequences and risk notes relevant to this command.",
      "3) If specific impact is unknown, say what is unknown without inventing numbers.",
      "4) Include the exact confirmation instruction unchanged.",
      "5) Keep command as secondary audit-trail detail.",
    ].join("\n");

    try {
      const result = await this.responderAgent.generate(prompt);
      const text = result.text?.trim();
      if (!text || text.length === 0) {
        return fallback;
      }

      if (!text.includes(input.confirmInstruction)) {
        return fallback;
      }

      return truncateForTelegram(text);
    } catch {
      return fallback;
    }
  }

  private async generateElicitationResponse(input: {
    message: NormalizedMessage;
    plan: Plan;
    conversationContext?: string;
    validation?: { valid: false; reason: string; missingValues?: string[] };
  }): Promise<AgentResponse> {
    const fallback = input.validation
      ? buildClarificationFromInvalidCommand(input.plan, input.validation)
      : buildClarificationPromptFromPlan(input.plan);

    const planWarnings = (input.plan.warnings ?? []).filter((warning) => warning.trim().length > 0);
    const missingFromValidation = (input.validation?.missingValues ?? []).filter((value) => value.trim().length > 0);
    const missingContext = [
      ...planWarnings.map((warning) => `- ${warning}`),
      ...missingFromValidation.map((value) => `- ${value}`),
    ];

    const elicitationPrompt = [
      "You are preparing a parameter-elicitation response before a risky infrastructure action.",
      "",
      `User request: ${input.message.text}`,
      `Plan summary: ${input.plan.summary}`,
      `Plan risk: ${input.plan.overallRisk}`,
      input.validation ? `Validation issue: ${input.validation.reason}` : "Validation issue: missing executable risky command",
      "",
      "Known missing or ambiguous inputs:",
      missingContext.length > 0 ? missingContext.join("\n") : "- none explicitly listed",
      "",
      "Response requirements:",
      "1) Ask only for truly missing fields.",
      "2) If something can be discovered with read-only checks, say you can fetch it automatically.",
      "3) Suggest sensible defaults as optional suggestions, not assumptions.",
      "4) Keep it concise and actionable in Telegram style.",
      "5) Never include write/destructive commands in this response.",
      "6) Ask as few questions as possible and group related inputs.",
    ].join("\n");

    try {
      const result = await this.responderAgent.generate(
        this.buildPrompt(elicitationPrompt, input.conversationContext),
      );

      const text = result.text?.trim();
      if (!text) {
        return {
          correlationId: input.message.correlationId,
          status: "success",
          text: fallback,
        };
      }

      return {
        correlationId: input.message.correlationId,
        status: "success",
        text: truncateForTelegram(text),
      };
    } catch {
      return {
        correlationId: input.message.correlationId,
        status: "success",
        text: fallback,
      };
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
      return await this.generateElicitationResponse({
        message,
        plan,
        conversationContext,
      });
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

        return await this.generateElicitationResponse({
          message,
          plan,
          conversationContext,
          validation,
        });
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
        return await this.generateElicitationResponse({
          message,
          plan,
          conversationContext,
        });
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

        return await this.generateElicitationResponse({
          message,
          plan,
          conversationContext,
          validation,
        });
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

    const confirmInstruction = requiredRole === "commander"
      ? `/confirm ${pendingAction.confirmationTarget}`
      : `/approve ${pendingAction.id}`;

    const approvalText = await this.generateApprovalMessage({
      role: requiredRole,
      riskTier,
      description,
      command,
      confirmInstruction,
    });

    return {
      correlationId: message.correlationId,
      status: "pending_approval",
      text: approvalText,
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
    const today = new Date().toISOString().slice(0, 10);
    const runtimeContext = [
      `Runtime date (UTC): ${today}`,
      "Autonomy: resolve relative dates and contextual resource references yourself before asking the user.",
    ].join("\n");

    if (!conversationContext) {
      return `${runtimeContext}\n\n${userMessage}`;
    }

    return `${runtimeContext}\n\nConversation context:\n${conversationContext}\n\nLatest user message: ${userMessage}`;
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
