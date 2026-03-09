import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { classifyAWSCommand } from "./classifier.js";
import { executeAWSCommand } from "./executor.js";
import type { ProviderPackage } from "@helmsman/shared";

export function createAwsProvider(requestActionTool: any): ProviderPackage {
  const awsReadTool = createTool({
    id: "aws_read",
    description: `Run any read-only AWS CLI command to inspect, list, or describe resources.
      Examples: list EC2 instances, describe S3 buckets, get CloudWatch metrics.
      Do NOT use for commands that create, modify, or delete anything.`,
    inputSchema: z.object({
      command: z.string().describe('Full AWS CLI command starting with "aws"'),
      reasoning: z.string().describe('Why you need this information'),
    }),
    execute: async (context) => {
      const tier = classifyAWSCommand(context.command);

      if (tier !== "read") {
        throw new Error(
          `This command is classified as "${tier}", not read-only. ` +
          `Use aws_write or aws_dangerous instead.`
        );
      }

      return await executeAWSCommand(context.command);
    },
  });

  const awsWriteTool = createTool({
    id: "aws_write",
    description: `Request approval to run a create or modify AWS CLI command.
      Use for: creating resources, updating configurations, starting/stopping instances.
      Do NOT use for destructive operations (delete, terminate, destroy).
      Returns an approval token — tell the user to send /approve TOKEN.`,
    inputSchema: z.object({
      userId: z.string(),
      chatId: z.string(),
      correlationId: z.string(),
      command: z.string().describe('Full AWS CLI command starting with "aws"'),
      plainEnglish: z.string().describe('Plain English: what will this do?'),
      resourceName: z.string().optional().describe('Name of the resource being affected'),
    }),
    execute: async (context) => {
      const tier = classifyAWSCommand(context.command);

      if (tier === "read") {
        throw new Error("This is a read-only command. Use aws_read instead.");
      }
      if (tier === "commander") {
        throw new Error("This is a destructive command. Use aws_dangerous instead.");
      }

      return await requestActionTool.execute({
        userId: context.userId,
        chatId: context.chatId,
        correlationId: context.correlationId,
        riskTier: "significant",
        description: context.plainEnglish,
        command: context.command,
      });
    },
  });

  const awsDangerousTool = createTool({
    id: "aws_dangerous",
    description: `Request confirmation to run a DESTRUCTIVE AWS CLI command.
      Use ONLY for: terminate instances, delete S3 buckets, delete RDS databases.
      These actions are IRREVERSIBLE. User must confirm by typing the resource identifier.
      Returns a confirmation token — tell the user to send /confirm RESOURCE_IDENTIFIER.`,
    inputSchema: z.object({
      userId: z.string(),
      chatId: z.string(),
      correlationId: z.string(),
      command: z.string().describe('Full AWS CLI command starting with "aws"'),
      plainEnglish: z.string().describe('Plain English: what will be permanently destroyed?'),
      resourceIdentifier: z.string().optional().describe('The exact resource ID or name user must type'),
      resourceName: z.string().optional().describe('Human-readable name of the resource'),
    }),
    execute: async (context) => {
      const tier = classifyAWSCommand(context.command);

      if (tier !== "commander") {
        throw new Error(
          `This command is classified as "${tier}", not destructive. ` +
          `Use aws_read or aws_write instead.`
        );
      }

      return await requestActionTool.execute({
        userId: context.userId,
        chatId: context.chatId,
        correlationId: context.correlationId,
        riskTier: "destructive",
        description: context.plainEnglish + " (Resource: " + (context.resourceIdentifier || context.resourceName || "unknown") + ")",
        command: context.command,
      });
    },
  });

  return {
    name: "aws",
    displayName: "Amazon Web Services",
    observerTools: [awsReadTool],
    operatorTools: [awsWriteTool],
    commanderTools: [awsDangerousTool],
  };
}
