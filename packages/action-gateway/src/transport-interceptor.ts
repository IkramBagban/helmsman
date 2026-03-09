import type { AgentResponse } from "@helmsman/shared";

import type { CapabilityRole } from "./capability-store.js";

export interface ActionCommandInterceptorInput {
  readonly text: string;
  readonly userId: string;
  readonly chatId: string;
  readonly handleActivation: (
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ) => Promise<AgentResponse>;
  readonly handleApprovalByCode: (approvalId: string, userId: string, chatId: string) => Promise<AgentResponse>;
  readonly handleConfirmationByTarget: (target: string, userId: string, chatId: string) => Promise<AgentResponse>;
  readonly handleScheduleApproval?: (approvalId: string, userId: string, chatId: string) => Promise<string | null>;
}

export type ActionCommandInterceptResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly responseText: string };

export const interceptActionCommand = async (
  input: ActionCommandInterceptorInput,
): Promise<ActionCommandInterceptResult> => {
  const activateMatch = input.text.match(/^\/activate\s+(operator|commander)\s+([A-Z0-9]{6})$/i);
  if (activateMatch?.[1] && activateMatch?.[2]) {
    const role = activateMatch[1].toLowerCase() as CapabilityRole;
    const activationId = activateMatch[2].toUpperCase();
    const response = await input.handleActivation(role, activationId, input.userId, input.chatId);
    return { handled: true, responseText: response.text };
  }

  const approveMatch = input.text.match(/^\/approve\s+([a-zA-Z0-9-]{6,40})$/i);
  if (approveMatch?.[1]) {
    const approvalId = approveMatch[1];

    if (input.handleScheduleApproval) {
      const scheduleApproval = await input.handleScheduleApproval(approvalId, input.userId, input.chatId);
      if (scheduleApproval) {
        return { handled: true, responseText: scheduleApproval };
      }
    }

    const response = await input.handleApprovalByCode(approvalId, input.userId, input.chatId);
    return { handled: true, responseText: response.text };
  }

  const confirmMatch = input.text.match(/^\/confirm\s+([^\s]+)$/i);
  if (confirmMatch?.[1]) {
    const target = confirmMatch[1];
    const response = await input.handleConfirmationByTarget(target, input.userId, input.chatId);
    return { handled: true, responseText: response.text };
  }

  return { handled: false };
};
