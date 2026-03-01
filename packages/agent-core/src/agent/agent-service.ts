import {
  AgentResponse,
  NormalizedMessage,
  PolicyDecision,
  RiskTier,
  ToolExecutionRequest,
} from "@helmsman/shared";
import { ShellExecuteTool, type ToolRegistry } from "@helmsman/tools";

import { LLMMessage, LLMProvider } from "../llm/provider.js";
import { ConversationMemoryStore, InMemoryConversationMemoryStore } from "./conversation-memory.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface AgentService {
  handleMessage(message: NormalizedMessage): Promise<AgentResponse>;
}

export interface PolicyEngine {
  evaluate(request: ToolExecutionRequest, riskTier: RiskTier): Promise<PolicyDecision>;
}

export interface AuditService {
  log(event: any): Promise<void>;
}

interface ParsedToolCall {
  readonly toolName: string;
  readonly parameters: Record<string, unknown>;
}

const AMBIGUOUS_CONFIRMATION_PATTERN = /^(yes|y|ok|okay|sure|go ahead|proceed|do it)$/i;

const isAmbiguousConfirmation = (text: string): boolean => {
  return AMBIGUOUS_CONFIRMATION_PATTERN.test(text.trim());
};

const TOOL_ARTIFACT_PATTERN = /("type"\s*:\s*"tool_call"|"toolName"\s*:\s*"shell\.execute"|```(?:json|tool_code)?)/i;

const sanitizeForUser = (text: string): string => {
  const withoutFencedToolBlocks = text
    .replace(/```(?:json|tool_code)?\s*\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}\s*```/gi, "")
    .replace(/\{[\s\S]*?"type"\s*:\s*"tool_call"[\s\S]*?\}/gi, "")
    .replace(/Tool\s+shell\.execute[\s\S]*?(?:approval\.|execution\.)/gi, "")
    .trim();

  if (!withoutFencedToolBlocks || TOOL_ARTIFACT_PATTERN.test(withoutFencedToolBlocks)) {
    return "I can help with that. Tell me what infrastructure detail you want to check, and I’ll return a clean summary.";
  }

  return withoutFencedToolBlocks;
};

const didAssistantAskToProceed = (conversationHistory: readonly LLMMessage[]): boolean => {
  for (let index = conversationHistory.length - 1; index >= 0; index -= 1) {
    const message = conversationHistory[index];
    if (message?.role !== "assistant") {
      continue;
    }

    return /do you want me to proceed|want me to proceed|should i proceed|shall i proceed/i.test(message.content);
  }

  return false;
};

const shorten = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}…`;
};

const summarizeRawOutputFallback = (output: string): string => {
  try {
    const parsed = JSON.parse(output) as unknown;

    if (typeof parsed === "object" && parsed !== null && "Buckets" in parsed) {
      const buckets = (parsed as { Buckets?: Array<{ Name?: string; CreationDate?: string }> }).Buckets ?? [];
      const preview = buckets
        .slice(0, 12)
        .map((bucket, index) => `${index + 1}. ${bucket.Name ?? "unknown"}${bucket.CreationDate ? ` (${bucket.CreationDate.slice(0, 10)})` : ""}`)
        .join("\n");
      return [
        `I found ${buckets.length} S3 bucket(s).`,
        preview ? `Top buckets:\n${preview}` : "",
        buckets.length > 12 ? `…and ${buckets.length - 12} more.` : "",
      ].filter(Boolean).join("\n\n");
    }

    if (typeof parsed === "object" && parsed !== null && "DistributionList" in parsed) {
      const items = (parsed as {
        DistributionList?: { Items?: Array<{ Id?: string; DomainName?: string; Aliases?: { Quantity?: number } }> };
      }).DistributionList?.Items ?? [];

      const preview = items
        .slice(0, 10)
        .map((item, index) => {
          const aliases = item.Aliases?.Quantity ?? 0;
          return `${index + 1}. ${item.Id ?? "unknown"} — ${item.DomainName ?? "unknown-domain"} (${aliases} alias${aliases === 1 ? "" : "es"})`;
        })
        .join("\n");

      return [
        `I found ${items.length} CloudFront distribution(s).`,
        preview ? `Here are the first ones:\n${preview}` : "",
        items.length > 10 ? `…and ${items.length - 10} more.` : "",
      ].filter(Boolean).join("\n\n");
    }

    if (Array.isArray(parsed)) {
      const preview = parsed
        .slice(0, 10)
        .map((item, index) => `${index + 1}. ${shorten(JSON.stringify(item), 160)}`)
        .join("\n");

      return [
        `I found ${parsed.length} result(s).`,
        preview ? `Top results:\n${preview}` : "",
        parsed.length > 10 ? `…and ${parsed.length - 10} more.` : "",
      ].filter(Boolean).join("\n\n");
    }
  } catch {
    // fall through to plain-text fallback
  }

  return `I executed the command successfully.\n\n${shorten(output.replace(/\s+/g, " ").trim(), 700)}`;
};

