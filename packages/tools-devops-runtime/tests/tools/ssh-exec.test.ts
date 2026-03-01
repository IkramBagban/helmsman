import { describe, expect, it } from "bun:test";
import { createDevopsRuntimeTools } from "../../src/index.js";

describe("devops.ssh.exec", () => {
  it("should expose significant ssh execution tool", () => {
    const tools = createDevopsRuntimeTools({ docker: {} as never });
    const tool = tools.find(item => item.definition.name === "devops.ssh.exec");
    expect(tool?.definition.riskTier).toBe("significant");
  });
});
