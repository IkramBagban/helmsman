import {
  AgentResponse,
  NormalizedMessage,
  PolicyDecision,
  RiskTier,
  ToolExecutionRequest,
} from "@helmsman/shared";
import { ShellExecuteTool, type ToolRegistry } from "@helmsman/tools";

import { LLMProvider } from "../llm/provider.js";
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
    .trim();

  if (!withoutFencedToolBlocks || TOOL_ARTIFACT_PATTERN.test(withoutFencedToolBlocks)) {
    return "I can help with that. Tell me what infrastructure detail you want to check, and I’ll return a clean summary.";
  }

  return withoutFencedToolBlocks;
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

export class HelmsmanAgentService implements AgentService {
  private readonly llmProvider: LLMProvider;
  private readonly policyEngine?: PolicyEngine;
  private readonly auditService?: AuditService;
  private readonly toolRegistry?: ToolRegistry;

  public constructor(config: { 
    llmProvider: LLMProvider;
    policyEngine?: PolicyEngine;
    auditService?: AuditService;
    toolRegistry?: ToolRegistry;
  }) {
    this.llmProvider = config.llmProvider;
    this.policyEngine = config.policyEngine;
    this.auditService = config.auditService;
    this.toolRegistry = config.toolRegistry;
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

    const llmResult = await this.llmProvider.generate({
      systemPrompt,
      messages: [{ role: "user", content: message.text }],
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
      return {
        correlationId: message.correlationId,
        status: "success",
        text: sanitizeForUser(llmResult.text),
        metadata: {
          model: llmResult.model,
        },
      };
    }

    if (parsedToolCall.toolName === "shell.execute" && isAmbiguousConfirmation(message.text)) {
      return {
        correlationId: message.correlationId,
        status: "success",
        text: "I need a specific instruction before running commands. Please tell me exactly what to do (for example: 'list running EC2 instances').",
        metadata: {
          model: llmResult.model,
        },
      };
    }

    const tool = this.toolRegistry?.getTool(parsedToolCall.toolName);
    if (!tool) {
      return {
        correlationId: message.correlationId,
        status: "error",
        text: `Tool '${parsedToolCall.toolName}' is not registered.`,
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
      return {
        correlationId: message.correlationId,
        status: "error",
        text: policyDecision.reason ?? "Policy denied this action.",
      };
    }

    if (policyDecision.action === "require_approval") {
      return {
        correlationId: message.correlationId,
        status: "pending_approval",
        text: policyDecision.reason ?? "This action requires approval.",
        metadata: {
          toolName: parsedToolCall.toolName,
          parameters: parsedToolCall.parameters,
          riskTier,
        },
      };
    }

    const toolResult = await tool.execute(parsedToolCall.parameters);

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
      return {
        correlationId: message.correlationId,
        status: "error",
        text: toolResult.error ?? "Tool execution failed.",
      };
    }

    // Always use LLM to format output naturally — no deterministic formatters needed.
    // The rich system prompt ensures the LLM knows how to summarize CLI output.
    let finalAnswer: { text: string; model: string };
    try {
      finalAnswer = await this.llmProvider.generate({
        systemPrompt:
          "You are Helmsman. Summarize tool output in plain operator language. Format as: 1) What I found, 2) Why it matters, 3) Recommended next step. Avoid raw JSON unless explicitly requested.",
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
        text: [
          "1) What I found:",
          toolResult.output.slice(0, 1500),
          "",
          "2) Why it matters:",
          "This is the direct output from the executed command.",
          "",
          "3) Recommended next step:",
          "If you want, I can refine this into a concise table or run a more targeted query.",
        ].join("\n"),
      };
    }

    return {
      correlationId: message.correlationId,
      status: "success",
      text: sanitizeForUser(finalAnswer.text),
      metadata: {
        model: finalAnswer.model,
        toolName: parsedToolCall.toolName,
      },
    };
  }
}
