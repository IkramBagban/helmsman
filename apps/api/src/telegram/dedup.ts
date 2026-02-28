import { AppError } from "@helmsman/shared";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

export interface DedupStore {
  isDuplicate(updateId: number, nowMs?: number): Promise<boolean>;
}

export class InMemoryDedupStore implements DedupStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly seenUpdates: Map<number, number>;

  public constructor(config?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.seenUpdates = new Map<number, number>();
  }

  public async isDuplicate(updateId: number, nowMs: number = Date.now()): Promise<boolean> {
    this.cleanup(nowMs);
    if (this.seenUpdates.has(updateId)) {
      return true;
    }

    this.seenUpdates.set(updateId, nowMs);
    if (this.seenUpdates.size > this.maxEntries) {
      const oldestUpdateId = this.seenUpdates.keys().next().value;
      if (oldestUpdateId !== undefined) {
        this.seenUpdates.delete(oldestUpdateId);
      }
    }

    return false;
  }

  private cleanup(nowMs: number): void {
    for (const [updateId, timestamp] of this.seenUpdates.entries()) {
      if (nowMs - timestamp > this.ttlMs) {
        this.seenUpdates.delete(updateId);
      }
    }
  }
}

export class RedisDedupStore implements DedupStore {
  public async isDuplicate(_updateId: number, _nowMs: number = Date.now()): Promise<boolean> {
    throw new AppError("DEDUP_NOT_IMPLEMENTED", "RedisDedupStore is not implemented yet");
  }
}
