import {
  AgentResponse,
  NormalizedMessage,
  PolicyDecision,
  RiskTier,
  ToolExecutionRequest,
} from "@helmsman/shared";
import type { ToolRegistry } from "@helmsman/tools";

import { LLMProvider } from "../llm/provider.js";

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

interface S3BucketLike {
  readonly Name?: unknown;
  readonly CreationDate?: unknown;
}

const tryParseToolCall = (text: string): ParsedToolCall | null => {
  const trimmed = text.trim();
  const jsonCandidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(jsonCandidate) as {
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

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
};

const summarizeS3Buckets = (rawOutput: string): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const buckets = parsed
    .filter((item): item is S3BucketLike => typeof item === "object" && item !== null)
    .map((item) => ({
      name: typeof item.Name === "string" ? item.Name : "unknown-bucket",
      creationDate: typeof item.CreationDate === "string" ? item.CreationDate : "unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (buckets.length === 0) {
    return "I checked your account and no S3 buckets were found.";
  }

  const preview = buckets
    .slice(0, 8)
    .map((bucket) => `- ${bucket.name} (created ${formatDate(bucket.creationDate)})`)
    .join("\n");

  const infraBuckets = buckets.filter((bucket) =>
    /cdk|serverless|deployment|assets/i.test(bucket.name),
  );

  const infraNote = infraBuckets.length > 0
    ? `\n\nObservation: ${infraBuckets.length} bucket(s) look infrastructure-managed (CDK/Serverless/deployment).`
    : "";

  const remainder = buckets.length > 8
    ? `\n\n…and ${buckets.length - 8} more bucket(s).`
    : "";

  return [
    `You currently have ${buckets.length} S3 bucket(s).`,
    "",
    "Top buckets:",
    preview,
    infraNote,
    remainder,
    "",
    "Next step: If you want, I can flag buckets that may need lifecycle, encryption, or public-access review.",
  ].join("\n").trim();
};

const summarizeKnownToolOutput = (toolName: string, rawOutput: string): string | null => {
  if (toolName === "aws:s3:ListBuckets") {
    return summarizeS3Buckets(rawOutput);
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
    const toolPrompt = toolDefinitions.length > 0
      ? `Available tools (JSON array): ${JSON.stringify(toolDefinitions)}. If a tool is required, respond with ONLY strict JSON: {"type":"tool_call","toolName":"<name>","parameters":{}}.`
      : "No tools are available.";

    const llmResult = await this.llmProvider.generate({
      systemPrompt:
        `You are Helmsman, a helpful DevOps assistant. Keep responses concise, safe, and actionable. ${toolPrompt}`,
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
        text: llmResult.text,
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

    const riskTier: RiskTier = tool.definition.riskTier;
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

    const deterministicSummary = summarizeKnownToolOutput(parsedToolCall.toolName, toolResult.output);
    if (deterministicSummary) {
      return {
        correlationId: message.correlationId,
        status: "success",
        text: deterministicSummary,
        metadata: {
          model: llmResult.model,
          toolName: parsedToolCall.toolName,
          summarySource: "deterministic",
        },
      };
    }

    const finalAnswer = await this.llmProvider.generate({
      systemPrompt:
        "You are Helmsman. Summarize tool output in plain operator language. Format exactly as: 1) What I found, 2) Why it matters, 3) Recommended next step. Avoid raw JSON unless explicitly requested.",
      messages: [
        { role: "user", content: `User request: ${message.text}` },
        {
          role: "assistant",
          content: `Tool ${parsedToolCall.toolName} output: ${toolResult.output}`,
        },
      ],
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: finalAnswer.text,
      metadata: {
        model: finalAnswer.model,
        toolName: parsedToolCall.toolName,
      },
    };
  }
}
