import type { Agent } from "@mastra/core/agent";
import type { AgentResponse, NormalizedMessage } from "@helmsman/shared";
import type { PendingActionRecord, CapabilityRole, CapabilityStore } from "../capability-store.js";
import { createActionRequest } from "@helmsman/action-gateway";
import { logTrace, previewText } from "../trace-logger.js";
import type { Plan } from "../agents/planner.js";
import type { ConversationState } from "./conversation-state.js";
import { MAX_STEPS } from "./constants.js";
import {
  buildClarificationFromInvalidCommand,
  buildClarificationPromptFromPlan,
  buildPrompt,
  evaluateRecoveryResult,
  extractRecoveryErrors,
  formatApprovalMessage,
  isLikelyQuestionForUser,
  truncateForTelegram,
  validateApprovalCommand,
} from "./helpers.js";

export interface ApprovalFlowContext {
  readonly state: ConversationState;
  readonly capabilityStore: CapabilityStore;
  readonly devopsAgent: Agent;
  readonly responderAgent: Agent;
  readonly executeShell: (command: string) => Promise<{ success: boolean; output: string; error?: string }>;
}

export interface ElicitationInput {
  readonly message: NormalizedMessage;
  readonly plan: Plan;
  readonly conversationContext?: string;
  readonly validation?: { valid: false; reason: string; missingValues?: string[] };
}

export async function resumePendingAction(
  context: ApprovalFlowContext,
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

    const execution = await context.executeShell(pendingAction.command);

    if (!execution.success) {
      const recovered = await attemptAutomaticRecoveryAfterFailure(
        context,
        pendingAction,
        execution.error ?? execution.output ?? "unknown error",
      );
      if (recovered) {
        context.state.recordTurn(pendingAction.chatId, "assistant", recovered.text);
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
      context.state.recordTurn(pendingAction.chatId, "assistant", response.text);
      return response;
    }

    const formatted = await context.responderAgent.generate(
      `User's original question: ${pendingAction.description ?? pendingAction.command}\n\nTool output:\n${execution.output}`,
    );

    const response: AgentResponse = {
      correlationId: crypto.randomUUID(),
      status: "success",
      text: truncateForTelegram(formatted.text),
    };
    logTrace("approval.resume.completed", {
      approvalId: pendingAction.id,
      runId: pendingAction.runId,
      status: response.status,
      responsePreview: previewText(response.text),
    });
    context.state.recordTurn(pendingAction.chatId, "assistant", response.text);
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
    context.state.recordTurn(pendingAction.chatId, "assistant", response.text);
    return response;
  }
}

export async function attemptAutomaticRecoveryAfterFailure(
  context: ApprovalFlowContext,
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
        "3.1) If the failure depends on uncertain AWS behavior/limits/defaults, call aws_knowledge_lookup before retrying.",
        "4) If the only safe next move requires user judgment, ask exactly one concise question with one proposed next action.",
        "5) Never request secrets (private keys/tokens/passwords).",
        "6) Be transparent: briefly mention what failed and what you changed.",
      ].join("\n");

      const recoveryResult = await context.devopsAgent.generate(
        buildPrompt(
          recoveryPrompt,
          context.state.getConversationContext(pendingAction.chatId),
          { userId: pendingAction.userId, chatId: pendingAction.chatId }
        ),
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

export async function generateApprovalMessage(
  context: Pick<ApprovalFlowContext, "responderAgent">,
  input: {
    role: CapabilityRole;
    riskTier: string;
    description: string;
    command: string;
    confirmInstruction: string;
  },
): Promise<string> {
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
    const result = await context.responderAgent.generate(prompt);
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

export async function generateElicitationResponse(
  context: Pick<ApprovalFlowContext, "responderAgent">,
  input: ElicitationInput,
): Promise<AgentResponse> {
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
    "2.1) If uncertainty is about AWS service behavior/defaults/limits, state that you'll verify via aws_knowledge_lookup.",
    "3) Suggest sensible defaults as optional suggestions, not assumptions.",
    "4) Keep it concise and actionable in Telegram style.",
    "5) Never include write/destructive commands in this response.",
    "6) Ask as few questions as possible and group related inputs.",
  ].join("\n");

  try {
    const result = await context.responderAgent.generate(
      buildPrompt(elicitationPrompt, input.conversationContext),
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

export async function runWithApproval(
  context: ApprovalFlowContext & {
    generateApprovalMessageFn: (input: {
      role: CapabilityRole;
      riskTier: string;
      description: string;
      command: string;
      confirmInstruction: string;
    }) => Promise<string>;
  },
  message: NormalizedMessage,
  command: string,
  riskTier: string,
  description: string,
): Promise<AgentResponse> {
  context.state.cleanupEphemeralState();

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

  const actionRequest = await createActionRequest({
    capabilityStore: context.capabilityStore,
    userId: message.userId,
    chatId: message.chatId,
    riskTier,
    description,
    command,
    correlationId: message.correlationId,
    rememberActivationContinuation: (continuation) => {
      context.state.rememberActivationContinuation({
        role: continuation.role,
        activationId: continuation.activationId,
        userId: continuation.userId,
        chatId: continuation.chatId,
        command: continuation.command,
        riskTier: continuation.riskTier,
        description: continuation.description,
        correlationId: continuation.correlationId,
      });
    },
  });

  if (actionRequest.type === "activation_required") {
    const roleText = actionRequest.role === "operator"
      ? "Before I can run this safely, I need Operator access enabled for you."
      : "This is a destructive action, so Commander access is required first.";

    return {
      correlationId: message.correlationId,
      status: "pending_approval",
      text: `${roleText}\n\nPlease send:\n/activate ${actionRequest.role} ${actionRequest.activationId}\n\nI’ll continue automatically after that.`,
    };
  }

  const requiredRole: CapabilityRole = actionRequest.role;

  logTrace("workflow.approval.start", {
    correlationId: message.correlationId,
    chatId: message.chatId,
    userId: message.userId,
    riskTier,
    command,
    description,
  }, "warn");

  const pendingAction = actionRequest.pendingAction;

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

  const approvalText = await context.generateApprovalMessageFn({
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
      confirmationMode: pendingAction.confirmationMode,
      confirmationTarget: pendingAction.confirmationTarget,
      suspendedStep: "approval-gate",
    },
  };
}
