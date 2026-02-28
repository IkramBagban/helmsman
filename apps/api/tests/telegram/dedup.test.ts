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
  it("should throw until implemented", async () => {
    const dedup = new RedisDedupStore();

    await expect(dedup.isDuplicate(1)).rejects.toMatchObject({
      code: "DEDUP_NOT_IMPLEMENTED",
    });
  });
});
