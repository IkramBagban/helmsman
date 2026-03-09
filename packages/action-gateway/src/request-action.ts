import { randomUUID } from "node:crypto";

import type { CapabilityRole, CapabilityStore, PendingActionRecord } from "./capability-store.js";

export interface ActivationContinuationPayload {
  readonly role: CapabilityRole;
  readonly activationId: string;
  readonly userId: string;
  readonly chatId: string;
  readonly command: string;
  readonly riskTier: string;
  readonly description: string;
  readonly correlationId: string;
}

export interface CreateActionRequestInput {
  readonly capabilityStore: CapabilityStore;
  readonly userId: string;
  readonly chatId: string;
  readonly riskTier: string;
  readonly description: string;
  readonly command: string;
  readonly correlationId: string;
  readonly rememberActivationContinuation?: (payload: ActivationContinuationPayload) => void;
}

export type CreateActionRequestResult =
  | {
    readonly type: "activation_required";
    readonly role: CapabilityRole;
    readonly activationId: string;
  }
  | {
    readonly type: "approval_required";
    readonly role: CapabilityRole;
    readonly pendingAction: PendingActionRecord;
  };

const roleForRisk = (riskTier: string): CapabilityRole =>
  riskTier === "destructive" ? "commander" : "operator";

export const createActionRequest = async (
  input: CreateActionRequestInput,
): Promise<CreateActionRequestResult> => {
  const requiredRole = roleForRisk(input.riskTier);
  const roleState = await input.capabilityStore.getRoleState(input.userId, input.chatId);

  const operatorActive = roleState.operator.active;
  const commanderActive = roleState.commander.active;

  if (!operatorActive && (requiredRole === "operator" || requiredRole === "commander")) {
    const activation = await input.capabilityStore.createActivation({
      role: "operator",
      userId: input.userId,
      chatId: input.chatId,
    });

    input.rememberActivationContinuation?.({
      role: "operator",
      activationId: activation.id,
      userId: input.userId,
      chatId: input.chatId,
      command: input.command,
      riskTier: input.riskTier,
      description: input.description,
      correlationId: input.correlationId,
    });

    return {
      type: "activation_required",
      role: "operator",
      activationId: activation.id,
    };
  }

  if (requiredRole === "commander" && !commanderActive) {
    const activation = await input.capabilityStore.createActivation({
      role: "commander",
      userId: input.userId,
      chatId: input.chatId,
    });

    input.rememberActivationContinuation?.({
      role: "commander",
      activationId: activation.id,
      userId: input.userId,
      chatId: input.chatId,
      command: input.command,
      riskTier: input.riskTier,
      description: input.description,
      correlationId: input.correlationId,
    });

    return {
      type: "activation_required",
      role: "commander",
      activationId: activation.id,
    };
  }

  const confirmationMode = requiredRole === "commander" ? "confirm_target" : "approve_code";
  const confirmationTarget = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();

  const pendingAction = await input.capabilityStore.createPendingAction({
    role: requiredRole,
    userId: input.userId,
    chatId: input.chatId,
    runId: randomUUID(),
    riskTier: input.riskTier,
    description: input.description,
    command: input.command,
    confirmationMode,
    confirmationTarget,
  });

  return {
    type: "approval_required",
    role: requiredRole,
    pendingAction,
  };
};
