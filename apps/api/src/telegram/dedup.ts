import { Redis } from "ioredis";

import { AppError } from "@helmsman/shared";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

const DEFAULT_REDIS_TTL_SEC = 60 * 60; // 1 hour

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
  private readonly redis: Redis;
  private readonly ttlSec: number;
  private readonly prefix: string;

  public constructor(redis: Redis, config?: { ttlSec?: number; prefix?: string }) {
    this.redis = redis;
    this.ttlSec = config?.ttlSec ?? DEFAULT_REDIS_TTL_SEC;
    this.prefix = config?.prefix ?? "telegram:update:";
  }

  public async isDuplicate(updateId: number): Promise<boolean> {
    const key = `${this.prefix}${updateId}`;
    try {
      const result = await (this.redis as any).set(key, "1", "EX", this.ttlSec, "NX");
      return result === null;
    } catch (error) {
      console.error("RedisDedupStore error", { updateId, error });
      return false;
    }
  }
}
