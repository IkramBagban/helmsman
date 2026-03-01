import type { LLMMessage } from "../llm/provider.js";

export interface ConversationMemoryStore {
  getMessages(conversationId: string): readonly LLMMessage[];
  appendMessages(conversationId: string, messages: readonly LLMMessage[]): void;
}

export class InMemoryConversationMemoryStore implements ConversationMemoryStore {
  private readonly conversations = new Map<string, LLMMessage[]>();
  private readonly maxMessagesPerConversation: number;

  public constructor(config?: { maxMessagesPerConversation?: number }) {
    this.maxMessagesPerConversation = Math.max(config?.maxMessagesPerConversation ?? 12, 2);
  }

  public getMessages(conversationId: string): readonly LLMMessage[] {
    return this.conversations.get(conversationId) ?? [];
  }

  public appendMessages(conversationId: string, messages: readonly LLMMessage[]): void {
    const current = this.conversations.get(conversationId) ?? [];
    const next = [...current, ...messages];

    if (next.length <= this.maxMessagesPerConversation) {
      this.conversations.set(conversationId, next);
      return;
    }

    this.conversations.set(conversationId, next.slice(-this.maxMessagesPerConversation));
  }
}

