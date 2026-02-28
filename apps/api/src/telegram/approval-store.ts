import { randomUUID } from "node:crypto";

interface PendingApproval {
  readonly approvalId: string;
  readonly userId: string;
  readonly chatId: string;
  readonly correlationId: string;
  readonly toolName: string;
  readonly parameters: Record<string, unknown>;
  readonly createdAtMs: number;
}

export class InMemoryApprovalStore {
  private readonly ttlMs: number;
  private readonly items: Map<string, PendingApproval>;

  public constructor(config?: { ttlMs?: number }) {
    this.ttlMs = config?.ttlMs ?? 15 * 60 * 1000;
    this.items = new Map<string, PendingApproval>();
  }

  public create(input: Omit<PendingApproval, "approvalId" | "createdAtMs">): PendingApproval {
    this.cleanup(Date.now());
    const record: PendingApproval = {
      ...input,
      approvalId: randomUUID().slice(0, 8),
      createdAtMs: Date.now(),
    };

    this.items.set(record.approvalId, record);
    return record;
  }

  public consume(approvalId: string, userId: string, chatId: string): PendingApproval | null {
    this.cleanup(Date.now());
    const item = this.items.get(approvalId);
    if (!item) {
      return null;
    }

    if (item.userId !== userId || item.chatId !== chatId) {
      return null;
    }

    this.items.delete(approvalId);
    return item;
  }

  private cleanup(nowMs: number): void {
    for (const [approvalId, item] of this.items.entries()) {
      if (nowMs - item.createdAtMs > this.ttlMs) {
        this.items.delete(approvalId);
      }
    }
  }
}
