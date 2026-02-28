import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import type { ToolExecutionResult, RiskTier } from "@helmsman/shared";
import { AwsTool } from "./base.js";

export class ListS3BucketsTool extends AwsTool {
  public readonly definition = {
    name: "aws:s3:ListBuckets",
    description: "Lists all S3 buckets in the current AWS account.",
    parameters: {},
    riskTier: "read_only" as RiskTier,
  };

  public readonly riskTier = "read_only" as RiskTier;

  private client = new S3Client({});

  public async execute(): Promise<ToolExecutionResult> {
    try {
      const command = new ListBucketsCommand({});
      const response = await this.client.send(command);

      return {
        success: true,
        output: JSON.stringify(response.Buckets ?? []),
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
