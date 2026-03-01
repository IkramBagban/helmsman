import { describe, expect, it } from "bun:test";
import { redactOutput } from "../../src/orchestrator/output-redactor.js";

describe("redactOutput", () => {
  it("should redact GitHub tokens and AWS-style key/value secrets", () => {
    const raw = "token=ghp_abcdefghijklmnopqrstuvwxyz123456 authorization: BearerSecret";
    const result = redactOutput(raw);
    expect(result).not.toContain("ghp_");
    expect(result).toContain("[REDACTED]");
  });

  it("should redact private key blocks", () => {
    const raw = "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactOutput(raw)).toBe("[REDACTED]");
  });
});
