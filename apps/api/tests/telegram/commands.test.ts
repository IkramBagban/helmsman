import { describe, expect, it } from "bun:test";

import { getCommandResponse } from "../../src/telegram/commands";

describe("getCommandResponse", () => {
  it("should return start response", () => {
    const response = getCommandResponse(
      {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 1, first_name: "A" },
          chat: { id: 1, type: "private" },
          date: 123,
          text: "/start",
        },
      },
      "corr",
    );

    expect(response?.status).toBe("success");
    expect(response?.text.includes("Helmsman")).toBeTrue();
  });
});
