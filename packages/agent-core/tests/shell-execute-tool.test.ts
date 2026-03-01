/**
 * Unit tests for shell-execute Mastra tool wrapper.
 *
 * Validates the tool schema, risk classification, and basic structure
 * without calling real shell commands.
 */

import { describe, expect, it } from "bun:test";
import { classifyShellCommandRisk } from "../src/tools/shell-execute.js";

describe("classifyShellCommandRisk", () => {
  it("should classify read-only commands as read_only", () => {
    expect(classifyShellCommandRisk("aws ec2 describe-instances --region us-east-1")).toBe("read_only");
    expect(classifyShellCommandRisk("aws s3api list-buckets")).toBe("read_only");
    expect(classifyShellCommandRisk("kubectl get pods -n default")).toBe("read_only");
  });

  it("should classify destructive commands as destructive", () => {
    expect(classifyShellCommandRisk("aws ec2 terminate-instances --instance-ids i-123")).toBe("destructive");
  });

  it("should classify modification commands as significant", () => {
    expect(classifyShellCommandRisk("aws ec2 stop-instances --instance-ids i-123")).toBe("significant");
  });
});

describe("shellExecuteTool structure", () => {
  it("should be importable and have expected properties", async () => {
    const { shellExecuteTool } = await import("../src/tools/shell-execute.js");
    expect(shellExecuteTool).toBeDefined();
    expect(shellExecuteTool.id).toBe("shell_execute");
    expect(shellExecuteTool.description).toContain("Execute a CLI command");
  });
});
