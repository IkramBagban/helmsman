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
import { classifyShellCommandRisk } from "./tools/shell-execute.js";
import { logTrace, previewText } from "./trace-logger.js";
import { infraWorkflow, approvalStep, type InfraWorkflowInput } from "./workflows/infra-workflow.js";
import { detectPromptInjectionAttempt, PROMPT_INJECTION_REFUSAL } from "./security/prompt-injection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HelmsmanConfig {
  readonly routerAgent: Agent;
  readonly devopsAgent: Agent;
  readonly plannerAgent: Agent;
  readonly responderAgent: Agent;
}

export interface PendingApproval {
  readonly runId: string;
  readonly userId: string;
  readonly chatId: string;
  readonly command: string;
  readonly riskTier: string;
  readonly description?: string;
  readonly message: string;
  readonly createdAt: Date;
}

interface ConversationTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** Max characters in a final response — Telegram-safe. */
const MAX_RESPONSE_LENGTH = 3000;
/** Max tool iterations for the DevOps agent. */
const MAX_STEPS = 8;
/** Max short-term conversation turns retained in-memory per chat. */
const MAX_HISTORY_TURNS = 8;

// ---------------------------------------------------------------------------
// In-memory store for pending workflow runs (replaced by persistent store later)
// ---------------------------------------------------------------------------

const pendingApprovals = new Map<string, { runId: string; approval: PendingApproval }>();

export function getPendingApproval(approvalId: string): PendingApproval | undefined {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return undefined;

  // Expire after 15 minutes
  const now = Date.now();
  if (now - pending.approval.createdAt.getTime() > 15 * 60 * 1000) {
    pendingApprovals.delete(approvalId);
    return undefined;
  }

  return pending.approval;
}

