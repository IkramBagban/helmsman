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
});
