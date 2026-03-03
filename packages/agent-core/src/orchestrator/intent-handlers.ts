import type { Agent } from "@mastra/core/agent";
import type { AgentResponse, NormalizedMessage } from "@helmsman/shared";
import type { IntentClassification } from "../agents/router.js";
import type { Plan } from "../agents/planner.js";
import { generatePlan } from "../agents/planner.js";
import { logTrace } from "../trace-logger.js";
import { MAX_STEPS } from "./constants.js";
import { buildPrompt, formatPlan, summarizeAgentRun, truncateForTelegram, validateApprovalCommand } from "./helpers.js";

export interface IntentHandlerContext {
  readonly devopsAgent: Agent;
  readonly plannerAgent: Agent;
  readonly runWithApproval: (
    message: NormalizedMessage,
    command: string,
    riskTier: string,
    description: string,
  ) => Promise<AgentResponse>;
  readonly generateElicitationResponse: (input: {
    message: NormalizedMessage;
    plan: Plan;
    conversationContext?: string;
    validation?: { valid: false; reason: string; missingValues?: string[] };
  }) => Promise<AgentResponse>;
}

export async function handleChatIntent(
  context: IntentHandlerContext,
  message: NormalizedMessage,
  _intent: IntentClassification,
  conversationContext?: string,
): Promise<AgentResponse> {
  logTrace("handler.chat.started", {
    correlationId: message.correlationId,
    chatId: message.chatId,
  });

  const prompt = buildPrompt(message.text, conversationContext);
  const result = await context.devopsAgent.generate(prompt);

  logTrace("handler.chat.completed", {
    correlationId: message.correlationId,
    chatId: message.chatId,
    ...summarizeAgentRun(result),
  });

  return {
    correlationId: message.correlationId,
    status: "success",
    text: truncateForTelegram(result.text, message.platform),
  };
}

export async function handleQueryIntent(
  context: IntentHandlerContext,
  message: NormalizedMessage,
  _intent: IntentClassification,
  conversationContext?: string,
): Promise<AgentResponse> {
  logTrace("handler.query.started", {
    correlationId: message.correlationId,
    chatId: message.chatId,
  });

  const queryPrompt = [
    message.text,
    "",
    "Query policy:",
    "- For AWS behavior/defaults/limits/policy questions, call aws_knowledge_lookup when available.",
    "- Do not rely on memory for AWS defaults/limits when tool grounding is possible.",
  ].join("\n");

  const prompt = buildPrompt(queryPrompt, conversationContext);
  const result = await context.devopsAgent.generate(prompt, {
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
    text: truncateForTelegram(result.text, message.platform),
  };
}

export async function handleSingleActionIntent(
  context: IntentHandlerContext,
  message: NormalizedMessage,
  _intent: IntentClassification,
  conversationContext?: string,
): Promise<AgentResponse> {
  logTrace("handler.single_action.started", {
    correlationId: message.correlationId,
    chatId: message.chatId,
  });

  const plannerPrompt = buildPrompt(message.text, conversationContext);
  const plan = await generatePlan(context.plannerAgent, plannerPrompt);

  const isRiskyPlan = plan.overallRisk === "significant" || plan.overallRisk === "destructive";

  const riskyStep = plan.steps.find(
    (step) => (step.risk === "significant" || step.risk === "destructive") && typeof step.command === "string" && step.command.trim().length > 0,
  );

  if (isRiskyPlan && !riskyStep) {
    return await context.generateElicitationResponse({
      message,
      plan,
      conversationContext,
    });
  }

  if (riskyStep?.command) {
    const validation = validateApprovalCommand(riskyStep.command);
    if (!validation.valid) {
      logTrace("handler.single_action.incomplete_command", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        command: riskyStep.command,
        reason: validation.reason,
        missingValues: validation.missingValues,
      }, "info");

      return await context.generateElicitationResponse({
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

    return await context.runWithApproval(
      message,
      riskyStep.command,
      riskyStep.risk,
      `${plan.summary}\nStep: ${riskyStep.description}`,
    );
  }

  const prompt = buildPrompt(message.text, conversationContext);
  const result = await context.devopsAgent.generate(prompt, {
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
    text: truncateForTelegram(result.text, message.platform),
  };
}

export async function handleMultiStepIntent(
  context: IntentHandlerContext,
  message: NormalizedMessage,
  _intent: IntentClassification,
  conversationContext?: string,
): Promise<AgentResponse> {
  logTrace("handler.multi_step.started", {
    correlationId: message.correlationId,
    chatId: message.chatId,
  });

  const plannerPrompt = buildPrompt(message.text, conversationContext);
  const plan = await generatePlan(context.plannerAgent, plannerPrompt);

  logTrace("handler.multi_step.plan_generated", {
    correlationId: message.correlationId,
    chatId: message.chatId,
    summary: plan.summary,
    stepCount: plan.steps.length,
    overallRisk: plan.overallRisk,
  });

  const planText = formatPlan(plan);

  if (plan.overallRisk === "significant" || plan.overallRisk === "destructive") {
    const firstRiskyStep = plan.steps.find(
      (step) => (step.risk === "significant" || step.risk === "destructive") && typeof step.command === "string" && step.command.trim().length > 0,
    );

    if (!firstRiskyStep?.command) {
      return await context.generateElicitationResponse({
        message,
        plan,
        conversationContext,
      });
    }

    const validation = validateApprovalCommand(firstRiskyStep.command);
    if (!validation.valid) {
      logTrace("handler.multi_step.incomplete_command", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        command: firstRiskyStep.command,
        reason: validation.reason,
        missingValues: validation.missingValues,
      }, "info");

      return await context.generateElicitationResponse({
        message,
        plan,
        conversationContext,
        validation,
      });
    }

    return await context.runWithApproval(
      message,
      firstRiskyStep.command,
      firstRiskyStep.risk,
      `${plan.summary}\nStep ${firstRiskyStep.order}: ${firstRiskyStep.description}\n\n${planText}`,
    );
  }

  const executionResult = await context.devopsAgent.generate(
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
    text: truncateForTelegram(executionResult.text, message.platform),
  };
}
