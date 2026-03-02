import { describe, expect, it } from "bun:test";

import { normalizeAwsKnowledgeResponse } from "../src/tools/aws-knowledge.js";

describe("normalizeAwsKnowledgeResponse", () => {
  it("should normalize direct answer payloads", () => {
    const result = normalizeAwsKnowledgeResponse({
      answer: "S3 versioning is disabled by default.",
      references: [
        { title: "Using versioning in S3", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html" },
      ],
    });

    expect(result.answer).toContain("disabled by default");
    expect(result.references.length).toBe(1);
    expect(result.references[0]).toContain("Versioning");
  });

  it("should normalize nested result payloads", () => {
    const result = normalizeAwsKnowledgeResponse({
      result: {
        content: [
          { text: "EC2 API throttling varies by API and account context." },
          { text: "Use Service Quotas and CloudWatch to monitor limits." },
        ],
        citations: [
          "https://docs.aws.amazon.com/AWSEC2/latest/APIReference/throttling.html",
        ],
      },
    });

    expect(result.answer).toContain("EC2 API throttling");
    expect(result.answer).toContain("Service Quotas");
    expect(result.references[0]).toContain("AWSEC2");
  });

  it("should return fallback text when payload shape is unknown", () => {
    const result = normalizeAwsKnowledgeResponse({ foo: "bar" });

    expect(result.answer).toContain("no readable answer field");
    expect(result.references).toHaveLength(0);
  });
});
