import { describe, expect, it } from "bun:test";
import { createDevopsRuntimeTools } from "../../src/index.js";

describe("devops.git.clone", () => {
  it("should expose low-risk git clone tool", () => {
    const tools = createDevopsRuntimeTools({ docker: {} as never });
    const tool = tools.find(item => item.definition.name === "devops.git.clone");
    expect(tool?.definition.riskTier).toBe("low_risk");
  });
});
