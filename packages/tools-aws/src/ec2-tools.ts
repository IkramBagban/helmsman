import { 
  EC2Client, 
  DescribeInstancesCommand, 
  RunInstancesCommand, 
  TerminateInstancesCommand 
} from "@aws-sdk/client-ec2";
import type { ToolExecutionResult, RiskTier } from "@helmsman/shared";
import { AwsTool, getRiskTierForAction } from "./base.js";

/**
 * Flexible EC2 Tool that takes an action and params.
 * This demonstrates how we can scale to 1000s of APIs by generalizing.
 */
export class GenericEc2Tool extends AwsTool {
  public readonly definition = {
    name: "aws:ec2:Execute",
    description: "Executes a generic EC2 command. Requires 'action' (e.g., 'DescribeInstances', 'RunInstances') and its associated 'params'.",
    parameters: {
      action: { type: "string" },
      params: { type: "object" }
    },
    riskTier: "significant" as RiskTier, // Defaults to high until validated
  };

  public get riskTier(): RiskTier {
    return getRiskTierForAction(this.lastAction || "significant");
  }

  private client = new EC2Client({});
  private lastAction?: string;

  public async execute(args: { action: string; params?: Record<string, any> }): Promise<ToolExecutionResult> {
    this.lastAction = args.action;
    try {
      // In a real implementation, we would use a dynamic router or 
      // a more structured mapping to Command classes.
      // For MVP, we switch on some common ones to prove the concept.
      let result;
      switch (args.action) {
        case "DescribeInstances":
          result = await this.client.send(new DescribeInstancesCommand(args.params || {}));
          break;
        case "RunInstances":
          result = await this.client.send(new RunInstancesCommand(args.params as any));
          break;
        case "TerminateInstances":
          result = await this.client.send(new TerminateInstancesCommand(args.params as any));
          break;
        default:
          throw new Error(`AWS EC2 action '${args.action}' not yet mapped in Helmsman.`);
      }

      return {
        success: true,
        output: JSON.stringify(result),
      };
    } catch (error) {
       return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
