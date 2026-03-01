import { describe, expect, it } from "bun:test";
import { createGitHubTools } from "../../src/index.js";

describe("createGitHubTools", () => {
  it("should register expected tool names", () => {
    const tools = createGitHubTools();
    const names = tools.map(tool => tool.definition.name);
    expect(names).toContain("github.search.repos");
    expect(names).toContain("github.issues.list");
    expect(names).toContain("github.search.code");
  });

  it("should fail authenticated code search without token", async () => {
    const tools = createGitHubTools();
    const tool = tools.find(item => item.definition.name === "github.search.code");
    if (!tool) throw new Error("missing tool");
    const result = await tool.execute({ query: "repo:owner/repo auth", perPage: 1, page: 1 }, { correlationId: "c", userId: "u", timeout: 1000 });
    expect(result.ok).toBe(false);
  });
});
