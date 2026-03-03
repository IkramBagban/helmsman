import { MAX_HISTORY_TURNS, PENDING_CONTEXT_TTL_MS } from "./constants.js";
import type { PendingActivationContinuation, ConversationTurn } from "./types.js";
import type { CapabilityRole } from "../capability-store.js";

export class ConversationState {
  private readonly conversationHistory = new Map<string, ConversationTurn[]>();
  private readonly pendingActivationContinuations = new Map<string, PendingActivationContinuation>();

  public getConversationContext(chatId: string): string | undefined {
    const turns = this.conversationHistory.get(chatId);
    if (!turns || turns.length === 0) {
      return undefined;
    }

    return turns
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
      .join("\n");
  }

  public recordTurn(chatId: string, role: "user" | "assistant", text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const history = this.conversationHistory.get(chatId) ?? [];
    const next = [...history, { role, text: trimmed }].slice(-MAX_HISTORY_TURNS);
    this.conversationHistory.set(chatId, next);
  }

  public rememberActivationContinuation(input: {
    role: CapabilityRole;
    activationId: string;
    userId: string;
    chatId: string;
    command: string;
    riskTier: string;
    description: string;
    correlationId: string;
  }): void {
    this.pendingActivationContinuations.set(`${input.role}:${input.activationId.toUpperCase()}`, {
      role: input.role,
      activationId: input.activationId.toUpperCase(),
      userId: input.userId,
      chatId: input.chatId,
      command: input.command,
      riskTier: input.riskTier,
      description: input.description,
      correlationId: input.correlationId,
      createdAtMs: Date.now(),
    });
  }

  public consumeActivationContinuation(
    role: CapabilityRole,
    activationId: string,
    userId: string,
    chatId: string,
  ): PendingActivationContinuation | null {
    this.cleanupEphemeralState();
    const key = `${role}:${activationId.toUpperCase()}`;
    const entry = this.pendingActivationContinuations.get(key);
    if (!entry) {
      return null;
    }

    if (entry.userId !== userId || entry.chatId !== chatId || entry.role !== role) {
      return null;
    }

    this.pendingActivationContinuations.delete(key);
    return entry;
  }

  public cleanupEphemeralState(nowMs: number = Date.now()): void {
    for (const [key, entry] of this.pendingActivationContinuations.entries()) {
      if (nowMs - entry.createdAtMs > PENDING_CONTEXT_TTL_MS) {
        this.pendingActivationContinuations.delete(key);
      }
    }
  }
}
