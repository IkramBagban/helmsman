import type { Agent } from "@mastra/core/agent";
import type { CapabilityRole, CapabilityStore } from "../capability-store.js";

export interface HelmsmanConfig {
  readonly routerAgent: Agent;
  readonly devopsAgent: Agent;
  readonly plannerAgent: Agent;
  readonly responderAgent: Agent;
  readonly capabilityStore?: CapabilityStore;
}

export interface ConversationTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface PendingActivationContinuation {
  readonly role: CapabilityRole;
  readonly activationId: string;
  readonly userId: string;
  readonly chatId: string;
  readonly command: string;
  readonly riskTier: string;
  readonly description: string;
  readonly correlationId: string;
  readonly createdAtMs: number;
}

export interface ApprovalValidationFailure {
  readonly valid: false;
  readonly reason: string;
  readonly missingValues?: string[];
}

export type ApprovalValidationResult =
  | { readonly valid: true }
  | ApprovalValidationFailure;
