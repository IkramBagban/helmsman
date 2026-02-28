import { AgentResponse, NormalizedMessage, PolicyDecision, ToolExecutionRequest, RiskTier } from "@helmsman/shared";

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

export class HelmsmanAgentService implements AgentService {
  private readonly llmProvider: LLMProvider;
  private readonly policyEngine?: PolicyEngine;
  private readonly auditService?: AuditService;

  public constructor(config: { 
    llmProvider: LLMProvider;
    policyEngine?: PolicyEngine;
    auditService?: AuditService;
  }) {
    this.llmProvider = config.llmProvider;
    this.policyEngine = config.policyEngine;
    this.auditService = config.auditService;
  }

  public async handleMessage(message: NormalizedMessage): Promise<AgentResponse> {
    // 1. Log incoming message to audit
    await this.auditService?.log({
      type: "message_received",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: { text: message.text, platform: message.platform },
    });

    const llmResult = await this.llmProvider.generate({
      systemPrompt:
        "You are Helmsman, a helpful DevOps assistant. Keep responses concise, safe, and actionable.",
      messages: [{ role: "user", content: message.text }],
    });

    // 2. Log LLM response
    await this.auditService?.log({
      type: "llm_response",
      userId: message.userId,
      correlationId: message.correlationId,
      metadata: { text: llmResult.text, model: llmResult.model },
    });

    return {
      correlationId: message.correlationId,
      status: "success",
      text: llmResult.text,
      metadata: {
        model: llmResult.model,
      },
    };
  }
}
