import type { PolicyDecision, ToolExecutionRequest, RiskTier } from "@helmsman/shared";

export interface PolicyEngine {
  evaluate(request: ToolExecutionRequest, riskTier: RiskTier): Promise<PolicyDecision>;
}

export class DefaultPolicyEngine implements PolicyEngine {
  public async evaluate(request: ToolExecutionRequest, riskTier: RiskTier): Promise<PolicyDecision> {
    switch (riskTier) {
      case "read_only":
      case "low_risk":
        return { action: "allow" };
      case "significant":
      case "destructive":
        return { 
          action: "require_approval", 
          reason: `Tool ${request.toolName} has risk tier ${riskTier} and requires explicit approval.` 
        };
      default:
        return { action: "deny", reason: "Unknown risk tier" };
    }
  }
}
