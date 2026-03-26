import { parseCommand, validateCommand } from "@helmsman/tools";
import type { CapabilityRole } from "../capability-store.js";
import type { Plan } from "../agents/planner.js";
import { previewText } from "../trace-logger.js";
import { MAX_RESPONSE_LENGTH } from "./constants.js";
import type {
  ApprovalValidationFailure,
  ApprovalValidationResult,
} from "./types.js";
import { buildSkillContext } from "../skills/index.js";

const TRUNCATION_HINT =
  '\n\n↳ Response shortened for chat. Ask "continue" to see more.';

export function truncateForTelegram(
  text: string,
  platform: string = "telegram",
): string {
  if (platform !== "telegram") {
    return text;
  }

  if (text.length <= MAX_RESPONSE_LENGTH) {
    return text;
  }

  const maxContentLength = MAX_RESPONSE_LENGTH - TRUNCATION_HINT.length;
  if (maxContentLength <= 0) {
    return text.slice(0, MAX_RESPONSE_LENGTH);
  }

  const sliced = text.slice(0, maxContentLength);
  const boundaryCandidates = [
    sliced.lastIndexOf("\n\n"),
    sliced.lastIndexOf("\n"),
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("! "),
    sliced.lastIndexOf("? "),
  ];

  const bestBoundary = Math.max(...boundaryCandidates);
  const minBoundary = Math.floor(maxContentLength * 0.6);
  const safeSlice =
    bestBoundary >= minBoundary ? sliced.slice(0, bestBoundary + 1) : sliced;

  return `${safeSlice.trimEnd()}${TRUNCATION_HINT}`;
}

export function summarizeAgentRun(result: unknown): Record<string, unknown> {
  const parsed = result as {
    text?: string;
    toolCalls?: Array<{ toolName?: string }>;
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
  };

  const toolNames = [
    ...(parsed.toolCalls ?? []).map((entry) => entry.toolName).filter(Boolean),
    ...(parsed.toolResults ?? [])
      .map((entry) => entry.toolName)
      .filter(Boolean),
  ];

  return {
    textPreview: previewText(parsed.text),
    toolCallsCount: parsed.toolCalls?.length ?? 0,
    toolResultsCount: parsed.toolResults?.length ?? 0,
    toolNames: Array.from(new Set(toolNames)),
  };
}

export function buildClarificationPromptFromPlan(plan: Plan): string {
  const warnings = (plan.warnings ?? []).filter(
    (warning) => warning.trim().length > 0,
  );
  const warningSection =
    warnings.length > 0
      ? `\n\nWhat I still need from you:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
      : "\n\nPlease share the missing parameters and I'll continue.";

  return `I can continue with this request, but I need a bit more detail before running any risky command.${warningSection}`;
}

export function validateApprovalCommand(
  command: string,
): ApprovalValidationResult {
  const hasTemplatePlaceholder = /<[a-z_][a-z0-9_]*>/i.test(command);
  if (hasTemplatePlaceholder) {
    const placeholders = command.match(/<[a-z_][a-z0-9_]*>/gi) ?? [];
    const missing = placeholders.map((p) =>
      p.replace(/[<>]/g, "").replace(/_/g, " "),
    );
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

export function buildClarificationFromInvalidCommand(
  plan: Plan,
  validation: ApprovalValidationFailure,
): string {
  const planWarnings = (plan.warnings ?? []).filter(
    (warning) => warning.trim().length > 0,
  );
  const placeholderWarnings = (validation.missingValues ?? []).map(
    (value) => `What ${value} should I use?`,
  );

  const warnings = planWarnings.length > 0 ? planWarnings : placeholderWarnings;

  const warningSection =
    warnings.length > 0
      ? `\n\nWhat I still need from you:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
      : "\n\nPlease share the missing parameters and I'll continue.";

  return `I can set this up, but I need a few details first.${warningSection}`;
}

export function summarizeDescription(description: string): string {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("Step ") &&
        !line.startsWith("📋") &&
        !line.startsWith("Overall risk"),
    );

  return lines[0] ?? description.trim();
}

export function formatApprovalMessage(input: {
  role: CapabilityRole;
  riskTier: string;
  description: string;
  command: string;
  confirmInstruction: string;
}): string {
  const title =
    input.role === "commander"
      ? "⚙️ Commander Action — Confirmation Required"
      : "⚙️ Operator Action — Confirmation Required";

  const riskLabel =
    input.riskTier === "destructive" ? "Destructive" : "Significant";
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

export function evaluateRecoveryResult(
  result: unknown,
): "success" | "error" | "unknown" {
  const parsed = result as {
    toolResults?: Array<{
      toolName?: string;
      result?: { success?: boolean; error?: string; output?: string };
    }>;
  };

  const shellResults = (parsed.toolResults ?? []).filter(
    (entry) => entry.toolName === "shell_execute",
  );
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

export function extractRecoveryErrors(result: unknown): string[] {
  const parsed = result as {
    toolResults?: Array<{
      toolName?: string;
      result?: { success?: boolean; error?: string; output?: string };
    }>;
  };

  const shellResults = (parsed.toolResults ?? []).filter(
    (entry) => entry.toolName === "shell_execute",
  );
  return shellResults
    .filter((entry) => entry.result?.success === false)
    .map(
      (entry) =>
        entry.result?.error ??
        entry.result?.output ??
        "unknown shell execution error",
    )
    .filter(
      (error): error is string =>
        typeof error === "string" && error.trim().length > 0,
    );
}

export function isLikelyQuestionForUser(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("?") ||
    /\b(can you|could you|would you|please provide|please confirm|should i proceed|proceed\?)\b/.test(
      normalized,
    )
  );
}

export function formatPlan(plan: Plan): string {
  const lines: string[] = [`📋 **Plan: ${plan.summary}**`, ""];

  for (const step of plan.steps) {
    const riskEmoji =
      step.risk === "destructive"
        ? "🔴"
        : step.risk === "significant"
          ? "🟡"
          : step.risk === "low_risk"
            ? "🟢"
            : "⚪";

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

export interface PromptMetadata {
  readonly chatId?: string;
  readonly userId?: string;
  readonly messageId?: string;
  readonly platform?: string;
}

export function buildPrompt(
  userMessage: string,
  conversationContext?: string,
  metadata?: PromptMetadata,
  skillSelectionMessage?: string,
): string {
  const now = new Date();
  const runtimeLines = [
    `Runtime datetime (UTC): ${now.toISOString()}`,
    "Autonomy: resolve relative dates and contextual resource references yourself before asking the user.",
    "Source policy: use tools for facts; use aws_knowledge_lookup for AWS behavior/limits/defaults when uncertain.",
  ];

  if (metadata?.chatId) {
    runtimeLines.push(
      `Session metadata — platform: ${metadata.platform ?? "telegram"}, chatId: ${metadata.chatId}, userId: ${metadata.userId ?? "unknown"}, messageId: ${metadata.messageId ?? "unknown"}`,
    );
  }

  const runtimeContext = runtimeLines.join("\n");
  const skillContext = buildSkillContext(skillSelectionMessage ?? userMessage);

  if (!conversationContext) {
    return [runtimeContext, skillContext, userMessage]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    runtimeContext,
    skillContext,
    `Conversation context:\n${conversationContext}`,
    `Latest user message: ${userMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildQueryPrompt(userMessage: string): string {
  return [
    userMessage,
    "",
    "Query policy:",
    "- For AWS behavior/defaults/limits/policy questions, call aws_knowledge_lookup when available.",
    "- Do not rely on memory for AWS defaults/limits when tool grounding is possible.",
  ].join("\n");
}