const summarizeToolError = (errorText: string): string => {
  if (/Invalid choice/i.test(errorText)) {
    return "The command was not valid for this AWS service. I can retry with the correct operation name and then return a clean summary.";
  }

  if (/Command blocked:/i.test(errorText)) {
    return `I blocked that command for safety. ${errorText.replace(/^Command blocked:\s*/i, "")}`;
  }

  if (/timed out/i.test(errorText)) {
    return "The command timed out. I can retry with a narrower query (filters, region, or max-items).";
  }

  return `I couldn't complete that command. ${shorten(errorText, 280)}`;
};

const isAwsInvalidChoiceError = (errorText: string): boolean => {
  return /aws:\s*error:\s*argument\s+operation:\s*Invalid choice/i.test(errorText);
};

const isCommandSubstitutionBlockedError = (errorText: string): boolean => {
  return /Command substitution\s*\$\(\)\s*is blocked/i.test(errorText);
};

const formatIsoDate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

const rewriteCostExplorerDateSubstitutions = (command: string): string | null => {
  if (!/\baws\s+ce\s+get-cost-and-usage\b/i.test(command)) {
    return null;
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const startDate = formatIsoDate(monthStart);
  const endDate = formatIsoDate(today);

  const rewritten = command
    .replace(/\$\([^)]*%Y-%m-01[^)]*\)/gi, startDate)
    .replace(/\$\([^)]*%Y-%m-%d[^)]*\)/gi, endDate)
    .replace(/`[^`]*%Y-%m-01[^`]*`/gi, startDate)
    .replace(/`[^`]*%Y-%m-%d[^`]*`/gi, endDate);

  if (rewritten === command) {
    return null;
  }

  return rewritten;
};

const parseToolCallCandidate = (candidate: string): ParsedToolCall | null => {
  try {
    const parsed = JSON.parse(candidate) as {
      toolName?: unknown;
      parameters?: unknown;
      type?: unknown;
    };

    if (parsed.type !== "tool_call") {
      return null;
    }

    if (typeof parsed.toolName !== "string") {
      return null;
    }

    if (typeof parsed.parameters !== "object" || parsed.parameters === null) {
      return null;
    }

    return {
      toolName: parsed.toolName,
      parameters: parsed.parameters as Record<string, unknown>,
    };
  } catch {
    return null;
  }
};

