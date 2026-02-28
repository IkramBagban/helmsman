import type { RiskTier, ToolDefinition, ToolExecutionResult } from "@helmsman/shared";

export abstract class AwsTool {
  public abstract readonly definition: ToolDefinition;
  
  /**
   * Every AWS tool must specify its risk tier for the Policy Engine.
   */
  public abstract readonly riskTier: RiskTier;

  /**
   * The actual SDK execution logic.
   */
  public abstract execute(params: Record<string, any>): Promise<ToolExecutionResult>;
}

/**
 * Maps AWS SDK actions to Risk Tiers
 */
export const AWS_RISK_MAPPING: Record<string, RiskTier> = {
  // Read-only (Default: read_only)
  "list": "read_only",
  "get": "read_only",
  "describe": "read_only",
  
  // State changes (Default: low_risk)
  "create": "low_risk",
  "update": "low_risk",
  "tag": "low_risk",
  
  // Dangerous (Default: significant)
  "delete": "significant",
  "terminate": "significant",
  "stop": "significant",
  
  // Critical (Default: destructive)
  "purge": "destructive",
  "detach": "significant",
};

export function getRiskTierForAction(action: string): RiskTier {
  const lowerAction = action.toLowerCase();
  for (const [prefix, tier] of Object.entries(AWS_RISK_MAPPING)) {
    if (lowerAction.startsWith(prefix)) return tier;
  }
  return "significant"; // Conservative default
}
