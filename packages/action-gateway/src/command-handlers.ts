import type { AgentResponse } from "@helmsman/shared";

import type {
  CapabilityRole,
  CapabilityStore,
  PendingActionRecord,
} from "./capability-store.js";
import type { ActivationContinuationPayload } from "./request-action.js";

export interface ActivationContinuationRecord extends ActivationContinuationPayload {}

export interface CommandHandlerDependencies {
  readonly capabilityStore: CapabilityStore;
  readonly consumeActivationContinuation: (input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
  }) => ActivationContinuationRecord | null;
  readonly continueAfterActivation: (continuation: ActivationContinuationRecord) => Promise<AgentResponse>;
  readonly executeApprovedAction: (pendingAction: PendingActionRecord) => Promise<AgentResponse>;
}

export interface ActionCommandHandlers {
  handleApprovalByCode(approvalId: string, userId: string, chatId: string): Promise<AgentResponse>;
  handleConfirmationByTarget(target: string, userId: string, chatId: string): Promise<AgentResponse>;
  handleActivation(
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ): Promise<AgentResponse>;
}

export const createActionCommandHandlers = (
  dependencies: CommandHandlerDependencies,
): ActionCommandHandlers => ({
  async handleApprovalByCode(approvalId: string, userId: string, chatId: string): Promise<AgentResponse> {
    const pendingAction = await dependencies.capabilityStore.consumePendingActionByCode({
      userId,
      chatId,
      value: approvalId,
    });

    if (!pendingAction) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Approval request not found, expired, or already used.",
      };
    }

    return await dependencies.executeApprovedAction(pendingAction);
  },

  async handleConfirmationByTarget(target: string, userId: string, chatId: string): Promise<AgentResponse> {
    const pendingAction = await dependencies.capabilityStore.consumePendingActionByTarget({
      userId,
      chatId,
      value: target.trim(),
    });

    if (!pendingAction) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Confirmation target not found, expired, or already used.",
      };
    }

    return await dependencies.executeApprovedAction(pendingAction);
  },

  async handleActivation(
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ): Promise<AgentResponse> {
    const activation = await dependencies.capabilityStore.consumeActivation({
      role,
      activationId: activationId.toUpperCase(),
      userId,
      chatId,
    });

    if (!activation) {
      return {
        correlationId: crypto.randomUUID(),
        status: "error",
        text: "Activation request not found, expired, already used, or not owned by you.",
      };
    }

    const state = await dependencies.capabilityStore.activateRole({ role, userId, chatId });
    const expiryMs = role === "operator" ? state.operator.expiresAtMs : state.commander.expiresAtMs;
    const expiryText = expiryMs
      ? new Date(expiryMs).toISOString().replace("T", " ").replace(".000Z", " UTC")
      : "(unknown)";

    const continuation = dependencies.consumeActivationContinuation({
      role,
      activationId: activationId.toUpperCase(),
      userId,
      chatId,
    });

    if (!continuation) {
      return {
        correlationId: crypto.randomUUID(),
        status: "success",
        text: `${role === "operator" ? "Operator" : "Commander"} access is active until ${expiryText}.`,
      };
    }

    return await dependencies.continueAfterActivation(continuation);
  },
});