const tryParseToolCall = (text: string): ParsedToolCall | null => {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  if (trimmed.startsWith("```")) {
    candidates.push(trimmed.replace(/^```(?:[a-zA-Z_-]+)?\s*/i, "").replace(/\s*```$/, ""));
  }

  const fencedBlockMatch = trimmed.match(/```(?:[a-zA-Z_-]+)?\s*([\s\S]*?)\s*```/);
  if (fencedBlockMatch?.[1]) {
    candidates.push(fencedBlockMatch[1]);
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    candidates.push(objectMatch[0]);
  }

  for (const candidate of candidates) {
    const parsed = parseToolCallCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const rememberConversationTurn = (
  memoryStore: ConversationMemoryStore,
  conversationId: string,
  userText: string,
  assistantText: string,
): void => {
  memoryStore.appendMessages(conversationId, [
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ]);
};

export class HelmsmanAgentService implements AgentService {
  private readonly llmProvider: LLMProvider;
  private readonly policyEngine?: PolicyEngine;
  private readonly auditService?: AuditService;
  private readonly toolRegistry?: ToolRegistry;
  private readonly memoryStore: ConversationMemoryStore;

  public constructor(config: { 
    llmProvider: LLMProvider;
    policyEngine?: PolicyEngine;
    auditService?: AuditService;
    toolRegistry?: ToolRegistry;
    memoryStore?: ConversationMemoryStore;
  }) {
    this.llmProvider = config.llmProvider;
    this.policyEngine = config.policyEngine;
    this.auditService = config.auditService;
    this.toolRegistry = config.toolRegistry;
    this.memoryStore = config.memoryStore ?? new InMemoryConversationMemoryStore();
  }

  public async handleMessage(message: NormalizedMessage): Promise<AgentResponse> {
    // 1. Log incoming message to audit
    await this.auditService?.log({
      type: "message_received",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: { text: message.text, platform: message.platform },
    });

    const toolDefinitions = this.toolRegistry?.getAllDefinitions() ?? [];
    const systemPrompt = buildSystemPrompt(JSON.stringify(toolDefinitions));

    const conversationId = `${message.platform}:${message.chatId}:${message.userId}`;
    const conversationHistory = this.memoryStore.getMessages(conversationId);
    const llmMessages: LLMMessage[] = [...conversationHistory, { role: "user", content: message.text }];

    const llmResult = await this.llmProvider.generate({
      systemPrompt,
      messages: llmMessages,
    });

    // 2. Log LLM response
    await this.auditService?.log({
      type: "llm_response",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: { text: llmResult.text, model: llmResult.model },
    });

    const parsedToolCall = tryParseToolCall(llmResult.text);
    if (!parsedToolCall) {
      const plainTextResponse = sanitizeForUser(llmResult.text);
      rememberConversationTurn(this.memoryStore, conversationId, message.text, plainTextResponse);

      return {
        correlationId: message.correlationId,
        status: "success",
        text: plainTextResponse,
        metadata: {
          model: llmResult.model,
        },
      };
    }

    if (
      parsedToolCall.toolName === "shell.execute"
      && isAmbiguousConfirmation(message.text)
      && !didAssistantAskToProceed(conversationHistory)
    ) {
      const clarification = "I need a specific instruction before running commands. Please tell me exactly what to do (for example: 'list running EC2 instances').";
      rememberConversationTurn(this.memoryStore, conversationId, message.text, clarification);

      return {
        correlationId: message.correlationId,
        status: "success",
        text: clarification,
        metadata: {
          model: llmResult.model,
        },
      };
    }

    if (parsedToolCall.toolName === "shell.execute" && typeof parsedToolCall.parameters.command !== "string") {
      return {
        correlationId: message.correlationId,
        status: "success",
        text: "I need a valid command target first. Please restate what you want to check in plain language.",
        metadata: {
          model: llmResult.model,
        },
      };
    }

    const tool = this.toolRegistry?.getTool(parsedToolCall.toolName);
    if (!tool) {
      const toolMissingResponse = `Tool '${parsedToolCall.toolName}' is not registered.`;
      rememberConversationTurn(this.memoryStore, conversationId, message.text, toolMissingResponse);

      return {
        correlationId: message.correlationId,
        status: "error",
        text: toolMissingResponse,
        metadata: {
          model: llmResult.model,
        },
      };
    }

    const policyRequest: ToolExecutionRequest = {
      toolName: parsedToolCall.toolName,
      parameters: parsedToolCall.parameters,
      correlationId: message.correlationId,
      userId: message.userId,
    };

    // Dynamic risk classification: if the tool supports it (e.g. ShellExecuteTool),
    // classify based on the actual command content rather than static definition.
    let riskTier: RiskTier = tool.definition.riskTier;
    if (tool instanceof ShellExecuteTool && typeof parsedToolCall.parameters.command === "string") {
      riskTier = tool.classifyRisk(parsedToolCall.parameters.command);
    }
    const policyDecision: PolicyDecision = this.policyEngine
      ? await this.policyEngine.evaluate(policyRequest, riskTier)
      : { action: "allow" };

    await this.auditService?.log({
      type: "policy_check",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: {
        toolName: parsedToolCall.toolName,
        riskTier,
        decision: policyDecision.action,
        reason: policyDecision.reason,
      },
    });

    if (policyDecision.action === "deny") {
      const deniedResponse = policyDecision.reason ?? "Policy denied this action.";
      rememberConversationTurn(this.memoryStore, conversationId, message.text, deniedResponse);

      return {
        correlationId: message.correlationId,
        status: "error",
        text: deniedResponse,
      };
    }

    if (policyDecision.action === "require_approval") {
      const pendingApprovalResponse = policyDecision.reason ?? "This action requires approval.";
      rememberConversationTurn(this.memoryStore, conversationId, message.text, pendingApprovalResponse);

      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: pendingApprovalResponse,
        metadata: {
          toolName: parsedToolCall.toolName,
          parameters: parsedToolCall.parameters,
          riskTier,
        },
      };
    }

    let toolResult = await tool.execute(parsedToolCall.parameters);

    if (
      !toolResult.success
      && tool instanceof ShellExecuteTool
      && typeof parsedToolCall.parameters.command === "string"
      && isAwsInvalidChoiceError(toolResult.error ?? "")
    ) {
      try {
        const retryPlan = await this.llmProvider.generate({
          systemPrompt:
            "You are fixing an AWS CLI command that failed with 'Invalid choice'. Respond with ONLY JSON tool_call for shell.execute. Constraints: read-only operation only, keep --output json, keep the same user intent.",
          messages: [
            {
              role: "user",
              content: [
                `User request: ${message.text}`,
                `Failed command: ${parsedToolCall.parameters.command}`,
                `CLI error: ${toolResult.error ?? "unknown"}`,
              ].join("\n\n"),
            },
          ],
        });

        const retryToolCall = tryParseToolCall(retryPlan.text);
        if (
          retryToolCall
          && retryToolCall.toolName === "shell.execute"
          && typeof retryToolCall.parameters.command === "string"
          && tool.classifyRisk(retryToolCall.parameters.command) === "read_only"
        ) {
          const retryResult = await tool.execute(retryToolCall.parameters);
          if (retryResult.success) {
            parsedToolCall.parameters.command = retryToolCall.parameters.command;
            toolResult = retryResult;
          }
        }
      } catch {
        // Ignore retry failure and return friendly error below.
      }
    }

    if (
      !toolResult.success
      && tool instanceof ShellExecuteTool
      && typeof parsedToolCall.parameters.command === "string"
      && isCommandSubstitutionBlockedError(toolResult.error ?? "")
    ) {
      const rewrittenCommand = rewriteCostExplorerDateSubstitutions(parsedToolCall.parameters.command);
      if (rewrittenCommand && tool.classifyRisk(rewrittenCommand) === "read_only") {
        const retryResult = await tool.execute({
          ...parsedToolCall.parameters,
          command: rewrittenCommand,
        });

        if (retryResult.success) {
          parsedToolCall.parameters.command = rewrittenCommand;
          toolResult = retryResult;
        }
      }
    }

    await this.auditService?.log({
      type: "tool_execution",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: {
        toolName: parsedToolCall.toolName,
        success: toolResult.success,
      },
    });

    if (!toolResult.success) {
      const toolErrorResponse = sanitizeForUser(summarizeToolError(toolResult.error ?? "Tool execution failed."));
      rememberConversationTurn(this.memoryStore, conversationId, message.text, toolErrorResponse);

      return {
        correlationId: message.correlationId,
        status: "error",
        text: toolErrorResponse,
      };
    }

    // Always use LLM to format output naturally — no deterministic formatters needed.
    // The rich system prompt ensures the LLM knows how to summarize CLI output.
    let finalAnswer: { text: string; model: string };
    try {
      finalAnswer = await this.llmProvider.generate({
        systemPrompt:
          "You are Helmsman. Reply in a conversational, human-friendly DevOps style. Never expose tool names, payload JSON, or raw command internals. Summarize results clearly with concrete findings, risks, and next step. Avoid dumping raw JSON.",
        messages: [
          { role: "user", content: `User request: ${message.text}` },
          {
            role: "assistant",
            content: `Tool ${parsedToolCall.toolName} executed command and returned:\n${toolResult.output}`,
          },
        ],
      });
    } catch {
      finalAnswer = {
        model: llmResult.model,
        text: summarizeRawOutputFallback(toolResult.output),
      };
    }

    const assistantResponse = sanitizeForUser(finalAnswer.text);
    rememberConversationTurn(this.memoryStore, conversationId, message.text, assistantResponse);

    return {
      correlationId: message.correlationId,
      status: "success",
      text: assistantResponse,
      metadata: {
        model: finalAnswer.model,
        toolName: parsedToolCall.toolName,
      },
    };
  }
}