export function consumePendingApproval(approvalId: string): { runId: string; approval: PendingApproval } | undefined {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return undefined;

  // Expire after 15 minutes
  const now = Date.now();
  if (now - pending.approval.createdAt.getTime() > 15 * 60 * 1000) {
    pendingApprovals.delete(approvalId);
    return undefined;
  }

  pendingApprovals.delete(approvalId);
  return pending;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateForTelegram(text: string): string {
  if (text.length <= MAX_RESPONSE_LENGTH) return text;
  return `${text.slice(0, MAX_RESPONSE_LENGTH)}\n\n…(truncated)`;
}

function generateApprovalId(): string {
  return crypto.randomUUID().slice(0, 8);
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

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class HelmsmanOrchestrator {
  private readonly routerAgent: Agent;
  private readonly devopsAgent: Agent;
  private readonly plannerAgent: Agent;
  private readonly responderAgent: Agent;
  private readonly conversationHistory = new Map<string, ConversationTurn[]>();

  constructor(config: HelmsmanConfig) {
    this.routerAgent = config.routerAgent;
    this.devopsAgent = config.devopsAgent;
    this.plannerAgent = config.plannerAgent;
    this.responderAgent = config.responderAgent;
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

    const pending = consumePendingApproval(approvalId);

    if (!pending) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Approval request not found, expired, or already used.",
      };
    }

    if (pending.approval.userId !== userId || pending.approval.chatId !== chatId) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "This approval request doesn't belong to you.",
      };
    }

    // Resume the workflow with approval
    try {
      const run = await infraWorkflow.createRun({ runId: pending.runId });
      logTrace("approval.resume.started", {
        approvalId,
        runId: pending.runId,
        riskTier: pending.approval.riskTier,
        userId,
        chatId,
      });
      const result = await run.resume({
        step: approvalStep,
        resumeData: { approved: true },
      });

      if (result.status === "success") {
        const output = result.result as { success: boolean; output: string; error?: string };
        if (output.success) {
          // Format via responder
          const formatted = await formatResponse(
            this.responderAgent,
            output.output,
            pending.approval.description ?? pending.approval.command,
          );
          const response: AgentResponse = {
            correlationId: crypto.randomUUID(),
            status: "success",
            text: truncateForTelegram(formatted),
          };
          logTrace("approval.resume.completed", {
            approvalId,
            runId: pending.runId,
            status: response.status,
            responsePreview: previewText(response.text),
          });
          this.recordTurn(chatId, "assistant", response.text);
          return response;
        }

        const response: AgentResponse = {
          correlationId: crypto.randomUUID(),
          status: "error",
          text: `Approved action failed: ${output.error ?? "unknown error"}`,
        };
        logTrace("approval.resume.completed", {
          approvalId,
          runId: pending.runId,
          status: response.status,
          error: output.error ?? "unknown error",
        }, "warn");
        this.recordTurn(chatId, "assistant", response.text);
        return response;
      }

      const response: AgentResponse = {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Workflow completed with unexpected status.",
      };
      logTrace("approval.resume.unexpected-status", {
        approvalId,
        runId: pending.runId,
        workflowStatus: result.status,
      }, "warn");
      this.recordTurn(chatId, "assistant", response.text);
      return response;
    } catch (error) {
      logTrace("approval.resume.failed", {
        approvalId,
        userId,
        chatId,
        error: error instanceof Error ? error.message : String(error),
      }, "error");
      const response: AgentResponse = {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Failed to execute the approved action. Please try again.",
      };
      this.recordTurn(chatId, "assistant", response.text);
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

    // Let the DevOps agent attempt the action with tools
    const prompt = this.buildPrompt(message.text, conversationContext);
    const result = await this.devopsAgent.generate(prompt, {
      maxSteps: MAX_STEPS,
    });

    logTrace("handler.single_action.completed", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      ...summarizeAgentRun(result),
    });

    // Check if any tool call involves a risky command
    // Look for shell_execute calls in the tool results
    const toolResults = result.toolResults ?? [];
    for (const toolResult of toolResults) {
      const tr = toolResult as { toolName?: string; args?: Record<string, unknown>; result?: Record<string, unknown> };
      if (tr.toolName === "shell_execute" && tr.args && typeof tr.args.command === "string") {
        const risk = classifyShellCommandRisk(tr.args.command);
        if (risk === "significant" || risk === "destructive") {
          logTrace("handler.single_action.approval_required", {
            correlationId: message.correlationId,
            chatId: message.chatId,
            command: tr.args.command,
            risk,
          }, "warn");
          // The agent already ran the command through native tool calling,
          // but our shell_execute wrapper checks safety rules.
          // For approval flow, we use the workflow instead.
          return await this.runWithApproval(
            message,
            tr.args.command,
            risk,
            `${message.text}`,
          );
        }
      }
    }

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

    // If the plan has significant or destructive steps, require approval
    if (plan.overallRisk === "significant" || plan.overallRisk === "destructive") {
      const approvalId = generateApprovalId();

      pendingApprovals.set(approvalId, {
        runId: crypto.randomUUID(),
        approval: {
          runId: crypto.randomUUID(),
          userId: message.userId,
          chatId: message.chatId,
          command: JSON.stringify(plan.steps.map((s) => s.command ?? s.description)),
          riskTier: plan.overallRisk,
          description: plan.summary,
          message: planText,
          createdAt: new Date(),
        },
      });

      logTrace("handler.multi_step.approval_created", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        approvalId,
        overallRisk: plan.overallRisk,
        stepCount: plan.steps.length,
      }, "warn");

      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: `${planText}\n\nReply with /approve ${approvalId} to execute this plan.`,
        plan: {
          id: approvalId,
          summary: plan.summary,
          steps: plan.steps.map((s) => ({
            order: s.order,
            description: s.description,
            tool: s.tool,
            risk: s.risk,
          })),
          riskTier: plan.overallRisk as RiskTier,
          estimatedDuration: plan.estimatedDuration,
        },
      };
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
    logTrace("workflow.approval.start", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      userId: message.userId,
      riskTier,
      command,
      description,
    }, "warn");

    const input: InfraWorkflowInput = {
      command,
      riskTier,
      userId: message.userId,
      chatId: message.chatId,
      description,
    };

    const run = await infraWorkflow.createRun();
    const result = await run.start({ inputData: input });

    if (result.status === "suspended") {
      // Store pending approval for resume
      const approvalId = generateApprovalId();
      const suspendedStep = result.suspended?.[0];

      pendingApprovals.set(approvalId, {
        runId: run.runId,
        approval: {
          runId: run.runId,
          userId: message.userId,
          chatId: message.chatId,
          command,
          riskTier,
          description,
          message: `This action requires your approval:\n\n${description}\n\nCommand: \`${command}\``,
          createdAt: new Date(),
        },
      });

      logTrace("workflow.approval.suspended", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        approvalId,
        runId: run.runId,
        riskTier,
        suspendedStep: suspendedStep ?? "approval-gate",
      }, "warn");

      const riskLabel = riskTier === "destructive" ? "🔴 DESTRUCTIVE" : "🟡 Significant";
      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: `${riskLabel} action detected.\n\n${description}\n\nCommand: \`${command}\`\n\nReply with /approve ${approvalId} to proceed.`,
        metadata: {
          approvalId,
          suspendedStep: suspendedStep ?? "approval-gate",
        },
      };
    }

    // Ran through (read_only or low_risk)
    if (result.status === "success") {
      const output = result.result as { success: boolean; output: string; error?: string };
      if (output.success) {
        const formatted = await formatResponse(this.responderAgent, output.output, description);
        logTrace("workflow.approval.completed", {
          correlationId: message.correlationId,
          chatId: message.chatId,
          runId: run.runId,
          status: "success",
          outputPreview: previewText(output.output),
        });
        return {
          correlationId: message.correlationId,
          status: "success",
          text: truncateForTelegram(formatted),
        };
      }

      logTrace("workflow.approval.completed", {
        correlationId: message.correlationId,
        chatId: message.chatId,
        runId: run.runId,
        status: "error",
        error: output.error ?? "Action failed.",
      }, "warn");

      return {
        correlationId: message.correlationId,
        status: "error",
        text: output.error ?? "Action failed.",
      };
    }

    logTrace("workflow.approval.unexpected_status", {
      correlationId: message.correlationId,
      chatId: message.chatId,
      runId: run.runId,
      workflowStatus: result.status,
    }, "warn");

    return {
      correlationId: message.correlationId,
      status: "error",
      text: "Workflow completed with unexpected status.",
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
}
