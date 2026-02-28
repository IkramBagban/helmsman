import { describe, expect, it } from "bun:test";
import { InMemoryDedupStore, RedisDedupStore } from "../../src/telegram/dedup.js";

describe("InMemoryDedupStore", () => {
  it("should deduplicate updates", async () => {
    const dedup = new InMemoryDedupStore({ ttlMs: 1000, maxEntries: 10 });

    expect(await dedup.isDuplicate(1, 100)).toBe(false);
    expect(await dedup.isDuplicate(1, 200)).toBe(true);
    expect(await dedup.isDuplicate(1, 1300)).toBe(false);
  });

  it("should evict old entries when max size is reached", async () => {
    const dedup = new InMemoryDedupStore({ ttlMs: 10000, maxEntries: 2 });

    expect(await dedup.isDuplicate(1, 100)).toBe(false);
    expect(await dedup.isDuplicate(2, 200)).toBe(false);
    expect(await dedup.isDuplicate(3, 300)).toBe(false);
    expect(await dedup.isDuplicate(1, 400)).toBe(false);
  });
});

describe("RedisDedupStore", () => {
  it("should deduplicate using mocked redis", async () => {
    const mockRedis = {
      set: async (key: string) => {
        if (key.includes("duplicate")) return null;
        return "OK";
      },
    } as any;

    const dedup = new RedisDedupStore(mockRedis);

    expect(await dedup.isDuplicate(123)).toBe(false); // result "OK" => false
    
    const mockRedisDup = {
        set: async () => null
    } as any;
    const dedupDup = new RedisDedupStore(mockRedisDup);
    expect(await dedupDup.isDuplicate(123)).toBe(true); // result null => true
  });

  it("should fallback to false on redis error", async () => {
    const mockRedis = {
      set: async () => { throw new Error("Redis connection failure"); },
    } as any;

    const dedup = new RedisDedupStore(mockRedis);
    expect(await dedup.isDuplicate(1)).toBe(false);
  });
});
