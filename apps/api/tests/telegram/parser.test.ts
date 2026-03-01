import { describe, expect, it } from "bun:test";

import { parseTelegramUpdate } from "../../src/telegram/parser.js";

describe("parseTelegramUpdate", () => {
  it("should parse a text update", () => {
    const result = parseTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 2,
        from: { id: 3, first_name: "Test" },
        chat: { id: 4, type: "private" },
        date: 1_700_000_000,
        text: "hello",
      },
    });

    expect(result?.text).toBe("hello");
    expect(result?.platform).toBe("telegram");
  });

  it("should extract latest user utterance from transcript-like pasted text", () => {
    const result = parseTelegramUpdate({
      update_id: 2,
      message: {
        message_id: 3,
        from: { id: 4, first_name: "Test" },
        chat: { id: 5, type: "private" },
        date: 1_700_000_100,
        text: [
          "Ikram: list my buckets",
          "Jack: I found 10 buckets",
          "Ikram: in 4th one can you tell me files and config",
        ].join("\n"),
      },
    });

    expect(result?.text).toBe("in 4th one can you tell me files and config");
  });
});
