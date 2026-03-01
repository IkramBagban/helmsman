import { describe, expect, it } from "bun:test";

import { DefaultPolicyEngine } from "../src/index";

describe("DefaultPolicyEngine", () => {
  it("should return user-friendly approval reason without internal tool details", async () => {
    const engine = new DefaultPolicyEngine();

    const decision = await engine.evaluate(
      {
        toolName: "shell.execute",
        parameters: { command: "aws ec2 stop-instances --instance-ids i-123" },
        correlationId: "corr-1",
        userId: "user-1",
      },
      "significant",
    );

    expect(decision.action).toBe("require_approval");
    expect(decision.reason?.toLowerCase()).toContain("requires your approval");
    expect(decision.reason).not.toContain("shell.execute");
    expect(decision.reason).not.toContain("significant");
  });
});
