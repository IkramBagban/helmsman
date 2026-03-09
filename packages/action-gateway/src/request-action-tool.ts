import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { CapabilityStore } from "./capability-store.js";
import { createActionRequest } from "./request-action.js";

export const createRequestActionTool = (capabilityStore: CapabilityStore) =>
  createTool({
    id: "request_action",
    description: `Create an approval request for significant or destructive actions.
Use this before running write/delete infrastructure commands.
Returns either an activation command (/activate ...) or confirmation command (/approve or /confirm).`,
    inputSchema: z.object({
      userId: z.string().min(1),
      chatId: z.string().min(1),
      correlationId: z.string().min(1),
      riskTier: z.enum(["significant", "destructive"]),
      description: z.string().min(1),
      command: z.string().min(1),
    }),
    outputSchema: z.object({
      mode: z.enum(["activation_required", "approval_required"]),
      text: z.string(),
      approvalId: z.string().optional(),
      confirmationTarget: z.string().optional(),
    }),
    execute: async (inputData) => {
      const result = await createActionRequest({
        capabilityStore,
        userId: inputData.userId,
        chatId: inputData.chatId,
        riskTier: inputData.riskTier,
        description: inputData.description,
        command: inputData.command,
        correlationId: inputData.correlationId,
      });

      if (result.type === "activation_required") {
        const text = result.role === "operator"
          ? `Before I can run this safely, I need Operator access enabled for you.\n\nPlease send:\n/activate operator ${result.activationId}`
          : `This is a destructive action, so Commander access is required first.\n\nPlease send:\n/activate commander ${result.activationId}`;

        return {
          mode: "activation_required" as const,
          text,
        };
      }

      if (result.pendingAction.confirmationMode === "confirm_target") {
        return {
          mode: "approval_required" as const,
          text: `To confirm, type:\n/confirm ${result.pendingAction.confirmationTarget}`,
          approvalId: result.pendingAction.id,
          confirmationTarget: result.pendingAction.confirmationTarget,
        };
      }

      return {
        mode: "approval_required" as const,
        text: `To approve, type:\n/approve ${result.pendingAction.id}`,
        approvalId: result.pendingAction.id,
      };
    },
  });
